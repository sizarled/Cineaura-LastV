-- Generalized post attachments for recommendations, reviews and recommendation lists.
-- Existing TMDB entries remain unchanged; linked entries may point to an article,
-- document, answer, product, movie, series or book. Run after sql/profile.sql.
alter table public.post_items alter column tmdb_id drop not null;
alter table public.post_items add column if not exists source_type text not null default 'tmdb';
alter table public.post_items add column if not exists source_id text not null default '';
alter table public.post_items add column if not exists href text not null default '';
alter table public.post_items add column if not exists note text not null default '';
alter table public.post_items drop constraint if exists post_items_source_type_check;
alter table public.post_items add constraint post_items_source_type_check
  check (source_type in ('tmdb', 'article', 'document', 'answer', 'product', 'movie', 'series', 'book'));
notify pgrst, 'reload schema';
