-- CineAura — question and answer attachments.
-- Run after sql/community.sql. Public Q&A attachments live in a dedicated
-- public bucket so images/video can preview and other files can be downloaded.
-- The client accepts any MIME type, up to 5 files per post, 50 MiB per file.

alter table public.community_questions
  add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.community_answers
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.community_questions
  drop constraint if exists community_questions_attachments_array_check;
alter table public.community_questions
  add constraint community_questions_attachments_array_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5);

alter table public.community_answers
  drop constraint if exists community_answers_attachments_array_check;
alter table public.community_answers
  add constraint community_answers_attachments_array_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-attachments', 'community-attachments', true, 52428800, null)
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object names are random and extensionless: MIME metadata is set from the
-- uploaded file, while names in the database are only display labels.
drop policy if exists com_qa_attach_insert on storage.objects;
drop policy if exists com_qa_attach_delete on storage.objects;
create policy com_qa_attach_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'community-attachments'
    and name ~ '^(questions|answers)/[0-9a-f]{32}$'
  );
create policy com_qa_attach_delete on storage.objects
  for delete to anon, authenticated
  using (
    bucket_id = 'community-attachments'
    and name ~ '^(questions|answers)/[0-9a-f]{32}$'
  );

comment on column public.community_questions.attachments is
  'JSON array of public Community question attachments: name, path, mime, size.';
comment on column public.community_answers.attachments is
  'JSON array of public Community answer attachments: name, path, mime, size.';

notify pgrst, 'reload schema';
