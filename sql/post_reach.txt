-- CineAura — post reach & daily suggestion engine
-- Run once in the Supabase SQL editor (safe to re-run), after sql/profile.sql,
-- sql/post_analytics.sql and sql/post_reports.sql, and BEFORE re-running
-- sql/search.sql (its post branches now call public.post_silenced()).
--
-- Business rules (member spec):
--   * Reach of a post = its all-time points: +30 per up-vote, −30 per down-vote,
--     +1 per comment, +1 per share, −60 per valid report (same as _search_rank).
--   * Daily suggestion budget = that reach: a post with reach 100 is surfaced
--     to up to 100 distinct NEW members per day. Reach 0 (or less) → no more
--     suggestions ever, but followers still see it.
--   * A post whose DAY points go negative (that UTC day) is silenced for as
--     many hours as the deficit: −70 points on a day → hidden from suggestions,
--     updates and search until the day end + 70 hours; only its owner and the
--     owner's followers still see it.
--   * Distribution rotates per post: each post serves its own daily budget
--     towards the interested pool, so a 300-reach post covers 600 interested
--     members in 2 days while a 100-reach post needs 6.

-- ------------------------------------------------------------------ 1. replies
alter table public.post_comments add column if not exists parent_id bigint
  references public.post_comments(id) on delete cascade;
create index if not exists post_comments_parent_idx on public.post_comments (parent_id);
comment on column public.post_comments.parent_id is 'Reply threading: the comment this one answers (null = top level)';

-- ------------------------------------------------- 2. daily surfacing log
create table if not exists public.post_surfaced (
  post_id text not null,
  member_id text not null,
  on_day date not null default ((now() at time zone 'utc')::date),
  surfaced_at timestamptz not null default now(),
  primary key (post_id, member_id, on_day)
);
comment on table public.post_surfaced is 'One row per post per viewer per UTC day: who the post was suggested to today (the daily budget). Written only by post_suggestions().';

alter table public.post_surfaced enable row level security;
drop policy if exists "post_surfaced select" on public.post_surfaced;
create policy "post_surfaced select" on public.post_surfaced for select to anon, authenticated using (true);

-- ------------------------------------------------------------------ 3. reach
create or replace function public.post_reach(p_post_id text)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(30 * (select count(*)::int from public.post_votes v where v.post_id = p_post_id and v.vote = 'up'), 0)
       - coalesce(30 * (select count(*)::int from public.post_votes v where v.post_id = p_post_id and v.vote = 'down'), 0)
       + coalesce((select count(*)::int from public.post_comments c where c.post_id = p_post_id), 0)
       + coalesce((select count(*)::int from public.post_events e where e.post_id = p_post_id and e.kind = 'share'), 0)
       - coalesce(60 * (select count(*)::int from public.post_reports r where r.post_id = p_post_id and r.verdict = 'valid'), 0)
$$;
comment on function public.post_reach(text) is 'All-time reach points of a post (+30/−30/+1/+1/−60). The daily suggestion budget.';

-- points earned on one UTC day
create or replace function public.post_day_points(p_post_id text, p_day date)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(30 * (select count(*)::int from public.post_votes v where v.post_id = p_post_id and v.vote = 'up' and (v.created_at at time zone 'utc')::date = p_day), 0)
       - coalesce(30 * (select count(*)::int from public.post_votes v where v.post_id = p_post_id and v.vote = 'down' and (v.created_at at time zone 'utc')::date = p_day), 0)
       + coalesce((select count(*)::int from public.post_comments c where c.post_id = p_post_id and (c.created_at at time zone 'utc')::date = p_day), 0)
       + coalesce((select count(*)::int from public.post_events e where e.post_id = p_post_id and e.kind = 'share' and (e.created_at at time zone 'utc')::date = p_day), 0)
       - coalesce(60 * (select count(*)::int from public.post_reports r where r.post_id = p_post_id and r.verdict = 'valid' and (r.reported_at at time zone 'utc')::date = p_day), 0)
$$;

-- ------------------------------------------------------------------ 4. silence
-- A net-negative day silences the post until that day's end + |points| hours
-- (cap 30 days). Today and yesterday are both checked: a negative yesterday
-- may still be running.
create or replace function public.post_silenced_until(p_post_id text)
returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  d date;
  pts bigint;
  cand timestamptz := null;
begin
  for d in select dd from (values ((now() at time zone 'utc')::date),
                                 ((now() at time zone 'utc')::date - 1)) as v(dd) order by dd desc loop
    pts := public.post_day_points(p_post_id, d);
    if pts < 0 then
      cand := (d + 1)::timestamptz + make_interval(hours => least((-pts)::int, 24 * 30));
      if cand > now() then return cand; end if;
    end if;
  end loop;
  return null;
