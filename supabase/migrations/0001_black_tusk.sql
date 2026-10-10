-- Black Tusk Companion: database schema, permission rules and seed data.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

-- ───────────────────────────────────────────────────────────── types
do $$ begin
  create type public.visibility as enum ('all', 'specific', 'draft');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.marker_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────────────────── members
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,23}$'),
  display_name  text not null check (
                  char_length(btrim(display_name)) between 1 and 40
                  and display_name ~ '[[:alnum:]]'                                   -- not blank or all punctuation
                  and display_name !~ '[[:cntrl:]]'
                  -- no invisible characters: U+200B-200F, U+2028-202F, U+2060, U+FEFF
                  and display_name !~ ('[' || chr(8203) || '-' || chr(8207) || chr(8232) || '-' || chr(8239)
                                         || chr(8288) || chr(65279) || ']')),
  tags          text[] not null default '{}'
                check (tags <@ array['chieftain','right_tusk','left_tusk','wise_woman','blooded','blood_kin',
                                     'kinsmen','unblooded','ally','daedric','forgemaster','deceased']::text[]),
  discord_name  text check (discord_name is null or (char_length(discord_name) between 1 and 64 and discord_name !~ '[[:cntrl:]]')),
  must_change_password boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Nobody can pass as someone else: display names and Discord names are unique.
create unique index if not exists profiles_display_name_key on public.profiles (lower(display_name));
create unique index if not exists profiles_discord_name_key on public.profiles (lower(discord_name)) where discord_name is not null;

-- The caller's tags. SECURITY DEFINER so policies can read it without recursion.
create or replace function public.my_tags() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select tags from public.profiles where id = auth.uid()), '{}'::text[])
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

-- Chieftain, Right Tusk, Left Tusk, Wise Woman, Forgemaster
create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_tags() operator(pg_catalog.&&) array['chieftain','right_tusk','left_tusk','wise_woman','forgemaster']
$$;

-- Officers plus Daedric (game masters): announcements, map approvals, ledger
create or replace function public.is_herald() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_tags() operator(pg_catalog.&&) array['chieftain','right_tusk','left_tusk','wise_woman','forgemaster','daedric']
$$;

create or replace function public.is_forgemaster() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_tags() operator(pg_catalog.&&) array['forgemaster']
$$;

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.is_member());
-- No insert/update/delete policies: accounts are managed by the clan-api
-- function (service role). Members only see the public columns (see the
-- grants at the end); these functions cover everything else.

-- A member's own full profile row.
create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p from public.profiles p where p.id = auth.uid()
$$;

-- Every profile in full, for the officers' Members screen.
create or replace function public.member_admin_list() returns setof public.profiles
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then raise exception 'Officers only' using errcode = '42501'; end if;
  return query select * from public.profiles;
end $$;

create or replace function public.update_my_profile(p_display_name text, p_discord_name text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.profiles
     set display_name = btrim(p_display_name),
         discord_name = nullif(btrim(coalesce(p_discord_name, '')), ''),
         updated_at = now()
   where id = auth.uid()
   returning * into row;
  if row.id is null then raise exception 'No member profile' using errcode = '42501'; end if;
  return row;
end $$;

-- Sign-in names of removed members. Only a Forgemaster may hand one out again.
create table if not exists public.retired_names (
  username    text primary key,
  removed_at  timestamptz not null default now(),
  removed_by  uuid
);
alter table public.retired_names enable row level security;

-- ───────────────────────────────────────────────────────────── notice board
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 8000),
  visibility  public.visibility not null default 'all',
  audience    uuid[] not null default '{}',
  expires_at  timestamptz,
  author_id   uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Who wrote a post and when can never be rewritten; edits are stamped.
create or replace function public.posts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;            -- service role / SQL editor
  if tg_op = 'INSERT' then
    new.author_id := auth.uid(); new.created_at := now(); new.updated_by := null;
  else
    new.author_id := old.author_id; new.created_at := old.created_at; new.updated_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists posts_guard on public.announcements;
create trigger posts_guard before insert or update on public.announcements
  for each row execute function public.posts_guard();

