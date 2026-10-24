-- CineAura P0: additive preparation for verified Supabase Auth.
-- Run on a restored STAGING database first. This file ALONE does NOT close the
-- legacy API exposure. See docs/security-auth-rollout-ar.md before any live run.
-- Run auth_contain.sql FIRST and keep auth_cutover.sql LAST; never rerun old open-policy installers afterward.
begin;

do $$
begin
  if to_regclass('cineaura_private.auth_containment') is null then
    raise exception 'initial_containment_required_before_preparation';
  end if;
  if not exists (select 1 from cineaura_private.auth_containment where id) then
    raise exception 'initial_containment_required_before_preparation';
  end if;
  if to_regclass('cineaura_private.auth_rollout') is not null then
    if exists (select 1 from cineaura_private.auth_rollout where id and phase = 'sealed') then
      raise exception 'preparation_after_seal_requires_reviewed_upgrade';
    end if;
  end if;
end $$;

create schema if not exists cineaura_private;
revoke all on schema cineaura_private from public, anon, authenticated;
-- Policies/views may execute individually granted helpers, but the schema must
-- NOT be added to PostgREST's exposed schemas.
grant usage on schema cineaura_private to authenticated, anon;
alter default privileges in schema cineaura_private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

create table if not exists cineaura_private.member_identities (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  member_id text not null unique references public.members(member_id) on delete cascade,
  linked_at timestamptz not null default now()
);
create table if not exists cineaura_private.legacy_member_claims (
  member_id text primary key references public.members(member_id) on delete cascade,
  email text not null unique,
  captured_at timestamptz not null default now(),
  approved_at timestamptz,
  approval_reference text,
  constraint legacy_claim_email_normalized check (email = lower(btrim(email))),
  constraint legacy_claim_approval check (approved_at is null or (approval_reference is not null and length(btrim(approval_reference)) > 0))
);
create table if not exists cineaura_private.auth_rollout (
  id boolean primary key default true check (id),
  phase text not null check (phase in ('prepared', 'sealed')),
  prepared_at timestamptz not null default now(),
  sealed_at timestamptz
);
alter table cineaura_private.auth_rollout add column if not exists staff_review_reference text;
alter table cineaura_private.auth_rollout add column if not exists staff_review_fingerprint text;
insert into cineaura_private.auth_rollout(id, phase) values (true, 'prepared') on conflict do nothing;
alter table cineaura_private.member_identities enable row level security;
alter table cineaura_private.legacy_member_claims enable row level security;
alter table cineaura_private.auth_rollout enable row level security;
revoke all on all tables in schema cineaura_private from public, anon, authenticated;

-- Capture only; NEVER automatically approve publicly writable legacy addresses.
-- An operator must compare this private ledger to a trusted pre-incident backup
-- or verify ownership independently and record approval_reference. Re-running
-- preparation cannot replace a previously captured/approved address.
insert into cineaura_private.legacy_member_claims(member_id, email)
select member_id, lower(btrim(email)) from public.members
on conflict (member_id) do nothing;

-- Existing staff grants were writable in the legacy system too. A verified
-- email does not make an unreviewed legacy "super" row trustworthy. An operator
-- must independently review this roster after containment and record evidence.
-- Timestamps are excluded so the digest is stable across connection timezones.
create or replace function cineaura_private.staff_roster_fingerprint() returns text
language sql stable security definer set search_path = pg_catalog as $$
  select encode(extensions.digest(convert_to(coalesce(
    jsonb_agg(jsonb_build_array(s.id, s.role, s.member_id, s.username, s.password, s.sections) order by s.id)::text,
    '[]'), 'UTF8'), 'sha256'), 'hex') from public.staff s
$$;
revoke all on function cineaura_private.staff_roster_fingerprint() from public, anon, authenticated;

create or replace function cineaura_private.is_service_request() returns boolean
language sql stable set search_path = pg_catalog as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (coalesce(auth.role(), '') = ''
        and session_user not in ('authenticator', 'anon', 'authenticated')
        and current_setting('role', true) in ('none', 'postgres', 'supabase_admin', 'service_role'))
$$;
revoke all on function cineaura_private.is_service_request() from public;
grant execute on function cineaura_private.is_service_request() to anon, authenticated, service_role;

create or replace function cineaura_private.current_member_id() returns text
language sql stable security definer set search_path = pg_catalog as $$
  select i.member_id
    from cineaura_private.member_identities i
    join public.members m on m.member_id = i.member_id
    join auth.users u on u.id = i.auth_user_id
   where i.auth_user_id = auth.uid()
     and u.email_confirmed_at is not null
     and m.status <> 'banned'
$$;
revoke all on function cineaura_private.current_member_id() from public;
grant execute on function cineaura_private.current_member_id() to anon, authenticated, service_role;

