-- ============================================================
-- CineAura — Search system (search.html)
-- Run in the Supabase SQL editor AFTER members.sql, profile.sql, dashboard.sql,
-- content.sql, post_reviews.sql, post_analytics.sql, post_watch_points.sql,
-- iptv_lists.sql, market.sql, prize_center.sql, prize_modes.sql, prize_admin.sql,
-- prize_secure.sql and point_levels.sql (safe to run again).
--
-- search.html has seven tabs. Each tab shows several result types and every
-- result may be narrowed by "added" (today, yesterday, this week, this month,
-- this year, all time) and ordered by the ranking points below.
--
--   Videos     videos, playlists, recommendations, reviews
--   Movies     movies (TMDB), recommendations, reviews, playlists
--   Series     series (TMDB), recommendations, reviews, playlists
--   Channels   free channels, the site's own lists (published by the staff),
--              member channels and lists (public and exclusive — the exclusive
--              ones only when every criterion the publisher set is met: country,
--              language, followers, account level, membership level, and one of
--              the publisher's passwords; private lists only appear when the
--              publisher allows it in search, and then only with a "request to
--              join" button the publisher must approve)
--   Profiles   profiles, posts, recommendations
--   Market     products, categories, purchase recommendations, reviews,
--              shopping lists
--   Prizes     prizes, challenges, lottery, prize groups
--
-- Ranking points (search_rank) decide the top places of the channels, videos
-- and playlists results:
--
--   +60  every watched minute
--   +30  every recommendation or re-recommendation
--   -30  every "don't recommend" or its re-share
--   + 1  every comment
--   + 1  every link share outside the site
--   -60  every valid report
--
-- Movies and series are ranked by their TMDB rating and trending (the browser
-- reads TMDB directly; search_titles covers their local playlists, recs and
-- reviews).
--
-- Every table is closed to the public API; the page calls the functions below.
-- Like the rest of the site (no Supabase Auth), the functions trust the member
-- id the browser sends.
-- ============================================================

-- ------------------------------------------------------------------ 1. helpers

-- The ranking points of one result. Used by every search below and by anything
-- that wants to order channels, videos or playlists by their standing.
create or replace function public._search_rank(
  p_minutes bigint default 0, p_recs int default 0, p_non int default 0,
  p_comments int default 0, p_shares int default 0, p_reports int default 0)
returns bigint language sql immutable as $$
  select coalesce(60 * p_minutes, 0) + coalesce(30 * p_recs, 0) - coalesce(30 * p_non, 0)
       + coalesce(p_comments, 0) + coalesce(p_shares, 0) - coalesce(60 * p_reports, 0)
$$;

-- The "added" window of a result: '' (all time) | today | yesterday | week | month | year
create or replace function public._search_when(p_ts timestamptz, p_when text)
returns boolean language sql stable as $$
  select case lower(coalesce(p_when, ''))
    when 'today'     then p_ts >= date_trunc('day', now())
    when 'yesterday' then p_ts >= date_trunc('day', now()) - interval '1 day' and p_ts < date_trunc('day', now())
    when 'week'      then p_ts >= date_trunc('week', now())
    when 'month'     then p_ts >= date_trunc('month', now())
    when 'year'      then p_ts >= date_trunc('year', now())
    else true end
$$;

-- The account level of a member (LV0 … LV10), the same thresholds as
-- js/common.js POINT_LEVELS: 0, 10, 100, 1K … 10B earned points.
create or replace function public._search_level(p_member text)
returns int language plpgsql stable security definer set search_path = public as $$
declare pts numeric; lvl int := 0; i int;
begin
  select coalesce((public._points(coalesce(p_member, ''))->>'earned')::numeric, 0) into pts;
  for i in 1..10 loop
    exit when pts < (10::numeric ^ i);
    lvl := i;
  end loop;
  return lvl;
end $$;

-- Words of a query, lower-cased and escaped for like; at most 8.
create or replace function public._search_words(p_q text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(x), '{}') from (
    select replace(replace(replace(lower(x), '\', '\\'), '%', '\%'), '_', '\_') as x
    from regexp_split_to_table(btrim(coalesce(p_q, '')), '\s+') as x where x <> '' limit 8
  ) s
$$;

-- TRUE when every word is inside the haystack.
create or replace function public._search_has(p_words text[], p_hay text)
returns boolean language sql immutable as $$
  select not exists (
    select 1 from unnest(coalesce(p_words, '{}')) as ww(x)
    where lower(coalesce(p_hay, '')) not like '%' || ww.x || '%')
$$;

-- ------------------------------------------------------------------ 2. channels: conditions, passwords, join requests

-- Exclusive lists can also demand a membership level (premium), a minimum
-- account level and one of the publisher's passwords.
alter table public.iptv_lists add column if not exists excl_premium boolean not null default false;
alter table public.iptv_lists add column if not exists excl_level integer not null default 0;
-- Private lists: show the list itself in the search results (only with a
-- "request to join" button). Default: do not appear.
alter table public.iptv_lists add column if not exists in_search boolean not null default false;
-- Lists the site publishes through its staff (admins and moderators).
alter table public.iptv_lists add column if not exists official boolean not null default false;

comment on column public.iptv_lists.excl_premium is 'exclusive: Silver / Gold / Diamond members only';
comment on column public.iptv_lists.excl_level is 'exclusive: minimum account level (LV0..LV10)';
comment on column public.iptv_lists.in_search is 'private: the list may appear in search results behind a join request';
comment on column public.iptv_lists.official is 'published by the site (staff list)';

-- The passwords a publisher sets: meeting every criterion is not enough, the
-- viewer enters one of these. One row per password.
create table if not exists public.iptv_list_passwords (
  id bigint generated always as identity primary key,
  list_id text not null references public.iptv_lists (list_id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  constraint iptv_list_passwords_code check (char_length(btrim(code)) between 1 and 64)
);
create index if not exists iptv_list_passwords_list_idx on public.iptv_list_passwords (list_id);

-- A viewer who entered a valid password keeps the list open (like a seat).
create table if not exists public.iptv_list_unlocks (
  list_id text not null references public.iptv_lists (list_id) on delete cascade,
  member_id text not null,
  created_at timestamptz not null default now(),
  primary key (list_id, member_id)
);

-- Join requests for the private lists that appear in search. The publisher must
-- approve one before the member may watch.
create table if not exists public.iptv_list_requests (
  id bigint generated always as identity primary key,
  list_id text not null references public.iptv_lists (list_id) on delete cascade,
  member_id text not null,
  username text not null default '',
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text not null default '',
  constraint iptv_list_requests_status check (status in ('pending', 'approved', 'rejected'))
);
create index if not exists iptv_list_requests_list_idx on public.iptv_list_requests (list_id, status);
create index if not exists iptv_list_requests_member_idx on public.iptv_list_requests (member_id, status);

-- Valid reports against a video (the ranking points subtract 60 per one).
-- The team (Panel) settles them: status valid -> ended.
create table if not exists public.content_reports (
  id bigint generated always as identity primary key,
  content_id text not null references public.content (content_id) on delete cascade,
  reporter_id text not null default '',
  subject text not null default 'other',
  note text not null default '',
  status text not null default 'valid',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint content_reports_status check (status in ('valid', 'ended'))
);
create index if not exists content_reports_content_idx on public.content_reports (content_id, status);

-- Nothing of this is open to the public API.
do $$
declare t text; pol record;
begin
  foreach t in array array['iptv_list_passwords', 'iptv_list_unlocks', 'iptv_list_requests', 'content_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 3. who may see a list (upgraded)

-- 'ok', or why the member may not open the list:
--   gone | private | signin | followers | country | language | level | premium | password
-- The publisher always sees their own lists. A member who entered one of the
-- passwords (iptv_list_unlocks) passes the password step.
create or replace function public._iptvl_access(l public.iptv_lists, p_member text) returns text
language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  p_member := btrim(coalesce(p_member, ''));
  if p_member <> '' and l.owner_id = p_member then return 'ok'; end if;
  if l.suspended_at is not null then return 'gone'; end if;
  if public._iptvl_banned(l.owner_id) then return 'gone'; end if;
  if l.visibility = 'public' then
    -- even a public list can carry passwords its publisher set
    if exists (select 1 from public.iptv_list_passwords w where w.list_id = l.list_id)
       and (p_member = '' or not exists (
         select 1 from public.iptv_list_unlocks u where u.list_id = l.list_id and u.member_id = p_member)) then
      return 'password';
    end if;
    return 'ok';
  end if;
  m := public._iptvl_viewer(p_member);
  if l.visibility = 'private' then
    if m.member_id is null or not exists (
      select 1 from public.iptv_list_access a where a.list_id = l.list_id and a.member_id = m.member_id
    ) then
      return 'private';
    end if;
  else
    -- exclusive: signed-in members who meet every criterion
    if m.member_id is null then return 'signin'; end if;
    if l.excl_followers and not exists (
      select 1 from public.follows f
      where f.follower_id = m.member_id and f.following_id = l.owner_id and f.status = 'accepted'
    ) then
      return 'followers';
    end if;
    if btrim(l.excl_countries) <> ''
       and not (upper(btrim(coalesce(m.country, ''))) = any (string_to_array(l.excl_countries, ','))) then
      return 'country';
    end if;
    if btrim(l.excl_languages) <> ''
       and not (public._iptvl_lang(m.member_id, m.country) = any (string_to_array(l.excl_languages, ','))) then
      return 'language';
    end if;
    if coalesce(l.excl_level, 0) > 0 and public._search_level(m.member_id) < l.excl_level then
      return 'level';
    end if;
    if coalesce(l.excl_premium, false) and not (
      coalesce(m.membership_type, 'Free') in ('Silver', 'Gold', 'Diamond')
      and (m.membership_expires_at is null or m.membership_expires_at > now())) then
      return 'premium';
    end if;
  end if;
  if exists (select 1 from public.iptv_list_passwords w where w.list_id = l.list_id)
     and not exists (
       select 1 from public.iptv_list_unlocks u where u.list_id = l.list_id and u.member_id = m.member_id) then
    return 'password';
  end if;
  return 'ok';
end $$;

-- A list as a card (search results, iptv.html, the dashboard), with the new
-- criteria and the viewer's join request, if any.
create or replace function public._iptvl_card(l public.iptv_lists, p_member text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.list_id, 'name', l.name, 'description', left(l.description, 300),
    'visibility', l.visibility, 'followers', l.excl_followers,
    'countries', l.excl_countries, 'languages', l.excl_languages,
    'premium', l.excl_premium, 'level', l.excl_level,
    'password', exists (select 1 from public.iptv_list_passwords w where w.list_id = l.list_id),
    'in_search', l.in_search, 'official', l.official,
    'channels', l.channel_count, 'groups', l.group_count,
    'live', l.live_count, 'movies', l.movie_count, 'series', l.series_count,
    'views', l.views, 'source', l.source, 'epg', l.epg_url <> '',
    'created_at', l.created_at, 'updated_at', l.updated_at, 'ready', l.indexed_at is not null,
    'owner_id', l.owner_id,
    'owner', coalesce((select m.username from public.members m where m.member_id = l.owner_id), l.owner_username),
    'owner_avatar', coalesce((select p.avatar_url from public.profiles p where p.member_id = l.owner_id), ''),
    'staff', coalesce(l.official, false) or exists (
      select 1 from public.staff s where s.member_id = l.owner_id and s.role in ('super', 'admin', 'moderator')),
    'mine', l.owner_id = btrim(coalesce(p_member, '')),
    'request', case
      when btrim(coalesce(p_member, '')) = '' then null
      else (select jsonb_build_object('id', r.id, 'status', r.status, 'at', r.created_at)
              from public.iptv_list_requests r
             where r.list_id = l.list_id and r.member_id = btrim(coalesce(p_member, ''))
             order by r.created_at desc limit 1) end,
    -- only the publisher ever gets the card of a suspended list
    'suspended', case when l.suspended_at is not null
                      then jsonb_build_object('reason', l.suspended_reason, 'at', l.suspended_at) end)
$$;

-- ------------------------------------------------------------------ 4. Videos tab

-- search_content — the Videos tab.
--   p_kind  videos | playlists | recs | reviews
--   p_when  '' | today | yesterday | week | month | year  (added)
--   p_sort  rank | relevance | date | views | recs | minutes | shares | az | za
-- videos and recs: the public and exclusive videos of sql/content.sql (an
-- exclusive one the viewer cannot watch carries a lock) and the private ones
-- the member was given; recs narrows to the videos members recommend.
-- playlists: the video playlists of members (content_playlists), each with the
-- ranking points of its videos.
-- reviews: the comments members write under videos.
-- -> { total, items, sort, kind }
create or replace function public.search_content(
  p_member text default '', p_q text default '', p_kind text default '', p_when text default '',
  p_sort text default '', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, ''));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
begin
  if knd not in ('videos', 'playlists', 'recs', 'reviews') then knd := 'videos'; end if;
  if srt not in ('rank', 'relevance', 'date', 'views', 'recs', 'minutes', 'shares', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  if knd in ('videos', 'recs') then
    with base as (
      select c as r, public._content_access(c, me) as why,
             public._search_rank(c.watch_minutes, c.likes, c.dislikes, c.comments, c.shares,
               (select count(*)::int from public.content_reports cr
                 where cr.content_id = c.content_id and cr.status = 'valid')) as score
      from public.content c
      where c.publish_at <= now()
        and (knd <> 'recs' or (c.likes > 0 and c.likes >= c.dislikes))
        and public._search_when(c.publish_at, p_when)
        and public._search_has(words, c.title || ' ' || c.description || ' ' ||
                                   array_to_string(c.tags, ' ') || ' ' || c.owner_username)
    ), seen as (
      select * from base where why not in ('private', 'scheduled', 'gone', 'age')
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(public._content_card(s2.r, s2.why) ||
                     jsonb_build_object('type', 'video', 'score', s2.score, 'recs', (s2.r).likes) order by s2.rn) from (
               select s.r, s.why, s.score, row_number() over (order by
                 case when srt = 'rank' then s.score end desc,
                 case when srt = 'relevance' then (case when lower((s.r).title) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'views' then (s.r).views end desc,
                 case when srt = 'recs' then (s.r).likes end desc,
                 case when srt = 'minutes' then (s.r).watch_minutes end desc,
                 case when srt = 'shares' then (s.r).shares end desc,
                 case when srt = 'az' then lower((s.r).title) end asc,
                 case when srt = 'za' then lower((s.r).title) end desc,
                 case when srt in ('relevance', 'rank') then (s.r).views end desc,
                 (s.r).publish_at desc, (s.r).content_id) as rn
               from seen s order by rn offset off limit lim) s2), '[]'::jsonb)
      into total, items;

  elsif knd = 'playlists' then
    with pl as (
      select p.*,
        (select count(*)::int from public.content_playlist_items i where i.playlist_id = p.playlist_id) as n_items,
        coalesce((select jsonb_agg(z.thumb order by z.added_at) from (
            select c2.thumb_url as thumb, i2.added_at
            from public.content_playlist_items i2 join public.content c2 on c2.content_id = i2.content_id
            where i2.playlist_id = p.playlist_id and c2.publish_at <= now() and c2.visibility = 'public'
            order by i2.added_at limit 4) z), '[]'::jsonb) as thumbs,
        coalesce((select sum(public._search_rank(c3.watch_minutes, c3.likes, c3.dislikes, c3.comments, c3.shares,
               (select count(*)::int from public.content_reports cr
                 where cr.content_id = c3.content_id and cr.status = 'valid')))::bigint
          from public.content_playlist_items i3 join public.content c3 on c3.content_id = i3.content_id
          where i3.playlist_id = p.playlist_id and c3.publish_at <= now()
            and c3.visibility in ('public', 'exclusive')), 0) as score
      from public.content_playlists p
      join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where p.suspended_at is null
        and public._search_has(words, p.name || ' ' || p.owner_username)
        and public._search_when(p.created_at, p_when)
    )
    select (select count(*) from pl),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'playlist', 'source', 'videos', 'id', x.playlist_id, 'title', x.name,
               'owner', x.owner_username, 'owner_id', x.owner_id,
               'owner_avatar', coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = x.owner_id), ''),
               'items', x.n_items, 'thumbs', x.thumbs, 'score', x.score,
               'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(name) end asc,
                 case when srt = 'za' then lower(name) end desc,
                 case when srt in ('relevance', 'rank') then n_items end desc,
                 created_at desc, playlist_id) as rn
               from pl order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;

  else -- reviews: the comments under videos
    with rv as (
      select cm.id, cm.body, cm.created_at, cm.member_id,
             coalesce(nullif(cm.username, ''), m.username) as username,
             c.content_id, c.title, c.thumb_url, c.owner_id, c.owner_username,
             public._content_access(c, me) as why
      from public.content_comments cm
      join public.content c on c.content_id = cm.content_id
      left join public.members m on m.member_id = cm.member_id
      where cm.parent_id is null
        and c.publish_at <= now()
        and public._search_when(cm.created_at, p_when)
        and public._search_has(words, cm.body || ' ' || c.title || ' ' || cm.username)
    ), seen as (
      select * from rv where why not in ('private', 'scheduled', 'gone', 'age')
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'review', 'source', 'video', 'id', s.id, 'body', left(s.body, 600),
               'author', s.username, 'author_id', s.member_id,
               'content_id', s.content_id, 'title', s.title, 'thumb', s.thumb_url,
               'owner_id', s.owner_id, 'owner', s.owner_username,
               'created_at', s.created_at, 'score', 0) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(body) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(body) end asc,
                 case when srt = 'za' then lower(body) end desc,
                 created_at desc, id) as rn
               from seen order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;
  end if;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 5. Movies & Series tabs (local results)

-- Who may see a TMDB playlist of dashboard.sql.
create or replace function public._search_playlist_ok(pl public.playlists, p_member text)
returns text language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  p_member := btrim(coalesce(p_member, ''));
  if p_member <> '' and pl.owner_id = p_member then return 'ok'; end if;
  if coalesce(pl.visibility, 'private') = 'private' then
    if p_member = '' or not exists (
      select 1 from public.playlist_access a where a.playlist_id = pl.playlist_id and lower(a.username) in (
        lower(p_member), lower(coalesce((select mm.username from public.members mm where mm.member_id = p_member), '')))
    ) then return 'private'; end if;
    return 'ok';
  end if;
  m := public._iptvl_viewer(p_member);
  if coalesce(pl.visibility, '') = 'exclusive' and m.member_id is null then return 'signin'; end if;
  if coalesce(pl.require_member, false) and m.member_id is null then return 'signin'; end if;
  if coalesce(pl.require_followers, false) and (m.member_id is null or not exists (
    select 1 from public.follows f where f.follower_id = m.member_id and f.following_id = pl.owner_id and f.status = 'accepted'
  )) then return 'followers'; end if;
  return 'ok';
end $$;

-- Who may see a post of sql/profile.sql.
create or replace function public._search_post_ok(p public.posts, p_member text)
returns text language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  p_member := btrim(coalesce(p_member, ''));
  if p_member <> '' and p.owner_id = p_member then return 'ok'; end if;
  if public._iptvl_banned(p.owner_id) then return 'gone'; end if;
  if coalesce(p.visibility, 'public') = 'public' then return 'ok'; end if;
  m := public._iptvl_viewer(p_member);
  if p.visibility = 'private' then
    if m.member_id is null or not exists (
      select 1 from public.post_access a where a.post_id = p.post_id
        and lower(a.username) in (lower(m.member_id), lower(m.username))
    ) then return 'private'; end if;
    return 'ok';
  end if;
  if m.member_id is null then return 'signin'; end if;
  if coalesce(p.require_followers, false) and not exists (
    select 1 from public.follows f where f.follower_id = m.member_id and f.following_id = p.owner_id and f.status = 'accepted'
  ) then return 'followers'; end if;
  return 'ok';
end $$;

-- search_titles — the local results of the Movies and Series tabs (their TMDB
-- items come straight from TMDB in the browser).
--   p_kind   playlists | recs | reviews
--   p_media  '' | movie | tv
--   p_when   '' | today | yesterday | week | month | year  (added)
--   p_sort   rank | relevance | date | views | az | za
-- playlists: the TMDB playlists of members (dashboard.sql playlists) and their
-- playlist posts.
-- recs: the recommendation posts (and recommendation lists) of members.
-- reviews: the review posts and the title comments (sql/comments).
-- -> { total, items, sort, kind }
create or replace function public.search_titles(
  p_member text default '', p_q text default '', p_kind text default '', p_media text default '',
  p_when text default '', p_sort text default '', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, 'playlists'));
  med text := lower(coalesce(p_media, ''));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
begin
  if knd not in ('playlists', 'recs', 'reviews') then knd := 'playlists'; end if;
  if med not in ('movie', 'tv') then med := ''; end if;
  if srt not in ('rank', 'relevance', 'date', 'views', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  if knd = 'playlists' then
    with src as (
      select 'list' as source, pl.playlist_id as id, pl.name as title, left(pl.description, 300) as body,
             pl.owner_id, pl.owner_username as owner,
             coalesce((select p.avatar_url from public.profiles p where p.member_id = pl.owner_id), '') as avatar,
             pl.media_type, pl.created_at, pl.viewers, pl.watch_minutes,
             (select count(*)::int from public.playlist_items pi where pi.playlist_id = pl.playlist_id) as n_items,
             public._search_rank(coalesce(pl.watch_minutes, 0), 0, 0, 0, 0, 0)
               + coalesce(pl.viewers, 0) as score,
             public._search_playlist_ok(pl, me) as why
      from public.playlists pl
      join public.members m on m.member_id = pl.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where (med = '' or pl.media_type = med)
        and public._search_has(words, pl.name || ' ' || coalesce(pl.description, '') || ' ' || pl.owner_username)
        and public._search_when(pl.created_at, p_when)
      union all
      select 'post', p.post_id, p.title, left(p.body, 300), p.owner_id, p.owner_username,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = p.owner_id), ''),
             med, p.created_at, 0, 0,
             (select count(*)::int from public.post_items pi where pi.post_id = p.post_id
                and (med = '' or pi.media_type = med)),
             public._search_rank(0,
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'up'),
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'down'),
               (select count(*)::int from public.post_comments c where c.post_id = p.post_id),
               (select count(*)::int from public.post_events e where e.post_id = p.post_id and e.kind = 'share'),
               0),
             public._search_post_ok(p, me)
      from public.posts p
      join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where p.kind in ('playlist', 'reclist')
        and (med = '' or exists (select 1 from public.post_items pi
                                 where pi.post_id = p.post_id and pi.media_type = med))
        and public._search_has(words, p.title || ' ' || coalesce(p.body, '') || ' ' || p.owner_username)
        and public._search_when(p.created_at, p_when)
        -- Silenced posts (net-negative day, sql/post_reach.sql) leave search too,
        -- but their owner and the owner's followers keep finding them.
        and (me = p.owner_id
             or exists (select 1 from public.follows fo
                        where fo.follower_id = me and fo.following_id = p.owner_id and fo.status = 'accepted')
             or not public.post_silenced(p.post_id))
    ), seen as (
      select * from src where why = 'ok'
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'playlist', 'source', s.source, 'id', s.id, 'title', s.title, 'body', s.body,
               'owner', s.owner, 'owner_id', s.owner_id, 'avatar', s.avatar, 'media', s.media_type,
               'items', s.n_items, 'views', coalesce(s.viewers, 0), 'score', s.score,
               'created_at', s.created_at) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(title) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'views' then viewers end desc,
                 case when srt = 'az' then lower(title) end asc,
                 case when srt = 'za' then lower(title) end desc,
                 case when srt in ('relevance', 'rank') then n_items end desc,
                 created_at desc, id) as rn
               from seen order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;

  elsif knd = 'recs' then
    with src as (
      select p.post_id as id, p.kind, p.title, left(p.body, 400) as body, p.owner_id, p.owner_username as owner,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = p.owner_id), '') as avatar,
             p.created_at,
             coalesce((select jsonb_agg(jsonb_build_object('tmdb', pi.tmdb_id, 'media', pi.media_type,
                        'title', coalesce(pi.title, ''), 'poster', coalesce(pi.poster_path, '')) order by pi.id)
               from (select * from public.post_items pi2 where pi2.post_id = p.post_id
                      and (med = '' or pi2.media_type = med) order by pi2.id limit 4) pi), '[]'::jsonb) as items,
             (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'up') as ups,
             (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'down') as downs,
             (select count(*)::int from public.post_comments c where c.post_id = p.post_id) as n_comments,
             public._search_rank(0,
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'up'),
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'down'),
               (select count(*)::int from public.post_comments c where c.post_id = p.post_id),
               (select count(*)::int from public.post_events e where e.post_id = p.post_id and e.kind = 'share'),
               0) as score,
             public._search_post_ok(p, me) as why
      from public.posts p
      join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where p.kind in ('recommendation', 'reclist')
        and (med = '' or exists (select 1 from public.post_items pi
                                 where pi.post_id = p.post_id and pi.media_type = med))
        and public._search_has(words, p.title || ' ' || coalesce(p.body, '') || ' ' || p.owner_username)
        and public._search_when(p.created_at, p_when)
        -- Silenced posts (net-negative day, sql/post_reach.sql) leave search too,
        -- but their owner and the owner's followers keep finding them.
        and (me = p.owner_id
             or exists (select 1 from public.follows fo
                        where fo.follower_id = me and fo.following_id = p.owner_id and fo.status = 'accepted')
             or not public.post_silenced(p.post_id))
    ), seen as (
      select * from src where why = 'ok'
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'rec', 'source', 'post', 'id', s.id, 'kind', s.kind, 'title', s.title, 'body', s.body,
               'owner', s.owner, 'owner_id', s.owner_id, 'avatar', s.avatar, 'items', s.items,
               'ups', s.ups, 'downs', s.downs, 'comments', s.n_comments, 'score', s.score,
               'created_at', s.created_at) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(title) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(title) end asc,
                 case when srt = 'za' then lower(title) end desc,
                 case when srt in ('relevance', 'rank') then ups end desc,
                 created_at desc, id) as rn
               from seen order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;

  else -- reviews: review posts and the title comments
    with src as (
      select 'post' as source, p.post_id as id, p.title, left(p.body, 600) as body,
             left(coalesce(p.pros, ''), 300) as pros, left(coalesce(p.cons, ''), 300) as cons,
             p.owner_id, p.owner_username as owner, p.created_at,
             coalesce((select pi.tmdb_id from public.post_items pi where pi.post_id = p.post_id
                        and (med = '' or pi.media_type = med) order by pi.id limit 1), 0) as tmdb_id,
             coalesce((select pi.media_type from public.post_items pi where pi.post_id = p.post_id
                        and (med = '' or pi.media_type = med) order by pi.id limit 1), med) as media,
             public._search_post_ok(p, me) as why
      from public.posts p
      join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where p.kind = 'review'
        and (med = '' or exists (select 1 from public.post_items pi
                                 where pi.post_id = p.post_id and pi.media_type = med))
        and public._search_has(words, p.title || ' ' || coalesce(p.body, '') || ' ' ||
                                     coalesce(p.pros, '') || ' ' || coalesce(p.cons, '') || ' ' || p.owner_username)
        and public._search_when(p.created_at, p_when)
      union all
      select 'comment', 'c' || cm.id::text, '', left(cm."comment", 600), '', '',
             coalesce(cm.member_id, ''), cm.username, cm.created_at,
             cm.idtmdb, cm."type", 'ok'
      from public.comments cm
      where cm.comment_type = 'comment'
        and (med = '' or cm."type" = med)
        and public._search_has(words, cm."comment" || ' ' || cm.username)
        and public._search_when(cm.created_at, p_when)
    ), seen as (
      select * from src where why = 'ok'
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'review', 'source', s.source, 'id', s.id, 'title', s.title, 'body', s.body,
               'pros', s.pros, 'cons', s.cons, 'owner', s.owner, 'owner_id', s.owner_id,
               'tmdb', s.tmdb_id, 'media', s.media, 'created_at', s.created_at, 'score', 0) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(body) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(body) end asc,
                 case when srt = 'za' then lower(body) end desc,
                 created_at desc, id) as rn
               from seen order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;
  end if;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 6. Channels tab

