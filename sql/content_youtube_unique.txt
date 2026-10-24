-- =====================================================================
-- Round 56 — one YouTube video, one page on the site.
--
-- Two halves, one feature:
--   1) The studio offers "Import title + description from YouTube" under
--      the link field (js/content-studio.js): the video's own words, or
--      the member's own ones — the link stays either way.
--   2) This file makes the link unique: whatever shape it comes in
--      (watch?v=, /embed/, /shorts/, /live/, /v/, youtu.be/), the same
--      11-character video id belongs to one row of public.content — no
--      member can publish it again, not even the same member, for as long
--      as that video exists. content_delete frees the link again.
--
-- The answer of a duplicate is honest: { ok: false, reason: 'dup_link' }.
-- =====================================================================

-- 1. The 11-character YouTube video id out of any link shape. The whole
--    link is lowercased first: two links to ONE video only ever differ in
--    host/casing of the link itself — the id comes back identical. On any
--    non-YouTube or id-less input the answer is null.
create or replace function public._youtube_id(p_url text) returns text
language sql immutable strict as $$
  select coalesce(
    substring(lower(p_url) from 'youtu\.be/([a-z0-9_-]{11})'),
    substring(lower(p_url) from 'youtube(?:-nocookie)?\.com/(?:watch\?[^#]*v=|embed/|shorts/|live/|v/)([a-z0-9_-]{11})')
  )
$$;

-- 2. content_create with the duplicate ban inside it.
-- d: { url, provider, thumb, title, description, tags[], language, age, visibility,
--      followers, premium, countries, people[], playlist, playlist_name, publish_at }
-- -> { ok, id, publish_at, scheduled } | { ok: false, reason }  (reason 'dup_link' added)
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
  -- (content_delete frees the link again)
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
