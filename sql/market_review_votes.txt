-- CineAura — votes on market reviews (helpful / not helpful)
-- Run once in the Supabase SQL editor (safe to re-run), after sql/market.sql.
--
-- Every review card (profile > Market,updates feed, Market pages) shows a
-- "Helpful" 👍 and a "Not helpful" 👎 button. One vote per member and review,
-- a changed vote replaces the old one. A helpful vote adds +30 positive
-- points to the review, a not-helpful vote adds +30 negative points — the
-- same reach arithmetic profile posts use (sql/post_reach.sql).
-- A member cannot vote on their own review (enforced in js).

create table if not exists public.market_review_votes (
  review_id bigint not null references public.market_reviews(id) on delete cascade,
  member_id text not null,
  username text not null default '',
  vote text not null check (vote in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (review_id, member_id)
);
comment on table public.market_review_votes is 'One vote per member and review: helpful (up) / not helpful (down).';

create index if not exists market_review_votes_member_idx on public.market_review_votes (member_id);

-- The points of a review: +30 per helpful vote, −30 per not-helpful vote.
create or replace function public.mkt_review_points(p_review_id bigint)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(30 * (select count(*)::int from public.market_review_votes v where v.review_id = p_review_id and v.vote = 'up'), 0)
       - coalesce(30 * (select count(*)::int from public.market_review_votes v where v.review_id = p_review_id and v.vote = 'down'), 0)
$$;
comment on function public.mkt_review_points(bigint) is 'Points of a market review: +30 per helpful vote, -30 per not-helpful vote.';

grant select, insert, update, delete on public.market_review_votes to anon, authenticated;
grant execute on function public.mkt_review_points(bigint) to anon, authenticated;

-- Ask PostgREST to pick up the new objects right away.
notify pgrst, 'reload schema';
