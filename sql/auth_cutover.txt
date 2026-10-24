-- CineAura P0: maintenance-window cutover. NOT an automatic production migration.
-- Preconditions / rollout / compatibility limits: docs/security-auth-rollout-ar.md
-- In the SAME connection, explicitly run:
--   set cineaura.allow_security_cutover = 'on';
-- Then execute this entire file. Any error rolls the transaction back.
begin;

-- Serialize the reviewed roster with the final grants/policy switch.
lock table public.staff in share row exclusive mode;
do $$
begin
  if current_setting('cineaura.allow_security_cutover', true) is distinct from 'on' then
    raise exception 'cutover_requires_explicit_maintenance_window';
  end if;
  if to_regclass('cineaura_private.member_identities') is null then raise exception 'run_auth_prepare_first'; end if;
  if not exists (
    select 1 from cineaura_private.auth_rollout
     where id and length(btrim(coalesce(staff_review_reference, ''))) > 0
       and staff_review_fingerprint = cineaura_private.staff_roster_fingerprint()
  ) then raise exception 'independent_staff_roster_review_required'; end if;
  if not exists (
    select 1 from public.staff s join cineaura_private.member_identities i on i.member_id = s.member_id
     join auth.users u on u.id = i.auth_user_id
     join public.members m on m.member_id = i.member_id
    where s.role = 'super' and u.email_confirmed_at is not null and m.status <> 'banned'
  ) then raise exception 'verified_super_admin_binding_required'; end if;
end $$;

-- Invalidate potentially exposed legacy panel tokens once, inside the same
-- transaction. Reapplying a sealed cutover must not log out new native-bound staff.
do $$
begin
  if exists (select 1 from cineaura_private.auth_rollout where id and phase = 'prepared') then
    delete from public.staff_sessions;
  end if;
end $$;

revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Eliminate TABLE grants AND legacy column grants. Revoking only a table grant
-- leaves separately granted password/recovery_code column privileges intact.
-- Unreviewed tables/views default to no browser access rather than retaining
-- the old 'USING (true)' policy. Trusted jobs/service_role are preserved.
do $$
declare item record; pol record; col record;
begin
  for item in select c.oid, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute format('revoke all on table public.%I from public, anon, authenticated', item.relname);
    for col in select attname from pg_attribute where attrelid = item.oid and attnum > 0 and not attisdropped loop
      execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.%2$I from public, anon, authenticated', col.attname, item.relname);
    end loop;
    execute format('grant all on table public.%I to service_role', item.relname);
    if item.relkind in ('r', 'p') then
      execute format('alter table public.%I enable row level security', item.relname);
      for pol in select policyname from pg_policies where schemaname = 'public' and tablename = item.relname loop
        execute format('drop policy %I on public.%I', pol.policyname, item.relname);
      end loop;
    end if;
  end loop;
end $$;
revoke all on all sequences in schema public from public, anon, authenticated;
grant all on all sequences in schema public to service_role;

-- No browser ever reads/writes members.password or recovery_code, including its
-- own. Credentials live exclusively in GoTrue. Personal data is view-redacted.
grant select on public.member_directory, public.profile_directory to anon, authenticated;

-- Core profile writes are column-limited; counters, points, membership, country,
-- follower totals and identity cannot be supplied in UPDATEs or upsert payloads.
-- Profiles are created by member_auth_bind(), not by a browser INSERT.
grant select on public.profiles to authenticated;
create policy ca_profile_self_read on public.profiles for select to authenticated
  using (member_id = cineaura_private.current_member_id());
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ') into columns_sql
    from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
      and attname = any(array['bio','avatar_url','theme','language','region','display_name','follow_policy',
        'show_country','show_gender','show_language','websites','last_seen','active_layout_id','active_style_id',
        'layout_config','custom_css_url','style']);
  execute 'grant update (' || columns_sql || ') on public.profiles to authenticated';
end $$;
create policy ca_profile_self_update on public.profiles for update to authenticated
  using (member_id = cineaura_private.current_member_id())
  with check (member_id = cineaura_private.current_member_id());

