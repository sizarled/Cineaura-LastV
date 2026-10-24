-- CineAura — plain text posts (kind 'post')
-- Run once in the Supabase SQL editor (safe to re-run), after sql/profile.sql.
--
-- The Create page gains a "Post" tab: a free text post where the title picker
-- is optional (no TMDB title required — before this, every kind forced one
-- and saving answered "Pick at least one title.").
-- Plain posts take part in votes / comments / replies / reach / suggestions
-- exactly like the other kinds (a title-less post simply has no item hits).

alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts
  add constraint posts_kind_check check (kind in ('playlist', 'recommendation', 'reclist', 'account', 'review', 'post'));

comment on column public.posts.kind is 'playlist / recommendation / reclist / account / review / post (post = free text post, titles optional)';

-- Ask PostgREST to pick up the new constraint right away.
notify pgrst, 'reload schema';
