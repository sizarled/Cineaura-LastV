-- Profile post interactions: agreement is separate from recommend / don't recommend;
-- comments can be classified and filtered by positive or negative sentiment.
-- Run after sql/profile.sql and sql/post_reach.sql. Safe to re-run.
alter table public.post_votes alter column vote drop not null;
alter table public.post_votes add column if not exists agreement text;
alter table public.post_votes drop constraint if exists post_votes_vote_check;
alter table public.post_votes drop constraint if exists post_votes_agreement_check;
alter table public.post_votes add constraint post_votes_vote_check
  check (vote is null or vote in ('up', 'down'));
alter table public.post_votes add constraint post_votes_agreement_check
  check (agreement is null or agreement in ('agree', 'disagree'));
alter table public.post_votes drop constraint if exists post_votes_has_interaction_check;
alter table public.post_votes add constraint post_votes_has_interaction_check
  check (vote is not null or agreement is not null);

alter table public.post_comments add column if not exists sentiment text not null default 'neutral';
alter table public.post_comments drop constraint if exists post_comments_sentiment_check;
alter table public.post_comments add constraint post_comments_sentiment_check
  check (sentiment in ('positive', 'negative', 'neutral'));

notify pgrst, 'reload schema';