alter table public.announcements enable row level security;
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated using (
  public.is_member() and (
    author_id = auth.uid()
    or (visibility <> 'draft' and public.is_herald())
    or ((expires_at is null or expires_at > now())
        and (visibility = 'all' or (visibility = 'specific' and auth.uid() = any (audience))))
  ));
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_herald());
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_herald() and (author_id = auth.uid() or visibility <> 'draft'))
  with check (public.is_herald());
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_herald() and (author_id = auth.uid() or visibility <> 'draft'));

create table if not exists public.changelog (
  id          uuid primary key default gen_random_uuid(),
  version     text not null default '' check (char_length(version) <= 24),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 8000),
  released_at date not null default current_date,
  created_at  timestamptz not null default now()
);
alter table public.changelog enable row level security;
drop policy if exists changelog_read on public.changelog;
create policy changelog_read on public.changelog for select to authenticated using (public.is_member());
drop policy if exists changelog_write on public.changelog;
create policy changelog_write on public.changelog for all to authenticated
  using (public.is_forgemaster()) with check (public.is_forgemaster());

-- ───────────────────────────────────────────────────────────── mine deals
create table if not exists public.mine_deals (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 8000),
  visibility  public.visibility not null default 'all',
  audience    uuid[] not null default '{}',
  author_id   uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists posts_guard on public.mine_deals;
create trigger posts_guard before insert or update on public.mine_deals
  for each row execute function public.posts_guard();

alter table public.mine_deals enable row level security;
drop policy if exists mine_deals_read on public.mine_deals;
create policy mine_deals_read on public.mine_deals for select to authenticated using (
  public.is_member() and (
    author_id = auth.uid()
    or (visibility <> 'draft' and public.is_officer())
    or visibility = 'all'
    or (visibility = 'specific' and auth.uid() = any (audience))
  ));
drop policy if exists mine_deals_insert on public.mine_deals;
create policy mine_deals_insert on public.mine_deals for insert to authenticated
  with check (public.is_officer());
drop policy if exists mine_deals_update on public.mine_deals;
create policy mine_deals_update on public.mine_deals for update to authenticated
  using (public.is_officer() and (author_id = auth.uid() or visibility <> 'draft'))
  with check (public.is_officer());
drop policy if exists mine_deals_delete on public.mine_deals;
create policy mine_deals_delete on public.mine_deals for delete to authenticated
  using (public.is_officer() and (author_id = auth.uid() or visibility <> 'draft'));

-- ───────────────────────────────────────────────────────────── expansion goals
create table if not exists public.expansion_stages (
  id          uuid primary key default gen_random_uuid(),
  sort        integer not null default 0,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  details     text not null default '' check (char_length(details) <= 4000),
  updated_at  timestamptz not null default now()
);
create table if not exists public.expansion_resources (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references public.expansion_stages (id) on delete cascade,
  sort        integer not null default 0,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  unit        text not null default '' check (char_length(unit) <= 24),
  note        text not null default '' check (char_length(note) <= 120),
  goal        integer not null default 0 check (goal >= 0),
  have        integer not null default 0 check (have >= 0),
  in_total    boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.expansion_stages enable row level security;
alter table public.expansion_resources enable row level security;
drop policy if exists expansion_stages_read on public.expansion_stages;
create policy expansion_stages_read on public.expansion_stages for select to authenticated using (public.is_member());
drop policy if exists expansion_stages_write on public.expansion_stages;
create policy expansion_stages_write on public.expansion_stages for all to authenticated
  using (public.is_officer()) with check (public.is_officer());
drop policy if exists expansion_resources_read on public.expansion_resources;
create policy expansion_resources_read on public.expansion_resources for select to authenticated using (public.is_member());
drop policy if exists expansion_resources_write on public.expansion_resources;
create policy expansion_resources_write on public.expansion_resources for all to authenticated
  using (public.is_officer()) with check (public.is_officer());

-- ───────────────────────────────────────────────────────────── mining map
create table if not exists public.ore_markers (
  id          uuid primary key default gen_random_uuid(),
  ore         text not null check (ore ~ '^[a-z_]{2,24}$'),
  -- Skyrim world units. The range covers the whole map and keeps out NaN and infinity.
  x           double precision not null check (x between -260000 and 270000),
  y           double precision not null check (y between -200000 and 220000),
  kind        text not null default 'surface' check (kind in ('surface', 'cave', 'dungeon', 'mine')),
  place       text not null default '' check (char_length(place) <= 80),
  note        text not null default '' check (char_length(note) <= 400),
  veins       integer not null default 1 check (veins between 1 and 99),
  status      public.marker_status not null default 'pending',
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 200)
);
create index if not exists ore_markers_status_idx on public.ore_markers (status);

