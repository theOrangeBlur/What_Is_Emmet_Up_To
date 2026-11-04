-- Absolute 25 (formerly Thermometers; the tables keep their thermo_ names):
-- published daily puzzles and the daily leaderboard.
-- Run this before the thermo_* additions in unlocks.sql (unlock_stat_value reads thermo_scores).
--
-- Days are YYYYMMDD integers on EST (UTC-5), the same as Final Wordle's getDayKey().

create or replace function public.est_day_key()
returns int
language sql stable as $$
  select to_char((now() at time zone 'UTC') - interval '5 hours', 'YYYYMMDD')::int;
$$;

-- ── Published dailies ─────────────────────────────────────────────────────
-- Written by .github/workflows/generate-daily-thermo.yml with the service role
-- (which bypasses RLS). A row is never replaced once written, so a day's puzzle
-- stays fixed even when the generator changes.
create table if not exists public.thermo_daily (
  date       int primary key,
  puzzle     jsonb not null,
  grade      jsonb,
  created_at timestamptz not null default now()
);
alter table public.thermo_daily enable row level security;

-- The puzzle includes its solution (the page needs it for Check and Hint), so
-- future days stay hidden until they start.
drop policy if exists thermo_daily_read on public.thermo_daily;
create policy thermo_daily_read on public.thermo_daily
  for select to anon, authenticated
  using (date <= public.est_day_key());

-- ── Daily scores ──────────────────────────────────────────────────────────
-- time_ms already includes the hint penalty (30 s per hint).
create table if not exists public.thermo_scores (
  id         bigint generated always as identity primary key,
  date       int not null,
  name       text not null check (char_length(name) between 1 and 6),
  time_ms    int not null check (time_ms > 0 and time_ms < 86400000),
  hints      int not null default 0 check (hints >= 0),
  device_id  text not null,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists thermo_scores_one_per_device on public.thermo_scores (date, device_id);
create unique index if not exists thermo_scores_one_per_user on public.thermo_scores (date, user_id) where user_id is not null;
create index if not exists thermo_scores_by_day on public.thermo_scores (date, time_ms);
alter table public.thermo_scores enable row level security;

drop policy if exists thermo_scores_read on public.thermo_scores;
create policy thermo_scores_read on public.thermo_scores
  for select to anon, authenticated
  using (true);

-- Posting: only for today (or yesterday, for a solve that crossed midnight), and
-- a signed-in row must belong to the poster.
drop policy if exists thermo_scores_insert on public.thermo_scores;
create policy thermo_scores_insert on public.thermo_scores
  for insert to anon, authenticated
  with check (
    date between to_char((now() at time zone 'UTC') - interval '29 hours', 'YYYYMMDD')::int
             and public.est_day_key()
    and (user_id is null or user_id = auth.uid())
  );

-- Claiming: a daily solved signed out is saved with user_id null, so its name
-- can't link to a profile. When the player signs in, the page hands over its
-- device id and this attaches that browser's recent unclaimed scores to the
-- account. Device ids are readable from thermo_scores, so only today's and
-- yesterday's scores can be claimed, which keeps anyone from collecting a
-- stranger's old scores. A day the account already has a score for is skipped.
create or replace function public.claim_thermo_scores(p_device_id text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_device_id is null or p_device_id = '' then return 0; end if;
  update public.thermo_scores s set user_id = v_uid
  where s.device_id = p_device_id
    and s.user_id is null
    and s.date >= to_char((now() at time zone 'UTC') - interval '29 hours', 'YYYYMMDD')::int
    and not exists (select 1 from public.thermo_scores o where o.date = s.date and o.user_id = v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.claim_thermo_scores(text) from public, anon;
grant execute on function public.claim_thermo_scores(text) to authenticated;

grant select on public.thermo_daily to anon, authenticated;
grant select, insert on public.thermo_scores to anon, authenticated;
