-- Buy a membership with POINTS (no Patreon, no money code) — prices follow
-- Panel > Plans (sql/plans.sql): its points price, its months, and its pricing
-- system (a money-only plan leaves this shop entirely). Without that table the
-- rule is equality with the monthly money price × the withdrawal rate (100
-- points = $1 by default), Silver $5/month, Gold $10, Diamond $20 — 500 /
-- 1000 / 2000 points — and an owner override may sit in
-- panel_settings.membership_points_prices (JSON, e.g. {"Silver":450,...}).
--
-- Buy flow (Dashboard → Points → "Buy a membership with points"): the member
-- taps a plan → membership_buy_with_points() spends check-and-deduct inside the
-- SAME locked transaction the prizes use (_spend_prize), then hands the
-- months to _account_set_plan — the exact helper the activation codes use, so
-- a plan still running gets the months stacked onto its expiry. One tap, the
-- membership starts immediately; nothing to copy or type.
--
-- Run in the Supabase SQL editor AFTER prize_secure.sql and packages.sql.
-- Safe to run more than once.

-- ── 1 · optional owner-set prices (null/absent → money price × rate) ─────────
alter table public.panel_settings add column if not exists membership_points_prices jsonb;
comment on column public.panel_settings.membership_points_prices is
  'Optional plan point prices per month, e.g. {"Silver":450,"Gold":900,"Diamond":1800}. Absent or a missing key falls back to the monthly money price (Silver $5 · Gold $10 · Diamond $20) times the withdrawal rate.';