-- Members' pings wait for approval; heralds' markers go straight on the map.
-- Who pinged and who reviewed are stamped here and cannot be set by hand.
create or replace function public.ore_markers_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    if coalesce(auth.role(), '') = 'authenticated' then raise exception 'Not signed in' using errcode = '28000'; end if;
    return new;                                             -- service role / SQL editor
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if public.is_herald() then
      new.status := 'approved'; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    else
      if (select count(*) from public.ore_markers where created_by = auth.uid() and status = 'pending') >= 30 then
        raise exception 'You have 30 pings waiting for approval. Wait for an officer to check them.' using errcode = '53400';
      end if;
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := '';
    end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    if public.is_herald() and new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    else
      new.status := old.status; new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ore_markers_guard on public.ore_markers;
create trigger ore_markers_guard before insert or update on public.ore_markers
  for each row execute function public.ore_markers_guard();

alter table public.ore_markers enable row level security;
drop policy if exists ore_markers_read on public.ore_markers;
create policy ore_markers_read on public.ore_markers for select to authenticated using (
  public.is_member() and (status = 'approved' or created_by = auth.uid() or public.is_herald()));
drop policy if exists ore_markers_insert on public.ore_markers;
create policy ore_markers_insert on public.ore_markers for insert to authenticated with check (public.is_member());
drop policy if exists ore_markers_update on public.ore_markers;
create policy ore_markers_update on public.ore_markers for update to authenticated
  using (public.is_herald() or (created_by = auth.uid() and status = 'pending'))
  with check (public.is_herald() or (created_by = auth.uid() and status = 'pending'));
drop policy if exists ore_markers_delete on public.ore_markers;
create policy ore_markers_delete on public.ore_markers for delete to authenticated
  using (public.is_herald() or (created_by = auth.uid() and status <> 'approved'));

