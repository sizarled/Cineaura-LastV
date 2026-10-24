-- CineAura P0: INITIAL maintenance containment, before trusting legacy records.
-- Read docs/security-auth-rollout-ar.md. This intentionally stops legacy browser
-- access; it is NOT a transparent, zero-downtime upgrade and NOT auto-deployed.
-- In the SAME connection: set cineaura.allow_security_containment = 'on';
-- Run reviewed legacy schema installers BEFORE this file, never afterward.
begin;

do $$
begin
  if current_setting('cineaura.allow_security_containment', true) is distinct from 'on' then
    raise exception 'containment_requires_explicit_maintenance_window';
  end if;
  if to_regclass('cineaura_private.auth_rollout') is not null then
    if exists (select 1 from cineaura_private.auth_rollout where id and phase = 'sealed') then
      raise exception 'initial_containment_after_seal_requires_separate_incident_plan';
    end if;
  end if;
end $$;

create schema if not exists cineaura_private;
revoke all on schema cineaura_private from public, anon, authenticated;
create table if not exists cineaura_private.auth_containment (
  id boolean primary key default true check (id),
  contained_at timestamptz not null default now()
);
alter table cineaura_private.auth_containment enable row level security;
revoke all on cineaura_private.auth_containment from public, anon, authenticated;

revoke create on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Revoke column grants too. Old permissive policies cannot authorize a request
-- without a table/column privilege, even before the final replacement policies.
do $$
declare item record; col record; f record;
begin
  for item in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute format('revoke all on table public.%I from public, anon, authenticated', item.relname);
    for col in select attname from pg_attribute where attrelid = item.oid and attnum > 0 and not attisdropped loop
      execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.%2$I from public, anon, authenticated', col.attname, item.relname);
    end loop;
    execute format('grant all on table public.%I to service_role', item.relname);
  end loop;
  for f in select p.proname, pg_get_function_identity_arguments(p.oid) as arguments_sql
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.arguments_sql);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.arguments_sql);
  end loop;
end $$;
revoke all on all sequences in schema public from public, anon, authenticated;
grant all on all sequences in schema public to service_role;

-- Staff tokens may already have leaked. Revoke before preparing/linking users;
-- staff_login stays closed until the reviewed final cutover.
delete from public.staff_sessions;

-- This contains browser writes/private reads, NOT already-public file URLs or
-- previously issued signed URLs. Trusted service-role maintenance is preserved.
do $$
declare p record;
begin
  if to_regclass('storage.objects') is null then return; end if;
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('ca_block_unreviewed_insert','ca_block_unreviewed_update','ca_block_unreviewed_delete','ca_block_unreviewed_private_read') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
  execute 'create policy ca_block_unreviewed_insert on storage.objects as restrictive for insert to anon, authenticated with check (false)';
  execute 'create policy ca_block_unreviewed_update on storage.objects as restrictive for update to anon, authenticated using (false) with check (false)';
  execute 'create policy ca_block_unreviewed_delete on storage.objects as restrictive for delete to anon, authenticated using (false)';
  execute 'create policy ca_block_unreviewed_private_read on storage.objects as restrictive for select to anon, authenticated using (exists (select 1 from storage.buckets b where b.id = bucket_id and b.public))';
end $$;

insert into cineaura_private.auth_containment(id) values (true)
  on conflict (id) do update set contained_at = now();
notify pgrst, 'reload schema';
commit;
