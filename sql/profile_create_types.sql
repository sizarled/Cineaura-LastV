-- CineAura profile Create types. Apply once after sql/plain_posts.sql.
-- Readlists share the existing posts/reach/vote/comment pipeline, while their
-- entries are authored as lines of text so they can refer to articles, docs,
-- answers, books, or a mixed reading list.
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts
  add constraint posts_kind_check check (kind in ('playlist', 'recommendation', 'reclist', 'readlist', 'account', 'review', 'post'));
notify pgrst, 'reload schema';
