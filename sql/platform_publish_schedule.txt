-- Secure scheduler for the social publishing Edge Function.
--
-- The shared secret is generated inside Vault and is never written to this file.
-- pg_cron derives a short-lived request proof from the Vault secret; the Edge
-- Function validates it through a service_role-only RPC before touching the queue.
-- This lets the function keep verify_jwt=false without exposing an unauthenticated
-- publishing endpoint or embedding a service-role JWT in cron.job.

create extension if not exists pg_net;

-- Generate a one-time secret directly inside Vault. Keep the existing secret on
-- re-runs so scheduled requests and the Edge Function continue to agree.
do $vault_secret$
begin
  if not exists (
    select 1 from vault.secrets
    where name = 'cineaura_platform_publish_cron_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cineaura_platform_publish_cron_token',
      'Private signing key for the platform-publish scheduled Edge Function'
    );
  end if;
end
$vault_secret$;

create or replace function public.platform_publish_authorize(
  p_bucket bigint,
  p_signature text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault
as $authorize$
declare
  secret_value text;
  current_bucket bigint;
begin
  select decrypted_secret
    into secret_value
    from vault.decrypted_secrets
   where name = 'cineaura_platform_publish_cron_token'
   limit 1;

  if secret_value is null or p_bucket is null or p_signature is null then
    return false;
  end if;

  current_bucket := floor(extract(epoch from clock_timestamp()) / 300)::bigint;
  -- Accept the current and immediately previous five-minute window so a delayed
  -- pg_net delivery does not fail at a bucket boundary.
  if p_bucket < current_bucket - 1 or p_bucket > current_bucket then
    return false;
  end if;

  return lower(p_signature) = encode(
    extensions.digest(secret_value || ':' || p_bucket::text, 'sha256'),
    'hex'
  );
end
$authorize$;

revoke all on function public.platform_publish_authorize(bigint, text)
  from public, anon, authenticated;
grant execute on function public.platform_publish_authorize(bigint, text)
  to service_role;

-- Replace a previous job with the same name instead of creating duplicate runs.
do $schedule$
declare
  old_job_id bigint;
  job_command text := $job$
    with signing as (
      select
        floor(extract(epoch from clock_timestamp()) / 300)::bigint as bucket,
        decrypted_secret
      from vault.decrypted_secrets
      where name = 'cineaura_platform_publish_cron_token'
      limit 1
    )
    select net.http_post(
      url := 'https://samazxadqggoeilaqfdp.supabase.co/functions/v1/platform-publish',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cineaura-publish-bucket', signing.bucket::text,
        'x-cineaura-publish-signature', encode(
          extensions.digest(signing.decrypted_secret || ':' || signing.bucket::text, 'sha256'),
          'hex'
        )
      ),
      body := '{}'::jsonb
    )
    from signing;
  $job$;
begin
  for old_job_id in
    select jobid from cron.job where jobname = 'platform-publish-daily'
  loop
    perform cron.unschedule(old_job_id);
  end loop;

  perform cron.schedule('platform-publish-daily', '0 9 * * *', job_command);
end
$schedule$;
