-- Each member's card: a short bio, up to three masteries with a level, and the
-- hours of the week they are usually free to play. Members edit their own.
-- Run after 0002_signin_name_case.sql. Safe to re-run.

alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists masteries jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists availability integer[];

-- A list of at most three {"skill": ..., "level": 0-5}, no skill twice.
create or replace function public.valid_masteries(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(m) is distinct from 'array' then false
  else jsonb_array_length(m) <= 3
    and not exists (
      select 1 from jsonb_array_elements(m) e
      where jsonb_typeof(e) <> 'object'
         or (select count(*) from jsonb_object_keys(e)) <> 2
         or jsonb_typeof(e -> 'skill') is distinct from 'string'
         or jsonb_typeof(e -> 'level') is distinct from 'number'
         or (e ->> 'skill') not in ('one_handed', 'two_handed', 'dual_wielder', 'armor', 'shield', 'cook', 'alchemist',
              'blacksmith', 'woodcutter', 'tailor', 'scholar', 'miner', 'first_aid', 'lockpicking', 'skinner',
              'harvester', 'artifact_scavenger')
         or (e ->> 'level') not in ('0', '1', '2', '3', '4', '5'))
    and (select count(distinct e ->> 'skill') from jsonb_array_elements(m) e) = jsonb_array_length(m)
  end
$$;

alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles add constraint profiles_bio_check check (char_length(bio) <= 500);
alter table public.profiles drop constraint if exists profiles_masteries_check;
alter table public.profiles add constraint profiles_masteries_check check (public.valid_masteries(masteries));
alter table public.profiles drop constraint if exists profiles_timezone_check;
alter table public.profiles add constraint profiles_timezone_check check (timezone is null or timezone ~ '^[A-Za-z0-9_+/-]{1,64}$');
-- Seven numbers, Monday to Sunday. In each, bit 0 is midnight to 1am and bit 23 is 11pm to midnight, in the member's own time zone.
alter table public.profiles drop constraint if exists profiles_availability_check;
alter table public.profiles add constraint profiles_availability_check check (
  availability is null or (
    array_ndims(availability) = 1 and array_length(availability, 1) = 7
    and array_position(availability, null) is null
    and 0 <= all (availability) and 16777215 >= all (availability)));

-- A member saves their own card. Nobody can save anyone else's.
create or replace function public.update_my_card(p_bio text, p_masteries jsonb, p_timezone text, p_availability integer[])
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.profiles
     set bio = btrim(coalesce(p_bio, '')),
         masteries = coalesce(p_masteries, '[]'::jsonb),
         timezone = nullif(btrim(coalesce(p_timezone, '')), ''),
         availability = p_availability,
         updated_at = now()
   where id = auth.uid()
   returning * into row;
  if row.id is null then raise exception 'No member profile' using errcode = '42501'; end if;
  return row;
end $$;

-- Members see each other's cards. Guests see nothing.
grant select (bio, masteries, timezone, availability) on public.profiles to authenticated;
revoke execute on function public.update_my_card(text, jsonb, text, integer[]) from public, anon;
grant execute on function public.update_my_card(text, jsonb, text, integer[]) to authenticated, service_role;
revoke execute on function public.valid_masteries(jsonb) from public, anon;
grant execute on function public.valid_masteries(jsonb) to authenticated, service_role;
