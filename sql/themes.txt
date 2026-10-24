-- Appearance themes: per-user saved style (14 presets)
-- Run once in Supabase SQL editor.
-- Safe to re-run: column added only if missing.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='style'
  ) then
    alter table public.profiles add column style text not null default 'default'
      check (style in ('default','facebook','youtube','instagram','netflix','prime','appletv','win7','win8','win10','win11','macos','android','ios'));
  end if;
end $$;

-- Backfill existing rows (default already set)
-- No RLS changes needed; profiles RLS already allows owner to read/write own row.

comment on column public.profiles.style is 'Appearance preset: default glass + fb/yt/ig/netflix/prime/atv/win7/8/10/11/macos/android/ios';