-- ───────────────────────────────────────────────────────────── pricing ledger
-- The item catalog ships with the app; this table only holds what the clan
-- has decided about an item (and any items the clan adds by hand).
create table if not exists public.ledger_entries (
  item_key    text primary key check (char_length(item_key) between 1 and 80),
  tier        smallint check (tier between 1 and 5),
  price       integer check (price >= 0),
  price_note  text not null default '' check (char_length(price_note) <= 200),
  uses        text not null default '' check (char_length(uses) <= 1200),
  acquire     text not null default '' check (char_length(acquire) <= 1200),
  image_path  text check (image_path is null or image_path ~ '^[A-Za-z0-9._-]{1,160}$'),
  hidden      boolean not null default false,
  custom      jsonb check (custom is null or (
                jsonb_typeof(custom) = 'object'
                and jsonb_typeof(custom -> 'name') = 'string' and char_length(custom ->> 'name') between 1 and 80
                and jsonb_typeof(custom -> 'cat') = 'string'
                and custom ->> 'cat' in ('weapons','apparel','potions','scrolls','food','ingredients','books','keys','misc')
                and pg_column_size(custom) < 600)),
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.ledger_entries enable row level security;
drop policy if exists ledger_read on public.ledger_entries;
create policy ledger_read on public.ledger_entries for select to authenticated
  using (public.is_member() and (not hidden or public.is_herald()));
drop policy if exists ledger_write on public.ledger_entries;
create policy ledger_write on public.ledger_entries for all to authenticated
  using (public.is_herald()) with check (public.is_herald());

-- Items the officers have marked as not obtainable. Members get only the keys
-- (so the app can leave those items out), never the officers' notes on them.
create or replace function public.hidden_item_keys() returns text[]
language sql stable security definer set search_path = '' as $$
  select case when public.is_member()
    then coalesce((select array_agg(item_key) from public.ledger_entries where hidden), '{}'::text[])
    else '{}'::text[] end
$$;

-- ───────────────────────────────────────────────────────────── settings, vault, audit
create table if not exists public.app_settings (
  key         text primary key check (char_length(key) <= 60),
  value       jsonb not null check (pg_column_size(value) < 4000),
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (public.is_member());
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.is_forgemaster()) with check (public.is_forgemaster());

-- Encrypted copy of each member's current password so the Forgemaster can
-- read it back. Row level security is on with NO policies: only the clan-api
-- function (service role) can touch it, and the key lives outside the database.
--
-- The function first stages the new cipher in next_cipher. The trigger below
-- moves it into place in the same transaction that changes the real password,
-- so the copy can never disagree with what Supabase Auth holds.
create table if not exists public.password_vault (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  cipher           text,
  next_cipher      text,
  next_must_change boolean,
  next_at          timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.password_vault enable row level security;

create or replace function public.on_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.password_vault;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
  select * into v from public.password_vault where user_id = new.id;
  if v.next_cipher is not null and v.next_at > now() - interval '2 minutes' then
    update public.password_vault
       set cipher = v.next_cipher, next_cipher = null, next_must_change = null, next_at = null, updated_at = now()
     where user_id = new.id;
    update public.profiles set must_change_password = coalesce(v.next_must_change, false) where id = new.id;
  else
    -- Changed some other way than through the app: the saved copy is no longer
    -- true, so drop it and ask the member to set a password through the app.
    delete from public.password_vault where user_id = new.id;
    update public.profiles set must_change_password = true where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_password_changed on auth.users;
create trigger on_password_changed after update of encrypted_password on auth.users
  for each row execute function public.on_password_changed();

-- A member cannot rename their own sign-in. The function changes the profile
-- first, then the sign-in email; anything else is refused.
create or replace function public.on_login_email_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  if new.email is not distinct from old.email then return new; end if;
  select username into u from public.profiles where id = new.id;
  if u is null then return new; end if;                     -- not a member account
  if split_part(new.email, '@', 1) <> u or split_part(new.email, '@', 2) <> split_part(old.email, '@', 2) then
    raise exception 'Sign-in names are changed by the Forgemaster' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists on_login_email_changed on auth.users;
create trigger on_login_email_changed before update of email on auth.users
  for each row execute function public.on_login_email_changed();

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  action      text not null,
  target      uuid,
  detail      jsonb not null default '{}'
);
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_forgemaster());

-- Used by the clan-api function so that a new account's profile, password
-- copy and audit entry are written together or not at all.
create or replace function public.admin_finish_create(
  p_id uuid, p_username text, p_display_name text, p_tags text[], p_discord_name text, p_cipher text, p_actor uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  insert into public.profiles (id, username, display_name, tags, discord_name, must_change_password)
  values (p_id, p_username, p_display_name, p_tags, p_discord_name, true) returning * into row;
  insert into public.password_vault (user_id, cipher) values (p_id, p_cipher)
    on conflict (user_id) do update set cipher = excluded.cipher, next_cipher = null, next_at = null, updated_at = now();
  delete from public.retired_names where username = p_username;
  insert into public.audit_log (actor, action, target, detail)
  values (p_actor, 'member.created', p_id, jsonb_build_object('username', p_username, 'tags', p_tags));
  return row;
end $$;

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','announcements','mine_deals','expansion_stages','expansion_resources','ledger_entries','app_settings'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

create or replace function public.ledger_stamp() returns trigger
language plpgsql as $$ begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists ledger_stamp on public.ledger_entries;
create trigger ledger_stamp before insert or update on public.ledger_entries
  for each row execute function public.ledger_stamp();

-- ───────────────────────────────────────────────────────────── item images
-- A public bucket: pictures are fetched by URL. Only picture files up to 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 2097152, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists item_images_read on storage.objects;
create policy item_images_read on storage.objects for select to authenticated
  using (bucket_id = 'item-images' and public.is_herald());
drop policy if exists item_images_insert on storage.objects;
create policy item_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and public.is_herald());
drop policy if exists item_images_update on storage.objects;
create policy item_images_update on storage.objects for update to authenticated
  using (bucket_id = 'item-images' and public.is_herald())
  with check (bucket_id = 'item-images' and public.is_herald());
