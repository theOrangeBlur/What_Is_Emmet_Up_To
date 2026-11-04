-- Monthly leaderboards for Final Wordle and Thermometers.
-- Paste into the Supabase SQL editor and run, after thermometers.sql (for
-- est_day_key) and awards.sql (for the champion awards). Safe to re-run.
--
-- Standings are computed live from the score tables; nothing is stored.
-- Each day, signed-in solves are ranked by time (ties go to whoever posted
-- first) and earn placement points: 15, 12, 10, 9, 8, 7, 6, 5, 4, 3, then 3
-- for every place after that. Points add up over the calendar month (EST) and
-- start fresh on the 1st. Signed-out solves don't count and don't take places.
--
-- Months are YYYYMM integers, e.g. 202611.

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

-- One month's standings for p_game ('wordle' or 'thermo'). p_month null means
-- the current month. name is the arcade name the player used most recently.
create or replace function public.get_monthly_standings(p_game text, p_month int default null)
returns table (user_id uuid, name text, points int, days_played int, wins int)
language sql stable security definer set search_path = public as $$
  with m as (select coalesce(p_month, public.est_day_key() / 100) as month),
  raw as (
    select s.user_id, s.date::text::int as day, s.time_ms, s.created_at, s.name
    from public.wordle_scores s, m
    where p_game = 'wordle' and s.user_id is not null and s.time_ms > 0
      and s.date::text::int / 100 = m.month
    union all
    select t.user_id, t.date, t.time_ms, t.created_at, t.name
    from public.thermo_scores t, m
    where p_game = 'thermo' and t.user_id is not null
      and t.date / 100 = m.month
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

-- Last month's winner for p_game, or no row if nobody signed in played.
-- color is their profile's favorite color (color1), which profile pages
-- already hand every visitor as `theme`; null if they haven't picked one.
-- name_font is the typeface they've picked for their name (shared/name-fonts.js).
drop function if exists public.get_monthly_champion(text); -- return columns changed; replace can't do that
create function public.get_monthly_champion(p_game text)
returns table (user_id uuid, name text, points int, days_played int, wins int, month int, color text, name_font text)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.name, s.points, s.days_played, s.wins, p.month, pr.answers->>'color1', pr.name_font
  from (select public.month_key_before(public.est_day_key() / 100) as month) p
  cross join lateral public.get_monthly_standings(p_game, p.month) s
  left join public.profiles pr on pr.user_id = s.user_id
  limit 1;
$$;

revoke all on function public.get_monthly_standings(text, int) from public;
revoke all on function public.get_monthly_champion(text) from public;
grant execute on function public.get_monthly_standings(text, int) to anon, authenticated;
grant execute on function public.get_monthly_champion(text) to anon, authenticated;

-- ── Champion awards ───────────────────────────────────────────────────────
-- Handed out by .github/workflows/crown-monthly-champions.yml with the service
-- role, never from a page (grant_award would let anyone crown themself).
-- Running it more than once a month changes nothing.
insert into public.awards (key, title, description, hint, icon, hidden, target, sort) values
  ('wordle_month_champ', 'Word of the Month', 'Finish a month on top of the Final Wordle standings.', null, '👑', false, null, 95),
  ('thermo_month_champ', 'Hottest of the Month', 'Finish a month on top of the Thermometers standings.', null, '👑', false, null, 125)
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
begin
  foreach g in array array['wordle', 'thermo'] loop
    for c in select * from public.get_monthly_champion(g) loop
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
alter table public.wordle_scores drop column if exists is_family;
