-- Sign-in names keep the capitals they were given ("Grug"). Signing in and
-- uniqueness ignore case, so "grug" and "GRUG" are the same member.
-- Run after 0001_black_tusk.sql. Safe to re-run.

alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$');
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

-- The sign-in email is always the lower-case name.
create or replace function public.on_login_email_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  if new.email is not distinct from old.email then return new; end if;
  select username into u from public.profiles where id = new.id;
  if u is null then return new; end if;                     -- not a member account
  if split_part(new.email, '@', 1) <> lower(u) or split_part(new.email, '@', 2) <> split_part(old.email, '@', 2) then
    raise exception 'Sign-in names are changed by the Forgemaster' using errcode = '42501';
  end if;
  return new;
end $$;

-- Removed members' names are remembered in lower case.
update public.retired_names set username = lower(username) where username <> lower(username);

create or replace function public.admin_finish_create(
  p_id uuid, p_username text, p_display_name text, p_tags text[], p_discord_name text, p_cipher text, p_actor uuid)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  insert into public.profiles (id, username, display_name, tags, discord_name, must_change_password)
  values (p_id, p_username, p_display_name, p_tags, p_discord_name, true) returning * into row;
  insert into public.password_vault (user_id, cipher) values (p_id, p_cipher)
    on conflict (user_id) do update set cipher = excluded.cipher, next_cipher = null, next_at = null, updated_at = now();
  delete from public.retired_names where username = lower(p_username);
  insert into public.audit_log (actor, action, target, detail)
  values (p_actor, 'member.created', p_id, jsonb_build_object('username', p_username, 'tags', p_tags));
  return row;
end $$;