drop policy if exists item_images_delete on storage.objects;
create policy item_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-images' and public.is_herald());

-- ───────────────────────────────────────────────────────────── grants
-- Start from nothing and hand out exactly what the app uses, so the result is
-- the same whatever the project's defaults are. Row level security above
-- still decides which rows each member can touch. Guests get nothing.
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;
-- members see each other's name, tags and Discord name, not sign-in names
grant select (id, display_name, tags, discord_name, created_at) on public.profiles to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on
  public.announcements, public.changelog, public.mine_deals, public.expansion_stages, public.expansion_resources,
  public.ore_markers, public.ledger_entries, public.app_settings
  to authenticated;
grant execute on function public.my_tags(), public.is_member(), public.is_officer(), public.is_herald(),
  public.is_forgemaster(), public.my_profile(), public.member_admin_list(), public.update_my_profile(text, text),
  public.hidden_item_keys()
  to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ───────────────────────────────────────────────────────────── seed: expansion goals
do $$
declare s uuid;
begin
  if exists (select 1 from public.expansion_stages) then return; end if;

  insert into public.expansion_stages (sort, title) values (1, 'Stage 1: Wall Upgrade & Extension') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 16000), (s, 2, 'Iron Ingots', '', 800), (s, 3, 'Steel Ingots', '', 350),
    (s, 4, 'Corundum', '', 400), (s, 5, 'Firewood', '', 1000), (s, 6, 'Leather Strips', '', 100);

  insert into public.expansion_stages (sort, title, details)
    values (2, 'Stage 2: Crop Fields (Outside the Palisade)', 'Planting is flat work with no material cost.') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 7000), (s, 2, 'Iron Ingots', '', 250), (s, 3, 'Firewood', '', 500), (s, 4, 'Leather Strips', '', 40);
  insert into public.expansion_resources (stage_id, sort, name, unit, note, goal, in_total) values
    (s, 5, 'Wheat', 'planted', 'Planting', 20, false), (s, 6, 'Leeks', 'planted', 'Planting', 16, false),
    (s, 7, 'Potatoes', 'planted', 'Planting', 16, false);

  insert into public.expansion_stages (sort, title) values (3, 'Stage 3: Cooking Hut') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 5500), (s, 2, 'Iron Ingots', '', 200), (s, 3, 'Corundum', '', 100),
    (s, 4, 'Firewood', '', 600), (s, 5, 'Pelts (Any)', '', 35);

  insert into public.expansion_stages (sort, title) values (4, 'Stage 4: Small Huts (6 Huts)') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, note, goal) values
    (s, 1, 'Gold', 'Septims', '4,500 per hut', 27000), (s, 2, 'Iron Ingots', '', '130 per hut', 780),
    (s, 3, 'Firewood', '', '400 per hut', 2400), (s, 4, 'Pelts (Any)', '', '40 per hut', 240),
    (s, 5, 'Leather Strips', '', '35 per hut', 210);

  insert into public.expansion_stages (sort, title) values (5, 'Stage 5: Gate Shop Hut with Sales Counter') returning id into s;
  insert into public.expansion_resources (stage_id, sort, name, unit, goal) values
    (s, 1, 'Gold', 'Septims', 9000), (s, 2, 'Iron Ingots', '', 350), (s, 3, 'Steel Ingots', '', 100),
    (s, 4, 'Corundum', '', 200), (s, 5, 'Firewood', '', 650), (s, 6, 'Leather Strips', '', 70), (s, 7, 'Silver Ingots', '', 8);
end $$;

insert into public.changelog (version, title, body)
select '0.1.0', 'The fire is lit',
       'First build of the Black Tusk companion: Code of Mauloch, the Oath, Notice Board, Members, Mine of the Black Tusks, Expansion Goals, Mining Map and Pricing Ledger.'
where not exists (select 1 from public.changelog);