-- Private conversations: participants read; only the sender inserts, only the
-- receiver marks read. Neither can rewrite identity/body via UPDATE.
grant select, delete on public.messages to authenticated;
grant insert (sender_id, receiver_id, sender_username, receiver_username, body) on public.messages to authenticated;
grant update (read) on public.messages to authenticated;
-- Cached usernames are display input, not identity. Derive sender/recipient
-- names from their server records so a genuine member cannot impersonate staff.
create or replace function cineaura_private.message_identity() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not cineaura_private.is_service_request() then
    perform cineaura_private.assert_actor(new.sender_id);
    select username into new.sender_username from public.members where member_id = new.sender_id;
    select username into new.receiver_username from public.members where member_id = new.receiver_id;
  end if;
  return new;
end $$;
revoke all on function cineaura_private.message_identity() from public, anon, authenticated;
drop trigger if exists ca_message_identity on public.messages;
create trigger ca_message_identity before insert on public.messages
  for each row execute function cineaura_private.message_identity();

create policy ca_messages_read on public.messages for select to authenticated
  using (cineaura_private.current_member_id() in (sender_id, receiver_id));
create policy ca_messages_send on public.messages for insert to authenticated
  with check (sender_id = cineaura_private.current_member_id() and sender_id <> receiver_id
    and exists (select 1 from public.member_directory d where d.member_id = receiver_id));
create policy ca_messages_read_receipt on public.messages for update to authenticated
  using (receiver_id = cineaura_private.current_member_id())
  with check (receiver_id = cineaura_private.current_member_id());
create policy ca_messages_delete on public.messages for delete to authenticated
  using (cineaura_private.current_member_id() in (sender_id, receiver_id));

-- Only the recipient can read/mark/delete a notification. Arbitrary client
-- INSERTs (including fake financial/admin notices) remain deliberately closed.
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
create policy ca_notes_read on public.notifications for select to authenticated using (member_id = cineaura_private.current_member_id());
create policy ca_notes_update on public.notifications for update to authenticated
  using (member_id = cineaura_private.current_member_id()) with check (member_id = cineaura_private.current_member_id());
create policy ca_notes_delete on public.notifications for delete to authenticated using (member_id = cineaura_private.current_member_id());

-- Members may read their own codes/history, never mint paid codes, change a
-- status, redeem another account's activation or write a balance directly.
do $$
declare item record;
begin
  for item in select * from (values
    ('codes', 'owner'), ('activation', 'member_id'), ('point_spends', 'member_id'),
    ('membership_purchases', 'member_id'), ('views', 'viewer_id'), ('hestory', 'visitor_id')
  ) as x(table_name, actor_column) loop
    if to_regclass('public.' || item.table_name) is null then continue; end if;
    execute format('grant select on public.%I to authenticated', item.table_name);
    execute format('create policy ca_owner_read on public.%I for select to authenticated using (%I = cineaura_private.current_member_id())', item.table_name, item.actor_column);
  end loop;
end $$;