create or replace function cineaura_private.can_section(p_section text) returns boolean
language sql stable security definer set search_path = pg_catalog as $$
  select exists (
    select 1 from public.staff s
     where s.member_id = cineaura_private.current_member_id()
       and (s.role = 'super' or
            (s.role in ('admin', 'moderator') and p_section = any(string_to_array(replace(coalesce(s.sections, ''), ' ', ''), ','))))
  )
$$;
revoke all on function cineaura_private.can_section(text) from public;
grant execute on function cineaura_private.can_section(text) to anon, authenticated, service_role;

create or replace function cineaura_private.assert_actor(p_member text, p_allow_guest boolean default false) returns void
language plpgsql stable security definer set search_path = pg_catalog as $$
declare caller text;
begin
  if cineaura_private.is_service_request() then return; end if;
  if p_allow_guest and coalesce(p_member, '') = '' then return; end if;
  caller := cineaura_private.current_member_id();
  if caller is null or caller is distinct from p_member then
    raise exception 'member_identity_mismatch' using errcode = '42501';
  end if;
end
$$;
revoke all on function cineaura_private.assert_actor(text, boolean) from public;
grant execute on function cineaura_private.assert_actor(text, boolean) to anon, authenticated, service_role;

create or replace function cineaura_private.assert_staff_token(p_token text) returns void
language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if cineaura_private.is_service_request() then return; end if;
  if not exists (
    select 1 from public.staff_sessions ss join public.staff s on s.id = ss.staff_id
     where ss.token = p_token and ss.expires_at > now()
       and s.member_id = cineaura_private.current_member_id()
  ) then raise exception 'staff_auth' using errcode = '42501'; end if;
end
$$;
revoke all on function cineaura_private.assert_staff_token(text) from public;
grant execute on function cineaura_private.assert_staff_token(text) to authenticated, service_role;

