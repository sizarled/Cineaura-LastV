-- ─────────────────────────────────────────────────────────────────────────────
-- CineAura — Social platforms (Panel > Platforms + Panel > Settings > Social
-- platforms API + the home page's "Follow us" strip), sql/platforms.sql
--
-- WHAT IT SETS UP
--   platform_settings  one row per network: enabled, its page URL (home strip),
--                      the weekday the network publishes on (null = with every run),
--                      and the API credentials the staff pasted (only staff RPCs read them)
--   platform_posts     the queue: title, description, tags, the media (a public URL —
--                      uploads land in the source bucket under Platforms/Photos or
--                      Platforms/Videos), the chosen networks, and per-network results
--   RPCs               platforms_public()                    (home page: key+url only)
--                      platforms_config(p_token)             (staff: everything)
--                      platforms_settings_save(p_token,…)    (staff+settings section)
--                      platform_posts_list(p_token)
--                      platform_post_save(p_token,…)
--                      platform_post_state(p_token,…)
--                      platform_post_delete(p_token)
--   The publisher itself is the edge function supabase/functions/platform-publish
--   (service role; it reads this table, no anon access anywhere).
--
-- IDEMPOTENT — run it in the Supabase SQL editor as often as you like.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 · tables -----------------------------------------------------------------

create table if not exists public.platform_settings (
  platform     text primary key check (platform ~ '^[a-z]{1,20}$'),
  enabled      boolean not null default false,
  profile_url  text not null default '',
  publish_day  smallint check (publish_day between 0 and 6), -- 0=Sunday … 6=Saturday (site-local; the edge function compares UTC)
  credentials  jsonb not null default '{}'::jsonb,
  updated_by   text not null default '',
  updated_at   timestamptz not null default now()
);

create table if not exists public.platform_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default '' check (length(title) <= 300),
  description  text not null default '' check (length(description) <= 12000),
  tags         text[] not null default '{}',
  media_type   text not null default 'none' check (media_type in ('none','image','video')),
  media_url    text not null default '' check (length(media_url) <= 2000),
  platforms    text[] not null default '{}',
  state        text not null default 'pending' check (state in ('pending','pending_webhook','published','partial','failed')),
  results      jsonb not null default '{}'::jsonb,  -- { platform: { ok, detail, at } }
  publish_day  smallint check (publish_day between 0 and 6), -- a post may force its own day (null = follow each network)
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_run_at  timestamptz
);
create index if not exists platform_posts_due_idx on public.platform_posts (state, last_run_at) where state in ('pending','pending_webhook','failed');

alter table public.platform_settings enable row level security;
alter table public.platform_posts    enable row level security;
-- no anon/authenticated policies anywhere: only the RPCs below (security definer)
-- and the service role read this data — the API keys never leave the database.

-- 2 · staff gate (platforms.sql is standalone: panel_admin.sql's section list
--    does not know "platforms"; the super role and csv'd sections both pass) ----

create or replace function public._platforms_staff(p_token text, p_section text default 'platforms') returns text
language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  s := public._staff(p_token);
  if s.role = 'super'
     or position(',' || p_section || ',' in ',' || replace(coalesce(s.sections, ''), ' ', '') || ',') > 0 then
    return coalesce(nullif(s.username, ''), s.role);
  end if;
  raise exception 'staff_forbidden';
end $$;

-- known networks (kept in code too: js/social-icons.js); ids the UI shows.
create or replace function public._platform_known(p text) returns boolean language sql immutable as $$
  select p = any (array[
    'youtube','facebook','instagram','tiktok','x','pinterest','telegram','reddit',
    'quora','tumblr','rumble','odysee','vimeo','bilibili','snapchat','threads'
  ]) $$;

-- 3 · the public read (home page): key + url of the enabled networks only -----

create or replace function public.platforms_public()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('platform', p.platform, 'url', p.profile_url) order by p.platform)
    from public.platform_settings p
    where p.enabled and p.profile_url <> ''
  ), '[]'::jsonb);
end $$;
grant execute on function public.platforms_public() to anon, authenticated;

-- 4 · staff: full config ------------------------------------------------------

create or replace function public.platforms_config(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := public._platforms_staff(p_token, 'settings');
  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.platform) from public.platform_settings p
  ), '[]'::jsonb);
end $$;

create or replace function public.platforms_settings_save(
  p_token text, p_platform text, p_enabled boolean, p_profile_url text,
  p_publish_day smallint, p_credentials jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare who text; u text := btrim(coalesce(p_profile_url, ''));
begin
  who := public._platforms_staff(p_token, 'settings');
  if not public._platform_known(p_platform) then
    return jsonb_build_object('ok', false, 'error', 'bad_platform');
  end if;
  if u <> '' and (length(u) > 500 or u !~* '^https://[^/?#[:space:]<>"`]+') then
    return jsonb_build_object('ok', false, 'error', 'bad_url');
  end if;
  if p_publish_day is not null and (p_publish_day < 0 or p_publish_day > 6) then
    return jsonb_build_object('ok', false, 'error', 'bad_day');
  end if;
  insert into public.platform_settings as s (platform, enabled, profile_url, publish_day, credentials, updated_by, updated_at)
  values (p_platform, coalesce(p_enabled, false), u, p_publish_day, coalesce(p_credentials, '{}'::jsonb), who, now())
  on conflict (platform) do update set
    enabled     = excluded.enabled,
    profile_url = excluded.profile_url,
    publish_day = excluded.publish_day,
    -- empty credentials object = keep what is stored (the UI sends it cleared
    -- when the staff did not touch the key fields — it never overwrites by accident)
    credentials = case when excluded.credentials = '{}'::jsonb then s.credentials else excluded.credentials end,
    updated_by  = excluded.updated_by,
    updated_at  = excluded.updated_at;
  return jsonb_build_object('ok', true);
end $$;

-- 5 · staff: the queue --------------------------------------------------------

create or replace function public.platform_posts_list(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := public._platforms_staff(p_token);
  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.created_at desc)
    from (select * from public.platform_posts order by created_at desc limit 100) p
  ), '[]'::jsonb);
