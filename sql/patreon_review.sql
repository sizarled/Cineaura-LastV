-- CineAura — Patreon buyers REVIEW (Panel > Patreon)
--   Patreon's creator tools let you download the buyers/members list as a CSV.
--   The owner uploads it here (patreon_import), then runs the review
--   (patreon_review_admin): every claim the code-activation page ever issued
--   is checked against that list —
--     · a claim whose Patreon account does not appear in the uploaded list is
--       flagged "mismatch",
--     · when two claims share one Patreon account text, the EARLIEST claim is
--       the original that stays; every later one is flagged "duplicate".
--   One click (patreon_ban_flags) then bans the flagged set: the claim dies
--   (the page never serves its code again), its unused serial returns to the
--   point-code stock, and — even when the code was already spent and the
--   membership activated — the site account that redeemed it is banned.
--   patreon_unban lifts the ban again (the stay of ban is the reversible kind
--   Panel > Accounts uses).
--
-- Run in the Supabase SQL editor AFTER patreon.sql, point_codes.sql,
-- panel.sql and account_deadline.sql. Safe to run more than once.

-- ------------------------------------------------------------------ 1. the buyers list (from the Patreon CSV)
create table if not exists public.patreon_buyers (
  id bigint generated always as identity primary key,
  norm text not null unique,               -- the main match key: user id, else email, else name
  keys text[] not null default '{}',       -- every match key this buyer may be known by
  label text not null default '',          -- the display name the CSV showed
  product text not null default '',
  amount_cents int,
  currency text not null default '',
  source text not null default '',         -- which import this came from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.patreon_buyers enable row level security;  -- no policies: RPC-only
revoke all on public.patreon_buyers from anon, authenticated;

-- The claim ban: the page keeps saying "flagged" instead of serving the code again.
alter table public.patreon_claims add column if not exists banned_at timestamptz;
alter table public.patreon_claims add column if not exists ban_note text not null default '';

-- ------------------------------------------------------------------ 2. helpers
create or replace function public._patreon_norm(s text) returns text
language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce($1, '')), '\s+', ' ', 'g'))
$$;

-- The staff member with the Patreon section (or the Super Admin). -> who
create or replace function public._patreon_staff(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.staff; secs text;
begin
  if to_regprocedure('public._staff(text)') is null then raise exception 'staff_setup'; end if;
  s := public._staff(p_token);
  secs := ',' || replace(coalesce(s.sections, ''), ' ', '') || ',';
  if s.role <> 'super' and position(',patreon,' in secs) = 0 then raise exception 'staff_forbidden'; end if;
  return coalesce(nullif(s.username, ''), s.role);
end $$;

-- ------------------------------------------------------------------ 3. import the CSV rows
-- rows: [{ email, name, uid, product, amount_cents, currency }]
create or replace function public.patreon_import(p_token text, rows jsonb, p_source text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who text; line jsonb;
  v_email text; v_name text; v_uid text; v_keys text[]; v_norm text;
  v_label text; v_product text; v_cents int; v_currency text;
  v_added int := 0; v_updated int := 0; v_source text := left(btrim(coalesce(p_source, '')), 80);
begin
  begin
    who := public._patreon_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;
  if jsonb_typeof(rows) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'rows'); end if;

  for line in select jsonb_array_elements(rows) loop
    v_email := public._patreon_norm(line->>'email');
    v_uid   := lower(btrim(coalesce(line->>'uid', '')));
    v_name  := public._patreon_norm(line->>'name');
    v_keys := array_remove(array(select distinct k from (values (v_uid), (v_email), (v_name)) t(k) where k <> ''), null);
    if coalesce(array_length(v_keys, 1), 0) = 0 then continue; end if;
    v_norm := coalesce(nullif(v_uid, ''), nullif(v_email, ''), v_name);
    v_label := left(coalesce(nullif(btrim(coalesce(line->>'name', '')), ''), nullif(btrim(coalesce(line->>'email', '')), ''), v_norm), 120);
    v_product := left(btrim(coalesce(line->>'product', '')), 160);
    begin v_cents := nullif(round((line->>'amount_cents')::numeric), 0); exception when others then v_cents := null; end;
    if v_cents is not null then v_cents := greatest(0, v_cents::int); end if;
    v_currency := upper(left(btrim(coalesce(line->>'currency', '')), 3));

    insert into public.patreon_buyers (norm, keys, label, product, amount_cents, currency, source)
    values (v_norm, v_keys, v_label, v_product, v_cents, v_currency, v_source)
    on conflict (norm) do update
       set keys = (select array(select distinct k from unnest(public.patreon_buyers.keys || excluded.keys) k)),
           label = case when excluded.label <> '' then excluded.label else public.patreon_buyers.label end,
           product = case when excluded.product <> '' then excluded.product else public.patreon_buyers.product end,
           amount_cents = coalesce(excluded.amount_cents, public.patreon_buyers.amount_cents),
           currency = case when excluded.currency <> '' then excluded.currency else public.patreon_buyers.currency end,
           source = case when excluded.source <> '' then excluded.source else public.patreon_buyers.source end,
           updated_at = now();
    if found then
      if (select updated_at = created_at from public.patreon_buyers where norm = v_norm) then v_added := v_added + 1;
      else v_updated := v_updated + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'added', v_added, 'updated', v_updated,
                            'total', (select count(*) from public.patreon_buyers));