-- Bind from auth.users (server-verified email), NOT JWT user_metadata or a
-- supplied member_id/email/password. Existing account fields and balances are
-- untouched. A UUID remains bound when its verified email subsequently changes.
create or replace function public.member_auth_bind() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  u auth.users;
  m public.members;
  claim cineaura_private.legacy_member_claims;
  linked text;
  info jsonb;
  new_id text;
  birth date;
  i integer;
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null or u.email_confirmed_at is null or coalesce(u.email, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_confirmation_required');
  end if;
  -- Serialize duplicate tabs/callbacks and competing claims for the same email.
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(u.email)), 0));
  perform pg_advisory_xact_lock(hashtextextended(u.id::text, 1));
  select member_id into linked from cineaura_private.member_identities where auth_user_id = u.id;
  if linked is not null then
    select * into m from public.members where member_id = linked for update;
    if m.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
    -- GoTrue changes auth.users.email only after its confirmation requirements
    -- pass. Never sync from raw_user_meta_data or the browser's cached email.
    if lower(btrim(m.email)) is distinct from lower(btrim(u.email)) then
      if exists (select 1 from public.members where lower(btrim(email)) = lower(btrim(u.email)) and member_id <> m.member_id)
         or exists (select 1 from cineaura_private.legacy_member_claims where email = lower(btrim(u.email)) and member_id <> m.member_id) then
        return jsonb_build_object('ok', false, 'reason', 'email_conflict');
      end if;
      update public.members set email = lower(btrim(u.email)) where member_id = m.member_id returning * into m;
    end if;
  else
    select * into claim from cineaura_private.legacy_member_claims where email = lower(btrim(u.email));
    if claim.member_id is not null then
      if claim.approved_at is null then return jsonb_build_object('ok', false, 'reason', 'legacy_claim_review_required'); end if;
      -- A password-only login to a previously confirmed Auth account is NOT a
      -- fresh email-ownership proof. Legacy hashes may already be compromised.
      -- Newly confirmed emails, or a fresh signed OTP/recovery AMR from GoTrue,
      -- are required for the initial link (never trust user_metadata.amr).
      if u.email_confirmed_at < claim.captured_at and not exists (
        select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) amr
         where amr->>'method' in ('otp', 'recovery')
           and (amr->>'timestamp') ~ '^[0-9]{1,12}$'
           and (amr->>'timestamp')::bigint >= floor(extract(epoch from claim.captured_at))::bigint
           and (amr->>'timestamp')::bigint between extract(epoch from now())::bigint - 900 and extract(epoch from now())::bigint + 30
      ) then return jsonb_build_object('ok', false, 'reason', 'email_ownership_refresh_required'); end if;
      select * into m from public.members where member_id = claim.member_id for update;
      if m.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
      if exists (select 1 from cineaura_private.member_identities where member_id = m.member_id) then
        return jsonb_build_object('ok', false, 'reason', 'legacy_account_already_claimed');
      end if;
      -- Restore the approved address if an old public writer changed it after
      -- capture. Other account fields are deliberately not reset by this flow.
      update public.members set email = claim.email where member_id = m.member_id returning * into m;
    else
      if exists (select 1 from public.members where lower(btrim(email)) = lower(btrim(u.email))) then
        return jsonb_build_object('ok', false, 'reason', 'legacy_claim_review_required');
      end if;
      info := coalesce(u.raw_user_meta_data, '{}'::jsonb);
      if coalesce(info->>'legacy_account', '') = 'true' then
        return jsonb_build_object('ok', false, 'reason', 'account_details_required');
      end if;
      if length(btrim(coalesce(info->>'full_name', ''))) not between 2 and 120
         or coalesce(info->>'username', '') !~ '^[A-Za-z0-9._]{3,24}$'
         or length(btrim(coalesce(info->>'country', ''))) not between 2 and 80
         or coalesce(info->>'gender', '') not in ('male', 'female') then
        return jsonb_build_object('ok', false, 'reason', 'account_details_required');
      end if;
      begin birth := (info->>'birth_date')::date;
      exception when invalid_datetime_format or datetime_field_overflow then birth := null; end;
      if birth is null or birth < date '1920-01-01' or birth > (current_date - interval '13 years')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_age');
      end if;
      perform pg_advisory_xact_lock(hashtextextended(lower(info->>'username'), 2));
      if exists (select 1 from public.members where lower(username) = lower(info->>'username')) then
        return jsonb_build_object('ok', false, 'reason', 'username_unavailable');
      end if;
      for i in 1..12 loop
        -- Server-generated digits from a UUID, not a browser-supplied identity.
        new_id := 'ID' || (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint)::text;
        exit when not exists (select 1 from public.members where member_id = new_id);
      end loop;
      insert into public.members(member_id, full_name, username, status, email, password, country, birth_date, gender,
                                 membership_type, membership_duration, membership_expires_at, watch_minutes,
                                 referred_by_member_id, referred_post_id)
      values (new_id, btrim(info->>'full_name'), info->>'username', 'disabled', lower(btrim(u.email)),
              'SUPABASE_AUTH_ONLY', btrim(info->>'country'), birth, info->>'gender',
              'Free', '1 month', now() + interval '1 month', 0,
              case when coalesce(info->>'referred_by_member_id', '') ~ '^ID[0-9]{1,20}$' then info->>'referred_by_member_id' end,
              case when coalesce(info->>'referred_post_id', '') ~ '^[A-Za-z0-9._-]{1,80}$' then info->>'referred_post_id' end)
      returning * into m;
    end if;
    insert into cineaura_private.member_identities(auth_user_id, member_id) values (u.id, m.member_id);
  end if;
  insert into public.profiles(member_id, username, country, membership_type)
  values (m.member_id, m.username, m.country, m.membership_type) on conflict (member_id) do nothing;
  return jsonb_build_object('ok', true, 'member', jsonb_build_object(
    'auth_user_id', u.id, 'member_id', m.member_id, 'username', m.username, 'email', m.email,
    'full_name', m.full_name, 'status', m.status, 'country', m.country,
    'membership_type', m.membership_type, 'membership_duration', m.membership_duration,
    'membership_expires_at', m.membership_expires_at));
exception when unique_violation then
  -- No disclosure of which address/username caused a conflict; no partial link.
  return jsonb_build_object('ok', false, 'reason', 'account_conflict');
end
$$;
revoke all on function public.member_auth_bind() from public, anon;
grant execute on function public.member_auth_bind() to authenticated, service_role;

