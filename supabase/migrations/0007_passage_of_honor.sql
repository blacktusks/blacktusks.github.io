-- A passage of honor on a fallen member's card, above the cause of death. Written by officers.
-- Run after 0006_bow_mastery.sql. Safe to re-run.

alter table public.profiles add column if not exists death_honor text not null default '';
alter table public.profiles drop constraint if exists profiles_death_honor_check;
alter table public.profiles add constraint profiles_death_honor_check check (char_length(death_honor) <= 1000);

-- An officer records a death: the passage of honor, the cause, and the date (a day, unknown, or not entered yet).
-- The reach is the same as for the rest of a member's account: only a Forgemaster edits a Forgemaster,
-- only they or the Chieftain edit the Chieftain.
create or replace function public.set_death_record(p_id uuid, p_honor text, p_cause text, p_date date, p_unknown boolean)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles; mine text[] := public.my_tags(); unknown boolean := coalesce(p_unknown, false);
begin
  if not public.is_officer() then raise exception 'Officers only' using errcode = '42501'; end if;
  select * into row from public.profiles where id = p_id;
  if row.id is null then raise exception 'That member no longer exists' using errcode = 'P0002'; end if;
  if p_id <> auth.uid() then
    if 'forgemaster' = any (row.tags) and not ('forgemaster' = any (mine)) then
      raise exception 'Only a Forgemaster can edit a Forgemaster' using errcode = '42501';
    end if;
    if 'chieftain' = any (row.tags) and not (mine operator(pg_catalog.&&) array['chieftain', 'forgemaster']) then
      raise exception 'Only the Chieftain or a Forgemaster can edit the Chieftain' using errcode = '42501';
    end if;
  end if;
  if not ('deceased' = any (row.tags)) then
    raise exception 'Give them the Deceased tag first' using errcode = '22023';
  end if;
  if not unknown and p_date is not null and (p_date > current_date + 1 or p_date < date '2011-11-11') then
    raise exception 'That date of passing is not possible' using errcode = '22008';
  end if;
  update public.profiles
     set death_honor = btrim(coalesce(p_honor, '')),
         death_cause = btrim(coalesce(p_cause, '')),
         death_date = case when unknown then null else p_date end,
         death_date_unknown = unknown,
         updated_at = now()
   where id = p_id
   returning * into row;
  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'member.death_recorded', p_id, jsonb_build_object('date', row.death_date, 'unknown', row.death_date_unknown));
  return row;
end $$;

-- The earlier form, without the passage. A copy of the app that has not updated itself yet
-- still calls it; it saves the rest and leaves the passage as it is.
create or replace function public.set_death_record(p_id uuid, p_cause text, p_date date, p_unknown boolean)
returns public.profiles language plpgsql security definer set search_path = '' as $$
begin
  return public.set_death_record(p_id, (select p.death_honor from public.profiles p where p.id = p_id), p_cause, p_date, p_unknown);
end $$;

grant select (death_honor) on public.profiles to authenticated;
revoke execute on function public.set_death_record(uuid, text, text, date, boolean) from public, anon;
grant execute on function public.set_death_record(uuid, text, text, date, boolean) to authenticated, service_role;
