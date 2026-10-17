-- 0.4.0: two clans in one app. The Black Tusks of Largashbur and their sister tribe, the Scorned of Narzulbur.
-- Run after 0007_passage_of_honor.sql. Safe to re-run.
--
-- Every member carries one or more clan tags, kept apart from the role tags. Each clan has its own
-- Notice Board, mine, Expansion Goals and Deceased list; Members, Roles, the Mining Map, the Pricing
-- Ledger and the change log are shared. A role counts within its own clan: the Scorned Chieftain is a
-- member with the Chieftain tag and the Scorned clan tag. The Forgemaster counts in every clan.

-- ───────────────────────────────────────────────────────────── clan tags
alter table public.profiles add column if not exists clans text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_clans_check;
alter table public.profiles add constraint profiles_clans_check check (clans <@ array['black_tusks','scorned']::text[]);
-- Everyone here before the Scorned arrived is a Black Tusk. Only on the first run: once anyone has a clan, nothing is touched.
update public.profiles set clans = '{black_tusks}'
 where clans = '{}' and not exists (select 1 from public.profiles where clans <> '{}');
grant select (clans) on public.profiles to authenticated;

create or replace function public.my_clans() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select clans from public.profiles where id = auth.uid()), '{}'::text[])
$$;

-- A clan's officers: its Chieftain, Right Tusk, Left Tusk and Wise Woman. The Forgemaster counts in every clan.
create or replace function public.is_clan_officer(p_clan text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_forgemaster()
      or (p_clan = any (public.my_clans()) and public.my_tags() operator(pg_catalog.&&) array['chieftain','right_tusk','left_tusk','wise_woman'])
$$;

-- A clan's heads: its Chieftain and Wise Woman, and the Forgemaster.
create or replace function public.is_clan_head(p_clan text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_forgemaster()
      or (p_clan = any (public.my_clans()) and public.my_tags() operator(pg_catalog.&&) array['chieftain','wise_woman'])
$$;

-- Who keeps a clan's mine and its Expansion Goals: that clan's officers (Chieftain, Right Tusk, Left Tusk,
-- Wise Woman). The Forgemaster keeps both clans'.
create or replace function public.can_keep_mine(p_clan text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_clan_officer(p_clan)
$$;

-- Whose account an officer may touch: members who share one of their clans (or have none yet).
-- The Forgemaster may touch everyone's.
create or replace function public.shares_clan(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_forgemaster()
      or exists (select 1 from public.profiles p where p.id = p_id
                 and (p.clans = '{}'::text[] or p.clans operator(pg_catalog.&&) public.my_clans()))
$$;

-- ───────────────────────────────────────────────────────────── one Forgemaster
-- The Forgemaster tag is never handed out or taken away, by anyone, through the app or the function.
-- The first Forgemaster is made once in the SQL editor (README); after that there is only ever one.
create or replace function public.forgemaster_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.forgemaster_override', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if 'forgemaster' = any (new.tags) and exists (select 1 from public.profiles where 'forgemaster' = any (tags)) then
      raise exception 'There is only one Forgemaster' using errcode = '42501';
    end if;
  elsif ('forgemaster' = any (new.tags)) is distinct from ('forgemaster' = any (old.tags)) then
    raise exception 'The Forgemaster tag cannot be given or taken' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists forgemaster_guard on public.profiles;
create trigger forgemaster_guard before insert or update of tags on public.profiles
  for each row execute function public.forgemaster_guard();

-- ───────────────────────────────────────────────────────────── a clan on every board and goal
alter table public.announcements add column if not exists clan text not null default 'black_tusks';
alter table public.announcements drop constraint if exists announcements_clan_check;
alter table public.announcements add constraint announcements_clan_check check (clan in ('black_tusks', 'scorned'));
alter table public.mine_deals add column if not exists clan text not null default 'black_tusks';
alter table public.mine_deals drop constraint if exists mine_deals_clan_check;
alter table public.mine_deals add constraint mine_deals_clan_check check (clan in ('black_tusks', 'scorned'));
alter table public.expansion_stages add column if not exists clan text not null default 'black_tusks';
alter table public.expansion_stages drop constraint if exists expansion_stages_clan_check;
alter table public.expansion_stages add constraint expansion_stages_clan_check check (clan in ('black_tusks', 'scorned'));

-- Notices: any clan's Chieftain, Right Tusk, Left Tusk or Wise Woman posts on either board (unchanged: is_herald).

-- Mines: each clan's own keepers.
drop policy if exists mine_deals_read on public.mine_deals;
create policy mine_deals_read on public.mine_deals for select to authenticated using (
  public.is_member() and (
    author_id = auth.uid()
    or (visibility <> 'draft' and public.can_keep_mine(clan))
    or visibility = 'all'
    or (visibility = 'specific' and auth.uid() = any (audience))
  ));
drop policy if exists mine_deals_insert on public.mine_deals;
create policy mine_deals_insert on public.mine_deals for insert to authenticated
  with check (public.can_keep_mine(clan));
drop policy if exists mine_deals_update on public.mine_deals;
create policy mine_deals_update on public.mine_deals for update to authenticated
  using (public.can_keep_mine(clan) and (author_id = auth.uid() or visibility <> 'draft'))
  with check (public.can_keep_mine(clan));
drop policy if exists mine_deals_delete on public.mine_deals;
create policy mine_deals_delete on public.mine_deals for delete to authenticated
  using (public.can_keep_mine(clan) and (author_id = auth.uid() or visibility <> 'draft'));

-- Expansion Goals: each clan's officers, and the Forgemaster.
drop policy if exists expansion_stages_write on public.expansion_stages;
create policy expansion_stages_write on public.expansion_stages for all to authenticated
  using (public.is_clan_officer(clan)) with check (public.is_clan_officer(clan));
drop policy if exists expansion_resources_write on public.expansion_resources;
create policy expansion_resources_write on public.expansion_resources for all to authenticated
  using (exists (select 1 from public.expansion_stages s where s.id = stage_id and public.is_clan_officer(s.clan)))
  with check (exists (select 1 from public.expansion_stages s where s.id = stage_id and public.is_clan_officer(s.clan)));

-- ───────────────────────────────────────────────────────────── officers keep to their own clan
-- The officers' Members list: every member, but sign-in names only for those an officer may manage.
create or replace function public.member_admin_list() returns setof public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare r public.profiles;
begin
  if not public.is_officer() then raise exception 'Officers only' using errcode = '42501'; end if;
  for r in select * from public.profiles loop
    if not public.shares_clan(r.id) then r.username := null; end if;
    return next r;
  end loop;
end $$;

create or replace function public.set_member_masteries(p_id uuid, p_masteries jsonb)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles; mine text[] := public.my_tags(); list jsonb := coalesce(p_masteries, '[]'::jsonb);
begin
  if not public.is_officer() then raise exception 'Only clan officers can edit members' using errcode = '42501'; end if;
  select * into row from public.profiles where id = p_id;
  if row.id is null then raise exception 'That member no longer exists' using errcode = 'P0002'; end if;
  if p_id <> auth.uid() then
    if not public.shares_clan(p_id) then
      raise exception 'Officers edit the members of their own clan' using errcode = '42501';
    end if;
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

create or replace function public.set_death_record(p_id uuid, p_honor text, p_cause text, p_date date, p_unknown boolean)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles; mine text[] := public.my_tags(); unknown boolean := coalesce(p_unknown, false);
begin
  if not public.is_officer() then raise exception 'Officers only' using errcode = '42501'; end if;
  select * into row from public.profiles where id = p_id;
  if row.id is null then raise exception 'That member no longer exists' using errcode = 'P0002'; end if;
  if p_id <> auth.uid() then
    if not public.shares_clan(p_id) then
      raise exception 'Officers edit the members of their own clan' using errcode = '42501';
    end if;
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

-- A new member's account, with their clan. (The earlier form without the clan stays for a function
-- that has not been redeployed yet; the account it makes has no clan until the Forgemaster gives one.)
create or replace function public.admin_finish_create(
  p_id uuid, p_username text, p_display_name text, p_tags text[], p_discord_name text, p_cipher text, p_actor uuid, p_clans text[])
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  insert into public.profiles (id, username, display_name, tags, discord_name, clans, must_change_password)
  values (p_id, p_username, p_display_name, p_tags, p_discord_name, coalesce(p_clans, '{}'), true) returning * into row;
  insert into public.password_vault (user_id, cipher) values (p_id, p_cipher)
    on conflict (user_id) do update set cipher = excluded.cipher, next_cipher = null, next_at = null, updated_at = now();
  delete from public.retired_names where username = lower(p_username);
  insert into public.audit_log (actor, action, target, detail)
  values (p_actor, 'member.created', p_id, jsonb_build_object('username', p_username, 'tags', p_tags, 'clans', p_clans));
  return row;
end $$;

-- ───────────────────────────────────────────────────────────── the Scorned's Expansion Goals
do $$
declare s uuid;
begin
  if exists (select 1 from public.expansion_stages where clan = 'scorned') then return; end if;

  insert into public.expansion_stages (sort, title, clan) values (1, 'Stage 1: Wall Upgrade & Extension', 'scorned') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 16000), (s, 2, 'Iron Ingots', '', 800), (s, 3, 'Steel Ingots', '', 350),
    (s, 4, 'Corundum', '', 400), (s, 5, 'Firewood', '', 1000), (s, 6, 'Leather Strips', '', 100);

  insert into public.expansion_stages (sort, title, details, clan)
    values (2, 'Stage 2: Crop Fields (Outside the Palisade)', 'Planting is flat work with no material cost.', 'scorned') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 7000), (s, 2, 'Iron Ingots', '', 250), (s, 3, 'Firewood', '', 500), (s, 4, 'Leather Strips', '', 40);
  insert into public.expansion_resources (stage_id, sort, name, unit, note, goal, in_total) values
    (s, 5, 'Wheat', 'planted', 'Planting', 20, false), (s, 6, 'Leeks', 'planted', 'Planting', 16, false),
    (s, 7, 'Potatoes', 'planted', 'Planting', 16, false);

  insert into public.expansion_stages (sort, title, clan) values (3, 'Stage 3: Cooking Hut', 'scorned') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 5500), (s, 2, 'Iron Ingots', '', 200), (s, 3, 'Corundum', '', 100),
    (s, 4, 'Firewood', '', 600), (s, 5, 'Pelts (Any)', '', 35);

  insert into public.expansion_stages (sort, title, clan) values (4, 'Stage 4: Small Huts (6 Huts)', 'scorned') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, note, goal) values
    (s, 1, 'Gold', 'Septims', '4,500 per hut', 27000), (s, 2, 'Iron Ingots', '', '130 per hut', 780),
    (s, 3, 'Firewood', '', '400 per hut', 2400), (s, 4, 'Pelts (Any)', '', '40 per hut', 240),
    (s, 5, 'Leather Strips', '', '35 per hut', 210);

  insert into public.expansion_stages (sort, title, clan) values (5, 'Stage 5: Gate Shop Hut with Sales Counter', 'scorned') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 9000), (s, 2, 'Iron Ingots', '', 350), (s, 3, 'Steel Ingots', '', 100),
    (s, 4, 'Corundum', '', 200), (s, 5, 'Firewood', '', 650), (s, 6, 'Leather Strips', '', 70), (s, 7, 'Silver Ingots', '', 8);
end $$;

-- ───────────────────────────────────────────────────────────── grants
revoke execute on function public.my_clans(), public.is_clan_officer(text), public.is_clan_head(text), public.can_keep_mine(text),
  public.shares_clan(uuid), public.forgemaster_guard() from public, anon;
grant execute on function public.my_clans(), public.is_clan_officer(text), public.is_clan_head(text), public.can_keep_mine(text),
  public.shares_clan(uuid) to authenticated, service_role;
revoke execute on function public.admin_finish_create(uuid, text, text, text[], text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.admin_finish_create(uuid, text, text, text[], text, text, uuid, text[]) to service_role;
