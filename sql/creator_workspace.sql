-- Creator workspace: channels, blogs, community spaces and libraries.
-- Apply after the existing content/community/article/document schemas.
-- Shared workspace metadata, staff, subscribers, categories and password passes.

create table if not exists public.creator_hubs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('channel','blog','space','library')),
  owner_id text not null,
  name text not null,
  description text not null default '',
  logo_url text not null default '',
  cover_url text not null default '',
  visibility text not null default 'public' check (visibility in ('public','exclusive','private')),
  domain text not null default '',
  niche text not null default '',
  related_links jsonb not null default '[]'::jsonb,
  vip_member_ids text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creator_hubs_owner_idx on public.creator_hubs(owner_id, kind, created_at desc);
create index if not exists creator_hubs_kind_idx on public.creator_hubs(kind, visibility, created_at desc);

create table if not exists public.creator_hub_staff (
  hub_id bigint not null references public.creator_hubs(id) on delete cascade,
  member_id text not null,
  role text not null default 'manager' check (role in ('manager','editor','moderator')),
  added_at timestamptz not null default now(),
  primary key (hub_id, member_id)
);
create index if not exists creator_hub_staff_member_idx on public.creator_hub_staff(member_id, hub_id);

create table if not exists public.creator_hub_subscribers (
  hub_id bigint not null references public.creator_hubs(id) on delete cascade,
  member_id text not null,
  tier text not null default 'subscriber' check (tier in ('subscriber','vip')),
  created_at timestamptz not null default now(),
  primary key (hub_id, member_id)
);
create index if not exists creator_hub_subscribers_member_idx on public.creator_hub_subscribers(member_id, hub_id);

create table if not exists public.creator_hub_categories (
  id bigint generated always as identity primary key,
  hub_id bigint not null references public.creator_hubs(id) on delete cascade,
  parent_id bigint references public.creator_hub_categories(id) on delete set null,
  name text not null,
  depth smallint not null default 1 check (depth between 1 and 3),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (hub_id, parent_id, name)
);
create index if not exists creator_hub_categories_hub_idx on public.creator_hub_categories(hub_id, depth, sort_order);

create table if not exists public.creator_hub_items (
  hub_id bigint not null references public.creator_hubs(id) on delete cascade,
  category_id bigint references public.creator_hub_categories(id) on delete set null,
  content_type text not null check (content_type in ('video','podcast','playlist','article','question','answer','book','document')),
  content_id text not null,
  title text not null default '',
  thumb_url text not null default '',
  href text not null default '',
  visibility text not null default 'public' check (visibility in ('public','exclusive','private')),
  minutes_viewed bigint not null default 0,
  shares bigint not null default 0,
  reports bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (hub_id, content_type, content_id)
);
create index if not exists creator_hub_items_hub_idx on public.creator_hub_items(hub_id, content_type, created_at desc);
create index if not exists creator_hub_items_content_idx on public.creator_hub_items(content_type, content_id);

create table if not exists public.creator_hub_passes (
  id bigint generated always as identity primary key,
  hub_id bigint not null references public.creator_hubs(id) on delete cascade,
  password_hash text not null,
  allowed_member_ids text[] not null default '{}',
  expires_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index if not exists creator_hub_passes_hub_expiry_idx on public.creator_hub_passes(hub_id, expires_at);

create or replace function public.creator_hub_can_view(p_hub bigint, p_member text default '', p_password_hash text default '')
returns boolean language plpgsql stable security definer set search_path = public as $$
declare h public.creator_hubs;
begin
  select * into h from public.creator_hubs where id = p_hub;
  if not found then return false; end if;
  if h.visibility = 'public' then return true; end if;
  if btrim(coalesce(p_member, '')) <> '' and (h.owner_id = p_member or p_member = any(h.vip_member_ids)
     or exists (select 1 from public.creator_hub_staff s where s.hub_id = h.id and s.member_id = p_member)) then return true; end if;
  if h.visibility = 'exclusive' then
    return exists (select 1 from public.creator_hub_subscribers s where s.hub_id = h.id and s.member_id = p_member);
  end if;
  return btrim(coalesce(p_password_hash, '')) <> '' and exists (
    select 1 from public.creator_hub_passes p where p.hub_id = h.id and p.password_hash = p_password_hash
      and p.expires_at > now() and (cardinality(p.allowed_member_ids) = 0 or p_member = any(p.allowed_member_ids))
  );
end $$;
grant execute on function public.creator_hub_can_view(bigint, text, text) to anon, authenticated;

create or replace function public._creator_hub_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists creator_hubs_touch on public.creator_hubs;
create trigger creator_hubs_touch before update on public.creator_hubs for each row execute function public._creator_hub_touch();

alter table public.creator_hubs enable row level security;
alter table public.creator_hub_staff enable row level security;
alter table public.creator_hub_subscribers enable row level security;
alter table public.creator_hub_categories enable row level security;
alter table public.creator_hub_items enable row level security;
alter table public.creator_hub_passes enable row level security;

drop policy if exists creator_hubs_access on public.creator_hubs;
create policy creator_hubs_access on public.creator_hubs for all to anon, authenticated using (true) with check (true);
drop policy if exists creator_hub_staff_access on public.creator_hub_staff;
create policy creator_hub_staff_access on public.creator_hub_staff for all to anon, authenticated using (true) with check (true);
drop policy if exists creator_hub_subscribers_access on public.creator_hub_subscribers;
create policy creator_hub_subscribers_access on public.creator_hub_subscribers for all to anon, authenticated using (true) with check (true);
drop policy if exists creator_hub_categories_access on public.creator_hub_categories;
create policy creator_hub_categories_access on public.creator_hub_categories for all to anon, authenticated using (true) with check (true);
drop policy if exists creator_hub_items_access on public.creator_hub_items;
create policy creator_hub_items_access on public.creator_hub_items for all to anon, authenticated using (true) with check (true);
drop policy if exists creator_hub_passes_access on public.creator_hub_passes;
create policy creator_hub_passes_access on public.creator_hub_passes for insert to anon, authenticated with check (true);

grant select, insert, update, delete on public.creator_hubs, public.creator_hub_staff, public.creator_hub_subscribers,
  public.creator_hub_categories, public.creator_hub_items to anon, authenticated;
grant insert on public.creator_hub_passes to anon, authenticated;
grant usage, select on sequence public.creator_hubs_id_seq, public.creator_hub_categories_id_seq, public.creator_hub_passes_id_seq to anon, authenticated;
notify pgrst, 'reload schema';
