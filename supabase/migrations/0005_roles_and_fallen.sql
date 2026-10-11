-- 0.2.5: the Deceased screen, the Roles screen, and the end of the Daedric tag.
-- Run after 0004_app_presence.sql. Safe to re-run.

-- ───────────────────────────────────────────────────────────── the Daedric tag is retired
update public.profiles set tags = array_remove(tags, 'daedric') where 'daedric' = any (tags);
-- The first check on tags (0001) still lists the name. This one refuses it, whatever asks:
-- the clan-api function hands tags to the database, and the database has the last word.
alter table public.profiles drop constraint if exists profiles_no_daedric_check;
alter table public.profiles add constraint profiles_no_daedric_check check (not ('daedric' = any (tags)));

-- Notices, map approvals and the ledger were shared with Daedric. They are the officers' alone now.
create or replace function public.is_herald() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_officer()
$$;

-- ───────────────────────────────────────────────────────────── the fallen
-- A member whose character has died keeps their account and moves to the Deceased
-- screen. Their card there carries how they died and when, both written by officers.
-- The date is one of three things: not entered yet (null, not unknown), a day, or unknown.
alter table public.profiles add column if not exists death_cause text not null default '';
alter table public.profiles add column if not exists death_date date;
alter table public.profiles add column if not exists death_date_unknown boolean not null default false;
alter table public.profiles drop constraint if exists profiles_death_cause_check;
alter table public.profiles add constraint profiles_death_cause_check check (char_length(death_cause) <= 500);
alter table public.profiles drop constraint if exists profiles_death_date_check;
alter table public.profiles add constraint profiles_death_date_check check (not (death_date_unknown and death_date is not null));

-- An officer records a death. The reach is the same as for the rest of a member's
-- account: only a Forgemaster edits a Forgemaster, only they or the Chieftain edit the Chieftain.
create or replace function public.set_death_record(p_id uuid, p_cause text, p_date date, p_unknown boolean)
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
     set death_cause = btrim(coalesce(p_cause, '')),
         death_date = case when unknown then null else p_date end,
         death_date_unknown = unknown,
         updated_at = now()
   where id = p_id
   returning * into row;
  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'member.death_recorded', p_id, jsonb_build_object('date', row.death_date, 'unknown', row.death_date_unknown));
  return row;
end $$;

grant select (death_cause, death_date, death_date_unknown) on public.profiles to authenticated;
revoke execute on function public.set_death_record(uuid, text, date, boolean) from public, anon;
grant execute on function public.set_death_record(uuid, text, date, boolean) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────── what each tag means
-- The Roles screen. The app carries a short description of every tag; a row here
-- replaces it. Officers write, every member reads.
create table if not exists public.role_notes (
  tag         text primary key check (tag = any (array['chieftain','right_tusk','left_tusk','wise_woman','blooded','blood_kin',
                                                       'kinsmen','unblooded','ally','forgemaster','deceased']::text[])),
  about       text not null check (char_length(btrim(about)) between 1 and 400),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.role_notes enable row level security;
drop policy if exists role_notes_read on public.role_notes;
create policy role_notes_read on public.role_notes for select to authenticated using (public.is_member());
drop policy if exists role_notes_write on public.role_notes;
create policy role_notes_write on public.role_notes for all to authenticated
  using (public.is_officer()) with check (public.is_officer());

create or replace function public.role_notes_stamp() returns trigger
language plpgsql as $$ begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists role_notes_stamp on public.role_notes;
create trigger role_notes_stamp before insert or update on public.role_notes
  for each row execute function public.role_notes_stamp();

-- A new table can arrive with the project's default access for everyone. Take that away first: guests get nothing.
revoke all on public.role_notes from anon, authenticated;
grant select, insert, update, delete on public.role_notes to authenticated;
grant all on public.role_notes to service_role;