-- Public, non-credential configuration/catalogs only. Adding a new table later
-- requires an explicit review instead of inheriting public CRUD.
do $$
declare t text;
begin
  foreach t in array array['plans', 'plans_settings', 'plan_prices', 'panel_settings', 'help_categories', 'prize_categories'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy ca_catalog_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

do $$
begin
  if to_regclass('public.help_articles') is not null then
    grant select on public.help_articles to anon, authenticated;
    create policy ca_help_published on public.help_articles for select to anon, authenticated
      using (status = 'published' or cineaura_private.can_section('help'));
  end if;
end $$;

-- A public staff badge is not a staff password/session/permission grant.
create or replace view public.staff_directory with (security_barrier = true) as
select id, member_id, username, role from public.staff;
revoke all on public.staff_directory from public, anon, authenticated;
grant select on public.staff_directory to anon, authenticated;
grant select (id, member_id, username, role, sections) on public.staff to authenticated;
create policy ca_staff_self_read on public.staff for select to authenticated
  using (member_id = cineaura_private.current_member_id() or cineaura_private.can_section('staff'));

-- Every legacy staff token is additionally bound to the native Auth UUID of its
-- owner. A stolen token, shared role password, or localStorage role is not enough.
create or replace function public._staff(p_token text) returns public.staff
language plpgsql security definer set search_path = pg_catalog as $$
declare s public.staff;
begin
  perform cineaura_private.assert_staff_token(p_token);
  select st.* into s from public.staff st join public.staff_sessions ss on ss.staff_id = st.id
   where ss.token = p_token and ss.expires_at > now();
  if not found then raise exception 'staff_auth' using errcode = '42501'; end if;
  return s;
end $$;

create or replace function public.staff_login(p_role text, p_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare s public.staff; tok text; recent integer; caller text := cineaura_private.current_member_id();
begin
  if caller is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  delete from public.staff_login_attempts where at < now() - interval '1 day';
  select count(*) into recent from public.staff_login_attempts where role = caller and at > now() - interval '15 minutes';
  if recent >= 8 then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  select * into s from public.staff where member_id = caller and role = lower(coalesce(p_role, ''))
    and password = extensions.crypt(coalesce(p_hash, ''), password) limit 1;
  if not found then
    insert into public.staff_login_attempts(role) values (caller);
    return jsonb_build_object('ok', false, 'error', 'credentials');
  end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.staff_sessions(token, staff_id, expires_at) values (tok, s.id, now() + interval '7 days');
  delete from public.staff_sessions where expires_at < now();
  return jsonb_build_object('ok', true, 'token', tok, 'staff', public._staff_json(s));
end $$;

-- A payout requires a recent password-authenticated native session. Password
-- hashes leaked by the old schema cannot authorize a withdrawal. The browser
-- explicitly reauthenticates with GoTrue before calling withdraw_request.
create or replace function cineaura_private.assert_recent_password() returns void
language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if cineaura_private.is_service_request() then return; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) amr
     where amr->>'method' = 'password'
       and (amr->>'timestamp') ~ '^[0-9]{1,12}$'
       and (amr->>'timestamp')::bigint between extract(epoch from now())::bigint - 300 and extract(epoch from now())::bigint + 30
  ) then raise exception 'recent_password_required' using errcode = '42501'; end if;
end $$;
revoke all on function cineaura_private.assert_recent_password() from public, anon, authenticated;

-- RPCs are SECURITY DEFINER: RLS alone does not protect their p_member/p_viewer
-- arguments. Keep implementations private, expose guarded wrappers, and revoke
-- every unknown/helper/old login RPC. The manifest makes the decision auditable.
create table if not exists cineaura_private.rpc_manifest (
  signature text primary key,
  implementation_name text not null,
  decision text not null,
  wrapper_definition text,
  original_definition text not null
);
alter table cineaura_private.rpc_manifest enable row level security;
revoke all on cineaura_private.rpc_manifest from public, anon, authenticated;

