-- ── Member video uploads (Streamtape) ──────────────────────────────────────
-- The site hosts its videos on Streamtape. Every member gets their own folder
-- there (Users/{member_id}) with five fixed subfolders: Market, Movies, TV,
-- Videos, Posts. This table registers every upload the site knows: who sent
-- it, which folder, its Streamtape file id, and the page it belongs to. The
-- folder rules the Streamtape API cannot say — a film or an episode at one
-- quality only once site-wide, the ascending ordinals of a product's videos —
-- are unique rows here.
--
-- Run this whole file in the Supabase SQL editor (it is idempotent).

create table if not exists public.media_uploads (
  id bigint generated always as identity primary key,
  owner_id text not null,
  owner_username text not null default '',
  folder text not null check (folder in ('market','movies','tv','videos','posts')),
  name text not null default '',            -- the folder's own name, e.g. "TV - 1396 - S1 - Ep353 - SD"
  file_id text not null,                    -- the Streamtape file id (the /v/-/e/ urls come from it)
  page_url text not null default '',
  embed_url text not null default '',
  quality text not null default '',         -- movies/tv: the picked quality
  tmdb_id integer,                          -- movies/tv: the title
  season integer,                           -- tv only
  episode integer,                          -- tv only
  ref_id text not null default '',          -- market: product id · posts: post id · videos: content id
  ordinal integer,                          -- market: 0,1,2… per product
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.media_uploads is 'Registry of the member video uploads on Streamtape (Market/Movies/TV/Videos/Posts folders)';

create unique index if not exists media_uploads_file_unique on public.media_uploads (file_id);
create unique index if not exists media_uploads_owner_name_unique on public.media_uploads (owner_id, folder, name);
create index if not exists media_uploads_owner_idx on public.media_uploads (owner_id, created_at desc);
create index if not exists media_uploads_ref_idx on public.media_uploads (folder, ref_id);

-- one quality of one film — once for the whole site
create unique index if not exists media_uploads_movie_unique
  on public.media_uploads (tmdb_id, lower(quality)) where folder = 'movies';

-- one quality of one episode — once for the whole site
create unique index if not exists media_uploads_tv_unique
  on public.media_uploads (tmdb_id, season, episode, lower(quality)) where folder = 'tv';

-- the videos of one product ascend without gaps or collisions
create unique index if not exists media_uploads_market_ord_unique
  on public.media_uploads (ref_id, ordinal) where folder = 'market' and ref_id <> '';

-- the video's own picture, matched from Home/Thumbnails by the same name
alter table public.media_uploads add column if not exists thumb_url text not null default '';
alter table public.media_uploads add column if not exists thumb_file_id text not null default '';
comment on column public.media_uploads.thumb_url is 'Thumbnail image of the video, matched from the Home/Thumbnails Streamtape folder by the same file name';

alter table public.media_uploads enable row level security;
drop policy if exists "MediaUploads select" on public.media_uploads;
create policy "MediaUploads select" on public.media_uploads for select to anon, authenticated using (true);
drop policy if exists "MediaUploads insert" on public.media_uploads;
create policy "MediaUploads insert" on public.media_uploads for insert to anon, authenticated with check (true);
drop policy if exists "MediaUploads delete" on public.media_uploads;
create policy "MediaUploads delete" on public.media_uploads for delete to anon, authenticated using (true);

-- A profile post may carry one uploaded video (Posts folder on Streamtape;
-- named "Post - {postId}"). The feed frames its embed player.
alter table public.posts add column if not exists video_url text not null default '';
comment on column public.posts.video_url is 'The uploaded video of the post (Streamtape page url), empty for posts without one';
