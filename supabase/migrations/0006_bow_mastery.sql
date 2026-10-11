-- Bow joins the masteries, and officers set another member's masteries through the
-- database itself, so the list of masteries is checked in one place only.
-- Run after 0005_roles_and_fallen.sql. Safe to re-run.

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
         or (e ->> 'skill') not in ('one_handed', 'two_handed', 'dual_wielder', 'bow', 'armor', 'shield', 'cook', 'alchemist',
              'blacksmith', 'woodcutter', 'tailor', 'scholar', 'miner', 'first_aid', 'lockpicking', 'skinner',
              'harvester', 'artifact_scavenger')
         or (e ->> 'level') not in ('0', '1', '2', '3', '4', '5'))
    and (select count(distinct e ->> 'skill') from jsonb_array_elements(m) e) = jsonb_array_length(m)
  end
$$;

-- An officer sets another member's masteries (and nothing else on their card). The reach is
-- the same as for the rest of a member's account: only a Forgemaster edits a Forgemaster,
-- only they or the Chieftain edit the Chieftain.
create or replace function public.set_member_masteries(p_id uuid, p_masteries jsonb)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles; mine text[] := public.my_tags(); list jsonb := coalesce(p_masteries, '[]'::jsonb);
begin
  if not public.is_officer() then raise exception 'Only clan officers can edit members' using errcode = '42501'; end if;
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
  if not public.valid_masteries(list) then
    raise exception 'That list of masteries is not valid' using errcode = '22023';
  end if;
  update public.profiles set masteries = list, updated_at = now() where id = p_id returning * into row;
  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'member.masteries_set', p_id, jsonb_build_object('masteries', list));
  return row;
end $$;

revoke execute on function public.set_member_masteries(uuid, jsonb) from public, anon;
grant execute on function public.set_member_masteries(uuid, jsonb) to authenticated, service_role;
