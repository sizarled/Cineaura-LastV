-- ============================================================
-- CineAura — Help Center (مركز المساعدة)  v2
-- Run in Supabase SQL editor. Safe to run more than once, and
-- safe on databases that still have the OLD (v1) help tables:
-- every statement is add-only/repair-only and never deletes data.
-- Tables: help_categories, help_articles, help_article_categories,
--         help_article_votes, help_article_comments
-- Article ids are uuid (matches what v1 sites already have live;
-- the editor and the help page treat the id as an opaque string).
-- ============================================================

-- 1. Categories (main sections + subsections)
create table if not exists public.help_categories (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  name_ar text not null default '',
  parent_id bigint references public.help_categories(id) on delete cascade,
  sort_order integer not null default 0,
  icon text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists help_categories_parent_idx on public.help_categories(parent_id);
create index if not exists help_categories_sort_idx on public.help_categories(sort_order);

-- 2. Articles — fresh installs get the full v2 table right away
create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null default '',
  title text not null default '',
  summary text not null default '',
  content_html text not null default '',
  content_css text not null default '',
  language text not null default 'en',
  country text not null default 'global',
  status text not null default 'draft',
  author_id text not null default '',
  author_name text not null default '',
  category_id bigint,
  views integer not null default 0,
  reading_minutes integer not null default 2,
  helpful_count integer not null default 0,
  unhelpful_count integer not null default 0,
  comments_count integer not null default 0,
  image text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

-- 2b. Existing (v1) articles tables get the v2 columns ADDED —
--     old columns (content, custom_css, section_id, subsection_id,
--     reads, reading_time, useful_count, not_useful_count, content_mode,
--     autosave) stay untouched; nothing is dropped.
alter table public.help_articles add column if not exists slug text not null default '';
alter table public.help_articles add column if not exists summary text not null default '';
alter table public.help_articles add column if not exists content_html text not null default '';
alter table public.help_articles add column if not exists content_css text not null default '';
alter table public.help_articles add column if not exists author_id text not null default '';
alter table public.help_articles add column if not exists author_name text not null default '';
alter table public.help_articles add column if not exists category_id bigint;
alter table public.help_articles add column if not exists views integer not null default 0;
alter table public.help_articles add column if not exists reading_minutes integer not null default 2;
alter table public.help_articles add column if not exists helpful_count integer not null default 0;
alter table public.help_articles add column if not exists unhelpful_count integer not null default 0;
alter table public.help_articles add column if not exists comments_count integer not null default 0;
alter table public.help_articles add column if not exists image text not null default '';
alter table public.help_articles add column if not exists published_at timestamptz;

-- 2c. Backfill v2 columns from the old v1 ones (only fills empty/target defaults)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='content') then
    update public.help_articles set content_html = nullif(trim(content), '')
      where content_html = '' and content is not null and trim(content) <> '';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='custom_css') then
    update public.help_articles set content_css = custom_css
      where content_css = '' and custom_css is not null and custom_css <> '';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='reads') then
    update public.help_articles set views = greatest(views, coalesce(reads,0)::int);
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='reading_time') then
    update public.help_articles set reading_minutes = coalesce(reading_time, 2) where reading_time is not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='useful_count') then
    update public.help_articles set helpful_count = useful_count where useful_count is not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_articles' and column_name='not_useful_count') then
    update public.help_articles set unhelpful_count = not_useful_count where not_useful_count is not null;
  end if;
end $$;

-- 2d. Slugs for rows that miss them (title-derived, deduplicated by id suffix)
with base as (
  select id,
         trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(title),''), left(id::text,8)), '[^a-z0-9]+', '-', 'g'))) as b,
         row_number() over (partition by trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(title),''), left(id::text,8)), '[^a-z0-9]+', '-', 'g')))) as rn
  from public.help_articles
  where slug is null or slug = ''
)
update public.help_articles a
   set slug = case when b.b = '' then 'article-' || left(a.id::text,8)
                   when b.rn = 1 then b.b
                   else b.b || '-' || right(a.id::text,6) end
  from base b where a.id = b.id;
alter table public.help_articles alter column slug set not null;
create unique index if not exists help_articles_slug_ux on public.help_articles(slug);

-- 2e. Keep published timestamps sane + status within the two known states
update public.help_articles
   set published_at = coalesce(updated_at, created_at)
 where status = 'published' and published_at is null;
update public.help_articles set status = 'draft'
 where status is null or status not in ('draft','published');
update public.help_articles set language = 'en' where language is null or language = '';
update public.help_articles set country = 'global' where country is null or country = '';

