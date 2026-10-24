-- Podcast audio and e-book support for Creator Workspace.
-- Apply after sql/creator_workspace.sql and the community document schema.
-- Audio objects use a dedicated bucket; e-books continue using the existing document buckets.

alter table public.creator_hub_items add column if not exists description text not null default '';
alter table public.creator_hub_items add column if not exists file_path text not null default '';
alter table public.creator_hub_items add column if not exists file_name text not null default '';
alter table public.creator_hub_items add column if not exists file_mime text not null default '';
alter table public.creator_hub_items add column if not exists duration_seconds integer not null default 0;

alter table public.community_documents add column if not exists thumb_url text not null default '';
alter table public.community_documents drop constraint if exists community_documents_kind_check;
alter table public.community_documents add constraint community_documents_kind_check
  check (kind in ('pdf', 'word', 'sheet', 'slides', 'database', 'other', 'book'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('creator-media', 'creator-media', false, 262144000)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists creator_media_read on storage.objects;
drop policy if exists creator_media_write on storage.objects;
drop policy if exists creator_media_update on storage.objects;
drop policy if exists creator_media_delete on storage.objects;
create policy creator_media_read on storage.objects for select to anon, authenticated using (bucket_id = 'creator-media');
create policy creator_media_write on storage.objects for insert to anon, authenticated with check (bucket_id = 'creator-media');
create policy creator_media_update on storage.objects for update to anon, authenticated using (bucket_id = 'creator-media') with check (bucket_id = 'creator-media');
create policy creator_media_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'creator-media');
notify pgrst, 'reload schema';
