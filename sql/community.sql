-- CineAura — Community hub (Articles + Questions & Answers)
-- Run once in the Supabase SQL editor (safe to re-run). Delivers the tables,
-- the row-level policies and the counter triggers of the new Community section:
--   community_questions            a member's question (the hub lists newest first)
--   community_answers              an answer under a question (sorted by votes)
--   community_answer_votes         one "helpful" per member per answer (toggles)
--   community_articles             a member-written article (title, body, tags)
-- Counters (answers_count per question, votes per answer) move with triggers so
-- the page can read them straight from the rows — no client-side arithmetic.
-- Public read for everybody (like the help center); app-level checks keep the
-- member id honest, exactly like the posts and help tables already do.

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.community_questions (
  id            bigint generated always as identity primary key,
  member_id     text not null,
  title         text not null,
  details       text not null default '',
  answers_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.community_answers (
  id          bigint generated always as identity primary key,
  question_id bigint not null references public.community_questions(id) on delete cascade,
  member_id   text not null,
  body        text not null,
  votes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.community_answer_votes (
  answer_id  bigint not null references public.community_answers(id) on delete cascade,
  member_id  text not null,
  created_at timestamptz not null default now(),
  primary key (answer_id, member_id)
);

create table if not exists public.community_articles (
  id         bigint generated always as identity primary key,
  member_id  text not null,
  title      text not null,
  body       text not null default '',
  tags       text not null default '',
  views      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists com_q_new_idx      on public.community_questions (created_at desc);
create index if not exists com_q_member_idx   on public.community_questions (member_id);
create index if not exists com_a_question_idx on public.community_answers (question_id, votes desc);
create index if not exists com_a_member_idx   on public.community_answers (member_id);
create index if not exists com_art_new_idx    on public.community_articles (created_at desc);
create index if not exists com_art_member_idx on public.community_articles (member_id);

-- ─────────────────── counter triggers ───────────────────
create or replace function public._com_answers_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.community_questions set answers_count = answers_count + 1 where id = new.question_id;
    return new;
  else
    update public.community_questions set answers_count = greatest(answers_count - 1, 0) where id = old.question_id;
    return old;
  end if;
end $$;

drop trigger if exists com_answers_count on public.community_answers;
create trigger com_answers_count
  after insert or delete on public.community_answers
  for each row execute function public._com_answers_count();

create or replace function public._com_answer_votes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.community_answers set votes = votes + 1 where id = new.answer_id;
    return new;
  else
    update public.community_answers set votes = greatest(votes - 1, 0) where id = old.answer_id;
    return old;
  end if;
end $$;

drop trigger if exists com_answer_votes on public.community_answer_votes;
create trigger com_answer_votes
  after insert or delete on public.community_answer_votes
  for each row execute function public._com_answer_votes();

-- ─────────────── row level security (public read) ───────────────
alter table public.community_questions    enable row level security;
alter table public.community_answers      enable row level security;
alter table public.community_answer_votes enable row level security;
alter table public.community_articles     enable row level security;

drop policy if exists com_q_read      on public.community_questions;
drop policy if exists com_q_write     on public.community_questions;
drop policy if exists com_a_read      on public.community_answers;
drop policy if exists com_a_write     on public.community_answers;
drop policy if exists com_vote_read   on public.community_answer_votes;
drop policy if exists com_vote_write  on public.community_answer_votes;
drop policy if exists com_art_read    on public.community_articles;
drop policy if exists com_art_write   on public.community_articles;

create policy com_q_read      on public.community_questions    for select using (true);
create policy com_q_write     on public.community_questions    for all using (true) with check (true);
create policy com_a_read      on public.community_answers      for select using (true);
create policy com_a_write     on public.community_answers      for all using (true) with check (true);
create policy com_vote_read   on public.community_answer_votes for select using (true);
create policy com_vote_write  on public.community_answer_votes for all using (true) with check (true);
create policy com_art_read    on public.community_articles     for select using (true);
create policy com_art_write   on public.community_articles     for all using (true) with check (true);

-- Ask PostgREST to pick up the new tables right away.
notify pgrst, 'reload schema';