do $$
declare
  f record;
  actor text;
  checks text;
  invocation text;
  args text;
  statement text;
  decision text;
  public_reads text[] := array['site_banner_get', 'plans_public', 'platforms_public', 'market_categories',
    'channel_top', 'post_top_members', 'withdraw_info', 'balance_tier', 'level_cap', 'membership_point_price',
    'points_level', 'points_level_name', 'points_multiplier', 'watch_tier', 'watch_tier_minutes'];
  guest_reads text[] := array['content_comments_list','content_feed','content_get','content_playlist_get',
    'content_playlists_of','content_search','content_suggest','content_tags','iptv_channel_search','iptv_list_open',
    'iptv_lists_search','market_category','market_feed','market_home','market_list','market_product','market_profile',
    'market_search','market_store','market_suggest','market_top_stores','search_channels','search_content',
    'search_market','search_prizes','search_profiles','search_titles'];
  guest_gates text[] := array['code_use','iptv_premium_login','iptv_premium_unlock'];
  native_functions text[] := array['member_auth_bind()', 'member_account_update(p_full_name text)',
    'member_activate_free()', 'staff_login(p_role text, p_hash text)'];
  -- Explicit identity-guard compatibility surface from the repository schemas.
  -- Merely naming a parameter p_member/p_token is NOT enough to expose a new
  -- SECURITY DEFINER RPC. Unknown names AND unknown overloads stay server-only.
  -- This list reviews identity binding, not every business/provider rule.
  known_rpc_signatures text[] := array[
    'account_check(p_member text)',
    'account_code_redeem(p_member text, p_code text, p_ip text)',
    'account_level(p_member text)',
    'announce_list(p_token text, p_limit integer)',
    'announce_preview(p_token text, p_audience text, p_country text)',
    'announce_send(p_token text, p_title text, p_body text, p_href text, p_audience text, p_country text)',
    'balance_tier(p_balance bigint)',
    'channel_top(p_limit integer, p_days integer)',
    'channel_view_add(p_member text, p_package text, p_channel text)',
    'code_create(p_member text, p_code text, p_ip text, p_age text)',
    'code_device_add(p_member text, p_code text, p_mac text, p_name text, p_type text)',
    'code_device_edit(p_member text, p_code text, p_name text, p_type text)',
    'code_link_here(p_member text, p_code text, p_mac text, p_name text, p_ip text)',
    'code_unlink(p_member text, p_code text)',
    'code_use(p_code text, p_mac text, p_name text, p_ip text, p_age integer, p_silent boolean, p_type text, p_link boolean)',
    'content_admin(p_token text, p_kind text, p_filter text, p_q text, p_sort text, p_limit integer, p_offset integer)',
    'content_comment_add(p_member text, p_id text, p_body text, p_parent bigint, p_country text)',
    'content_comment_delete(p_member text, p_comment bigint)',
    'content_comments_list(p_id text, p_member text, p_limit integer)',
    'content_create(p_member text, d jsonb)',
    'content_delete(p_member text, p_id text)',
    'content_feed(p_member text, p_limit integer, p_before timestamp with time zone, p_before_id text)',
    'content_get(p_id text, p_member text)',
    'content_mine(p_member text)',
    'content_minute(p_id text, p_viewer text, p_country text)',
    'content_moderate(p_token text, p_kind text, p_id text, p_action text, p_reason text)',
    'content_playlist_add(p_member text, p_content text, p_playlist text, p_name text)',
    'content_playlist_get(p_playlist text, p_member text, p_limit integer, p_offset integer)',
    'content_playlist_remove(p_member text, p_content text, p_playlist text)',
    'content_playlists_mine(p_member text, p_content text)',
    'content_playlists_of(p_owner text, p_member text)',
    'content_publish_now(p_member text, p_id text)',
    'content_search(p_member text, p_q text, p_sort text, p_lang text, p_country text, p_age integer, p_owner text, p_tag text, p_limit integer, p_offset integer)',
    'content_stats(p_member text, p_from timestamp with time zone, p_to timestamp with time zone)',
    'content_suggest(p_id text, p_member text, p_limit integer)',
    'content_tags(p_q text, p_member text, p_limit integer)',
    'content_track(p_ids text[], p_kind text, p_viewer text, p_network text, p_country text)',
    'content_unlock(p_id text, p_member text, p_code text, p_mac text, p_name text, p_ip text, p_silent boolean, p_link boolean)',
    'content_update(p_member text, p_id text, d jsonb)',
    'content_vote(p_member text, p_id text, p_vote integer, p_country text)',
    'help_upload(p_token text, p_slug text, p_names text[])',
    'help_vote(p_article uuid, p_member text, p_helpful boolean)',
    'iptv_channel_search(p_member text, p_q text, p_kind text, p_sort text, p_limit integer, p_offset integer)',
    'iptv_list_conditions(p_member text, p_list text, d jsonb)',
    'iptv_list_delete(p_member text, p_id text)',
    'iptv_list_index(p_member text, p_id text, p_rows jsonb, p_start integer, p_done boolean, p_counts jsonb, p_epg text, p_sig text)',
    'iptv_list_join_answer(p_member text, p_list text, p_request bigint, p_action text)',
    'iptv_list_join_request(p_member text, p_list text, p_note text)',
    'iptv_list_moderate(p_token text, p_id text, p_action text, p_reason text)',
    'iptv_list_open(p_id text, p_member text)',
    'iptv_list_save(p_member text, d jsonb)',
    'iptv_list_unlock(p_member text, p_list text, p_code text)',
    'iptv_lists_admin(p_token text, p_filter text, p_q text, p_sort text, p_limit integer, p_offset integer)',
    'iptv_lists_mine(p_member text)',
    'iptv_lists_search(p_member text, p_q text, p_sort text, p_filter text, p_limit integer, p_offset integer)',
    'iptv_premium_login(p_user text, p_pass text)',
    'iptv_premium_unlock(p_code text, p_mac text, p_name text, p_ip text, p_silent boolean, p_type text, p_remember boolean)',
    'level_cap(p_plan text)',
    'market_address(p_member text)',
    'market_address_save(p_member text, p_address jsonb)',
    'market_admin_categories(p_token text, p_q text, p_sort text, p_limit integer, p_offset integer)',
    'market_admin_category(p_token text, p_id text, p_action text, p_value text)',
    'market_admin_order(p_token text, p_id text, p_action text, p_reason text)',
    'market_admin_orders(p_token text, p_filter text, p_q text, p_limit integer, p_offset integer)',
    'market_admin_overview(p_token text)',
    'market_admin_products(p_token text, p_filter text, p_q text, p_sort text, p_limit integer, p_offset integer)',
    'market_admin_social(p_token text, p_kind text, p_filter text, p_q text, p_limit integer, p_offset integer)',
    'market_admin_social_moderate(p_token text, p_kind text, p_id text, p_action text, p_reason text)',
    'market_admin_stores(p_token text, p_filter text, p_q text, p_sort text, p_limit integer, p_offset integer)',
    'market_buy(p_member text, p_product text, p_qty integer, p_address jsonb, p_ref text, p_coupon text, p_lang text)',
    'market_categories(p_q text, p_limit integer)',
    'market_category(p_id text, p_member text, p_lang text)',
    'market_coupon_check(p_member text, p_product text, p_code text, p_qty integer)',
    'market_coupon_get(p_member text, p_id text)',
    'market_coupon_remove(p_member text, p_id text)',
    'market_coupon_save(p_member text, d jsonb)',
    'market_coupon_status(p_member text, p_id text, p_status text)',
    'market_coupons_mine(p_member text, p_filter text, p_limit integer, p_offset integer)',
    'market_coupons_sales(p_member text, p_filter text, p_limit integer, p_offset integer)',
    'market_coupons_store(p_member text, p_store text)',
    'market_feed(p_member text, p_limit integer, p_before timestamp with time zone, p_before_id text, p_lang text)',
    'market_home(p_member text, p_lang text)',
    'market_images(p_member text, p_kind text, p_id text, p_urls jsonb)',
    'market_later(p_member text, p_product text, p_on boolean, p_lang text)',
    'market_list(p_list text, p_member text, p_lang text)',
    'market_list_delete(p_member text, p_list text)',
    'market_list_item(p_member text, p_list text, p_product text, p_on boolean, p_lang text)',
    'market_list_save(p_member text, d jsonb)',
    'market_lists_mine(p_member text, p_product text)',
    'market_me(p_member text)',
    'market_moderate(p_token text, p_kind text, p_id text, p_action text, p_reason text)',
    'market_my_products(p_member text, p_limit integer, p_offset integer)',
    'market_order_action(p_member text, p_order text, p_action text, p_note text)',
    'market_order_address(p_member text, p_order text, p_address jsonb, p_save boolean)',
    'market_orders(p_member text, p_side text, p_tab text, p_limit integer, p_offset integer)',
    'market_product(p_id text, p_member text, p_country text, p_lang text)',
    'market_product_notify_vip(p_member text, p_product text, p_note text)',
    'market_product_save(p_member text, d jsonb)',
    'market_product_status(p_member text, p_id text, p_status text)',
    'market_profile(p_owner text, p_member text, p_tab text, p_limit integer, p_offset integer, p_lang text)',
    'market_rec_delete(p_member text, p_id text)',
    'market_rec_save(p_member text, p_product text, d jsonb, p_lang text)',
    'market_rec_share(p_member text, p_kind text, p_id text, d jsonb)',
    'market_report(p_member text, p_kind text, p_id text, p_reason text, p_note text)',
    'market_reports_admin(p_token text, p_filter text, p_limit integer)',
    'market_reports_count(p_token text)',
    'market_reports_delete(p_token text, p_ids bigint[])',
    'market_reports_set(p_token text, p_ids bigint[], p_status text)',
    'market_request_close(p_member text, p_id bigint)',
    'market_request_reply(p_member text, p_id bigint, p_reply text)',
    'market_request_send(p_member text, p_store text, p_product text, p_kind text, p_body text)',
    'market_requests(p_member text, p_side text, p_limit integer, p_offset integer)',
    'market_review_delete(p_member text, p_product text)',
    'market_review_save(p_member text, p_product text, p_pros jsonb, p_cons jsonb, p_audience jsonb, p_lang text)',
    'market_reviews(p_member text, p_side text, p_limit integer, p_offset integer)',
    'market_search(p_member text, p_q text, p_type text, p_sort text, p_country text, p_kind text, p_category text, p_store text, p_limit integer, p_offset integer, p_lang text)',
    'market_store(p_id text, p_member text)',
    'market_store_deposit(p_member text, p_amount bigint)',
    'market_store_save(p_member text, d jsonb)',
    'market_store_withdraw(p_member text, p_amount bigint)',
    'market_suggest(p_id text, p_limit integer, p_member text, p_lang text)',
    'market_top_stores(p_member text, p_limit integer)',
    'market_upload(p_member text, p_kind text, p_id text, p_names text[])',
    'member_admin_set_status(p_token text, p_member text, p_status text)',
    'membership_buy_with_points(p_member text, p_plan text)',
    'membership_point_price(p_plan text)',
    'membership_points_catalog(p_member text)',
    'pack_code_save(p_token text, p_kind text, d jsonb)',
    'pack_codes_admin(p_token text, p_kind text, p_filter text, p_q text, p_limit integer, p_offset integer)',
    'pack_codes_delete(p_token text, p_kind text, p_codes text[])',
    'panel_member_summary(p_token text, p_member text)',
    'panel_overview(p_token text)',
    'panel_settings_save(p_token text, p_show_admin boolean, p_show_moderator boolean, p_show_member boolean)',
    'patreon_ban_flags(p_token text)',
    'patreon_import(p_token text, rows jsonb, p_source text)',
    'patreon_review_admin(p_token text)',
    'patreon_unban(p_token text, p_claim bigint)',
    'plans_admin(p_token text)',
    'plans_public()',
    'plans_save(p_token text, d jsonb)',
    'platform_post_delete(p_token text, p_id uuid)',
    'platform_post_save(p_token text, p_id uuid, p_title text, p_description text, p_tags text[], p_media_type text, p_media_url text, p_platforms text[], p_publish_day smallint)',
    'platform_post_state(p_token text, p_id uuid, p_state text)',
    'platform_posts_list(p_token text)',
    'platforms_config(p_token text)',
    'platforms_public()',
    'platforms_settings_save(p_token text, p_platform text, p_enabled boolean, p_profile_url text, p_publish_day smallint, p_credentials jsonb)',
    'points_code_history(p_member text)',
    'points_code_redeem(p_member text, p_code text, p_country text)',
    'points_level(p_earned bigint)',
    'points_level_name(p_level integer)',
    'points_multiplier(p_level integer)',
    'post_suggestions(p_member text, p_limit integer)',
    'post_top_members(p_limit integer)',
    'posts_gate(p_member text, p_ids text[])',
    'prize_admin_claim(p_token text, p_claim bigint, p_action text, d jsonb)',
    'prize_admin_codes(p_token text)',
    'prize_admin_delete(p_token text, p_id bigint)',
    'prize_admin_end(p_token text, p_id bigint)',
    'prize_admin_entry(p_token text, p_entry bigint, p_action text, p_days integer, p_by text)',
    'prize_admin_group(p_token text, p_op text, p_id bigint, p_name text, p_thumb text, p_visible boolean)',
    'prize_admin_group_image(p_token text, p_id bigint, p_thumb text)',
    'prize_admin_images(p_token text, p_id bigint, p_images jsonb)',
    'prize_admin_limits(p_token text, p_rows jsonb)',
    'prize_admin_overview(p_token text)',
    'prize_admin_save(p_token text, p_id bigint, d jsonb)',
    'prize_admin_stats(p_token text, p_from date, p_to date, p_prize bigint, p_mode text)',
    'prize_admin_upload(p_token text, p_kind text, p_id bigint, p_names text[])',
    'prize_claim_challenge(p_member text, p_entry bigint)',
    'prize_claim_simple(p_member text, p_prize bigint)',
    'prize_coupon_check(p_member text, p_prize bigint, p_code text)',
    'prize_join(p_member text, p_prize bigint, p_mode text, p_code text)',
    'prize_log_visit(p_prize bigint, p_visitor text, p_country text)',
    'prize_pack_mine(p_member text)',
    'prize_request_claim(p_member text, p_entry bigint)',
    'prize_subscribe_plain(p_member text, p_prize bigint)',
    'prize_withdraw(p_member text, p_entry bigint)',
    'search_channels(p_member text, p_q text, p_kind text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'search_content(p_member text, p_q text, p_kind text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'search_market(p_member text, p_q text, p_kind text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'search_prizes(p_member text, p_q text, p_kind text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'search_profiles(p_member text, p_q text, p_kind text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'search_titles(p_member text, p_q text, p_kind text, p_media text, p_when text, p_sort text, p_limit integer, p_offset integer)',
    'site_banner_admin(p_token text)',
    'site_banner_get()',
    'site_banner_save(p_token text, d jsonb)',
    'staff_add(p_token text, p_member text, p_role text, p_hash text, p_sections text)',
    'staff_app_save(p_token text, p_platform text, p_url text, p_version text)',
    'staff_logout(p_token text)',
    'staff_remove(p_token text, p_id bigint)',
    'staff_session(p_token text)',
    'staff_set_password(p_token text, p_hash text)',
    'staff_set_sections(p_token text, p_id bigint, p_sections text)',
    'staff_site_link_save(p_token text, p_key text, p_url text)',
    'watch_minute(p_view bigint, p_viewer text, p_country text)',
    'watch_tier(p_country text)',
    'watch_tier_minutes(p_tier integer)',
    'withdraw_admin_action(p_token text, p_id text, p_action text, p_reason text, p_reference text, p_refund boolean)',
    'withdraw_admin_list(p_token text, p_filter text, p_q text, p_limit integer, p_offset integer)',
    'withdraw_admin_settings(p_token text)',
    'withdraw_admin_settings_save(p_token text, d jsonb)',
    'withdraw_cancel(p_member text, p_id text)',
    'withdraw_forget(p_member text, p_method text)',
    'withdraw_info()',
    'withdraw_me(p_member text)',
    'withdraw_request(p_member text, p_password text, p_points integer, p_method text, p_details jsonb, p_save boolean)'
  ];
  disabled text[] := array['login_member','register_member','reset_password_with_recovery','staff_setup_super'];
begin
  for f in
    select p.*, pg_get_function_identity_arguments(p.oid) as identity_args,
           pg_get_function_arguments(p.oid) as arguments_sql, pg_get_function_result(p.oid) as result_sql,
           pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
     order by p.proname, p.oid
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.identity_args);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.identity_args);
    if exists (select 1 from cineaura_private.rpc_manifest where signature = f.proname || '(' || f.identity_args || ')') then
      if not exists (select 1 from cineaura_private.rpc_manifest where signature = f.proname || '(' || f.identity_args || ')'
                      and wrapper_definition = f.definition) then
        raise exception 'rpc_definition_drift: %', f.proname;
      end if;
      select m.decision into decision from cineaura_private.rpc_manifest m where m.signature = f.proname || '(' || f.identity_args || ')';
      if decision = 'public' then
        execute format('grant execute on function public.%I(%s) to anon, authenticated', f.proname, f.identity_args);
      elsif decision in ('actor', 'staff', 'native') then
        execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.identity_args);
      end if;
      continue;
    end if;
    if (f.proname || '(' || f.identity_args || ')') = any(native_functions) then
      execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.identity_args);
      -- Native functions contain their own UUID-based validation.
      continue;
    end if;
    if not (f.proname || '(' || f.identity_args || ')') = any(known_rpc_signatures) then continue; end if;
    if left(f.proname, 1) = '_' or f.proname = any(disabled)
       or f.prorettype = 'trigger'::regtype or f.provariadic <> 0
       or (f.proargmodes is not null and 'b' = any(f.proargmodes)) then
      continue;
    end if;
    checks := '';
    decision := 'server_only';
    if 'p_token' = any(coalesce(f.proargnames, array[]::text[])) then
      checks := 'perform cineaura_private.assert_staff_token(p_token);';
      decision := 'staff';
    else
      foreach actor in array array['p_member', 'p_viewer', 'p_visitor'] loop
        if actor = any(coalesce(f.proargnames, array[]::text[])) then
          -- account_level is intentionally a public aggregate/target lookup,
          -- not an actor. Do not confuse an admin target with its token owner.
          if f.proname = 'account_level' then continue; end if;
          checks := checks || format('perform cineaura_private.assert_actor(%I, %L);', actor, f.proname = any(guest_reads));
          decision := case when f.proname = any(guest_reads) then 'public' else 'actor' end;
        end if;
      end loop;
      if f.proname = any(public_reads) or f.proname = any(guest_gates) or f.proname = 'account_level' then decision := 'public'; end if;
    end if;
    if decision = 'server_only' then continue; end if;
    select string_agg('$' || n::text, ', ' order by n) into args from generate_series(1, f.pronargs) n;
    args := coalesce(args, '');
    if f.proname = 'withdraw_request' then
      checks := checks || 'perform cineaura_private.assert_recent_password();';
      -- Preserve the existing business rules inside the legacy implementation,
      -- but supply its compatibility password value only inside the server.
      -- That value is NEVER returned to a browser or used for authentication.
      args := replace(args, '$2', '(select password from public.members where member_id = p_member)');
    end if;
    execute format('alter function public.%I(%s) set schema cineaura_private', f.proname, f.identity_args);
    invocation := format('cineaura_private.%I(%s)', f.proname, args);
    if f.proretset then statement := 'return query select * from ' || invocation || ';';
    elsif f.prorettype = 'void'::regtype then statement := 'perform ' || invocation || '; return;';
    else statement := 'return ' || invocation || ';'; end if;
    execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path = pg_catalog as %L',
      f.proname, f.arguments_sql, f.result_sql, 'begin ' || checks || statement || ' end');
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.identity_args);
    if decision = 'public' then
      execute format('grant execute on function public.%I(%s) to anon, authenticated', f.proname, f.identity_args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.identity_args);
    end if;
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.identity_args);
    insert into cineaura_private.rpc_manifest(signature, implementation_name, decision, wrapper_definition, original_definition)
      select f.proname || '(' || f.identity_args || ')', f.proname, decision, pg_get_functiondef(p.oid), f.definition
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = f.proname and p.proargtypes = f.proargtypes;
  end loop;
