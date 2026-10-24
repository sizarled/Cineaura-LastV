-- ============================================================
-- CineAura — Panel > Plans: the four memberships gain a SETTINGS block.
--
-- The names and the order Free → Silver → Gold → Diamond stay put (the primary
-- key itself allows only these four). Everything around a plan becomes editable
-- in Panel > Plans: the price (already), what users read (perks, ribbon — the
-- already shipped fields), and now the PERMISSIONS, stored per plan as a
-- settings map on the same row:
--
--   ad_free         who may switch "Watch without ads" on (default: the paid plans)
--   daily_uploads   videos published per day          (default 50 for everyone)
--   batch_uploads   files in one Dashboard > Upload   (default 1)
--   codes_max       active access codes kept at once  (5 · 10 · 10 · 10, as today)
--   code_months     the lifetime of one code          (1 · 3 · 6 · 12, as today)
--   withdraw_turns  reactivations before a withdrawal (off · 12 · 6 · 1, as today)
--   level_cap       the account level the plan lets reach (2 · 5 · 8 · 10, as today)
--
-- Today these numbers live hard-coded in the observers:
-- content_create carries "50 per day", the dashboard carries "5/10 codes for
-- 1/3/6/12 months" (client side, no server check at all), the withdrawal helper
-- carries "Silver 12 · Gold 6 · Diamond 1", and ad-free answered "premium".
-- Each of these now reads the plan's settings; a row the team never edited
-- behaves EXACTLY as before. Run after sql/plans.sql (and content_portrait.sql);
-- safe to run again (idempotent).
-- ============================================================

-- ------------------------------------------------------------------ 1. the column + untouched defaults
alter table public.plans add column if not exists settings jsonb not null default '{}'::jsonb;

update public.plans set settings = jsonb_build_object(
  'ad_free', plan <> 'Free',
  'daily_uploads', 50,
  'batch_uploads', 1,
  'codes_max', case plan when 'Free' then 5 else 10 end,
  'code_months', case plan when 'Free' then 1 when 'Silver' then 3 when 'Gold' then 6 else 12 end,
  'withdraw_turns', case plan when 'Diamond' then 1 when 'Gold' then 6 when 'Silver' then 12 else null end,
  'level_cap', case plan when 'Diamond' then 10 when 'Gold' then 8 when 'Silver' then 5 else 2 end)
where settings = '{}'::jsonb;

-- ------------------------------------------------------------------ 2. reading helpers
-- The plan one member row stands on: a paid membership while it runs, else Free
-- (same rule as _wd_plan of sql/withdrawals.sql, self-contained: plans may be
-- run before the withdrawal file).
create or replace function public._plan_of_row(m public.members) returns text
language sql stable as $$
  select case when initcap(lower(btrim(coalesce(m.membership_type, '')))) in ('Silver', 'Gold', 'Diamond')
                   and (m.membership_expires_at is null or m.membership_expires_at > now())
              then initcap(lower(btrim(m.membership_type))) else 'Free' end
$$;

-- One plan's settings, normalized: every key present, defended against junk
-- (the column is only written by plans_save, but a stray SQL edit must never
-- break a page).
create or replace function public._plan_settings(p public.plans) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'ad_free', coalesce(case when jsonb_typeof(p.settings -> 'ad_free') = 'boolean'
                             then (p.settings ->> 'ad_free')::boolean end, p.plan <> 'Free'),
    'daily_uploads', case when jsonb_typeof(p.settings -> 'daily_uploads') = 'number'
                          then least(1000, greatest(1, (p.settings ->> 'daily_uploads')::int)) else 50 end,
    'batch_uploads', case when jsonb_typeof(p.settings -> 'batch_uploads') = 'number'
                          then least(20, greatest(1, (p.settings ->> 'batch_uploads')::int)) else 1 end,
    'codes_max', case when jsonb_typeof(p.settings -> 'codes_max') = 'number'
                      then least(100, greatest(0, (p.settings ->> 'codes_max')::int))
                      else case p.plan when 'Free' then 5 else 10 end end,
    'code_months', case when jsonb_typeof(p.settings -> 'code_months') = 'number'
                        then least(120, greatest(1, (p.settings ->> 'code_months')::int))
                        else case p.plan when 'Free' then 1 when 'Silver' then 3 when 'Gold' then 6 else 12 end end,
    'withdraw_turns', case when jsonb_typeof(p.settings -> 'withdraw_turns') = 'number'
                           then least(99, greatest(1, (p.settings ->> 'withdraw_turns')::int))
                           when jsonb_typeof(p.settings -> 'withdraw_turns') = 'null' then null
                           else case p.plan when 'Diamond' then 1 when 'Gold' then 6 when 'Silver' then 12 else null end end,
    'level_cap', case when jsonb_typeof(p.settings -> 'level_cap') = 'number'
                      then least(10, greatest(1, (p.settings ->> 'level_cap')::int))
                      else case p.plan when 'Diamond' then 10 when 'Gold' then 8 when 'Silver' then 5 else 2 end end)
