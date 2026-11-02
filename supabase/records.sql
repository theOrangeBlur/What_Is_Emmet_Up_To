-- Records (personal bests and site-wide all-time records) for the Trophy Case.
-- Paste into the Supabase SQL editor and run, after profiles.sql (record
-- holders go by their username). Safe to re-run: tables are created if
-- missing and functions are replaced.
--
-- Final Wordle records are read straight out of wordle_scores and
-- wordle_freeplay_scores. Everything else is tracked here:
--   user_visit_days  one row per (account, EST day) the visitor shows up signed in
--   user_stats       running tallies, bumped by add_stat() from the pages
--   user_reads       which movie/game reviews each account has opened

create table if not exists public.user_stats (
  user_id    uuid not null references auth.users on delete cascade,
  key        text not null,
  value      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.user_visit_days (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

create table if not exists public.user_reads (
  user_id uuid not null references auth.users on delete cascade,
  kind    text not null check (kind in ('movie', 'game')),
  item_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

alter table public.user_stats enable row level security;
alter table public.user_reads enable row level security;
alter table public.user_visit_days enable row level security;

drop policy if exists "read own stats" on public.user_stats;
create policy "read own stats" on public.user_stats
  for select using (auth.uid() = user_id);
drop policy if exists "read own visits" on public.user_visit_days;
create policy "read own visits" on public.user_visit_days
  for select using (auth.uid() = user_id);

-- Mark today (Eastern, same day boundary as the Wordle) as visited.
create or replace function public.record_visit()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.user_visit_days (user_id, day)
  values (auth.uid(), (now() at time zone 'America/New_York')::date)
  on conflict do nothing;
end;
$$;

drop policy if exists "read own reads" on public.user_reads;
create policy "read own reads" on public.user_reads
  for select using (auth.uid() = user_id);

-- Note that the caller opened a review. Re-opening one doesn't count twice.
create or replace function public.mark_read(p_kind text, p_item text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_kind not in ('movie', 'game') then raise exception 'unknown kind'; end if;
  if p_item is null or length(p_item) = 0 or length(p_item) > 120 then raise exception 'bad item'; end if;
  insert into public.user_reads (user_id, kind, item_id) values (auth.uid(), p_kind, p_item)
  on conflict do nothing;
end;
$$;

-- Add to one of the caller's tallies. Only known keys are accepted, and each
-- call is capped so a tampered client can't post absurd numbers in one go.
create or replace function public.add_stat(p_key text, p_delta bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cap bigint;
  v_value bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_cap := case p_key
    when 'fish_nips'         then 1000
    when 'snapshot_watch_ms' then 3600000  -- an hour of video per call
  end;
  if v_cap is null then raise exception 'unknown stat'; end if;
  if p_delta is null or p_delta <= 0 then return null; end if;

  insert into public.user_stats as cur (user_id, key, value, updated_at)
  values (v_uid, p_key, least(p_delta, v_cap), now())
  on conflict (user_id, key) do update set
    value = cur.value + excluded.value,
    updated_at = now()
  returning cur.value into v_value;
  return v_value;
end;
$$;

-- A record holder goes by their username, or failing that the arcade name
-- they last signed a Wordle score with. Emails never leave the database.
create or replace function public.record_holder_name(p_uid uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.username from public.profiles p where p.user_id = p_uid),
    (select s.name from public.wordle_scores s where s.user_id = p_uid order by s.created_at desc limit 1),
    (select f.name from public.wordle_freeplay_scores f where f.user_id = p_uid limit 1),
    'A MYSTERY GUEST'
  );
$$;

-- Who solved each daily fastest.
create or replace function public.wordle_daily_winners()
returns table (day text, name text, user_id uuid, device_id text)
language sql stable security definer set search_path = public as $$
  select distinct on (s.date) s.date::text, s.name, s.user_id, s.device_id
  from public.wordle_scores s
  where s.time_ms > 0
  order by s.date, s.time_ms, s.created_at;
$$;

-- Runs of consecutive visit days, one row per run.
create or replace function public.visit_streaks()
returns table (user_id uuid, first_day date, last_day date, len int)
language sql stable security definer set search_path = public as $$
  select v.user_id, min(v.day), max(v.day), count(*)::int
  from (
    select d.user_id, d.day,
           d.day - (row_number() over (partition by d.user_id order by d.day))::int as grp
    from public.user_visit_days d
  ) v
  group by v.user_id, v.grp;
$$;

-- Everything the Records tab shows: the caller's own numbers, and the
-- all-time best for each with its holder. p_device_id is the Wordle's
-- per-browser id, so solves made here before signing in still count.
-- Each site entry is { value, holder, date?, mine } (mine = caller holds it).
create or replace function public.get_records(p_device_id text default null)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dev text := nullif(p_device_id, '');
  v_today date := (now() at time zone 'America/New_York')::date;
  v_personal json;
  v_site json;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select json_build_object(
    'wordle_fastest', (
      select json_build_object('value', s.time_ms, 'date', s.date::text)
      from public.wordle_scores s
      where s.time_ms > 0 and (s.user_id = v_uid or s.device_id = v_dev)
      order by s.time_ms, s.created_at limit 1),
    'wordle_firsts', (
      select count(*) from public.wordle_daily_winners() w
      where w.user_id = v_uid or w.device_id = v_dev),
    'freeplay_best', (
      select max(f.score) from public.wordle_freeplay_scores f
      where f.user_id = v_uid or f.device_id = v_dev),
    'visit_days', (
      select count(*) from public.user_visit_days d where d.user_id = v_uid),
    'visit_streak_longest', (
      select max(v.len) from public.visit_streaks() v where v.user_id = v_uid),
    'visit_streak_current', (
      select coalesce(max(v.len), 0) from public.visit_streaks() v
      where v.user_id = v_uid and v.last_day >= v_today - 1),
    'member_since', (
      select u.created_at from auth.users u where u.id = v_uid),
    'snapshot_watch_ms', (
      select st.value from public.user_stats st where st.user_id = v_uid and st.key = 'snapshot_watch_ms'),
    'fish_nips', (
      select st.value from public.user_stats st where st.user_id = v_uid and st.key = 'fish_nips'),
    'movie_reads', (
      select count(*) from public.user_reads r where r.user_id = v_uid and r.kind = 'movie'),
    'game_reads', (
      select count(*) from public.user_reads r where r.user_id = v_uid and r.kind = 'game')
  ) into v_personal;

  select json_build_object(
    'wordle_fastest', (
      select json_build_object('value', s.time_ms, 'date', s.date::text,
                               'holder', case when s.user_id is null then s.name else public.record_holder_name(s.user_id) end,
                               'mine', coalesce(s.user_id = v_uid, false) or coalesce(s.device_id = v_dev, false))
      from public.wordle_scores s
      where s.time_ms > 0
      order by s.time_ms, s.created_at limit 1),
    'wordle_firsts', (
      -- Each group is one account (or one signed-out device), so its user_id is uniform.
      select json_build_object('value', count(*),
                               'holder', case when (array_agg(w.user_id))[1] is null
                                              then (array_agg(w.name order by w.day desc))[1]
                                              else public.record_holder_name((array_agg(w.user_id))[1]) end,
                               'mine', bool_or(coalesce(w.user_id = v_uid, false) or coalesce(w.device_id = v_dev, false)))
      from public.wordle_daily_winners() w
      group by coalesce(w.user_id::text, w.device_id)
      order by count(*) desc, min(w.day) limit 1),
    'freeplay_best', (
      select json_build_object('value', f.score,
                               'holder', case when f.user_id is null then f.name else public.record_holder_name(f.user_id) end,
                               'mine', coalesce(f.user_id = v_uid, false) or coalesce(f.device_id = v_dev, false))
      from public.wordle_freeplay_scores f
      order by f.score desc limit 1),
    'visit_days', (
      select json_build_object('value', count(*), 'holder', public.record_holder_name(d.user_id),
                               'mine', d.user_id = v_uid)
      from public.user_visit_days d
      group by d.user_id
      order by count(*) desc, min(d.day) limit 1),
    'visit_streak_longest', (
      select json_build_object('value', v.len, 'holder', public.record_holder_name(v.user_id),
                               'date', v.last_day, 'mine', v.user_id = v_uid)
      from public.visit_streaks() v
      order by v.len desc, v.last_day limit 1),
    'member_since', (
      select json_build_object('value', u.created_at, 'holder', public.record_holder_name(u.id),
                               'mine', u.id = v_uid)
      from auth.users u
      order by u.created_at limit 1),
    'snapshot_watch_ms', (
      select json_build_object('value', st.value, 'holder', public.record_holder_name(st.user_id),
                               'mine', st.user_id = v_uid)
      from public.user_stats st where st.key = 'snapshot_watch_ms'
      order by st.value desc, st.updated_at limit 1),
    'fish_nips', (
      select json_build_object('value', st.value, 'holder', public.record_holder_name(st.user_id),
                               'mine', st.user_id = v_uid)
      from public.user_stats st where st.key = 'fish_nips'
      order by st.value desc, st.updated_at limit 1),
    'movie_reads', (
      select json_build_object('value', count(*), 'holder', public.record_holder_name(r.user_id),
                               'mine', r.user_id = v_uid)
      from public.user_reads r where r.kind = 'movie'
      group by r.user_id
      order by count(*) desc, max(r.read_at) limit 1),
    'game_reads', (
      select json_build_object('value', count(*), 'holder', public.record_holder_name(r.user_id),
                               'mine', r.user_id = v_uid)
      from public.user_reads r where r.kind = 'game'
      group by r.user_id
      order by count(*) desc, max(r.read_at) limit 1)
  ) into v_site;

  return json_build_object('personal', v_personal, 'site', v_site);
end;
$$;

-- Helpers are only called from inside get_records.
revoke all on function public.record_holder_name(uuid) from public, anon, authenticated;
revoke all on function public.wordle_daily_winners() from public, anon, authenticated;
revoke all on function public.visit_streaks() from public, anon, authenticated;

revoke all on function public.record_visit() from public, anon;
revoke all on function public.mark_read(text, text) from public, anon;
revoke all on function public.add_stat(text, bigint) from public, anon;
revoke all on function public.get_records(text) from public, anon;
grant execute on function public.record_visit() to authenticated;
grant execute on function public.mark_read(text, text) to authenticated;
grant execute on function public.add_stat(text, bigint) to authenticated;
grant execute on function public.get_records(text) to authenticated;
