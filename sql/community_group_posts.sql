-- CineAura — Community group posts + reports (the group page: Posts tab)
-- Run once in the Supabase SQL editor (safe to re-run), after sql/community_groups.sql.
--   community_group_posts    one text post per row inside a group (the page
--                            enforces "members post, owner moderates" before each
--                            write — permission is verified on execution, not by
--                            hiding buttons)
--   community_group_reports  one report per (group, reporter); the panel surfaces
--                            them with the other reports in a later round
-- Also stamps posts_count onto community_groups (trigger), so row cards stay cheap.

create table if not exists public.community_group_posts (
  id         bigint generated always as identity primary key,
  group_id   bigint not null references public.community_groups(id) on delete cascade,
  member_id  text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_group_reports (
  group_id    bigint not null references public.community_groups(id) on delete cascade,
  reporter_id text not null,
  note        text not null default '',
  reported_at timestamptz not null default now(),
  primary key (group_id, reporter_id)
);

alter table public.community_groups add column if not exists posts_count integer not null default 0;

create index if not exists com_grpp_group_idx on public.community_group_posts (group_id, created_at desc);
create index if not exists com_grpp_member_idx on public.community_group_posts (member_id);

create or replace function public._com_grp_posts_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.community_groups set posts_count = posts_count + 1 where id = new.group_id;
    return new;
  else
    update public.community_groups set posts_count = greatest(posts_count - 1, 0) where id = old.group_id;
    return old;
  end if;
end $$;

drop trigger if exists com_grp_posts_count on public.community_group_posts;
create trigger com_grp_posts_count
  after insert or delete on public.community_group_posts
  for each row execute function public._com_grp_posts_count();

alter table public.community_group_posts   enable row level security;
alter table public.community_group_reports enable row level security;

drop policy if exists com_grpp_read  on public.community_group_posts;
drop policy if exists com_grpp_write on public.community_group_posts;
drop policy if exists com_grpr_read  on public.community_group_reports;
drop policy if exists com_grpr_write on public.community_group_reports;

create policy com_grpp_read  on public.community_group_posts   for select using (true);
create policy com_grpp_write on public.community_group_posts   for all using (true) with check (true);
create policy com_grpr_read  on public.community_group_reports for select using (true);
create policy com_grpr_write on public.community_group_reports for all using (true) with check (true);

-- Ask PostgREST to pick up the new tables right away.
notify pgrst, 'reload schema';
