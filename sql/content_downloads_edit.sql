-- =====================================================================
-- Round 57 — a member video's own switches, editable any time:
--
--   * downloads  — the publisher allows it in the studio; a Download button
--                  shows on the watch page (file / stream videos only).
--   * content_update — the row's pen: the custom picture (a Streamtape-hosted
--                  video takes any https picture), who may watch (public for
--                  everyone / exclusive / private), the age rating
--                  (3+ 6+ 13+ 16+ 18+), and the downloads switch. The link and
--                  the text stay untouched — content_create answers those.
--
-- -> every answer of content_update: { ok: true, id } | { ok: false, reason }
-- =====================================================================

alter table public.content add column if not exists downloads boolean not null default false;

-- content_create with the downloads switch (the one-link-once ban of
-- sql/content_youtube_unique.sql stays exactly where it was)
create or replace function public.content_create(p_member text, d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members; cid text; url text; title text; descr text; vis text; age int; lang text; prov text; thumb text; dup_id text;
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
  if url !~* '^https?://[^/?#[:space:]]+' or length(url) > 2000 or url ~ '[[:space:]<>"]' then
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
  -- a YouTube video lives once on the site, whatever shape its link comes in,
  -- whoever published it first — and only for as long as that video exists
  if prov = 'youtube' then
    select c.content_id into dup_id from public.content c
     where public._youtube_id(c.video_url) is not null
       and public._youtube_id(c.video_url) = public._youtube_id(url)
     limit 1;
    if dup_id is not null then return jsonb_build_object('ok', false, 'reason', 'dup_link'); end if;
  end if;
  thumb := btrim(coalesce(d->>'thumb', ''));
  if thumb <> '' and (thumb !~* '^https://[^/?#[:space:]]+' or length(thumb) > 1000 or thumb ~ '[[:space:]<>"]') then thumb := ''; end if;
  is_portrait := coalesce((d->>'portrait')::boolean, false) or prov = 'tiktok' or lower(url) like '%/shorts/%';
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
                              country, playlist_id, publish_at, portrait, downloads)
  values (cid, m.member_id, m.username, url, prov, thumb, title, descr, tags, lang, age, vis,
          vis = 'exclusive' and coalesce((d->>'followers')::boolean, false),
          vis = 'exclusive' and coalesce((d->>'premium')::boolean, false),
          case when vis = 'exclusive' then cty else '' end,
          upper(coalesce(m.country, '')), pid, pub, is_portrait,
          coalesce((d->>'downloads')::boolean, false));
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

-- the watch page answers the downloads switch of the publisher
create or replace function public.content_get(p_id text, p_member text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.content; why text; o record; v int;
begin
  select * into c from public.content where content_id = btrim(coalesce(p_id, ''));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  why := public._content_access(c, p_member);
  if why in ('private', 'scheduled', 'gone') then return jsonb_build_object('ok', false, 'reason', why); end if;
  select m.member_id, m.username, coalesce(p.display_name, '') as display_name, coalesce(p.avatar_url, '') as avatar_url,
         coalesce(p.followers, 0) as followers
    into o
  from public.members m left join public.profiles p on p.member_id = m.member_id
  where m.member_id = c.owner_id;
  select vote into v from public.content_votes where content_id = c.content_id and member_id = btrim(coalesce(p_member, ''));
  return jsonb_build_object(
    'ok', true, 'access', why, 'mine', c.owner_id = btrim(coalesce(p_member, '')),
    'content', public._content_card(c, why) || jsonb_build_object(
      'description', c.description, 'url', case when why = 'ok' and c.age_rating < 13 then c.video_url else null end,
      'code', c.age_rating >= 13,
      'shares', c.shares, 'playlists', c.playlists, 'excl_followers', c.excl_followers,
      'excl_premium', c.excl_premium, 'excl_countries', c.excl_countries,
      'downloads', c.downloads),
    'owner', jsonb_build_object('id', c.owner_id, 'username', coalesce(o.username, c.owner_username),
                                'display_name', o.display_name, 'avatar_url', o.avatar_url, 'followers', o.followers),
    'my_vote', coalesce(v, 0));
end $$;

-- the studio's own list carries the switch, for the edit dialog and the copy
create or replace function public.content_mine(p_member text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.content_id, 'title', c.title, 'description', c.description, 'url', c.video_url, 'provider', c.provider,
    'thumb', c.thumb_url, 'tags', to_jsonb(c.tags), 'language', c.language, 'age', c.age_rating,
    'visibility', c.visibility, 'followers', c.excl_followers, 'premium', c.excl_premium, 'countries', c.excl_countries,
    'country', c.country, 'publish_at', c.publish_at, 'created_at', c.created_at, 'scheduled', c.publish_at > now(),
    'views', c.views, 'impressions', c.impressions, 'clicks', c.clicks, 'likes', c.likes, 'dislikes', c.dislikes,
    'shares', c.shares, 'comments', c.comments, 'playlists_count', c.playlists, 'minutes', c.watch_minutes,
    'downloads', c.downloads,
    'suspended', case when c.suspended_at is not null then jsonb_build_object('reason', c.suspended_reason, 'at', c.suspended_at) end,
    'people', coalesce((select jsonb_agg(a.username order by a.username) from public.content_access a where a.content_id = c.content_id), '[]'::jsonb),
    'playlists', coalesce((select jsonb_agg(jsonb_build_object('id', p.playlist_id, 'name', p.name) order by p.name)
                           from public.content_playlist_items i join public.content_playlists p on p.playlist_id = i.playlist_id
                           where i.content_id = c.content_id and p.owner_id = c.owner_id), '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  from public.content c where c.owner_id = btrim(coalesce(p_member, ''));
$$;

-- ---------------------------------------------------------------- edit
-- d: { thumb, downloads, age, visibility, followers, premium, countries, people[] }
-- Only the owner, and only the video's own switches — never the link, never
-- the text. The excluded countries come back from the client as they stand
-- (the edit dialog does not touch that list).
create or replace function public.content_update(p_member text, p_id text, d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.content; m public.members; vis text; age int; cty text; thumb text; people text[]; u text;
begin
  m := public._content_viewer(p_member);
  if m.member_id is null then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if public._content_blocked(m.member_id, 'posts') then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  select * into c from public.content where content_id = btrim(coalesce(p_id, '')) and owner_id = m.member_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  thumb := btrim(coalesce(d->>'thumb', ''));
  if thumb <> '' and (thumb !~* '^https://[^/?#[:space:]]+' or length(thumb) > 1000 or thumb ~ '[[:space:]<>"]') then
    return jsonb_build_object('ok', false, 'reason', 'thumb');
  end if;
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

  update public.content set
    thumb_url = thumb,
    downloads = coalesce((d->>'downloads')::boolean, false),
    age_rating = age,
    visibility = vis,
    excl_followers = vis = 'exclusive' and coalesce((d->>'followers')::boolean, false),
    excl_premium = vis = 'exclusive' and coalesce((d->>'premium')::boolean, false),
    excl_countries = case when vis = 'exclusive' then cty else '' end
  where content_id = c.content_id;

  -- the private audience follows the new setting
  if c.visibility = 'private' or vis = 'private' then
    delete from public.content_access where content_id = c.content_id;
  end if;
  if vis = 'private' then
    foreach u in array people loop
      insert into public.content_access (content_id, username) values (c.content_id, u) on conflict do nothing;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', c.content_id);
end $$;
