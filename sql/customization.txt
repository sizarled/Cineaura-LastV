-- CineAura — Member customization (layout/template, style/colors, icons)
-- Run in Supabase SQL editor. Idempotent.

-- 1) Buckets: create public bucket "source" if missing (holds Themes/...)
insert into storage.buckets (id, name, public)
values ('source','source', true)
on conflict (id) do nothing;

-- 2) Tables for metadata (optional but handy for listing/search). Files themselves live in storage.
create table if not exists public.member_layouts (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  name text not null, -- template name, e.g. "my-netflix"
  pages jsonb not null default '{}'::jsonb, -- { home:[...ids], watch:[...], content:[...], market:[...], dashboard:[...], profile:[...] }
  shortcuts jsonb not null default '{}'::jsonb, -- { dashboard_in_profile:[...], profile_in_dashboard:[...] }
  pins jsonb not null default '[]'::jsonb, -- [tmdb_ids]
  preset text, -- which base preset it was derived from: default/facebook/...
  file_url text, -- storage path e.g. source/Themes/Template/{member_id}/my.json
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_layouts_member_idx on public.member_layouts(member_id);

create table if not exists public.member_styles (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  name text not null,
  colors jsonb not null default '{}'::jsonb, -- { primary, secondary, accent, bg, text, muted, surface... }
  css_text text, -- generated CSS
  preset text,
  file_url text, -- source/Themes/Style/{member_id}/name.css or .json
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_styles_member_idx on public.member_styles(member_id);

create table if not exists public.member_icons (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  name text not null,
  icon_key text not null, -- which nav/icon slot it replaces, e.g. "nav.home" / "logo"
  file_url text not null, -- source/Themes/Icons/{member_id}/file.svg
  mime text,
  created_at timestamptz not null default now()
);
create index if not exists member_icons_member_idx on public.member_icons(member_id);

-- 3) RLS
alter table public.member_layouts enable row level security;
alter table public.member_styles enable row level security;
alter table public.member_icons enable row level security;

drop policy if exists "member_layouts owner" on public.member_layouts;
create policy "member_layouts owner" on public.member_layouts
  for all using (true) with check (true); -- tighten in prod: auth.uid() = member_id

drop policy if exists "member_styles owner" on public.member_styles;
create policy "member_styles owner" on public.member_styles
  for all using (true) with check (true);

drop policy if exists "member_icons owner" on public.member_icons;
create policy "member_icons owner" on public.member_icons
  for all using (true) with check (true);

-- 4) Profiles extensions (cache active choices for fast boot without joining)
do $$
begin
  if not exists(select 1 from information_schema.columns where table_name='profiles' and column_name='active_layout_id') then
    alter table public.profiles add column active_layout_id uuid references public.member_layouts(id) on delete set null;
  end if;
  if not exists(select 1 from information_schema.columns where table_name='profiles' and column_name='active_style_id') then
    alter table public.profiles add column active_style_id uuid references public.member_styles(id) on delete set null;
  end if;
  if not exists(select 1 from information_schema.columns where table_name='profiles' and column_name='layout_config') then
    alter table public.profiles add column layout_config jsonb not null default '{}'::jsonb;
  end if;
  if not exists(select 1 from information_schema.columns where table_name='profiles' and column_name='custom_css_url') then
    alter table public.profiles add column custom_css_url text;
  end if;
end $$;

-- 5) Storage RLS (public bucket, but per-member folders)
-- Allow anyone to read (public bucket), authenticated to write to own folder.
-- Supabase storage.objects has RLS; we create permissive policies for demo.
do $$
begin
  -- enable RLS is already enabled on storage.objects
  -- create read policy
  if not exists(select 1 from pg_policies where policyname='source public read' and tablename='objects' and schemaname='storage') then
    create policy "source public read" on storage.objects for select using (bucket_id='source');
  end if;
  if not exists(select 1 from pg_policies where policyname='source member write' and tablename='objects' and schemaname='storage') then
    create policy "source member write" on storage.objects for all using (bucket_id='source') with check (bucket_id='source');
  end if;
end $$;

comment on table public.member_layouts is 'Per-member page section ordering, shortcuts and homepage pins; files mirrored in storage source/Themes/Template/{member_id}/';
comment on table public.member_styles is 'Per-member custom colors/CSS; files mirrored in source/Themes/Style/{member_id}/';
comment on table public.member_icons is 'Per-member custom icons; files in source/Themes/Icons/{member_id}/ (folder auto-created per member)';

-- Example: seed a default profile if needed
-- Note: App also falls back to localStorage cineaura_layout_* when offline.

