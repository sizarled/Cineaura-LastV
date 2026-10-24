-- CineAura post reports
-- Members flag posts (spam / abuse / misleading / other) from the post card's
-- report button (js/profile.js). One report per post per member. Valid reports
-- weigh −60 points each on the post's search rank (see _search_rank in
-- sql/search.sql). Run once in the Supabase SQL editor (safe to re-run).

create table if not exists public.post_reports (
  id bigint generated always as identity primary key,
  post_id text not null,
  owner_id text not null default '',
  owner_username text not null default '',
  reporter_id text not null default '',
  reporter_username text not null default '',
  subject text not null,
  note text not null default '',
  verdict text not null default 'valid',
  reported_at timestamptz not null default now(),
  constraint post_reports_subject_check check (subject in ('spam', 'abuse', 'misleading', 'other')),
  constraint post_reports_verdict_check check (verdict in ('valid', 'ended'))
);

comment on table public.post_reports is 'Member reports against profile posts; one report per post per member';
comment on column public.post_reports.verdict is 'valid on create; ended when closed by staff';
comment on column public.post_reports.subject is 'spam | abuse | misleading | other';

create unique index if not exists post_reports_pair on public.post_reports (post_id, reporter_id);
create index if not exists post_reports_post_idx on public.post_reports (post_id, verdict);
create index if not exists post_reports_owner_idx on public.post_reports (owner_id, reported_at desc);
create index if not exists post_reports_reporter_idx on public.post_reports (reporter_id, reported_at desc);

alter table public.post_reports enable row level security;

drop policy if exists "post_reports select" on public.post_reports;
create policy "post_reports select" on public.post_reports for select to anon, authenticated using (true);
drop policy if exists "post_reports insert" on public.post_reports;
create policy "post_reports insert" on public.post_reports for insert to anon, authenticated with check (true);
drop policy if exists "post_reports update" on public.post_reports;
create policy "post_reports update" on public.post_reports for update to anon, authenticated using (true) with check (true);
drop policy if exists "post_reports delete" on public.post_reports;
create policy "post_reports delete" on public.post_reports for delete to anon, authenticated using (true);

-- Ask PostgREST to pick up the new table right away.
notify pgrst, 'reload schema';
