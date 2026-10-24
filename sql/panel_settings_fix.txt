-- CineAura: fix "Show the Panel button on the dashboard for these roles" (Panel > Settings)
-- Run once in the Supabase SQL editor (safe to run again).
--
-- Why saving failed: panel_settings_save() ran an UPDATE with no WHERE clause, which the
-- Supabase API role refuses (pg-safeupdate), so nothing was ever saved and the old values
-- (e.g. Members = on) stayed in place. This file repairs the table and the function, and
-- switches the button off for members right away.

alter table public.panel_settings add column if not exists id integer;
alter table public.panel_settings add column if not exists show_admin boolean not null default true;
alter table public.panel_settings add column if not exists show_moderator boolean not null default true;
alter table public.panel_settings add column if not exists show_member boolean not null default false;

-- one row only, with id = 1
delete from public.panel_settings where ctid not in (select min(ctid) from public.panel_settings);
update public.panel_settings set id = 1 where true;
create unique index if not exists panel_settings_id_uniq on public.panel_settings (id);
insert into public.panel_settings (id, show_admin, show_moderator, show_member)
select 1, true, true, false where not exists (select 1 from public.panel_settings);

-- the Panel button is hidden from members now (change it later in Panel > Settings)
update public.panel_settings set show_member = false where true;

create or replace function public.panel_settings_save(p_token text, p_show_admin boolean, p_show_moderator boolean,
  p_show_member boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.staff; r record;
begin
  s := public._staff(p_token);
  if s.role <> 'super' then raise exception 'staff_forbidden'; end if;
  update public.panel_settings
     set show_admin = coalesce(p_show_admin, true), show_moderator = coalesce(p_show_moderator, true),
         show_member = coalesce(p_show_member, false)
   where true; -- Supabase's API role refuses an UPDATE without WHERE (pg-safeupdate)
  if not found then
    begin
      insert into public.panel_settings (id, show_admin, show_moderator, show_member)
      values (1, coalesce(p_show_admin, true), coalesce(p_show_moderator, true), coalesce(p_show_member, false));
    exception when others then
      insert into public.panel_settings (show_admin, show_moderator, show_member)
      values (coalesce(p_show_admin, true), coalesce(p_show_moderator, true), coalesce(p_show_member, false));
    end;
  end if;
  select show_admin, show_moderator, show_member into r from public.panel_settings limit 1;
  return jsonb_build_object('ok', true, 'settings', jsonb_build_object('show_admin', r.show_admin,
    'show_moderator', r.show_moderator, 'show_member', r.show_member));
end $$;


revoke all on function public.panel_settings_save(text, boolean, boolean, boolean) from public;
grant execute on function public.panel_settings_save(text, boolean, boolean, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- check: should show show_member = false
select * from public.panel_settings;
