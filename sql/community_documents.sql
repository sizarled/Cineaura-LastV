-- CineAura Officiel V2 — Documents (the fifth content type).
-- Paste this file in Supabase → SQL Editor AFTER sql/community.sql,
-- sql/community_groups.sql and sql/community_group_posts.sql.
-- It is idempotent: running it twice changes nothing.

-- 1) The private bucket that holds the files themselves.
--    Private on purpose: a document is never reachable through a public URL.
--    The site asks for a short-lived signed link each time somebody downloads
--    or previews a document, so a leaked path stops working within a minute.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- 2) Metadata: one row per document, keyed by its storage path.
create table if not exists public.community_documents (
  id           bigint generated always as identity primary key,
  member_id    text not null,
  title        text not null,
  description  text not null default '',
  tags         text not null default '',
  -- pdf | word | sheet | slides | database | other  (the UI groups by these)
  kind         text not null default 'other',
  ext          text not null default '',
  mime         text not null default '',
  size_bytes   bigint not null default 0,
  storage_path text not null unique,
  visibility   text not null default 'public',
  views        integer not null default 0,
  downloads    integer not null default 0,
  likes        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint community_documents_kind_check
    check (kind in ('pdf', 'word', 'sheet', 'slides', 'database', 'other')),
  constraint community_documents_vis_check
    check (visibility in ('public', 'exclusive', 'private'))
);

create index if not exists com_doc_new_idx    on public.community_documents (created_at desc);
create index if not exists com_doc_member_idx on public.community_documents (member_id);
create index if not exists com_doc_kind_idx   on public.community_documents (kind);
create index if not exists com_doc_title_idx  on public.community_documents (lower(title));

-- 3) Reports: a member flags a file; the Panel reviews them.
create table if not exists public.community_document_reports (
  id          bigint generated always as identity primary key,
  document_id bigint not null references public.community_documents(id) on delete cascade,
  member_id   text not null,
  reason      text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists com_docrep_doc_idx on public.community_document_reports (document_id);

-- 4) Likes: one row per member, so a second click can be undone exactly.
create table if not exists public.community_document_likes (
  document_id bigint not null references public.community_documents(id) on delete cascade,
  member_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (document_id, member_id)
);

create index if not exists com_doclike_member_idx on public.community_document_likes (member_id);

-- 5) Counters stay in step with the likes table.
create or replace function public._com_doc_likes_count() returns trigger
language plpgsql as $$
begin
  update public.community_documents d
     set likes = (select count(*) from public.community_document_likes l where l.document_id = d.id)
   where d.id = coalesce(new.document_id, old.document_id);
  return null;
end;
$$;

drop trigger if exists com_doc_likes_count on public.community_document_likes;
create trigger com_doc_likes_count
  after insert or delete on public.community_document_likes
  for each row execute function public._com_doc_likes_count();

-- 6) Access policies.
--    House convention: the tables are readable/writable for the demo token and
--    the real checks (ownership, membership, private documents) run in the app
--    at execution time. Tighten these to auth.uid()-based policies when the
--    project moves to per-member tokens.
alter table public.community_documents        enable row level security;
alter table public.community_document_reports enable row level security;
alter table public.community_document_likes   enable row level security;

drop policy if exists com_doc_read   on public.community_documents;
drop policy if exists com_doc_write  on public.community_documents;
drop policy if exists com_docrep_read  on public.community_document_reports;
drop policy if exists com_docrep_write on public.community_document_reports;
drop policy if exists com_doclike_read  on public.community_document_likes;
drop policy if exists com_doclike_write on public.community_document_likes;

create policy com_doc_read   on public.community_documents        for select using (true);
create policy com_doc_write  on public.community_documents        for all    using (true) with check (true);
create policy com_docrep_read  on public.community_document_reports for select using (true);
create policy com_docrep_write on public.community_document_reports for all    using (true) with check (true);
create policy com_doclike_read  on public.community_document_likes   for select using (true);
create policy com_doclike_write on public.community_document_likes   for all    using (true) with check (true);

-- 7) Storage policies for the private `documents` bucket.
--    Also permissive for the demo token; the app only ever signs a link after
--    it has checked that the caller may see that document.
drop policy if exists com_doc_obj_read   on storage.objects;
drop policy if exists com_doc_obj_write  on storage.objects;
drop policy if exists com_doc_obj_update on storage.objects;
drop policy if exists com_doc_obj_delete on storage.objects;

create policy com_doc_obj_read   on storage.objects for select using (bucket_id = 'documents');
create policy com_doc_obj_write  on storage.objects for insert with check (bucket_id = 'documents');
create policy com_doc_obj_update on storage.objects for update using (bucket_id = 'documents') with check (bucket_id = 'documents');
create policy com_doc_obj_delete on storage.objects for delete using (bucket_id = 'documents');

-- 8) Ask PostgREST to pick up the new tables right away.
notify pgrst, 'reload schema';

-- 9) Counters: one atomic bump per view / download. Called as
--    /rest/v1/rpc/doc_bump with { p_id, p_col }. The column is whitelisted, so
--    a crafted call cannot write any other field.
create or replace function public.doc_bump(p_id bigint, p_col text) returns void
language plpgsql as $$
begin
  if p_col = 'views' then
    update public.community_documents set views = views + 1 where id = p_id;
  elsif p_col = 'downloads' then
    update public.community_documents set downloads = downloads + 1 where id = p_id;
  end if;
end;
$$;

grant execute on function public.doc_bump(bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
