-- ============================================================
-- CineAura — Membership plans, priced from the Panel
--   Panel > Plans (the team) edits each plan: its dollar price, its points
--   price, the pricing system (money / points / both), how many months a buy
--   says, and the perks shown on the homepage pricing cards. Every plan also carries
--   a `settings` jsonb (Task 22): the permissions the whole site enforces for the
--   plan's members — ad-free viewing, how many links a day, how many videos one
--   upload action takes, how many codes and how long each lives, whether the
--   wallet may be withdrawn (and after how many flips), and the highest level
--   the plan may reach.
-- Run in the Supabase SQL editor AFTER panel.sql (public._staff), withdrawals.sql
-- (public._wd_int / public._wd_line) and membership_points.sql, and BEFORE the
-- panel page saves plans.
-- The file is idempotent: run it again any time.
--
--   The same rows answer everywhere prices appear:
--     · the homepage cards (js/plans.js → plans_public)
--     · Dashboard > Points > Buy a membership and the Activate page upgrade
--       cards (sql/membership_points.sql reads this table first)
-- ============================================================

-- ------------------------------------------------------------------ 1. the table
create table if not exists public.plans (
  plan text primary key check (plan in ('Free', 'Silver', 'Gold', 'Diamond')),
  price_usd_cents int not null default 0 check (price_usd_cents >= 0),
  price_points int check (price_points is null or price_points >= 0),
  mode text not null default 'money' check (mode in ('money', 'points', 'both')),
  months int not null default 1 check (months between 1 and 120),
  perks jsonb not null default '[]'::jsonb,
  ribbon text not null default '',
  sort smallint not null default 0,
  visible boolean not null default true,
  -- the plan's permissions, editable from the same Panel page (Task 22):
  -- { ad_free, daily_uploads, batch_uploads, codes_max, code_months,
  --   withdraw_turns (null = never payable), level_cap }
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table public.plans enable row level security;
-- no policy: REST never touches the table; every read or write is an RPC below
revoke all on public.plans from anon, authenticated;

-- existing installs: add the settings column and backfill exactly the rules the
-- site enforced before (50 links a day, 5 one-month codes for Free, 10 codes of
-- 3/6/12 months for the paid plans, withdrawals after 12/6/1 flips — never on
-- Free — and level caps 3/5/7/10)
alter table public.plans add column if not exists settings jsonb not null default '{}'::jsonb;
update public.plans set settings = jsonb_build_object(
    'ad_free', plan <> 'Free',
    'daily_uploads', 50,
    'batch_uploads', 1,
    'codes_max', case plan when 'Free' then 5 else 10 end,
    'code_months', case plan when 'Free' then 1 when 'Silver' then 3 when 'Gold' then 6 else 12 end,
    'withdraw_turns', case plan when 'Free' then null when 'Silver' then 12 when 'Gold' then 6 else 1 end,
    'level_cap', case plan when 'Free' then 3 when 'Silver' then 5 when 'Gold' then 7 else 10 end)
  where settings = '{}'::jsonb;

-- ------------------------------------------------------------------ 2. the defaults — exactly today's cards and prices
-- (English perk lines: their translations already live in every language file)
insert into public.plans (plan, price_usd_cents, price_points, mode, months, perks, ribbon, sort, visible) values
  ('Free', 0, null, 'money', 1,
   '["Registration required", "Watch all movies & series", "Free IPTV channels", "Quality up to 1080p", "Viewing with ads", "Publish watch links", "Win prizes", "Share recommendations & reviews", "Up to 5 access codes"]'::jsonb,
   '', 0, true),
  ('Silver', 500, 500, 'both', 1,
   '["Registration required", "Watch all movies & series", "Free + premium IPTV", "Quality up to 1080p", "Ad-free viewing", "Publish watch links", "Win prizes", "Share recommendations & reviews", "Up to 10 access codes"]'::jsonb,
   '', 1, true),
  ('Gold', 1000, 1000, 'both', 1,
   '["Registration required", "Watch all movies & series", "Free + premium IPTV", "Quality up to 1080p", "Ad-free viewing", "Publish watch links", "Win prizes", "Share recommendations & reviews", "Up to 10 access codes"]'::jsonb,
   'Most Popular', 2, true),
  ('Diamond', 2000, 2000, 'both', 1,
   '["Registration required", "Watch all movies & series", "Free + premium IPTV", "Quality up to 1080p", "Ad-free viewing", "Publish watch links", "Win prizes", "Share recommendations & reviews", "Up to 10 access codes"]'::jsonb,
   '', 3, true)
on conflict (plan) do nothing;

-- ------------------------------------------------------------------ 3. helpers
-- The Super Admin, or a staff member with the Plans section. -> who did it
create or replace function public._plan_staff(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.staff; secs text;
begin
  if to_regprocedure('public._staff(text)') is null then raise exception 'staff_setup'; end if;
  s := public._staff(p_token);
  secs := ',' || replace(coalesce(s.sections, ''), ' ', '') || ',';
  if s.role <> 'super' and position(',plans,' in secs) = 0 then raise exception 'staff_forbidden'; end if;
  return coalesce(nullif(s.username, ''), s.role);
end $$;

-- One plan row as the pages read it.
create or replace function public._plan_json(p public.plans) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan', p.plan,
    'price_usd_cents', p.price_usd_cents,
    'price_points', case when p.mode = 'money' then null else p.price_points end,
    'mode', p.mode,
    'months', p.months,
    'perks', coalesce(p.perks, '[]'::jsonb),
    'ribbon', p.ribbon,
    'sort', p.sort,
    'visible', p.visible,
    'settings', coalesce(p.settings, '{}'::jsonb))
$$;

-- ------------------------------------------------------------------ 4. Panel > Plans
-- -> { ok: true, plans: [...] } | { ok: false, reason: setup | forbidden }
create or replace function public.plans_admin(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text; v_rate int := 100;
begin
  begin
    who := public._plan_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;
  if to_regclass('public.withdraw_settings') is not null then
    select rate into v_rate from public.withdraw_settings where id = 1 limit 1;
    v_rate := greatest(1, coalesce(v_rate, 100));
  end if;
  return jsonb_build_object('ok', true, 'rate', v_rate,
    'plans', (select coalesce(jsonb_agg(public._plan_json(p) || jsonb_build_object('updated_at', p.updated_at, 'updated_by', p.updated_by)
                                          order by p.sort, p.plan), '[]'::jsonb)
                from public.plans p));
end $$;

-- Save one plan's editable fields. d: { plan, price_usd_cents, price_points, mode,
--   months, perks: [...strings], ribbon, sort, visible,
--   settings: { ad_free, daily_uploads, batch_uploads, codes_max, code_months,
--               withdraw_turns|null, level_cap } (missing keys keep the stored values) }
create or replace function public.plans_save(p_token text, d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who text; what text := initcap(lower(btrim(coalesce(d->>'plan', ''))));
  cents int; pts int; v_mode text; v_months int; v_sort smallint; v_visible boolean;
  v_ribbon text; v_perks jsonb := '[]'::jsonb; line text;
  v_set jsonb; s_in jsonb := d->'settings';
  s_ad text; s_daily int; s_batch int; s_codes int; s_codem int; s_turns int; s_cap int;
  row public.plans;
begin
  begin
    who := public._plan_staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  end;

  if what not in ('Free', 'Silver', 'Gold', 'Diamond') then
    return jsonb_build_object('ok', false, 'reason', 'plan');
  end if;
  cents := public._wd_int(d->>'price_usd_cents');
  if cents is null or cents < 0 or cents > 10000000 then return jsonb_build_object('ok', false, 'reason', 'price'); end if;
  pts := public._wd_int(d->>'price_points');
  if pts is not null and (pts < 0 or pts > 100000000) then return jsonb_build_object('ok', false, 'reason', 'points'); end if;
  v_mode := lower(btrim(coalesce(d->>'mode', '')));
  if v_mode not in ('money', 'points', 'both') then return jsonb_build_object('ok', false, 'reason', 'mode'); end if;
  -- a membership that may never be touched stays free of points; a plan sold
  -- with points needs a points price
  if what = 'Free' then pts := null; end if;
  if v_mode in ('points', 'both') and pts is null then pts := 0; end if;
  v_months := least(greatest(coalesce(public._wd_int(d->>'months'), 1), 1), 120);
  v_sort := least(greatest(coalesce(public._wd_int(d->>'sort'), 0), 0), 99)::smallint;
  v_visible := case lower(btrim(coalesce(d->>'visible', ''))) when 'false' then false when '0' then false when 'no' then false else true end;
  v_ribbon := left(coalesce(public._wd_line(d->>'ribbon'), ''), 60);
  if jsonb_typeof(d->'perks') = 'array' then
    for line in select jsonb_array_elements_text(d->'perks') loop
      line := left(coalesce(public._wd_line(line), ''), 200);
      if line <> '' then v_perks := v_perks || to_jsonb(line); end if;
    end loop;
  end if;

  -- the plan's permissions: every value the Panel sends is range-checked here;
  -- an unset key keeps what the plan already carries
  select p.settings into v_set from public.plans p where p.plan = what;
  v_set := coalesce(v_set, '{}'::jsonb);
  if jsonb_typeof(s_in) = 'object' then
    s_ad := lower(btrim(coalesce(s_in->>'ad_free', '')));
    if s_ad in ('true', '1', 'yes') then v_set := jsonb_set(v_set, '{ad_free}', 'true'::jsonb);
    elsif s_ad in ('false', '0', 'no') then v_set := jsonb_set(v_set, '{ad_free}', 'false'::jsonb); end if;
    s_daily := public._wd_int(s_in->>'daily_uploads');
    if s_daily is not null then v_set := jsonb_set(v_set, '{daily_uploads}', to_jsonb(least(greatest(s_daily, 1), 1000))); end if;
    s_batch := public._wd_int(s_in->>'batch_uploads');
    if s_batch is not null then v_set := jsonb_set(v_set, '{batch_uploads}', to_jsonb(least(greatest(s_batch, 1), 20))); end if;
    s_codes := public._wd_int(s_in->>'codes_max');
    if s_codes is not null then v_set := jsonb_set(v_set, '{codes_max}', to_jsonb(least(greatest(s_codes, 0), 100))); end if;
    s_codem := public._wd_int(s_in->>'code_months');
    if s_codem is not null then v_set := jsonb_set(v_set, '{code_months}', to_jsonb(least(greatest(s_codem, 1), 120))); end if;
    if what = 'Free' then
      -- Free never pays: the wallet may not be withdrawn on it
      v_set := jsonb_set(v_set, '{withdraw_turns}', 'null'::jsonb);
    else
      s_turns := public._wd_int(s_in->>'withdraw_turns');
      if s_turns is not null then v_set := jsonb_set(v_set, '{withdraw_turns}', to_jsonb(least(greatest(s_turns, 0), 99))); end if;
    end if;
    s_cap := public._wd_int(s_in->>'level_cap');
    if s_cap is not null then v_set := jsonb_set(v_set, '{level_cap}', to_jsonb(least(greatest(s_cap, 1), 10))); end if;
  end if;

  update public.plans p
     set price_usd_cents = cents, price_points = pts, mode = v_mode, months = v_months,
         perks = v_perks, ribbon = v_ribbon, sort = v_sort, visible = v_visible, settings = v_set,
         updated_at = now(), updated_by = who
   where p.plan = what
  returning p into row;
  if not found then
    insert into public.plans (plan, price_usd_cents, price_points, mode, months, perks, ribbon, sort, visible, settings, updated_by)
    values (what, cents, pts, v_mode, v_months, v_perks, v_ribbon, v_sort, v_visible,
            case when jsonb_typeof(s_in) = 'object' then v_set else '{}'::jsonb end, who)
    returning * into row;
  end if;
  return jsonb_build_object('ok', true, 'plan', public._plan_json(row));
end $$;

-- ------------------------------------------------------------------ 5. the homepage cards (and any public reader)
-- -> { ok: true, plans: [the visible ones, in order] }
create or replace function public.plans_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true,
    'plans', coalesce((select jsonb_agg(public._plan_json(p) order by p.sort, p.plan)
                         from public.plans p where p.visible), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ 6. grants
grant select, insert, update on public.plans to postgres, service_role;
revoke all on function public._plan_staff(text), public._plan_json(public.plans) from public, anon, authenticated;
revoke all on function public.plans_public(), public.plans_admin(text), public.plans_save(text, jsonb) from public;
grant execute on function public.plans_public() to anon, authenticated;
grant execute on function public.plans_admin(text), public.plans_save(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