-- ── 2 · the purchase journal ─────────────────────────────────────────────────
create table if not exists public.membership_purchases (
  id bigint generated always as identity primary key,
  member_id text not null,
  plan text not null check (plan in ('Silver', 'Gold', 'Diamond')),
  months int not null,
  points int not null,
  price_usd_cents int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.membership_purchases is 'Memberships bought with points (membership_buy_with_points)';
create index if not exists membership_purchases_member_idx on public.membership_purchases (member_id, created_at desc);

alter table public.membership_purchases enable row level security;
drop policy if exists "MembershipPurchases select" on public.membership_purchases;
create policy "MembershipPurchases select" on public.membership_purchases for select to anon, authenticated using (true);
revoke insert, update, delete on public.membership_purchases from anon, authenticated;

-- ── 3 · the price of a plan in points ────────────────────────────────────────
-- Panel > Plans (sql/plans.sql) is the authority: its explicit points price
-- wins; a plan priced "money only" is not sold with points at all (null).
-- Without the table: the old override in panel_settings, else equality with
-- the monthly money price × the withdrawal rate.
create or replace function public.membership_point_price(p_plan text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_override int;
  v_cents int;
  v_plan public.plans;
  v_rate int := 100; -- points per 1 unit of the currency (withdraw_settings)
begin
  -- money floor, mirroring the prices on the activation page
  v_cents := case p_plan when 'Silver' then 500 when 'Gold' then 1000 when 'Diamond' then 2000 else -1 end;
  if v_cents < 0 then return null; end if;

  -- the shared rate (used by both the table and the fallback paths)
  if to_regclass('public.withdraw_settings') is not null then
    select rate into v_rate from public.withdraw_settings where id = 1 limit 1;
    v_rate := greatest(1, coalesce(v_rate, 100));
  end if;

  -- Panel > Plans says the price (sql/plans.sql)
  if to_regclass('public.plans') is not null then
    select * into v_plan from public.plans where plan = p_plan limit 1;
    if found then
      if v_plan.mode = 'money' then return null; end if;
      if v_plan.price_points is not null then return v_plan.price_points; end if;
      return ceil(v_plan.price_usd_cents::numeric / 100.0 * v_rate)::int;
    end if;
  end if;

  -- owner override in Panel settings (guard: the column may not exist yet)
  begin
    select (membership_points_prices ->> p_plan)::int into v_override
      from public.panel_settings where id = 1 limit 1;
  exception
    when undefined_column or invalid_text_representation or numeric_value_out_of_range then
      v_override := null;
  end;
  if v_override is not null and v_override >= 0 then return v_override; end if;

  if to_regclass('public.withdraw_settings') is not null then
    select rate into v_rate from public.withdraw_settings where id = 1 limit 1;
  end if;
  v_rate := greatest(1, coalesce(v_rate, 100));

  -- the equality rule: $5 at 100 points/$1 → 500 points
  return ceil(v_cents::numeric / 100.0 * v_rate)::int;
end $$;

-- ── 4 · the shop window: plans, prices, the member's balance ─────────────────
create or replace function public.membership_points_catalog(p_member text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pts jsonb;
  v_available bigint := 0;
  v_mem record;
  v_list jsonb;
begin
  if to_regprocedure('public._points(text)') is null then
    return jsonb_build_object('ok', false, 'reason', 'setup');
  end if;
  v_pts := public._points(p_member);
  v_available := greatest(0, coalesce((v_pts->>'available')::bigint, 0));

  select membership_type, membership_expires_at, status
    into v_mem from public.members where member_id = p_member limit 1;

  -- Panel > Plans (sql/plans.sql): its price, months and pricing system; a plan
  -- priced money-only leaves the points shop. Without the table the historic set.
  if to_regclass('public.plans') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('plan', p.plan, 'months', p.months,
                                                 'price_usd_cents', p.price_usd_cents,
                                                 'price_points', public.membership_point_price(p.plan),
                                                 'mode', p.mode) order by p.sort, p.plan), '[]'::jsonb)
      into v_list
      from public.plans p
     where p.plan in ('Silver', 'Gold', 'Diamond') and p.mode <> 'money';
  else
    v_list := jsonb_build_array(
      jsonb_build_object('plan', 'Silver',  'months', 1,  'price_usd_cents', 500,  'price_points', public.membership_point_price('Silver'),  'mode', 'both'),
      jsonb_build_object('plan', 'Gold',    'months', 1,  'price_usd_cents', 1000, 'price_points', public.membership_point_price('Gold'),    'mode', 'both'),
      jsonb_build_object('plan', 'Diamond', 'months', 1,  'price_usd_cents', 2000, 'price_points', public.membership_point_price('Diamond'), 'mode', 'both')
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'available', v_available,
    'membership', jsonb_build_object(
      'type', coalesce(v_mem.membership_type, 'Free'),
      'active', v_mem.membership_expires_at is not null and v_mem.membership_expires_at > now() and lower(btrim(coalesce(v_mem.status, ''))) = 'active',
      'expires_at', v_mem.membership_expires_at
    ),
    'plans', v_list
  );
end $$;

-- ── 5 · the purchase, atomically: spend → months ─────────────────────────────
create or replace function public.membership_buy_with_points(p_member text, p_plan text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_months int;
  v_price int;
  v_pts jsonb;
  v_avail bigint;
  v_plan jsonb;
  v_ok_plan boolean;
  v_plan_months int;
  v_price_cents int;
begin
  if to_regprocedure('public._points(text)') is null
     or to_regprocedure('public._spend_prize(text,int,text,text)') is null
     or to_regprocedure('public._account_set_plan(text,text,int)') is null then
    return jsonb_build_object('ok', false, 'reason', 'setup');
  end if;

  v_months := case p_plan when 'Silver' then 1 when 'Gold' then 1 when 'Diamond' then 1 else -1 end;
  if v_months < 0 then return jsonb_build_object('ok', false, 'reason', 'plan'); end if;
  -- Panel > Plans (sql/plans.sql): the months and dollar price it says, and a
  -- money-only plan is never sold with points
  if to_regclass('public.plans') is not null then
    select p.mode <> 'money', p.months, p.price_usd_cents into v_ok_plan, v_plan_months, v_price_cents
      from public.plans p where p.plan = p_plan limit 1;
    if found then
      if not v_ok_plan then return jsonb_build_object('ok', false, 'reason', 'plan'); end if;
      v_months := greatest(1, coalesce(v_plan_months, v_months));
    end if;
  end if;
  v_price := public.membership_point_price(p_plan);
  if v_price is null or v_price < 0 then return jsonb_build_object('ok', false, 'reason', 'price'); end if;

  v_pts := public._points(p_member);
  v_avail := greatest(0, coalesce((v_pts->>'available')::bigint, 0));
  if v_avail < v_price then
    return jsonb_build_object('ok', false, 'reason', 'no_points', 'price', v_price, 'available', v_avail);
  end if;

  -- the same locked spend the prizes use (writes point_spends, bumps points_spent)
  if not public._spend_prize(p_member, v_price, 'Membership: ' || p_plan || ' · ' || v_months || ' months', 'membership') then
    return jsonb_build_object('ok', false, 'reason', 'no_points', 'price', v_price, 'available', v_avail);
  end if;

  -- the same helper the activation codes run through (same plan still running stacks)
  v_plan := public._account_set_plan(p_member, p_plan, v_months);

  insert into public.membership_purchases (member_id, plan, months, points, price_usd_cents, expires_at)
  values (p_member, p_plan, v_months, v_price,
          coalesce(v_price_cents, case p_plan when 'Silver' then 500 when 'Gold' then 1000 else 2000 end),
          (v_plan->>'expires_at')::timestamptz);

  return jsonb_build_object(
    'ok', true,
    'plan', p_plan,
    'months', v_months,
    'points', v_price,
    'expires_at', v_plan->>'expires_at',
    'extended', coalesce((v_plan->>'extended')::boolean, false),
    'available', greatest(0, v_avail - v_price)
  );
end $$;

grant execute on function public.membership_point_price(text) to anon, authenticated;
grant execute on function public.membership_points_catalog(text) to anon, authenticated;
grant execute on function public.membership_buy_with_points(text, text) to anon, authenticated;