$$;

-- One setting of one plan as text ('' is the none of withdraw_turns).
create or replace function public.plan_setting(p_plan text, p_key text, p_default text default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare p public.plans; v text;
begin
  select * into p from public.plans
   where plan = initcap(lower(btrim(coalesce(p_plan, '')))) limit 1;
  if not found then return p_default; end if;
  return coalesce(public._plan_settings(p) ->> btrim(coalesce(p_key, '')), p_default);
end $$;

-- ------------------------------------------------------------------ 3. cards everywhere carry the settings
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
    'settings', public._plan_settings(p))
$$;

-- ------------------------------------------------------------------ 4. plans_save learns the block
create or replace function public.plans_save(p_token text, d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who text; what text := initcap(lower(btrim(coalesce(d->>'plan', ''))));
  cents int; pts int; v_mode text; v_months int; v_sort smallint; v_visible boolean;
  v_ribbon text; v_perks jsonb := '[]'::jsonb; line text;
  s jsonb; v_set jsonb; wt_ok boolean;
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

  -- the permissions block: only the listed keys, digits-checked, sensible ranges.
  -- Free never withdraws (the Panel cannot give it a turns number either).
  s := case when jsonb_typeof(d->'settings') = 'object' then d->'settings' else '{}'::jsonb end;
  wt_ok := what <> 'Free' and btrim(coalesce(s->>'withdraw_turns', '')) ~ '^[0-9]{1,2}$';
  v_set := jsonb_build_object(
    'ad_free', lower(btrim(coalesce(s->>'ad_free', ''))) in ('true', '1', 'yes', 'on'),
    'daily_uploads', case when btrim(coalesce(s->>'daily_uploads', '')) ~ '^[0-9]{1,4}$'
                          then least(1000, greatest(1, (s->>'daily_uploads')::int)) else 50 end,
    'batch_uploads', case when btrim(coalesce(s->>'batch_uploads', '')) ~ '^[0-9]{1,2}$'
                          then least(20, greatest(1, (s->>'batch_uploads')::int)) else 1 end,
    'codes_max', case when btrim(coalesce(s->>'codes_max', '')) ~ '^[0-9]{1,3}$'
                      then least(100, greatest(0, (s->>'codes_max')::int))
                      else case what when 'Free' then 5 else 10 end end,
    'code_months', case when btrim(coalesce(s->>'code_months', '')) ~ '^[0-9]{1,3}$'
                        then least(120, greatest(1, (s->>'code_months')::int))
                        else case what when 'Free' then 1 when 'Silver' then 3 when 'Gold' then 6 else 12 end end,
    'withdraw_turns', case when wt_ok then least(99, greatest(1, (s->>'withdraw_turns')::int)) else null end,
    'level_cap', case when btrim(coalesce(s->>'level_cap', '')) ~ '^[0-9]{1,2}$'
                      then least(10, greatest(1, (s->>'level_cap')::int))
                      else case what when 'Diamond' then 10 when 'Gold' then 8 when 'Silver' then 5 else 2 end end);

  update public.plans p
     set price_usd_cents = cents, price_points = pts, mode = v_mode, months = v_months,
         perks = v_perks, ribbon = v_ribbon, sort = v_sort, visible = v_visible,
         settings = v_set,
         updated_at = now(), updated_by = who
   where p.plan = what
  returning p into row;
  if not found then
    insert into public.plans (plan, price_usd_cents, price_points, mode, months, perks, ribbon, sort, visible, settings, updated_by)
    values (what, cents, pts, v_mode, v_months, v_perks, v_ribbon, v_sort, v_visible, v_set, who)
    returning * into row;
  end if;
  return jsonb_build_object('ok', true, 'plan', public._plan_json(row));
end $$;

-- ------------------------------------------------------------------ 5. the observers read the plan
-- 5a. videos per day: the 50 of content_create becomes the plan's daily_uploads.
create or replace function public.content_create(p_member text, d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members; cid text; url text; title text; descr text; vis text; age int; lang text; prov text; thumb text;
  is_portrait boolean; daycap int;
  tags text[]; people text[]; cty text; pub timestamptz; pid text; pname text; recent int; i int := 0; u text;
begin
  m := public._content_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if public._content_blocked(m.member_id, 'posts') then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  daycap := greatest(1, coalesce(public.plan_setting(public._plan_of_row(m), 'daily_uploads', '50')::int, 50));
  select count(*) into recent from public.content where owner_id = m.member_id and created_at > now() - interval '1 day';
  if recent >= daycap then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;

  url := btrim(coalesce(d->>'url', ''));
  if url !~* '^https?://[^/?#[:space:]]+' or length(url) > 2000 or url ~ '[[:space:]<>"`]' then
    return jsonb_build_object('ok', false, 'reason', 'url');
  end if;
  -- the link of one of their videos the team suspended cannot come back as a new video
  if exists (select 1 from public.content where owner_id = m.member_id and video_url = url and suspended_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'suspended');
  end if;
  title := btrim(regexp_replace(coalesce(d->>'title', ''), '[[:cntrl:]]', ' ', 'g'));
  if char_length(title) < 1 or char_length(title) > 150 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  descr := btrim(coalesce(d->>'description', ''));
  if char_length(descr) > 5000 then return jsonb_build_object('ok', false, 'reason', 'description'); end if;
  prov := lower(coalesce(d->>'provider', 'link'));
  if prov not in ('youtube', 'vimeo', 'dailymotion', 'facebook', 'drive', 'tiktok', 'file', 'hls', 'link') then prov := 'link'; end if;
  thumb := btrim(coalesce(d->>'thumb', ''));
  if thumb <> '' and (thumb !~* '^https://[^/?#[:space:]]+' or length(thumb) > 1000 or thumb ~ '[[:space:]<>"`]') then thumb := ''; end if;
  -- a portrait (vertical) video: ticked by the publisher, or a Shorts / TikTok link
  is_portrait := coalesce((d->>'portrait')::boolean, false) or prov = 'tiktok' or lower(url) like '%/shorts/%';
  -- tags: lower case, no "#", 1 to 30 characters, 12 at most
  select coalesce(array_agg(t order by n), '{}') into tags from (
    select distinct on (t) t, n from (
      select lower(btrim(regexp_replace(x, '^#+', ''))) as t, n
      from jsonb_array_elements_text(case when jsonb_typeof(d->'tags') = 'array' then d->'tags' else '[]'::jsonb end)
           with ordinality as e(x, n)
    ) s where char_length(t) between 1 and 30 order by t, n
  ) z;
  if array_length(tags, 1) > 12 then tags := tags[1:12]; end if;
  lang := btrim(coalesce(d->>'language', ''));
  if char_length(lang) > 40 then lang := left(lang, 40); end if;
  age := coalesce(nullif(d->>'age', '')::int, 3);
  if age not in (3, 6, 13, 16, 18) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  vis := coalesce(d->>'visibility', 'public');
  if vis not in ('public', 'exclusive', 'private') then return jsonb_build_object('ok', false, 'reason', 'visibility'); end if;
  cty := upper(regexp_replace(coalesce(d->>'countries', ''), '[^A-Za-z,]', '', 'g'));
  select coalesce(array_agg(distinct x), '{}') into people from (
    select lower(btrim(regexp_replace(x, '^@+', ''))) as x
    from jsonb_array_elements_text(case when jsonb_typeof(d->'people') = 'array' then d->'people' else '[]'::jsonb end) as e(x)
  ) s where x <> '' and char_length(x) <= 60;
  if vis = 'private' and coalesce(array_length(people, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'people');
  end if;
  if coalesce(array_length(people, 1), 0) > 100 then return jsonb_build_object('ok', false, 'reason', 'people'); end if;
  pub := coalesce(nullif(d->>'publish_at', '')::timestamptz, now());
  if pub < now() then pub := now(); end if;
  if pub > now() + interval '1 year' then return jsonb_build_object('ok', false, 'reason', 'publish_at'); end if;

  -- the playlist: one of the member's own, or a new one by name
  pid := nullif(btrim(coalesce(d->>'playlist', '')), '');
  pname := btrim(coalesce(d->>'playlist_name', ''));
  if pid is not null and not exists (select 1 from public.content_playlists where playlist_id = pid and owner_id = m.member_id) then
    return jsonb_build_object('ok', false, 'reason', 'playlist');
  end if;
  if pid is null and pname <> '' then
    if char_length(pname) > 80 then return jsonb_build_object('ok', false, 'reason', 'playlist'); end if;
    select playlist_id into pid from public.content_playlists where owner_id = m.member_id and lower(name) = lower(pname) limit 1;
    if pid is null then
      loop
        pid := 'CPL' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
        exit when not exists (select 1 from public.content_playlists where playlist_id = pid);
      end loop;
      insert into public.content_playlists (playlist_id, owner_id, owner_username, name) values (pid, m.member_id, m.username, pname);
    end if;
  end if;

  loop
    cid := 'CT' || lpad((floor(random() * 1e10))::bigint::text, 10, '0');
    exit when not exists (select 1 from public.content where content_id = cid);
    i := i + 1;
    if i > 20 then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  end loop;
  insert into public.content (content_id, owner_id, owner_username, video_url, provider, thumb_url, title, description,
                              tags, language, age_rating, visibility, excl_followers, excl_premium, excl_countries,
                              country, playlist_id, publish_at, portrait)
  values (cid, m.member_id, m.username, url, prov, thumb, title, descr, tags, lang, age, vis,
          vis = 'exclusive' and coalesce((d->>'followers')::boolean, false),
          vis = 'exclusive' and coalesce((d->>'premium')::boolean, false),
          case when vis = 'exclusive' then cty else '' end,
          upper(coalesce(m.country, '')), pid, pub, is_portrait);
  if vis = 'private' then
    foreach u in array people loop
      insert into public.content_access (content_id, username) values (cid, u) on conflict do nothing;
    end loop;
  end if;
  if pid is not null then
    insert into public.content_playlist_items (playlist_id, content_id) values (pid, cid) on conflict do nothing;
  end if;
  if pub <= now() then perform public._content_notify(cid); end if;
  return jsonb_build_object('ok', true, 'id', cid, 'publish_at', pub, 'scheduled', pub > now(), 'playlist', pid);
end $$;

-- 5b. the withdrawal helpers: a plan's level ceiling and the reactivations it
-- asks before money may leave (sql/withdrawals.sql said Free LV2 / no money ·
-- Silver LV5 12 · Gold LV8 6 · Diamond LV10 1 — the untouched defaults stay).
create or replace function public.level_cap(p_plan text) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regprocedure('public.plan_setting(text, text, text)') is not null then
    return coalesce(public.plan_setting(p_plan, 'level_cap',
      case initcap(lower(btrim(coalesce(p_plan, '')))) when 'Diamond' then '10' when 'Gold' then '8' when 'Silver' then '5' else '2' end)::int,
      2);
  end if;
  return case initcap(lower(btrim(coalesce(p_plan, '')))) when 'Diamond' then 10 when 'Gold' then 8 when 'Silver' then 5 else 2 end;
end $$;

create or replace function public._wd_turns_needed(p_plan text) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regprocedure('public.plan_setting(text, text, text)') is not null
     and public.plan_setting(p_plan, 'withdraw_turns', null) is not null then
    return greatest(1, public.plan_setting(p_plan, 'withdraw_turns', null)::int);
  end if;
  return case initcap(lower(btrim(coalesce(p_plan, '')))) when 'Diamond' then 1 when 'Gold' then 6 when 'Silver' then 12 else null end;
end $$;

-- 5c. Dashboard > Codes: the member's own access codes, created server-side for
-- the first time — the count and the lifetime come from the plan, no longer
-- from a client constant. Reasons: member | code | exists | limit (+ max) |
-- age | ip.
create or replace function public.code_create(
  p_member text, p_code text, p_ip text default '', p_age text default 'adult')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members; c text; ip text; age text; plan text; maxc int; mon int; have int;
  save public.codes;
begin
  select * into m from public.members where member_id = btrim(coalesce(p_member, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  c := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if char_length(c) <> 6 then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  if exists (select 1 from public.codes where code = c) then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;
  ip := btrim(coalesce(p_ip, ''));
  if char_length(ip) > 60 or ip ~ '[^0-9.:a-fA-F ]' then
    return jsonb_build_object('ok', false, 'reason', 'ip');
  end if;
  age := lower(btrim(coalesce(p_age, 'adult')));
  if age not in ('u13', 'u16', 'u18', 'adult') then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  plan := public._plan_of_row(m);
  maxc := greatest(0, coalesce(public.plan_setting(plan, 'codes_max', '10')::int, 10));
  mon := greatest(1, coalesce(public.plan_setting(plan, 'code_months', '12')::int, 12));
  select count(*) into have from public.codes
   where owner = m.member_id and lower(coalesce(status, '')) = 'active'
     and (expires_at is null or expires_at > now());
  if have >= maxc then return jsonb_build_object('ok', false, 'reason', 'limit', 'max', maxc); end if;
  insert into public.codes (owner, code, status, duration, ip, age_rating, expires_at)
  values (m.member_id, c, 'active',
          mon || ' month' || case when mon > 1 then 's' else '' end,
          nullif(ip, ''), age, now() + make_interval(months => mon))
  returning * into save;
  return jsonb_build_object('ok', true, 'code', save.code, 'owner', save.owner,
                            'duration', save.duration, 'expires_at', save.expires_at,
                            'age', save.age_rating, 'max', maxc);
end $$;

grant execute on function public.code_create(text, text, text, text) to anon, authenticated;
revoke all on function public._plan_of_row(public.members), public._plan_settings(public.plans),
  public.plan_setting(text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
