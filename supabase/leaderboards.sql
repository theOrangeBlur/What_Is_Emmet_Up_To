-- Weekly and monthly leaderboards for Final Wordle and Absolute 25, plus
-- yesterday's winner. Paste into the Supabase SQL editor and run, after
-- thermometers.sql (for est_day_key) and awards.sql (for the champion
-- awards), then run awards-hidden.sql for the buried champion awards. Safe
-- to re-run.
--
-- Standings are computed live from the score tables. Each day, signed-in
-- solves are ranked by time (ties go to whoever posted first) and earn
-- placement points: 15, 12, 10, 9, 8, 7, 6, 5, 4, 3, then 3 for every place
-- after that. Points add up over the week (Monday to Sunday, EST) or the
-- calendar month (EST). Signed-out solves don't count and don't take places.
--
-- Months are YYYYMM integers, e.g. 202611. Weeks are their Monday's day key,
-- e.g. 20261102.

-- The month before p_month (202601 -> 202512).
create or replace function public.month_key_before(p_month int)
returns int
language sql immutable as $$
  select case when p_month % 100 = 1 then (p_month / 100 - 1) * 100 + 12 else p_month - 1 end;
$$;

create or replace function public.monthly_points_for_place(p_place int)
returns int
language sql immutable as $$
  select coalesce((array[15, 12, 10, 9, 8, 7, 6, 5, 4, 3])[p_place], 3);
$$;

-- Day keys are YYYYMMDD integers. p_day shifted by p_n days.
create or replace function public.day_key_add(p_day int, p_n int)
returns int
language sql immutable as $$
  select to_char(to_date(p_day::text, 'YYYYMMDD') + p_n, 'YYYYMMDD')::int;
$$;

-- Weeks run Monday to Sunday and are keyed by their Monday (20261102).
create or replace function public.week_key_of(p_day int)
returns int
language sql immutable as $$
  select public.day_key_add(p_day, 1 - extract(isodow from to_date(p_day::text, 'YYYYMMDD'))::int);
$$;

-- Standings for p_game ('wordle' or 'thermo') over the day keys p_from..p_to
-- (inclusive). name is the arcade name the player used most recently.
create or replace function public.get_standings(p_game text, p_from int, p_to int)
returns table (user_id uuid, name text, points int, days_played int, wins int)
language sql stable security definer set search_path = public as $$
  with raw as (
    select s.user_id, s.date::text::int as day, s.time_ms, s.created_at, s.name
    from public.wordle_scores s
    where p_game = 'wordle' and s.user_id is not null and s.time_ms > 0
      and s.date::text::int between p_from and p_to
    union all
    select t.user_id, t.date, t.time_ms, t.created_at, t.name
    from public.thermo_scores t
    where p_game = 'thermo' and t.user_id is not null
      and t.date between p_from and p_to
  ),
  -- One solve per account per day: the first one posted.
  scores as (
    select distinct on (r.user_id, r.day) r.*
    from raw r
    order by r.user_id, r.day, r.created_at
  ),
  ranked as (
    select sc.*, row_number() over (partition by sc.day order by sc.time_ms, sc.created_at)::int as place
    from scores sc
  )
  select r.user_id,
         (array_agg(r.name order by r.created_at desc))[1],
         sum(public.monthly_points_for_place(r.place))::int,
         count(*)::int,
         (count(*) filter (where r.place = 1))::int
  from ranked r
  group by r.user_id
  order by 3 desc, 5 desc, 4 desc, min(r.created_at);
$$;

-- One month's standings. p_month null means the current month.
create or replace function public.get_monthly_standings(p_game text, p_month int default null)
returns table (user_id uuid, name text, points int, days_played int, wins int)
language sql stable security definer set search_path = public as $$
  select * from public.get_standings(p_game,
    coalesce(p_month, public.est_day_key() / 100) * 100 + 1,
    coalesce(p_month, public.est_day_key() / 100) * 100 + 31);
$$;

-- One week's standings. p_week (a Monday's day key) null means this week.
create or replace function public.get_weekly_standings(p_game text, p_week int default null)
returns table (user_id uuid, name text, points int, days_played int, wins int)
language sql stable security definer set search_path = public as $$
  select * from public.get_standings(p_game,
    coalesce(p_week, public.week_key_of(public.est_day_key())),
    public.day_key_add(coalesce(p_week, public.week_key_of(public.est_day_key())), 6));
$$;

-- Each month's winner, saved by crown_monthly_champions() the first time it
-- runs after the month ends. Once saved, the champion stays put even if that
-- month's scores are later deleted. No policies: only read through the
-- functions below.
create table if not exists public.monthly_champions (
  game        text not null check (game in ('wordle', 'thermo')),
  month       int not null,
  user_id     uuid references auth.users on delete set null,
  name        text,
  points      int,
  days_played int,
  wins        int,
  crowned_at  timestamptz not null default now(),
  primary key (game, month)
);
alter table public.monthly_champions enable row level security;

