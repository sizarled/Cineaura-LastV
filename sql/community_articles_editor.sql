-- CineAura Officiel V2 — the rich article editor (article.html).
-- Paste in Supabase → SQL Editor AFTER sql/community.sql. Idempotent.

alter table public.community_articles add column if not exists description      text not null default '';
alter table public.community_articles add column if not exists body_html        text not null default '';
alter table public.community_articles add column if not exists language         text not null default '';
alter table public.community_articles add column if not exists categories       text not null default '';
alter table public.community_articles add column if not exists thumb            text not null default '';
alter table public.community_articles add column if not exists visibility       text not null default 'public';
alter table public.community_articles add column if not exists excl             jsonb not null default '{}'::jsonb;
alter table public.community_articles add column if not exists private_users    text not null default '';
alter table public.community_articles add column if not exists private_passwords text not null default '';
alter table public.community_articles add column if not exists publish_at       timestamptz;
alter table public.community_articles add column if not exists status           text not null default 'published';
alter table public.community_articles add column if not exists places           text not null default 'content';
alter table public.community_articles add column if not exists help_sections    text not null default '';
alter table public.community_articles add column if not exists content_field    text not null default '';
alter table public.community_articles add column if not exists content_niche    text not null default '';
alter table public.community_articles add column if not exists content_micro    text not null default '';
alter table public.community_articles add column if not exists content_nano     text not null default '';
alter table public.community_articles add column if not exists updated_by       text not null default '';

-- status: draft (owner only) · pending (waiting for staff in Help) · published
alter table public.community_articles drop constraint if exists community_articles_status_check;
alter table public.community_articles
  add constraint community_articles_status_check check (status in ('draft', 'pending', 'published'));

alter table public.community_articles drop constraint if exists community_articles_vis_check;
alter table public.community_articles
  add constraint community_articles_vis_check check (visibility in ('public', 'exclusive', 'private'));

create index if not exists com_art_status_idx  on public.community_articles (status, created_at desc);
create index if not exists com_art_publish_idx on public.community_articles (publish_at);
create index if not exists com_art_places_idx  on public.community_articles (places);

-- Staff decisions on Help submissions (approve / reject) leave a trace.
create table if not exists public.community_article_reviews (
  id           bigint generated always as identity primary key,
  article_id   bigint not null references public.community_articles(id) on delete cascade,
  reviewer_id  text not null,
  decision     text not null default 'approved',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  constraint community_article_reviews_decision_check check (decision in ('approved', 'rejected'))
);
create index if not exists com_artrev_article_idx on public.community_article_reviews (article_id);

alter table public.community_article_reviews enable row level security;
drop policy if exists com_artrev_read  on public.community_article_reviews;
drop policy if exists com_artrev_write on public.community_article_reviews;
create policy com_artrev_read  on public.community_article_reviews for select using (true);
create policy com_artrev_write on public.community_article_reviews for all using (true) with check (true);

comment on column public.community_articles.body_html is 'Sanitised article HTML from article.html; body keeps a plain-text copy for search and old readers.';
comment on column public.community_articles.places is 'content | help | both — where the article is published.';
comment on column public.community_articles.status is 'draft (owner) · pending (Help review) · published';

notify pgrst, 'reload schema';
