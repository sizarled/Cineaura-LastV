-- Patreon → POINTS code delivery (codeactivation page)
-- Run in the Supabase SQL editor after point_codes.sql — and run
-- sql/patreon_review.sql after it (the Panel > Patreon buyers review, which
-- can ban a claim; this file's claim guard needs its columns).
--
-- The site sells ONE kind of thing on Patreon: points codes. The page at
-- codeactivation.html asks the visitor for his Patreon account and walks him
-- through Patreon's own OAuth; the edge function (supabase/functions/
-- patreon-claim) confirms the paid purchase of YOUR campaign with Patreon's
-- API and calls the function below, which takes ONE unused serial out of the
-- point_codes stock, reserves it for this Patreon identity, and returns it.
-- Every new visit of the same Patreon account returns the SAME code again
-- (nobody can farm the stock with OAuth retries), and the serial is reserved
-- with the dedicated `reserved_by` column so the redemption systems keep
-- working with it exactly like any other code.
--
-- Value rule — the points equal the money: with the default withdrawal rate
-- (100 points per 1 unit of the currency → 1 point = 1 cent) a $5 tier gives
-- a 500-point serial. The delivered value comes from, in order:
--   1. an explicit p_points (a tier map entry {"kind":"points","points":500});
--   2. p_price_cents (tier map {"price_cents":500}, or the amount Patreon
--      reports the patron is entitled to);
--   3. any available serial, when nothing pins the value.
-- A legacy p_kind='membership' request (old tier maps) is TRANSLATED to its
-- money price in points (Silver $5 → 500, Gold $10 → 1000, Diamond $20 →
-- 2000): the stock touched is point_codes only, forever. Memberships are
-- bought with points inside the dashboard now (sql/membership_points.sql).
--
-- Safe to run more than once.

-- ---------------------------------------------------------------- 1. the claims journal
create table if not exists public.patreon_claims (
  id bigint generated always as identity primary key,
  patreon_user_id text not null unique,
  account text not null default '',           -- what the visitor typed into the box
  kind text not null check (kind in ('membership', 'points')),
  code text not null unique,
  payload jsonb not null default '{}'::jsonb, -- points / price_cents (legacy rows: membership_type/duration)
  created_at timestamptz not null default now()
);
comment on table public.patreon_claims is 'Which Patreon identity received which code — one claim per identity, forever idempotent. New claims are always points codes.';

alter table public.patreon_claims enable row level security;
-- the journal is private: only the edge function (service role) reads or writes it
drop policy if exists "PatreonClaims read" on public.patreon_claims;
drop policy if exists "PatreonClaims write" on public.patreon_claims;

-- ------------------------------------------------ 2. the reservation marker on the stock
alter table public.point_codes add column if not exists reserved_by text;
alter table public.point_codes add column if not exists reserved_at timestamptz;
comment on column public.point_codes.reserved_by is 'PATREON:<user id> when the serial was handed out on the Patreon activation page (redemption still works normally)';

-- ---------------------------------------------------------------- 3. the claim itself
-- (the old 6-parameter shape is replaced by this one with p_price_cents)
drop function if exists public.patreon_claim(text, text, text, text, text, integer);

create or replace function public.patreon_claim(
  p_user text,
  p_account text,
  p_kind text default 'points',
  p_membership text default null,
  p_duration text default null,
  p_points integer default null,
  p_price_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_pc record;
  v_payload jsonb;
  v_cents int;
  v_points int;
  v_rate int := 100;
begin
  -- The same Patreon identity always sees the same code — including codes
  -- handed out before the points-only switch (legacy kind='membership' rows
  -- come back untouched from here). A claim banned by the buyers review
  -- (sql/patreon_review.sql) gets the "banned" answer and never a code again.
  select * into v_existing from public.patreon_claims where patreon_user_id = p_user for update;
  if found then
    if to_regclass('public.patreon_buyers') is not null and v_existing.banned_at is not null then
      return jsonb_build_object('ok', false, 'reason', 'banned');
    end if;
    return jsonb_build_object(
      'ok', true, 'reused', true,
      'kind', v_existing.kind,
      'code', v_existing.code,
      'detail', v_existing.payload
    );
  end if;

  -- Everything new is a points claim. A legacy membership request is worth
  -- the plan's public money price, turned into points instead.
  v_cents := p_price_cents;
  if p_kind = 'membership' then
    v_cents := case p_membership
                 when 'Silver' then 500
                 when 'Gold' then 1000
                 when 'Diamond' then 2000
                 else null
               end;
    if v_cents is null then v_cents := p_price_cents; end if;
  end if;

  v_points := p_points;
  if v_points is null and v_cents is not null and v_cents > 0 then
    -- the equality rule: points = price-in-dollars × rate (1 pt = 1 cent at 100)
    if to_regclass('public.withdraw_settings') is not null then
      select rate into v_rate from public.withdraw_settings where id = 1 limit 1;
    end if;
    v_rate := greatest(1, coalesce(v_rate, 100));
    v_points := ceil(v_cents::numeric * v_rate / 100.0)::int;
  end if;

  -- One unused public serial nobody reserved and nobody pre-assigned.
  select code, points
    into v_pc
    from public.point_codes
   where used = false
     and uses < max_uses
     and coalesce(reserved_by, '') = ''
     and coalesce(member_id, '') = ''
     and coalesce(audience, 'public') = 'public'
     and (expires_at is null or expires_at > now())
     and (v_points is null or points = v_points)
   order by created_at
   limit 1
   for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'sold_out', 'detail', jsonb_build_object('wanted_points', v_points));
  end if;

  update public.point_codes
     set reserved_by = 'PATREON:' || p_user,
         reserved_at = now()
   where code = v_pc.code;

  v_payload := jsonb_build_object('points', v_pc.points);
  if v_cents is not null then
    v_payload := v_payload || jsonb_build_object('price_cents', v_cents);
  end if;
  if p_kind = 'membership' then
    -- remember the request started as a membership (from an old tier map)
    v_payload := v_payload || jsonb_build_object('from', 'membership', 'plan', coalesce(p_membership, ''));
  end if;

  insert into public.patreon_claims (patreon_user_id, account, kind, code, payload)
  values (p_user, coalesce(p_account, ''), 'points', v_pc.code, v_payload);

  return jsonb_build_object('ok', true, 'reused', false, 'kind', 'points', 'code', v_pc.code, 'detail', v_payload);
end;
$$;

-- Supabase's default privileges hand EXECUTE of every brand-new function to
-- anon/authenticated — take it back explicitly (revoking from public alone
-- does not, on this platform, touch those two roles).
revoke execute on function public.patreon_claim(text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.patreon_claim(text, text, text, text, text, integer, integer) to service_role;