-- Last month's winner for p_game, or no row if nobody signed in played.
-- The saved champion is used if there is one; otherwise it's worked out live
-- from the scores.
-- color is their profile's favorite color (color1), which profile pages
-- already hand every visitor as `theme`; null if they haven't picked one.
-- name_font is the typeface they've picked for their name (shared/name-fonts.js).
drop function if exists public.get_monthly_champion(text); -- return columns changed; replace can't do that
create function public.get_monthly_champion(p_game text)
returns table (user_id uuid, name text, points int, days_played int, wins int, month int, color text, name_font text)
language sql stable security definer set search_path = public as $$
  with p as (select public.month_key_before(public.est_day_key() / 100) as month),
  saved as (
    select c.user_id, c.name, c.points, c.days_played, c.wins, c.month
    from public.monthly_champions c, p
    where c.game = p_game and c.month = p.month
  ),
  live as (
    select s.user_id, s.name, s.points, s.days_played, s.wins, p.month
    from p cross join lateral public.get_monthly_standings(p_game, p.month) s
    where not exists (select 1 from saved)
    limit 1
  )
  select w.user_id, w.name, w.points, w.days_played, w.wins, w.month, pr.answers->>'color1', pr.name_font
  from (select * from saved union all select * from live) w
  left join public.profiles pr on pr.user_id = w.user_id
  limit 1;
$$;

-- Each week's winner, saved by crown_weekly_champions() the same way.
create table if not exists public.weekly_champions (
  game        text not null check (game in ('wordle', 'thermo')),
  week        int not null, -- the week's Monday, as a day key
  user_id     uuid references auth.users on delete set null,
  name        text,
  points      int,
  days_played int,
  wins        int,
  crowned_at  timestamptz not null default now(),
  primary key (game, week)
);
alter table public.weekly_champions enable row level security;

-- Last week's winner for p_game, the same way as get_monthly_champion. No
-- announcement card goes with this one, so it skips color and name_font.
create or replace function public.get_weekly_champion(p_game text)
returns table (user_id uuid, name text, points int, days_played int, wins int, week int)
language sql stable security definer set search_path = public as $$
  with p as (select public.day_key_add(public.week_key_of(public.est_day_key()), -7) as week),
  saved as (
    select c.user_id, c.name, c.points, c.days_played, c.wins, c.week
    from public.weekly_champions c, p
    where c.game = p_game and c.week = p.week
  ),
  live as (
    select s.user_id, s.name, s.points, s.days_played, s.wins, p.week
    from p cross join lateral public.get_weekly_standings(p_game, p.week) s
    where not exists (select 1 from saved)
    limit 1
  )
  select * from saved union all select * from live
  limit 1;
$$;

-- Who won yesterday's daily: first place by the same signed-in ranking the
-- standings use. Worked out live; nothing is saved.
create or replace function public.get_daily_winner(p_game text)
returns table (user_id uuid, name text, day int)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.name, public.day_key_add(public.est_day_key(), -1)
  from public.get_standings(p_game,
         public.day_key_add(public.est_day_key(), -1),
         public.day_key_add(public.est_day_key(), -1)) s
  limit 1;
$$;

revoke all on function public.get_standings(text, int, int) from public;
revoke all on function public.get_monthly_standings(text, int) from public;
revoke all on function public.get_weekly_standings(text, int) from public;
revoke all on function public.get_monthly_champion(text) from public;
revoke all on function public.get_weekly_champion(text) from public;
revoke all on function public.get_daily_winner(text) from public;
grant execute on function public.get_standings(text, int, int) to anon, authenticated;
grant execute on function public.get_monthly_standings(text, int) to anon, authenticated;
grant execute on function public.get_weekly_standings(text, int) to anon, authenticated;
grant execute on function public.get_monthly_champion(text) to anon, authenticated;
grant execute on function public.get_weekly_champion(text) to anon, authenticated;
grant execute on function public.get_daily_winner(text) to anon, authenticated;

-- ── Champion awards ───────────────────────────────────────────────────────
-- Handed out by .github/workflows/crown-monthly-champions.yml (which calls
-- crown_champions) with the service role, never from a page (grant_award
-- would let anyone crown themself). Re-running changes nothing. Champions are
-- saved (the first save sticks) and the saved winner gets the award, so the
-- crown survives scores or awards being wiped.
-- The monthly (wordle_month_champ, thermo_month_champ) and weekly (b_w4, b_w5)
-- awards are buried, so they're defined in awards-hidden.sql. Only the daily
-- winner's award is listed here.
insert into public.awards (key, title, description, hint, icon, hidden, target, sort) values
  ('wordle_day_champ', 'Top Hat', 'Win a day of Final Wordle: the fastest signed-in solve.', null, '🎩', false, null, 93),
  ('thermo_day_champ', 'Hot Hat', 'Win a day of Absolute 25: the fastest signed-in solve.', null, '🎩', false, null, 123)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, hint = excluded.hint,
  icon = excluded.icon, hidden = excluded.hidden, target = excluded.target, sort = excluded.sort;