-- 2f. FK to categories + full-text helper column + indexes
do $$
begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
                 where c.conname='help_articles_category_fk' and t.relname='help_articles') then
    alter table public.help_articles add constraint help_articles_category_fk
      foreign key (category_id) references public.help_categories(id) on delete set null;
  end if;
exception when others then null; -- retry-safe: constraint errors never abort the run
end $$;
alter table public.help_articles add column if not exists search_tsv tsvector
  generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content_html,''))) stored;
create index if not exists help_articles_status_idx on public.help_articles(status);
create index if not exists help_articles_lang_idx on public.help_articles(language);
create index if not exists help_articles_country_idx on public.help_articles(country);
create index if not exists help_articles_category_idx on public.help_articles(category_id);
create index if not exists help_articles_tsv_idx on public.help_articles using gin(search_tsv);

-- 2g. updated_at trigger
create or replace function public.help_touch_updated() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists help_articles_touch on public.help_articles;
create trigger help_articles_touch before update on public.help_articles
  for each row execute function public.help_touch_updated();

-- 3. Many-to-many article ↔ categories
create table if not exists public.help_article_categories (
  article_id uuid not null references public.help_articles(id) on delete cascade,
  category_id bigint not null references public.help_categories(id) on delete cascade,
  primary key (article_id, category_id)
);

-- 4. Helpful / Not helpful votes
--    Fresh installs get the v2 shape; v1 databases keep their table and get
--    member_id/helpful added (voter_key/is_useful stay, untouched).
create table if not exists public.help_article_votes (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.help_articles(id) on delete cascade,
  member_id text not null default '',
  helpful boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.help_article_votes add column if not exists member_id text not null default '';
alter table public.help_article_votes add column if not exists helpful boolean not null default true;
-- v1 backfill: voter_key → member_id, is_useful → helpful
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_article_votes' and column_name='voter_key') then
    update public.help_article_votes set member_id = voter_key where member_id = '' and voter_key is not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='help_article_votes' and column_name='is_useful') then
    update public.help_article_votes set helpful = is_useful where is_useful is not null;
  end if;
end $$;
-- v1 tables already carry GENERATED ALWAYS AS identity on id — only give a
-- nextval default when there is no identity (guarded: setting a default on an
-- identity column is rejected by Postgres)
create sequence if not exists help_article_votes_id_seq;
do $$
begin
  if (select attidentity from pg_attribute where attrelid='public.help_article_votes'::regclass and attname='id') = '' then
    execute 'alter table public.help_article_votes alter column id set default nextval(''public.help_article_votes_id_seq''::regclass)';
  end if;
end $$;
-- v1 legacy columns must not block new inserts (both were NOT NULL without defaults)
alter table public.help_article_votes alter column voter_key drop not null;
alter table public.help_article_votes alter column is_useful drop not null;
-- drop exact duplicate (article, member) rows before the unique index
delete from public.help_article_votes a using public.help_article_votes b
 where a.article_id = b.article_id and a.member_id = b.member_id and a.id < b.id and a.member_id <> '';
create unique index if not exists help_votes_unique_member on public.help_article_votes(article_id, member_id) where member_id <> '';
create index if not exists help_votes_article_idx on public.help_article_votes(article_id);

