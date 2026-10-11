-- Who has the companion app open right now.
--
-- While a signed-in member has the app in front of them it says so once a minute
-- (touch_seen). Anyone whose last word is under two and a half minutes old counts
-- as "on the app" (app_online). The times are kept in a table of their own, with
-- no policies at all: nobody reads or writes it except through these two
-- functions, so a member can only ever mark themselves, and the only thing that
-- comes back out is the list of members who are on the app at this moment.
create table if not exists public.app_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.app_presence enable row level security;
revoke all on public.app_presence from anon, authenticated;

create or replace function public.touch_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_member() then return; end if;
  insert into public.app_presence (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
end $$;

-- Leaving: signing out says so at once instead of waiting for the time to run out.
create or replace function public.leave_app() returns void
language sql security definer set search_path = '' as $$
  delete from public.app_presence where user_id = auth.uid();
$$;

create or replace function public.app_online() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.user_id from public.app_presence a
  where public.is_member() and a.seen_at > now() - interval '150 seconds';
$$;

revoke all on function public.touch_seen() from public, anon;
revoke all on function public.leave_app() from public, anon;
revoke all on function public.app_online() from public, anon;
grant execute on function public.touch_seen() to authenticated;
grant execute on function public.leave_app() to authenticated;
grant execute on function public.app_online() to authenticated;
