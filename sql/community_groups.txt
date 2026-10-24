-- CineAura — Community groups (Discover / My Groups / Create Group)
-- Run once in the Supabase SQL editor (safe to re-run), after sql/community.sql.
--   community_groups         a group card: owner, name, description, rules, cover,
--                            public flag and a members_count kept by trigger
--   community_group_members  one row per joined member (the owner is seated at
--                            creation by the page, role 'owner'); one row per
--                            (group, member) so Join/Leave is a clean toggle
-- Public read for everybody (house style, like the community articles tables);
-- the Discover tab lists public groups only, My Groups is membership-based.

create table if not exists public.community_groups (
  id            bigint generated always as identity primary key,
  owner_id      text not null,
  name          text not null,
  description   text not null default '',
  rules         text not null default '',
  cover         text not null default '',
  is_public     boolean not null default true,
  members_count integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.community_group_members (
  group_id   bigint not null references public.community_groups(id) on delete cascade,
  member_id  text not null,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (group_id, member_id)
);

create index if not exists com_grp_new_idx    on public.community_groups (created_at desc);
create index if not exists com_grp_owner_idx  on public.community_groups (owner_id);
create index if not exists com_grpm_member_idx on public.community_group_members (member_id);

create or replace function public._com_grp_members_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.community_groups set members_count = members_count + 1 where id = new.group_id;
    return new;
  else
    update public.community_groups set members_count = greatest(members_count - 1, 0) where id = old.group_id;
    return old;
  end if;
end $$;

drop trigger if exists com_grp_members_count on public.community_group_members;
create trigger com_grp_members_count
  after insert or delete on public.community_group_members
  for each row execute function public._com_grp_members_count();

alter table public.community_groups        enable row level security;
alter table public.community_group_members enable row level security;

drop policy if exists com_grp_read   on public.community_groups;
drop policy if exists com_grp_write  on public.community_groups;
drop policy if exists com_grpm_read  on public.community_group_members;
drop policy if exists com_grpm_write on public.community_group_members;

create policy com_grp_read   on public.community_groups        for select using (true);
create policy com_grp_write  on public.community_groups        for all using (true) with check (true);
create policy com_grpm_read  on public.community_group_members for select using (true);
create policy com_grpm_write on public.community_group_members for all using (true) with check (true);

-- Ask PostgREST to pick up the new tables right away.
notify pgrst, 'reload schema';