end $$;

create or replace function public.platform_post_save(
  p_token text, p_id uuid, p_title text, p_description text, p_tags text[],
  p_media_type text, p_media_url text, p_platforms text[], p_publish_day smallint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who text; tgt text[]; u text := btrim(coalesce(p_media_url, ''));
  clean_tags text[] := coalesce(array(select btrim(t) from unnest(coalesce(p_tags, '{}'::text[])) t where btrim(t) <> ''
                                      and length(btrim(t)) <= 60 and btrim(t) ~ '^[^@#<>{}\\]{1,60}$'), '{}'::text[]);
  r public.platform_posts;
begin
  who := public._platforms_staff(p_token);
  tgt := coalesce(array(select distinct x from unnest(coalesce(p_platforms, '{}'::text[])) x
                        where public._platform_known(x)), '{}'::text[]);
  if cardinality(tgt) = 0 then return jsonb_build_object('ok', false, 'error', 'no_platform'); end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then return jsonb_build_object('ok', false, 'error', 'no_title'); end if;
  if coalesce(p_media_type, 'none') not in ('none','image','video') then
    return jsonb_build_object('ok', false, 'error', 'bad_media');
  end if;
  -- the media may be an external https URL or a file already in the source bucket
  if p_media_type <> 'none'
     and u !~* '^https?://[^/?#[:space:]<>"`]+[^[:space:]<>"`]*$' then
    return jsonb_build_object('ok', false, 'error', 'bad_media_url');
  end if;
  if p_id is null then
    insert into public.platform_posts (title, description, tags, media_type, media_url, platforms, publish_day, created_by)
    values (btrim(p_title), btrim(coalesce(p_description, '')), clean_tags[1:20],
            coalesce(p_media_type, 'none'), u, tgt, p_publish_day, who)
    returning * into r;
  else
    update public.platform_posts set
      title = btrim(p_title), description = btrim(coalesce(p_description, '')),
      tags = clean_tags[1:20], media_type = coalesce(p_media_type, 'none'), media_url = u,
      platforms = tgt, publish_day = p_publish_day, updated_at = now(),
      state = case when state = 'published' then state else 'pending' end
    where id = p_id returning * into r;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'post', to_jsonb(r));
end $$;

-- staff marks a post (publisher absent / hand-posted); the edge function uses
-- service role SQL, no RPC, so this stays a staff convenience.
create or replace function public.platform_post_state(p_token text, p_id uuid, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := public._platforms_staff(p_token);
  if coalesce(p_state, '') not in ('pending','pending_webhook','published','partial','failed') then
    return jsonb_build_object('ok', false, 'error', 'bad_state');
  end if;
  update public.platform_posts set state = p_state, updated_at = now(),
         last_run_at = case when p_state = 'pending' then null else last_run_at end
  where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.platform_post_delete(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := public._platforms_staff(p_token);
  delete from public.platform_posts where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- 6 · the 13 accounts of the site, seeded (Platforms.txt): known URLs so the
--    home strip has links from the first run; the staff keeps them current.

insert into public.platform_settings (platform, enabled, profile_url, publish_day)
values
  ('youtube',    true,  'https://www.youtube.com/@CineauraV2',                          null),
  ('facebook',   true,  'https://www.facebook.com/CineauraV2',                          null),
  ('instagram',  true,  'https://www.instagram.com/cineaurav2/',                        null),
  ('tiktok',     true,  'https://www.tiktok.com/@cineauraV2',                           null),
  ('telegram',   true,  'https://t.me/CineauraV2',                                      null),
  ('reddit',     true,  'https://www.reddit.com/r/Cineaura2',                           null),
  ('pinterest',  true,  'https://www.pinterest.com/CineauraV2',                         null),
  ('quora',      true,  'https://msaht-cineaurav2arabic.quora.com',                     null),
  ('tumblr',     true,  'https://www.tumblr.com/cineaura-officiel-v2',                  null),
  ('rumble',     true,  'https://rumble.com/c/c-7972430',                               null),
  ('odysee',     true,  'https://odysee.com/@CineauraV2:c10d9b2863',                    null),
  ('vimeo',      true,  'https://vimeo.com/channels/1972980',                           null),
  ('bilibili',   true,  'https://www.bilibili.tv/en/space/1861102337',                  null),
  ('x',          false, '',                                                             null),
  ('snapchat',   false, '',                                                             null),
  ('threads',    false, '',                                                             null)
on conflict (platform) do nothing;

update public.platform_settings
set credentials = jsonb_set(coalesce(credentials, '{}'::jsonb), '{group_url}', '"https://web.facebook.com/groups/2011674376679254"', true)
where platform = 'facebook' and not (credentials ? 'group_url');

-- Storage note: the composer uploads to the `source` bucket under
--   Platforms/Photos/<file>  and  Platforms/Videos/<file>
-- sql/customization.sql already grants the bucket its public read + member write
-- policies — the same ones IPTV list uploads use — so nothing else is needed.
