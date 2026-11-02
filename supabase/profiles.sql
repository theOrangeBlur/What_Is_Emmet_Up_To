-- Usernames. Paste into the Supabase SQL editor and run (before records.sql,
-- which reads usernames for record holders). Safe to re-run.
--
-- Usernames are unique ignoring case, 3–16 letters, numbers or underscores.
-- The table has no policies: it's only reached through the functions below,
-- so nobody can list accounts or tie usernames to emails.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- For the sign-up form, before the account exists.
create or replace function public.username_available(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_name ~ '^[A-Za-z0-9_]{3,16}$'
     and not exists (
       select 1 from public.profiles p
       where lower(p.username) = lower(p_name)
         and p.user_id is distinct from auth.uid());
$$;

-- Set or change the caller's username.
create or replace function public.set_username(p_name text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  p_name := trim(p_name);
  if p_name is null or p_name !~ '^[A-Za-z0-9_]{3,16}$' then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;
  begin
    insert into public.profiles as cur (user_id, username, updated_at)
    values (v_uid, p_name, now())
    on conflict (user_id) do update set username = excluded.username, updated_at = now();
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'taken');
  end;
  return json_build_object('ok', true, 'username', p_name);
end;
$$;

create or replace function public.get_my_profile()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('username', p.username)
  from public.profiles p where p.user_id = auth.uid();
$$;

revoke all on function public.username_available(text) from public;
revoke all on function public.set_username(text) from public, anon;
revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
