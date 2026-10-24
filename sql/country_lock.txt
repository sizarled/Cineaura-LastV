-- CineAura: the country of an account is fixed at sign-up and can't be changed.
-- Run once in the Supabase SQL editor (safe to run again).
--
-- The country is detected from the visitor's IP address on register.html (the form no
-- longer lets anyone type or pick it). From then on:
--   * members.country can't be changed through the public API (browser keys);
--   * profiles.country always follows members.country, so editing the profile can't
--     give the account a second country.
-- Existing accounts keep the country they already have. Changes made in the Supabase
-- dashboard / SQL editor (service role, postgres) are still allowed, e.g. to fix a mistake.

create or replace function public.members_country_lock()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.country is distinct from old.country
     and current_user in ('anon', 'authenticated') then
    new.country := old.country;   -- silently keep the first country
  end if;
  return new;
end $$;

drop trigger if exists members_country_lock on public.members;
create trigger members_country_lock
  before update on public.members
  for each row execute function public.members_country_lock();

create or replace function public.profiles_country_follow_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare c text;
begin
  select m.country into c from public.members m where m.member_id = new.member_id;
  if c is not null then new.country := c; end if;
  return new;
end $$;

drop trigger if exists profiles_country_follow_member on public.profiles;
create trigger profiles_country_follow_member
  before insert or update on public.profiles
  for each row execute function public.profiles_country_follow_member();

-- bring the profiles that already differ back in line with their account
update public.profiles p
   set country = m.country
  from public.members m
 where m.member_id = p.member_id
   and m.country is not null
   and p.country is distinct from m.country;

notify pgrst, 'reload schema';