-- search_channels — the Channels tab.
--   p_kind  '' (all) | free | staff | member
--   p_when  '' | today | yesterday | week | month | year  (added)
--   p_sort  rank | relevance | date | views | channels | az | za
-- free: the free channels of the site (dashboard.sql iptv, type = free).
-- staff: the lists the site publishes through admins and moderators (official
--        or owned by a staff member), with their channels.
-- member: the channels of the lists members published — the public lists and
--         the exclusive ones whose criteria the viewer meets (country,
--         language, followers, account level, membership level, and one of the
--         publisher's passwords). A password list shows as a locked card. A
--         private list never shows its channels; when its publisher allows it
--         in search, it appears with a "request to join" button only.
-- -> { total, items, sort, kind } — items are { type: channel | list | free, … }
create or replace function public.search_channels(
  p_member text default '', p_q text default '', p_kind text default '', p_when text default '',
  p_sort text default '', p_limit int default 30, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, ''));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 30), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
begin
  if knd not in ('', 'free', 'staff', 'member') then knd := ''; end if;
  if srt not in ('rank', 'relevance', 'date', 'views', 'channels', 'lists', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  with lists as (
    select l.*,
      (coalesce(l.official, false) or exists (
        select 1 from public.staff s where s.member_id = l.owner_id and s.role in ('super', 'admin', 'moderator'))) as is_staff,
      public._iptvl_access(l, me) as why
    from public.iptv_lists l
    join public.members m on m.member_id = l.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
    where l.suspended_at is null
      and public._search_when(l.created_at, p_when)
      and (knd <> 'staff' or (coalesce(l.official, false) or exists (
             select 1 from public.staff s where s.member_id = l.owner_id and s.role in ('super', 'admin', 'moderator'))))
      and (knd <> 'member' or not (coalesce(l.official, false) or exists (
             select 1 from public.staff s where s.member_id = l.owner_id and s.role in ('super', 'admin', 'moderator'))))
  ), chs as (
    -- the channels of the lists the viewer may open
    select 'channel' as type, c.ckey as key, c.name, c.group_name as grp, c.logo, c.kind as media,
           l.list_id, l.name as list_name, l.owner_id, l.owner_username as owner,
           l.visibility, l.views as list_views, l.created_at,
           (coalesce(l.official, false) or exists (
             select 1 from public.staff s where s.member_id = l.owner_id and s.role in ('super', 'admin', 'moderator'))) as is_staff,
           l.views as score
    from lists l
    join public.iptv_list_channels c on c.list_id = l.list_id
    where l.why = 'ok'
      and (knd = '' or knd in ('staff', 'member'))
      and public._search_has(words, c.name || ' ' || c.group_name || ' ' || l.name)
  ), freech as (
    select 'free' as type, 'F' || f.id::text as key, f.name, '' as grp, '' as logo, 'live' as media,
           '' as list_id, '' as list_name, coalesce(f.owner_id, '') as owner_id, '' as owner,
           'public' as visibility, 0 as list_views, now() as created_at, false as is_staff,
           0 as score
    from public.iptv f
    where lower(coalesce(f.type, 'free')) = 'free'
      and (knd = '' or knd = 'free')
      and public._search_has(words, f.name)
  ), listcards as (
    -- the lists themselves: open ones whose name matches, and the private ones
    -- behind a join request (never their channels)
    select case when l.why = 'ok' then 'list' else 'joinlist' end as type,
           l.list_id as key, l.name, '' as grp, '' as logo, 'list' as media,
           l.list_id, l.name as list_name, l.owner_id, l.owner_username as owner,
           l.visibility, l.views as list_views, l.created_at, l.is_staff,
           l.views as score
    from lists l
    where public._search_has(words, l.name || ' ' || l.owner_username)
      and (knd = '' or (knd = 'staff' and l.is_staff) or (knd = 'member' and not l.is_staff))
      and (
        -- a matching open list (or a password one: shown locked)
        (l.why in ('ok', 'password') and l.indexed_at is not null)
        -- a private list its publisher lets appear in search
        or (l.why = 'private' and l.visibility = 'private' and l.in_search)
      )
  ), src as (
    select * from chs
    union all select * from freech
    union all select * from listcards
  )
  select (select count(*) from src),
         coalesce((select jsonb_agg(x.item order by x.rn) from (
             select jsonb_build_object(
                      'type', s.type, 'key', s.key, 'name', s.name, 'group', s.grp, 'logo', s.logo,
                      'media', s.media, 'list_id', s.list_id, 'list', s.list_name,
                      'owner', s.owner, 'owner_id', s.owner_id, 'visibility', s.visibility,
                      'staff', s.is_staff, 'score', s.score, 'created_at', s.created_at) ||
                    case when s.type = 'list' or s.type = 'joinlist' then
                      (select public._iptvl_card(l2, me) ||
                              jsonb_build_object('locked', public._iptvl_access(l2, me) = 'password')
                         from public.iptv_lists l2 where l2.list_id = s.list_id)
                    else '{}'::jsonb end as item,
                    row_number() over (order by
                      case when srt = 'rank' then s.score end desc,
                      case when srt = 'relevance' then (case when lower(s.name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                      case when srt = 'views' then s.list_views end desc,
                      case when srt in ('views', 'channels', 'lists') then s.list_views end desc,
                      case when srt = 'az' then lower(s.name) end asc,
                      case when srt = 'za' then lower(s.name) end desc,
                      case when srt in ('relevance', 'rank') then s.list_views end desc,
                      s.created_at desc, s.key) as rn
             from src s order by rn offset off limit lim) x), '[]'::jsonb)
    into total, items;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 7. Profiles tab

-- search_profiles — the Profiles tab.
--   p_kind  profiles | posts | recs
--   p_when  '' | today | yesterday | week | month | year  (added)
--   p_sort  rank | relevance | date | followers | az | za
-- profiles: the members themselves. posts: every post of sql/profile.sql the
-- viewer may read. recs: the recommendation posts only.
-- -> { total, items, sort, kind }
create or replace function public.search_profiles(
  p_member text default '', p_q text default '', p_kind text default '', p_when text default '',
  p_sort text default '', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, 'profiles'));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
begin
  if knd not in ('profiles', 'posts', 'recs') then knd := 'profiles'; end if;
  if srt not in ('rank', 'relevance', 'date', 'followers', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  if knd = 'profiles' then
    with src as (
      select m.member_id, m.username,
             coalesce(nullif(pr.display_name, ''), m.full_name) as name,
             coalesce(pr.avatar_url, '') as avatar, left(coalesce(pr.bio, ''), 300) as bio,
             coalesce(pr.followers, 0) as followers, coalesce(pr.following, 0) as following,
             coalesce(m.membership_type, 'Free') as membership,
             coalesce(m.country, '') as country,
             case when coalesce(pr.show_country, true) then coalesce(m.country, '') else '' end as country_out,
             m.created_at,
             public._search_level(m.member_id) as level
      from public.members m
      left join public.profiles pr on pr.member_id = m.member_id
      where lower(btrim(coalesce(m.status, ''))) = 'active'
        and (me = '' or m.member_id <> me)
        and (me = '' or not exists (
          select 1 from public.blocks b where (b.blocker_id = me and b.blocked_id = m.member_id)
                                          or (b.blocker_id = m.member_id and b.blocked_id = me)))
        and public._search_when(m.created_at, p_when)
        and public._search_has(words, m.username || ' ' || m.full_name || ' ' ||
                                     coalesce(pr.display_name, '') || ' ' || coalesce(pr.bio, ''))
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'profile', 'id', s.member_id, 'username', s.username, 'name', s.name,
               'avatar', s.avatar, 'bio', s.bio, 'followers', s.followers, 'following', s.following,
               'membership', s.membership, 'country', s.country_out, 'level', s.level,
               'created_at', s.created_at, 'score', 0) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then followers end desc,
                 case when srt = 'relevance' then (case when lower(username) like '%' || lower(q) || '%'
                                                        or lower(name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'followers' then followers end desc,
                 case when srt = 'az' then lower(username) end asc,
                 case when srt = 'za' then lower(username) end desc,
                 case when srt in ('relevance', 'rank') then level end desc,
                 created_at desc, member_id) as rn
               from src order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;

  else
    with src as (
      select p.post_id as id, p.kind, p.title, left(coalesce(p.body, ''), 400) as body,
             p.owner_id, p.owner_username as owner,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = p.owner_id), '') as avatar,
             p.visibility, p.created_at,
             coalesce((select jsonb_agg(jsonb_build_object('tmdb', pi.tmdb_id, 'media', pi.media_type,
                        'title', coalesce(pi.title, ''), 'poster', coalesce(pi.poster_path, '')) order by pi.id)
               from (select * from public.post_items pi2 where pi2.post_id = p.post_id order by pi2.id limit 4) pi), '[]'::jsonb) as items,
             (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'up') as ups,
             (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'down') as downs,
             (select count(*)::int from public.post_comments c where c.post_id = p.post_id) as n_comments,
             public._search_rank(0,
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'up'),
               (select count(*)::int from public.post_votes v where v.post_id = p.post_id and v.vote = 'down'),
               (select count(*)::int from public.post_comments c where c.post_id = p.post_id),
               (select count(*)::int from public.post_events e where e.post_id = p.post_id and e.kind = 'share'),
               0) as score,
             public._search_post_ok(p, me) as why
      from public.posts p
      join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where (knd <> 'recs' or p.kind in ('recommendation', 'reclist'))
        and (me = '' or not exists (
          select 1 from public.blocks b where (b.blocker_id = me and b.blocked_id = p.owner_id)
                                          or (b.blocker_id = p.owner_id and b.blocked_id = me)))
        and public._search_has(words, p.title || ' ' || coalesce(p.body, '') || ' ' || p.owner_username)
        and public._search_when(p.created_at, p_when)
        -- Silenced posts (net-negative day, sql/post_reach.sql) leave search too,
        -- but their owner and the owner's followers keep finding them.
        and (me = p.owner_id
             or exists (select 1 from public.follows fo
                        where fo.follower_id = me and fo.following_id = p.owner_id and fo.status = 'accepted')
             or not public.post_silenced(p.post_id))
    ), seen as (
      select * from src where why = 'ok'
    )
    select (select count(*) from seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'post', 'id', s.id, 'kind', s.kind, 'title', s.title, 'body', s.body,
               'owner', s.owner, 'owner_id', s.owner_id, 'avatar', s.avatar, 'items', s.items,
               'ups', s.ups, 'downs', s.downs, 'comments', s.n_comments, 'score', s.score,
               'created_at', s.created_at) order by s.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(title) like '%' || lower(q) || '%'
                                                        or lower(body) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(title) end asc,
                 case when srt = 'za' then lower(title) end desc,
                 case when srt in ('relevance', 'rank') then ups end desc,
                 created_at desc, id) as rn
               from seen order by rn offset off limit lim) s), '[]'::jsonb)
      into total, items;
  end if;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 8. Market tab