create or replace function public.member_account_update(p_full_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare member text := cineaura_private.current_member_id();
begin
  if member is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;
  update public.members set full_name = btrim(p_full_name) where member_id = member;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.member_account_update(text) from public, anon;
grant execute on function public.member_account_update(text) to authenticated, service_role;

-- Accounts moderation: the target is not the actor. Staff must own both the
-- native Auth session and the legacy staff token and hold the Accounts section.
create or replace function public.member_admin_set_status(p_token text, p_member text, p_status text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare caller text := cineaura_private.current_member_id(); caller_role text;
begin
  perform cineaura_private.assert_staff_token(p_token);
  if caller is null or not cineaura_private.can_section('accounts') then
    raise exception 'staff_forbidden' using errcode = '42501';
  end if;
  select role into caller_role from public.staff where member_id = caller;
  if p_status not in ('active', 'disabled', 'banned') or p_status is null or p_member = caller
     or exists (select 1 from public.staff where member_id = p_member and role = 'super')
     or (caller_role = 'moderator' and exists (select 1 from public.staff where member_id = p_member and role = 'admin')) then
    raise exception 'staff_forbidden' using errcode = '42501';
  end if;
  update public.members set status = p_status,
    banned_at = case when p_status = 'banned' then now() else null end where member_id = p_member;
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.member_admin_set_status(text, text, text) from public, anon;
grant execute on function public.member_admin_set_status(text, text, text) to authenticated, service_role;

-- A first Free activation is decided/recorded atomically by the server. It
-- cannot change the plan, extend paid access or be used for free renewals.
create or replace function public.member_activate_free() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare member text := cineaura_private.current_member_id(); m public.members; until_at timestamptz;
begin
  if member is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into m from public.members where member_id = member for update;
  if m.status <> 'disabled' or coalesce(m.membership_type, 'Free') <> 'Free' or m.activated_at is not null
     or exists (select 1 from public.activation where member_id = member) then
    return jsonb_build_object('ok', false, 'reason', 'first_free_only');
  end if;
  until_at := now() + interval '1 month';
  update public.members set status = 'active', membership_type = 'Free', membership_duration = '1 month',
    membership_expires_at = until_at, activated_at = now() where member_id = member;
  insert into public.activation(activation_code, member_id, membership_type, duration, started_at, expires_at, country, used, used_at, kind)
  values ('FREE' || replace(gen_random_uuid()::text, '-', ''), member, 'Free', '1 month', now(), until_at, m.country, true, now(), 'activate');
  update public.profiles set membership_type = 'Free' where member_id = member;
  return jsonb_build_object('ok', true, 'plan', 'Free', 'expires_at', until_at, 'months', 1, 'extended', false);
end
$$;
revoke all on function public.member_activate_free() from public, anon;
grant execute on function public.member_activate_free() to authenticated, service_role;

-- Column-shaped compatibility view. Credentials NEVER exist in this view.
-- Date of birth/email/deadline details are owner-only (or Accounts staff).
create or replace view public.member_directory with (security_barrier = true) as
select m.member_id, m.username, m.full_name, m.status, m.created_at,
       case when own.allowed then m.email end as email,
       case when own.allowed then m.birth_date end as birth_date,
       case when own.allowed or coalesce(p.show_country, true) then m.country end as country,
       case when own.allowed or coalesce(p.show_gender, true) then m.gender end as gender,
       m.membership_type,
       case when own.allowed then m.membership_duration end as membership_duration,
       case when own.allowed then m.membership_expires_at end as membership_expires_at,
       case when own.allowed then m.watch_minutes else 0 end as watch_minutes,
       case when own.allowed then m.banned_at end as banned_at,
       case when own.allowed then m.activated_at end as activated_at,
       case when own.allowed then m.ban_due_at end as ban_due_at,
       case when own.allowed then m.ban_reason end as ban_reason
  from public.members m left join public.profiles p on p.member_id = m.member_id
 cross join lateral (select m.member_id = cineaura_private.current_member_id() or cineaura_private.can_section('accounts') as allowed) own
 where m.status <> 'banned' or own.allowed;
revoke all on public.member_directory from public, anon, authenticated;
grant select on public.member_directory to anon, authenticated;

-- Allow only reviewed profile columns across installs, masking private fields.
-- A newly added column must NEVER become public simply by re-running preparation.
do $$
declare columns_sql text;
begin
  select string_agg(case
    when attname in ('private_minutes', 'points_spent', 'region') then
      format('case when p.member_id = cineaura_private.current_member_id() or cineaura_private.can_section(''accounts'') then p.%1$I end as %1$I', attname)
    when attname = 'country' then
      'case when p.member_id = cineaura_private.current_member_id() or coalesce(p.show_country, true) then p.country end as country'
    when attname = 'language' then
      'case when p.member_id = cineaura_private.current_member_id() or coalesce(p.show_language, true) then p.language end as language'
    else format('p.%I', attname) end, ', ' order by attnum)
    into columns_sql from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
      and attname = any(array['member_id','username','bio','membership_type','private_minutes','public_minutes',
        'avatar_url','followers','following','theme','language','region','country','display_name','follow_policy',
        'show_country','show_gender','show_language','websites','last_seen','points_spent','watch_points',
        'code_points','code_count','market_points','market_sales','market_ref_points','market_refs',
        'active_layout_id','active_style_id','layout_config','custom_css_url','style','content_points','content_units']);
  execute 'create or replace view public.profile_directory with (security_barrier = true) as select ' || columns_sql ||
          ' from public.profiles p join public.members m on m.member_id = p.member_id where m.status <> ''banned'' or cineaura_private.can_section(''accounts'')';
end $$;
revoke all on public.profile_directory from public, anon, authenticated;
grant select on public.profile_directory to anon, authenticated;

commit;
