-- CineAura — documents: VirusTotal result + the bucket each file lives in.
-- Paste AFTER sql/community_documents.sql. Idempotent.

-- Where the bytes are:
--   'documents' → the private bucket (signed links only) — used for private /
--                 exclusive documents, so a copied path is worthless
--   'source'    → the public bucket, folder Documents/ — used for public
--                 documents, as requested (…/storage/files/buckets/source?path=Documents)
alter table public.community_documents add column if not exists bucket text not null default 'documents';

-- The scan record: never a guess, always the answer VirusTotal gave.
alter table public.community_documents add column if not exists sha256      text not null default '';
alter table public.community_documents add column if not exists scan_status text not null default 'pending';
alter table public.community_documents add column if not exists scan_engine text not null default '';
alter table public.community_documents add column if not exists scan_stats  jsonb not null default '{}'::jsonb;
alter table public.community_documents add column if not exists scanned_at  timestamptz;

alter table public.community_documents drop constraint if exists community_documents_bucket_check;
alter table public.community_documents
  add constraint community_documents_bucket_check check (bucket in ('documents', 'source'));

-- clean · malicious · suspicious · unknown · pending
alter table public.community_documents drop constraint if exists community_documents_scan_check;
alter table public.community_documents
  add constraint community_documents_scan_check
  check (scan_status in ('clean', 'malicious', 'suspicious', 'unknown', 'pending'));

create index if not exists com_doc_sha_idx on public.community_documents (sha256) where sha256 <> '';

-- Only a clean file may ever be stored: the app refuses earlier, and this makes
-- a hand-made REST insert fail too.
alter table public.community_documents drop constraint if exists community_documents_clean_only;
alter table public.community_documents
  add constraint community_documents_clean_only check (scan_status = 'clean');

comment on column public.community_documents.bucket is 'documents (private, signed links) | source (public, Documents/ folder)';
comment on column public.community_documents.scan_status is 'VirusTotal verdict at upload time; the clean-only check refuses anything else';
comment on column public.community_documents.scan_stats is 'last_analysis_stats from VirusTotal (malicious / suspicious / harmless / undetected)';

notify pgrst, 'reload schema';