end $$;

-- ------------------------------------------------------------------ 4. the flags — who fails the review
-- "mismatch": claimed with an account text that has NO key in the buyers list.
-- "duplicate": a second (third…) claim of the same account text — the first stays.
create or replace function public._patreon_flags() returns table(claim_id bigint, why text)
language sql stable security definer set search_path = public as $$
  with has_list as (select exists (select 1 from public.patreon_buyers) ok),
  bkeys as (select distinct unnest(keys) k from public.patreon_buyers),
  ac as (
    select c.id, public._patreon_norm(c.account) norm, min(c.id) over (partition by public._patreon_norm(c.account)) first_id
      from public.patreon_claims c
     where c.banned_at is null
  )
  (select ac.id, 'mismatch'
     from ac, has_list
    where has_list.ok and ac.norm <> ''
      and not exists (select 1 from bkeys where bkeys.k = ac.norm))
  union all
  (select id, 'duplicate' from ac where norm <> '' and id <> first_id)
$$;

-- ------------------------------------------------------------------ 5. Panel > Patreon: the whole board
create or replace function public.patreon_review_admin(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  begin
    who := public._patreon_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;
  return jsonb_build_object(
    'ok', true,
    'buyers', (select count(*) from public.patreon_buyers),
    'claims', coalesce((select jsonb_agg(row_to_json(q) order by q.created_at desc) from (
        select c.id, c.account, c.code, c.kind, coalesce((c.payload->>'points')::int, 0) points,
               c.banned_at is not null banned, c.ban_note, c.created_at,
               (select string_agg(u.member_id, ', ' order by u.used_at) from public.point_code_uses u where u.code = c.code) member
          from public.patreon_claims c) q), '[]'::jsonb),
    'flagged', coalesce((select jsonb_agg(row_to_json(q) order by q.why, q.id) from (
        select f.claim_id id, f.why, c.account, c.code, coalesce((c.payload->>'points')::int, 0) points,
               (select string_agg(u.member_id, ', ' order by u.used_at) from public.point_code_uses u where u.code = c.code) member
          from public._patreon_flags() f join public.patreon_claims c on c.id = f.claim_id) q), '[]'::jsonb)
  );
end $$;

-- ------------------------------------------------------------------ 6. one click: ban every flagged claim
create or replace function public.patreon_ban_flags(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who text; f record; c record; usr record;
  n_claims int := 0; n_members int := 0; n_released int := 0; v_used boolean;
begin
  begin
    who := public._patreon_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;

  for f in select * from public._patreon_flags() loop
    select * into c from public.patreon_claims where id = f.claim_id and banned_at is null for update;
    if not found then continue; end if;
    update public.patreon_claims set banned_at = now(), ban_note = 'patreon_review:' || f.why where id = c.id;
    n_claims := n_claims + 1;

    v_used := exists (select 1 from public.point_code_uses u where u.code = c.code);
    if not v_used then
      -- the serial was never spent: release it back to the stock for a genuine buyer
      update public.point_codes
         set reserved_by = '', reserved_at = null
       where code = c.code and reserved_by = 'PATREON:' || c.patreon_user_id;
      if found then n_released := n_released + 1; end if;
    else
      -- the code was spent — maybe the membership already activated: ban every site account that used it
      for usr in select distinct member_id from public.point_code_uses where code = c.code loop
        if to_regprocedure('public._account_is_staff(text)') is not null and public._account_is_staff(usr.member_id) then
          continue;
        end if;
        update public.members
           set status = 'banned', banned_at = coalesce(banned_at, now())
         where member_id = usr.member_id and lower(coalesce(status, '')) <> 'banned';
        if found then
          n_members := n_members + 1;
          if to_regclass('public.movielink') is not null then
            execute 'delete from public.movielink where member_id = $1' using usr.member_id;
          end if;
          if to_regclass('public.tvlink') is not null then
            execute 'delete from public.tvlink where member_id = $1' using usr.member_id;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'banned_claims', n_claims,
                            'banned_members', n_members, 'released', n_released, 'by', who);
end $$;

-- ------------------------------------------------------------------ 7. …and back
create or replace function public.patreon_unban(p_token text, p_claim bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text; c record; usr record;
begin
  begin
    who := public._patreon_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;
  select * into c from public.patreon_claims where id = p_claim for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'claim'); end if;
  update public.patreon_claims set banned_at = null, ban_note = '' where id = c.id;
  -- the accounts this claim's banned code put in the ban state come back active
  for usr in select distinct member_id from public.point_code_uses where code = c.code loop
    update public.members set status = 'active'
     where member_id = usr.member_id and lower(coalesce(status, '')) = 'banned';
  end loop;
  return jsonb_build_object('ok', true, 'claim', p_claim);
end $$;

-- ------------------------------------------------------------------ 8. the page never serves a banned claim's code again
-- (full body copied from sql/patreon.sql with the ban guard added on top)
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
  select * into v_existing from public.patreon_claims where patreon_user_id = p_user for update;
  if found then
    -- a claim the buyers review banned: the page says "flagged", never a code again
    if v_existing.banned_at is not null then
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
    if to_regclass('public.withdraw_settings') is not null then
      select rate into v_rate from public.withdraw_settings where id = 1 limit 1;
    end if;
    v_rate := greatest(1, coalesce(v_rate, 100));
    v_points := ceil(v_cents::numeric * v_rate / 100.0)::int;
  end if;

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
    v_payload := v_payload || jsonb_build_object('from', 'membership', 'plan', coalesce(p_membership, ''));
  end if;

  insert into public.patreon_claims (patreon_user_id, account, kind, code, payload)
  values (p_user, coalesce(p_account, ''), 'points', v_pc.code, v_payload);

  return jsonb_build_object('ok', true, 'reused', false, 'kind', 'points', 'code', v_pc.code, 'detail', v_payload);
end;
$$;

-- ------------------------------------------------------------------ 9. grants
grant select, insert, update on public.patreon_buyers to postgres, service_role;
revoke all on function public._patreon_norm(text), public._patreon_staff(text), public._patreon_flags() from public, anon, authenticated;
revoke all on function public.patreon_import(text, jsonb, text), public.patreon_review_admin(text),
              public.patreon_ban_flags(text), public.patreon_unban(text, bigint) from public;
grant execute on function public.patreon_import(text, jsonb, text), public.patreon_review_admin(text),
                public.patreon_ban_flags(text), public.patreon_unban(text, bigint) to anon, authenticated;
revoke execute on function public.patreon_claim(text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.patreon_claim(text, text, text, text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