end $$;

-- Serial ids for the ONLY directly client-insertable core table.
do $$
declare seq text := pg_get_serial_sequence('public.messages', 'id');
begin
  if seq is not null then execute 'grant usage, select on sequence ' || seq || ' to authenticated'; end if;
end $$;

-- Ownership-bearing Storage policies need their own reviewed migration (P0 #2).
-- Contain the old write bypass immediately: restrictive policies intersect with
-- permissive bucket policies, so legacy anonymous upload/delete cannot survive.
-- Reading private buckets is blocked until owner-scoped policies are installed.
-- Public object URLs remain public by definition; do not call them private.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists ca_block_unreviewed_insert on storage.objects';
  execute 'drop policy if exists ca_block_unreviewed_update on storage.objects';
  execute 'drop policy if exists ca_block_unreviewed_delete on storage.objects';
  execute 'drop policy if exists ca_block_unreviewed_private_read on storage.objects';
  execute 'create policy ca_block_unreviewed_insert on storage.objects as restrictive for insert to anon, authenticated with check (false)';
  execute 'create policy ca_block_unreviewed_update on storage.objects as restrictive for update to anon, authenticated using (false) with check (false)';
  execute 'create policy ca_block_unreviewed_delete on storage.objects as restrictive for delete to anon, authenticated using (false)';
  execute 'create policy ca_block_unreviewed_private_read on storage.objects as restrictive for select to anon, authenticated using (exists (select 1 from storage.buckets b where b.id = bucket_id and b.public))';
end $$;

update cineaura_private.auth_rollout set phase = 'sealed', sealed_at = coalesce(sealed_at, now()) where id;
notify pgrst, 'reload schema';
commit;
