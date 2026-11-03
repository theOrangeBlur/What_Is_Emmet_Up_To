-- Thermometers: published daily puzzles and the daily leaderboard.
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

grant select on public.thermo_daily to anon, authenticated;
grant select, insert on public.thermo_scores to anon, authenticated;