-- 5. Comments
create table if not exists public.help_article_comments (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.help_articles(id) on delete cascade,
  member_id text not null default '',
  username text not null default '',
  avatar_url text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists help_comments_article_idx on public.help_article_comments(article_id, created_at desc);

-- 6. Views helper: increment views atomically
create or replace function public.help_increment_view(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.help_articles set views = views + 1 where id = p_id;
end $$;

-- 7. Vote helper: upsert vote and update counters (toggle remove / switch)
create or replace function public.help_vote(p_article uuid, p_member text, p_helpful boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_helpful boolean;
begin
  select helpful into v_helpful from public.help_article_votes where article_id = p_article and member_id = p_member;
  if found then
    if v_helpful = p_helpful then
      delete from public.help_article_votes where article_id = p_article and member_id = p_member;
      if p_helpful then
        update public.help_articles set helpful_count = greatest(0, helpful_count - 1) where id = p_article;
      else
        update public.help_articles set unhelpful_count = greatest(0, unhelpful_count - 1) where id = p_article;
      end if;
      return json_build_object('action','removed');
    else
      update public.help_article_votes set helpful = p_helpful where article_id = p_article and member_id = p_member;
      if p_helpful then
        update public.help_articles set helpful_count = helpful_count + 1, unhelpful_count = greatest(0, unhelpful_count - 1) where id = p_article;
      else
        update public.help_articles set unhelpful_count = unhelpful_count + 1, helpful_count = greatest(0, helpful_count - 1) where id = p_article;
      end if;
      return json_build_object('action','switched');
    end if;
  else
    insert into public.help_article_votes(article_id, member_id, helpful) values (p_article, p_member, p_helpful);
    if p_helpful then
      update public.help_articles set helpful_count = helpful_count + 1 where id = p_article;
    else
      update public.help_articles set unhelpful_count = unhelpful_count + 1 where id = p_article;
    end if;
    return json_build_object('action','added');
  end if;
end $$;

-- 8. RLS: public read, open write (app checks the panel role client-side,
--    like the rest of the site does)
alter table public.help_categories enable row level security;
alter table public.help_articles enable row level security;
alter table public.help_article_categories enable row level security;
alter table public.help_article_votes enable row level security;
alter table public.help_article_comments enable row level security;

do $$ declare t text; p record; begin
  foreach t in array array['help_categories','help_articles','help_article_categories','help_article_votes','help_article_comments'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy help_cat_read on public.help_categories for select using (true);
create policy help_art_read on public.help_articles for select using (true);
create policy help_artcat_read on public.help_article_categories for select using (true);
create policy help_vote_read on public.help_article_votes for select using (true);
create policy help_comment_read on public.help_article_comments for select using (true);
create policy help_cat_write on public.help_categories for all using (true) with check (true);
create policy help_art_write on public.help_articles for all using (true) with check (true);
create policy help_artcat_write on public.help_article_categories for all using (true) with check (true);
create policy help_vote_write on public.help_article_votes for all using (true) with check (true);
create policy help_comment_write on public.help_article_comments for all using (true) with check (true);

grant all on public.help_categories to anon, authenticated;
grant all on public.help_articles to anon, authenticated;
grant all on public.help_article_categories to anon, authenticated;
grant all on public.help_article_votes to anon, authenticated;
grant all on public.help_article_comments to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function public.help_increment_view(uuid) to anon, authenticated;
grant execute on function public.help_vote(uuid, text, boolean) to anon, authenticated;

-- 9. Seed: main sections + subsections (safe re-run, slug conflicts skip)
insert into public.help_categories (slug, name, name_ar, sort_order) values
  ('getting-started','Getting Started','البدء',1),
  ('account','Account & Access','الحساب والدخول',2),
  ('watching','Watching','المشاهدة',3),
  ('iptv-help','IPTV','قنوات IPTV',4),
  ('market-help','Market','المتجر',5),
  ('prizes-help','Prizes & Points','الجوائز والنقاط',6)
on conflict (slug) do nothing;

insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'gs-register', 'Create account', 'إنشاء حساب', c.id, 1 from public.help_categories c where c.slug='getting-started' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'gs-activate', 'Activate membership', 'تفعيل العضوية', c.id, 2 from public.help_categories c where c.slug='getting-started' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'acc-profile', 'Profile & Settings', 'الملف والإعدادات', c.id, 1 from public.help_categories c where c.slug='account' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'acc-codes', 'Access codes', 'رموز الدخول', c.id, 2 from public.help_categories c where c.slug='account' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'watch-links', 'Watch links', 'روابط المشاهدة', c.id, 1 from public.help_categories c where c.slug='watching' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'watch-player', 'Player & Quality', 'المشغل والجودة', c.id, 2 from public.help_categories c where c.slug='watching' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'iptv-free', 'Free channels', 'القنوات المجانية', c.id, 1 from public.help_categories c where c.slug='iptv-help' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'iptv-premium', 'Premium channels', 'القنوات المميزة', c.id, 2 from public.help_categories c where c.slug='iptv-help' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'mkt-buy', 'Buying', 'الشراء', c.id, 1 from public.help_categories c where c.slug='market-help' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'mkt-sell', 'Selling', 'البيع', c.id, 2 from public.help_categories c where c.slug='market-help' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'prize-join', 'How to join', 'كيف تشارك', c.id, 1 from public.help_categories c where c.slug='prizes-help' on conflict (slug) do nothing;
insert into public.help_categories (slug, name, name_ar, parent_id, sort_order)
select 'prize-points', 'Points & Levels', 'النقاط والمستويات', c.id, 2 from public.help_categories c where c.slug='prizes-help' on conflict (slug) do nothing;

-- 10. Notify PostgREST
select pg_notify('pgrst', 'reload schema');
