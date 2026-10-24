-- CineAura — cover & inline pictures of help articles
-- Run once in the Supabase SQL editor (safe to re-run), after sql/help.sql and
-- sql/image_uploads.sql (this builds on its upload-ticket system).
--
-- Article.html uploads the pictures picked on the device to
--   source/Articles/<article slug>.jpg            (the cover)
--   source/Articles/<article slug>-<suffix>.jpg   (inline / gallery / paste / drop)
-- The browser resizes them to JPEG first (CineAura.fitPicture), then uploads with
-- the public key + x-upsert. Storage only accepts files that have an upload
-- ticket, so the staff member asks for one per file name through help_upload
-- below (any staff session, cf. js/panel.js session token). Tickets live in
-- public.upload_tickets and expire after 15 minutes (sql/image_uploads.sql).
--
-- 1. article cover column --------------------------------------------------
alter table public.help_articles add column if not exists image text not null default '';
comment on column public.help_articles.image is 'Cover picture link of the article (cards + article page header); empty = first content image';

-- 2. upload tickets ---------------------------------------------------------
-- -> { ok: true, paths: [...] } | { ok: false, error: slug | names | unauthorized }
create or replace function public.help_upload(p_token text, p_slug text, p_names text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public.staff; nm text; paths text[] := '{}';
begin
  -- any staff member with a valid Panel session may illustrate articles
  begin
    s := public._staff(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end;
  if coalesce(p_slug, '') !~ '^[a-z0-9][a-z0-9\u0600-\u06FF-]{0,79}$' then
    return jsonb_build_object('ok', false, 'error', 'slug');
  end if;
  if p_names is null or cardinality(p_names) = 0 or cardinality(p_names) > 40 then
    return jsonb_build_object('ok', false, 'error', 'names');
  end if;
  foreach nm in array p_names loop
    -- the cover itself, or <slug>-<letters/digits, 2‑24 chars>
    if nm is null or (nm <> p_slug and nm !~ ('^' || p_slug || '-[a-z0-9]{2,24}$')) then
      return jsonb_build_object('ok', false, 'error', 'names');
    end if;
    perform public._upload_ticket('Articles/' || nm || '.jpg', '', s.id);
    paths := paths || ('Articles/' || nm || '.jpg');
  end loop;
  return jsonb_build_object('ok', true, 'paths', to_jsonb(paths));
end $$;

comment on function public.help_upload(text, text, text[]) is
  'Storage upload tickets for help-article pictures: source/Articles/<slug>[-suffix].jpg (staff only)';

revoke all on function public.help_upload(text, text, text[]) from public;
grant execute on function public.help_upload(text, text, text[]) to anon, authenticated;

-- Ask PostgREST to pick up the new function right away.
notify pgrst, 'reload schema';