-- search_market — the Market tab.
--   p_kind  products | categories | recs | reviews | lists
--   p_when  '' | today | yesterday | week | month | year  (added)
--   p_sort  rank | relevance | date | price | az | za
-- products and categories: sql/market_search. recs: the purchase
-- recommendations (and their re-recommendations) of members. reviews: the
-- product reviews. lists: the shopping lists. The exclusive and private ones
-- follow the audience their author set (sql/market.sql _mkt_sees).
-- -> { total, items, sort, kind }
create or replace function public.search_market(
  p_member text default '', p_q text default '', p_kind text default '', p_when text default '',
  p_sort text default '', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, 'products'));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
begin
  if knd not in ('products', 'categories', 'recs', 'reviews', 'lists') then knd := 'products'; end if;
  if srt not in ('rank', 'relevance', 'date', 'price', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  if knd = 'products' then
    with src as (
      select p.*,
        (select count(*)::int from public.market_recs r where r.product_id = p.id) as n_recs,
        (select count(*)::int from public.market_reviews r where r.product_id = p.id and r.visibility = 'public') as n_reviews,
        (select count(*)::int from public.market_reports r where r.kind = 'product' and r.target_id = p.id and r.status = 'resolved') as n_reports,
        public._search_rank(0,
          (select count(*)::int from public.market_recs r where r.product_id = p.id), 0,
          (select count(*)::int from public.market_reviews r where r.product_id = p.id and r.visibility = 'public'), 0,
          (select count(*)::int from public.market_reports r where r.kind = 'product' and r.target_id = p.id and r.status = 'resolved')) as score
      from public.market_products p
      join public.market_stores s on s.id = p.store_id
      join public.members m on m.member_id = s.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where p.status = 'active' and not s.suspended
        and (p.stock > 0 or s.is_open)
        and public._search_when(p.created_at, p_when)
        and public._search_has(words, p.title || ' ' || coalesce(p.description, '') || ' ' || s.name)
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(public._mkt_card(x) ||
                     jsonb_build_object('type', 'product', 'score', x.score,
                                        'recs', x.n_recs, 'reviewed', x.n_reviews) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(title) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'price' then 0 end,
                 case when srt = 'price' then price end asc,
                 case when srt = 'az' then lower(title) end asc,
                 case when srt = 'za' then lower(title) end desc,
                 case when srt in ('relevance', 'rank') then sales end desc,
                 created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;

  elsif knd = 'categories' then
    with src as (
      select c.id, c.name, c.created_at,
        (select count(*)::int from public.market_product_categories pc
           join public.market_products p2 on p2.id = pc.product_id and p2.status = 'active'
          where pc.category_id = c.id) as n_products,
        coalesce((select jsonb_agg(z.img) from (
            select p3.images->>0 as img from public.market_product_categories pc3
              join public.market_products p3 on p3.id = pc3.product_id and p3.status = 'active'
             where pc3.category_id = c.id and jsonb_array_length(p3.images) > 0
             order by p3.sales desc, p3.created_at desc limit 4) z), '[]'::jsonb) as images
      from public.market_categories c
      where public._search_has(words, c.name)
        and public._search_when(c.created_at, p_when)
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'category', 'id', x.id, 'title', x.name, 'products', x.n_products,
               'images', x.images, 'created_at', x.created_at, 'score', 0) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(name) end asc,
                 case when srt = 'za' then lower(name) end desc,
                 n_products desc, created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;

  elsif knd = 'recs' then
    with src as (
      select r.id, r.kind, r.note, r.product_id, r.list_id, r.member_id, r.created_at,
             coalesce(m.username, '') as username,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = r.member_id), '') as avatar,
             coalesce((select p2.title from public.market_products p2 where p2.id = r.product_id), '') as product_title,
             coalesce((select p2.images->>0 from public.market_products p2 where p2.id = r.product_id), '') as thumb,
             coalesce((select l2.name from public.market_lists l2 where l2.id = r.list_id), '') as list_name,
             coalesce((select count(*)::int from public.market_recs r2 where r2.root_id = r.id
                        or (r2.parent_id = r.id and r2.id <> r.id)), 0) as again,
             public._search_rank(0, 1, 0, 0,
               (select count(*)::int from public.market_recs r2 where r2.root_id = r.id
                  or (r2.parent_id = r.id and r2.id <> r.id)), 0) as score
      from public.market_recs r
      join public.members m on m.member_id = r.member_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where public._mkt_sees(r.member_id, r.visibility, r.excl_followers, r.excl_premium,
                             r.excl_countries, r.allowed, me)
        and public._search_when(r.created_at, p_when)
        and public._search_has(words, r.note || ' ' ||
              coalesce((select p2.title from public.market_products p2 where p2.id = r.product_id), '') || ' ' ||
              coalesce((select l2.name from public.market_lists l2 where l2.id = r.list_id), '') || ' ' ||
              coalesce(m.username, ''))
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'mrec', 'id', x.id, 'kind', x.kind, 'note', x.note,
               'product_id', x.product_id, 'product', x.product_title, 'thumb', x.thumb,
               'list_id', x.list_id, 'list', x.list_name, 'author', x.username,
               'author_id', x.member_id, 'avatar', x.avatar, 'again', x.again,
               'score', x.score, 'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'rank' then score end desc,
                 case when srt = 'relevance' then (case when lower(note) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(note) end asc,
                 case when srt = 'za' then lower(note) end desc,
                 case when srt in ('relevance', 'rank') then again end desc,
                 created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;

  elsif knd = 'reviews' then
    with src as (
      select r.id, r.product_id, r.store_id, r.member_id, r.pros, r.cons, r.created_at,
             coalesce(m.username, '') as username,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = r.member_id), '') as avatar,
             coalesce((select p2.title from public.market_products p2 where p2.id = r.product_id), '') as product_title,
             coalesce((select p2.images->>0 from public.market_products p2 where p2.id = r.product_id), '') as thumb,
             (r.order_id is not null) as verified
      from public.market_reviews r
      join public.members m on m.member_id = r.member_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where public._mkt_sees(r.member_id, r.visibility, r.excl_followers, r.excl_premium,
                             r.excl_countries, r.allowed, me)
        and public._search_when(r.created_at, p_when)
        and public._search_has(words,
              coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(r.pros) x), '') || ' ' ||
              coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(r.cons) x), '') || ' ' ||
              coalesce((select p2.title from public.market_products p2 where p2.id = r.product_id), '') || ' ' ||
              coalesce(m.username, ''))
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'mreview', 'id', x.id, 'product_id', x.product_id, 'product', x.product_title,
               'thumb', x.thumb, 'pros', x.pros, 'cons', x.cons, 'author', x.username,
               'author_id', x.member_id, 'avatar', x.avatar, 'verified', x.verified,
               'score', 0, 'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'az' then lower(product_title) end asc,
                 case when srt = 'za' then lower(product_title) end desc,
                 created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;

  else -- shopping lists
    with src as (
      select l.id, l.name, l.description, l.member_id, l.visibility, l.created_at,
             coalesce(m.username, '') as username,
             coalesce((select pr.avatar_url from public.profiles pr where pr.member_id = l.member_id), '') as avatar,
             (select count(*)::int from public.market_list_items i where i.list_id = l.id) as n_items,
             coalesce((select jsonb_agg(z.img) from (
                select p2.images->>0 as img from public.market_list_items i2
                  join public.market_products p2 on p2.id = i2.product_id
                 where i2.list_id = l.id and jsonb_array_length(p2.images) > 0
                 order by i2.added_at limit 4) z), '[]'::jsonb) as thumbs
      from public.market_lists l
      join public.members m on m.member_id = l.member_id and lower(btrim(coalesce(m.status, ''))) = 'active'
      where public._mkt_sees(l.member_id, l.visibility, l.excl_followers, l.excl_premium,
                             l.excl_countries, l.allowed, me)
        and public._search_when(l.created_at, p_when)
        and public._search_has(words, l.name || ' ' || coalesce(l.description, '') || ' ' || coalesce(m.username, ''))
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'mlist', 'id', x.id, 'title', x.name, 'body', x.description,
               'author', x.username, 'author_id', x.member_id, 'avatar', x.avatar,
               'items', x.n_items, 'thumbs', x.thumbs, 'visibility', x.visibility,
               'score', 0, 'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(name) end asc,
                 case when srt = 'za' then lower(name) end desc,
                 n_items desc, created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;
  end if;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 9. Prizes tab

-- search_prizes — the Prizes tab.
--   p_kind  prizes | challenges | lottery | groups
--   p_when  '' | today | yesterday | week | month | year  (added)
--   p_sort  rank | relevance | date | az | za
-- prizes: the ones with a gift mode (or the classic single-mode prizes).
-- challenges: the ones with a challenge mode. lottery: the ones with a
-- lottery mode. groups: the prize groups (categories) of sql/prize_center.sql.
-- Private prizes (panel.sql visibility + allowed_usernames) never leave their
-- audience; a hidden group hides its prizes.
-- -> { total, items, sort, kind }
create or replace function public.search_prizes(
  p_member text default '', p_q text default '', p_kind text default '', p_when text default '',
  p_sort text default '', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me text := btrim(coalesce(p_member, ''));
  q text := btrim(coalesce(p_q, ''));
  words text[] := public._search_words(q);
  knd text := lower(coalesce(p_kind, 'prizes'));
  srt text := lower(coalesce(p_sort, ''));
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  total int; items jsonb;
  has_modes boolean := to_regclass('public.prize_modes') is not null;
begin
  if knd not in ('prizes', 'challenges', 'lottery', 'groups') then knd := 'prizes'; end if;
  if srt not in ('rank', 'relevance', 'date', 'az', 'za') then
    srt := case when q = '' then 'rank' else 'relevance' end;
  end if;

  if knd = 'groups' then
    with src as (
      select g.id, g.name, coalesce(g.thumb, '') as thumb, g.sort_order, g.created_at,
             (select count(*)::int from public.prizes pz
               where pz.group_id = g.id and coalesce(pz.status, 'active') = 'active') as n_prizes
      from public.prize_groups g
      where coalesce(g.visible, true)
        and public._search_when(g.created_at, p_when)
        and public._search_has(words, g.name)
    )
    select (select count(*) from src),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'group', 'id', x.id, 'title', x.name, 'thumb', x.thumb,
               'prizes', x.n_prizes, 'score', 0, 'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(name) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(name) end asc,
                 case when srt = 'za' then lower(name) end desc,
                 sort_order, n_prizes desc, created_at desc, id) as rn
               from src order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;
  else
    with src as (
      select pz.id, pz.title, left(coalesce(pz.description, ''), 300) as body,
             coalesce(pz.prize_image, '') as thumb, coalesce(pz.group_thumb, '') as group_thumb,
             coalesce(pz.group_name, '') as group_name, pz.group_id,
             coalesce(pz.minutes_required, 0) as minutes_required,
             coalesce(pz.winners_needed, 1) as winners_needed,
             coalesce(pz.subscribers_needed, 0) as subscribers_needed,
             pz.starts_at, pz.ends_at, coalesce(pz.status, 'active') as status,
             coalesce(pz.created_at, now()) as created_at,
             coalesce((select count(*)::int from public.prize_entries e where e.prize_id = pz.id), 0) as entries,
             coalesce((select jsonb_agg(distinct pm2.mode order by pm2.mode) from public.prize_modes pm2
                        where pm2.prize_id = pz.id), '[]'::jsonb) as modes,
             case
               when coalesce(pz.visibility, 'public') = 'private'
                    and not (me <> '' and (
                      lower(me) = any (select lower(btrim(x)) from unnest(regexp_split_to_array(
                        lower(coalesce(pz.allowed_usernames, '')), '[,;]+')) x where btrim(x) <> '')
                      or lower(coalesce((select mm.username from public.members mm where mm.member_id = me), ''))
                         = any (select lower(btrim(x)) from unnest(regexp_split_to_array(
                        lower(coalesce(pz.allowed_usernames, '')), '[,;]+')) x where btrim(x) <> '')))
                 then false
               else true end as seen
      from public.prizes pz
      where coalesce(pz.status, 'active') = 'active'
        and (pz.group_id is null or exists (
          select 1 from public.prize_groups g where g.id = pz.group_id and coalesce(g.visible, true)))
        and (not has_modes
             or (knd = 'prizes' and (exists (select 1 from public.prize_modes pm where pm.prize_id = pz.id and pm.mode = 'gift')
                                     or not exists (select 1 from public.prize_modes pm where pm.prize_id = pz.id)))
             or (knd = 'challenges' and exists (select 1 from public.prize_modes pm where pm.prize_id = pz.id and pm.mode = 'challenge'))
             or (knd = 'lottery' and exists (select 1 from public.prize_modes pm where pm.prize_id = pz.id and pm.mode = 'lottery')))
        and public._search_when(coalesce(pz.created_at, now()), p_when)
        and public._search_has(words, pz.title || ' ' || coalesce(pz.description, '') || ' ' || coalesce(pz.group_name, ''))
    )
    select (select count(*) from src where seen),
           coalesce((select jsonb_agg(jsonb_build_object(
               'type', 'prize', 'id', x.id, 'title', x.title, 'body', x.body,
               'thumb', x.thumb, 'group', x.group_name, 'group_id', x.group_id,
               'minutes', x.minutes_required, 'winners', x.winners_needed,
               'target', x.subscribers_needed, 'starts', x.starts_at, 'ends', x.ends_at,
               'entries', x.entries, 'modes', x.modes,
               'score', 0, 'created_at', x.created_at) order by x.rn) from (
               select *, row_number() over (order by
                 case when srt = 'relevance' then (case when lower(title) like '%' || lower(q) || '%' then 0 else 1 end) end,
                 case when srt = 'az' then lower(title) end asc,
                 case when srt = 'za' then lower(title) end desc,
                 case when srt in ('relevance', 'rank') then entries end desc,
                 created_at desc, id) as rn
               from src where seen order by rn offset off limit lim) x), '[]'::jsonb)
      into total, items;
  end if;

  return jsonb_build_object('total', coalesce(total, 0), 'items', coalesce(items, '[]'::jsonb), 'sort', srt, 'kind', knd);
end $$;

-- ------------------------------------------------------------------ 10. passwords and join requests

-- Enter one of the passwords a publisher set on a list. Meeting the other
-- criteria is not enough without it. Keeps the list open for this member.
-- -> { ok: true } | { ok: false, reason: not_found | signin | password | banned }
create or replace function public.iptv_list_unlock(p_member text, p_list text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.iptv_lists; m public.members; why text;
begin
  m := public._iptvl_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'signin'); end if;
  select * into l from public.iptv_lists where list_id = btrim(coalesce(p_list, ''));
  if not found or l.suspended_at is not null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.owner_id = m.member_id then return jsonb_build_object('ok', true); end if;
  if not exists (
    select 1 from public.iptv_list_passwords w
    where w.list_id = l.list_id and lower(btrim(w.code)) = lower(btrim(coalesce(p_code, '')))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  insert into public.iptv_list_unlocks (list_id, member_id) values (l.list_id, m.member_id)
    on conflict (list_id, member_id) do update set created_at = now();
  why := public._iptvl_access(l, m.member_id);
  return jsonb_build_object('ok', why = 'ok', 'reason', case when why = 'ok' then null else why end);
end $$;

-- Ask to join a private list that appears in search. The publisher gets a bell
-- notification and must approve (iptv_list_join_answer).
-- -> { ok: true, status: pending | approved | rejected } | { ok: false, reason: … }
create or replace function public.iptv_list_join_request(p_member text, p_list text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.iptv_lists; m public.members; r record;
begin
  m := public._iptvl_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'signin'); end if;
  select * into l from public.iptv_lists where list_id = btrim(coalesce(p_list, ''));
  if not found or l.suspended_at is not null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.visibility <> 'private' then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if exists (select 1 from public.iptv_list_access a where a.list_id = l.list_id and a.member_id = m.member_id) then
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;
  select * into r from public.iptv_list_requests
   where list_id = l.list_id and member_id = m.member_id order by created_at desc limit 1;
  if found and r.status = 'pending' then
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;
  insert into public.iptv_list_requests (list_id, member_id, username, note)
  values (l.list_id, m.member_id, m.username, left(btrim(coalesce(p_note, '')), 300));
  insert into public.notifications (member_id, kind, title, body, href, from_id, from_username)
  values (l.owner_id, 'iptv_join',
          'Join request: ' || l.name,
          m.username || ' asks to join your private list “' || l.name || '”.',
          './listchannels.html?list=' || l.list_id, m.member_id, m.username);
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- The publisher answers a join request. Approving adds the member to the
-- private list's audience; both answers send a bell notification.
-- -> { ok: true, status } | { ok: false, reason: … }
create or replace function public.iptv_list_join_answer(
  p_member text, p_list text, p_request bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.iptv_lists; m public.members; r record; act text := lower(coalesce(p_action, ''));
begin
  m := public._iptvl_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'signin'); end if;
  if act not in ('approve', 'reject') then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  select * into l from public.iptv_lists where list_id = btrim(coalesce(p_list, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.owner_id <> m.member_id and not exists (
    select 1 from public.staff s where s.member_id = m.member_id and s.role in ('super', 'admin', 'moderator')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into r from public.iptv_list_requests where id = coalesce(p_request, 0) and list_id = l.list_id;
  if not found or r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if act = 'approve' then
    insert into public.iptv_list_access (list_id, member_id, username) values (l.list_id, r.member_id, r.username)
      on conflict do nothing;
    update public.iptv_list_requests set status = 'approved', decided_at = now(), decided_by = m.member_id
     where id = r.id;
  else
    update public.iptv_list_requests set status = 'rejected', decided_at = now(), decided_by = m.member_id
     where id = r.id;
  end if;
  insert into public.notifications (member_id, kind, title, body, href, from_id, from_username)
  values (r.member_id, 'iptv_join',
          case when act = 'approve' then 'Join accepted: ' else 'Join declined: ' end || l.name,
          case when act = 'approve'
               then 'Your request to join “' || l.name || '” was accepted. You can watch it now.'
               else 'Your request to join “' || l.name || '” was declined.' end,
          './listchannels.html?list=' || l.list_id, m.member_id, m.username);
  return jsonb_build_object('ok', true, 'status', case when act = 'approve' then 'approved' else 'rejected' end);
end $$;

-- The publisher's own conditions on a list: the membership level and account
-- level an exclusive list demands, its passwords, and whether a private list
-- may appear in the search results (behind a join request).
-- d: { premium: bool, level: 0..10, passwords: ["…", …] (one per password, at
--     most 10), in_search: bool } — only the keys you send are changed.
-- Staff (super / admin / moderator) may also set { official: bool }.
-- -> { ok: true, card } | { ok: false, reason: member | not_found | forbidden |
--      bad_request | passwords }
create or replace function public.iptv_list_conditions(p_member text, p_list text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.iptv_lists; m public.members; is_staff boolean := false;
  codes text[] := '{}'; c text; n int := 0;
begin
  m := public._iptvl_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'signin'); end if;
  select * into l from public.iptv_lists where list_id = btrim(coalesce(p_list, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  is_staff := exists (select 1 from public.staff s
                       where s.member_id = m.member_id and s.role in ('super', 'admin', 'moderator'));
  if l.owner_id <> m.member_id and not is_staff then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(d) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  if jsonb_typeof(d->'premium') in ('boolean') then
    update public.iptv_lists set excl_premium = coalesce((d->>'premium')::boolean, false)
     where list_id = l.list_id;
  end if;
  if nullif(btrim(coalesce(d->>'level', '')), '') is not null then
    update public.iptv_lists
       set excl_level = least(greatest(coalesce(_mkt_int(d->>'level'), 0), 0), 10)
     where list_id = l.list_id;
  end if;
  if jsonb_typeof(d->'in_search') in ('boolean') then
    update public.iptv_lists set in_search = coalesce((d->>'in_search')::boolean, false)
     where list_id = l.list_id;
  end if;
  if jsonb_typeof(d->'official') in ('boolean') and is_staff then
    update public.iptv_lists set official = coalesce((d->>'official')::boolean, false)
     where list_id = l.list_id;
  end if;
  if jsonb_typeof(d->'passwords') = 'array' then
    select coalesce(array_agg(left(btrim(e), 64) order by ord), '{}') into codes
      from jsonb_array_elements_text(d->'passwords') with ordinality as t(e, ord)
     where btrim(e) <> '';
    if cardinality(codes) > 10 then return jsonb_build_object('ok', false, 'reason', 'passwords'); end if;
    delete from public.iptv_list_passwords where list_id = l.list_id;
    foreach c in array codes loop
      insert into public.iptv_list_passwords (list_id, code) values (l.list_id, c);
    end loop;
  end if;

  select * into l from public.iptv_lists where list_id = l.list_id;
  return jsonb_build_object('ok', true, 'card', public._iptvl_card(l, m.member_id));
end $$;

-- ------------------------------------------------------------------ 11. open to the pages

do $$
declare f text;
begin
  foreach f in array array[
    'public._search_rank(bigint, int, int, int, int, int)', 'public._search_when(timestamptz, text)',
    'public._search_level(text)', 'public._search_words(text)', 'public._search_has(text[], text)',
    'public._search_playlist_ok(public.playlists, text)', 'public._search_post_ok(public.posts, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.search_content(text, text, text, text, text, int, int)',
    'public.search_titles(text, text, text, text, text, text, int, int)',
    'public.search_channels(text, text, text, text, text, int, int)',
    'public.search_profiles(text, text, text, text, text, int, int)',
    'public.search_market(text, text, text, text, text, int, int)',
    'public.search_prizes(text, text, text, text, text, int, int)',
    'public.iptv_list_unlock(text, text, text)',
    'public.iptv_list_join_request(text, text, text)',
    'public.iptv_list_join_answer(text, text, bigint, text)',
    'public.iptv_list_conditions(text, text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