create or replace function public.crown_monthly_champions()
returns int
language plpgsql security definer set search_path = public as $$
declare
  g text;
  c record;
  n int := 0;
  v_month int := public.month_key_before(public.est_day_key() / 100);
begin
  foreach g in array array['wordle', 'thermo'] loop
    insert into public.monthly_champions (game, month, user_id, name, points, days_played, wins)
    select g, v_month, s.user_id, s.name, s.points, s.days_played, s.wins
    from public.get_monthly_standings(g, v_month) s
    limit 1
    on conflict (game, month) do nothing;

    for c in select * from public.monthly_champions mc
             where mc.game = g and mc.month = v_month and mc.user_id is not null loop
      insert into public.user_awards as cur (user_id, award_key, progress, unlocked_at)
      values (c.user_id, g || '_month_champ', 0, now())
      on conflict (user_id, award_key) do update set unlocked_at = coalesce(cur.unlocked_at, excluded.unlocked_at);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.crown_monthly_champions() from public, anon, authenticated;
grant execute on function public.crown_monthly_champions() to service_role;

-- Same as crown_monthly_champions, for last week. b_w4 / b_w5 are the buried
-- weekly awards for Final Wordle / Absolute 25.
create or replace function public.crown_weekly_champions()
returns int
language plpgsql security definer set search_path = public as $$
declare
  g text;
  c record;
  n int := 0;
  v_week int := public.day_key_add(public.week_key_of(public.est_day_key()), -7);
begin
  foreach g in array array['wordle', 'thermo'] loop
    insert into public.weekly_champions (game, week, user_id, name, points, days_played, wins)
    select g, v_week, s.user_id, s.name, s.points, s.days_played, s.wins
    from public.get_weekly_standings(g, v_week) s
    limit 1
    on conflict (game, week) do nothing;

    for c in select * from public.weekly_champions wc
             where wc.game = g and wc.week = v_week and wc.user_id is not null loop
      insert into public.user_awards as cur (user_id, award_key, progress, unlocked_at)
      values (c.user_id, case g when 'wordle' then 'b_w4' else 'b_w5' end, 0, now())
      on conflict (user_id, award_key) do update set unlocked_at = coalesce(cur.unlocked_at, excluded.unlocked_at);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.crown_weekly_champions() from public, anon, authenticated;
grant execute on function public.crown_weekly_champions() to service_role;

-- The daily winner's award, for each of the last three days, so a missed
-- run still catches up.
create or replace function public.award_daily_winners()
returns int
language plpgsql security definer set search_path = public as $$
declare
  g text;
  d int;
  v_uid uuid;
  n int := 0;
begin
  foreach g in array array['wordle', 'thermo'] loop
    for i in 1..3 loop
      d := public.day_key_add(public.est_day_key(), -i);
      select s.user_id into v_uid from public.get_standings(g, d, d) s limit 1;
      continue when v_uid is null;
      insert into public.user_awards as cur (user_id, award_key, progress, unlocked_at)
      values (v_uid, g || '_day_champ', 0, now())
      on conflict (user_id, award_key) do update set unlocked_at = coalesce(cur.unlocked_at, excluded.unlocked_at);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.award_daily_winners() from public, anon, authenticated;
grant execute on function public.award_daily_winners() to service_role;

-- Everything the daily workflow hands out.
create or replace function public.crown_champions()
returns json
language plpgsql security definer set search_path = public as $$
begin
  return json_build_object(
    'monthly', public.crown_monthly_champions(),
    'weekly',  public.crown_weekly_champions(),
    'daily',   public.award_daily_winners());
end;
$$;
revoke all on function public.crown_champions() from public, anon, authenticated;
grant execute on function public.crown_champions() to service_role;

-- ── Claiming signed-out Wordle solves ─────────────────────────────────────
-- Same as claim_thermo_scores: once a player signs in, this browser's
-- unclaimed solves from today and yesterday move onto the account, so a solve
-- made before signing in still counts toward the month.
create or replace function public.claim_wordle_scores(p_device_id text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_device_id is null or p_device_id = '' then return 0; end if;
  update public.wordle_scores s set user_id = v_uid
  where s.device_id = p_device_id
    and s.user_id is null
    and s.date::text::int >= to_char((now() at time zone 'UTC') - interval '29 hours', 'YYYYMMDD')::int
    and not exists (select 1 from public.wordle_scores o where o.date = s.date and o.user_id = v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.claim_wordle_scores(text) from public, anon;
grant execute on function public.claim_wordle_scores(text) to authenticated;

-- ── Retiring the family leaderboard ───────────────────────────────────────
drop table if exists public.wordle_family_points;
drop table if exists public.wordle_family_members;
-- is_family stays as an unused column: browsers still holding the old
-- final-wordle.js send it on every insert, and PostgREST rejects the whole
-- insert (PGRST204) if the column is missing. Drop it once caches have
-- turned over (a few weeks after 2026-11-03).
alter table public.wordle_scores add column if not exists is_family boolean;