end $$;
comment on function public.post_silenced_until(text) is 'Until when a post is hidden from suggestions/updates/search because of a net-negative day (null = visible).';

create or replace function public.post_silenced(p_post_id text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.post_silenced_until(p_post_id) > now(), false)
$$;

-- gate a batch of posts for one viewer: silenced posts stay visible only to
-- their owner and to the owner's accepted followers.
create or replace function public.posts_gate(p_member text, p_ids text[])
returns table(post_id text, silenced_until timestamptz, allowed boolean)
language sql stable security definer set search_path = public as $$
  select p.post_id,
         public.post_silenced_until(p.post_id) as silenced_until,
         (public.post_silenced_until(p.post_id) is null
          or p.owner_id = p_member
          or exists (select 1 from public.follows f
                     where f.follower_id = p_member and f.following_id = p.owner_id
                       and f.status = 'accepted')) as allowed
  from public.posts p
  where p.post_id = any(coalesce(p_ids, '{}'))
$$;

-- ---------------------------------------------------------- 5. suggestions
-- The viewer's own suggestion package for today: posts related to the titles
-- they watched (post_items ∩ views/hestory), public, unsilenced, within their
-- daily surfacing budget, and not yet suggested to this viewer today. Each
-- returned row is immediately logged in post_surfaced (budget consumption).
create or replace function public.post_suggestions(p_member text, p_limit int default 12)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  p_member := btrim(coalesce(p_member, ''));
  if p_member = '' then return '[]'::jsonb; end if;
  with watched as (
    select tmdb_id from public.views where viewer_id = p_member
    union
    select tmdb_id from public.hestory where visitor_id = p_member
  ),
  cand as (
    select p.*,
           (select count(*)::int from public.post_items pi
            where pi.post_id = p.post_id and pi.tmdb_id in (select tmdb_id from watched)) as hits,
           public.post_reach(p.post_id) as reach,
           (select count(*)::int from public.post_surfaced s
            where s.post_id = p.post_id and s.on_day = (now() at time zone 'utc')::date) as shown
    from public.posts p
    join public.members m on m.member_id = p.owner_id and lower(btrim(coalesce(m.status, ''))) = 'active'
    where p.visibility = 'public'
      and p.owner_id <> p_member
      and not public.post_silenced(p.post_id)
  ),
  sel as (
    select * from cand
    where reach > 0 and shown < reach and hits > 0
      and not exists (select 1 from public.post_surfaced s2
                      where s2.post_id = cand.post_id and s2.member_id = p_member
                        and s2.on_day = (now() at time zone 'utc')::date)
    order by hits desc, reach desc, created_at desc
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  ),
  ins as (
    insert into public.post_surfaced (post_id, member_id, on_day)
    select post_id, p_member, (now() at time zone 'utc')::date from sel
    on conflict do nothing
    returning post_id
  )
  select coalesce(jsonb_agg(to_jsonb(sel) - 'hits' - 'reach' - 'shown'
                            || jsonb_build_object('hits', sel.hits, 'reach', sel.reach)
                            order by sel.hits desc, sel.reach desc, sel.created_at desc), '[]'::jsonb)
    into result
  from sel;
  return result;
end $$;
comment on function public.post_suggestions(text, int) is 'Daily suggestion package: public posts related to what the member watched, within each post''s reach budget (logged to post_surfaced).';

-- ------------------------------------------------- 6. the Find leader-board
create or replace function public.post_top_members(p_limit int default 12)
returns jsonb
language sql stable security definer set search_path = public as $$
  with per_post as (
    select p.owner_id, p.owner_username, public.post_reach(p.post_id) as reach
    from public.posts p
  ),
  per_member as (
    select owner_id, max(owner_username) as username,
           sum(reach) as reach, count(*) as posts
    from per_post where reach > 0
    group by owner_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('owner_id', owner_id, 'username', username,
                                               'reach', reach, 'posts', posts)
                            order by reach desc), '[]'::jsonb)
  from (select * from per_member order by reach desc limit greatest(1, least(coalesce(p_limit, 12), 50))) t
$$;
comment on function public.post_top_members(int) is 'Find tab leader-board: members with the biggest total reach across their posts.';

grant execute on function public.post_reach(text) to anon, authenticated;
grant execute on function public.post_day_points(text, date) to anon, authenticated;
grant execute on function public.post_silenced_until(text) to anon, authenticated;
grant execute on function public.post_silenced(text) to anon, authenticated;
grant execute on function public.posts_gate(text, text[]) to anon, authenticated;
grant execute on function public.post_suggestions(text, int) to anon, authenticated;
grant select on public.post_surfaced to anon, authenticated;

grant execute on function public.post_top_members(int) to anon, authenticated;

-- Ask PostgREST to pick up the new objects right away.
notify pgrst, 'reload schema';
