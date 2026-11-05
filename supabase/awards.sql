-- Awards (Steam-style achievements). Paste into the Supabase SQL editor and
-- run. Safe to re-run: tables are created if missing, functions are replaced,
-- and award rows are upserted so edits here overwrite what's live.
--
-- Three kinds of award:
--   visible  everything shown up front
--   hidden   name and hint shown; description and progress stay secret until earned
--   buried   not listed at all until earned
-- Hidden and buried awards are seeded separately in awards-hidden.sql, which is
-- gitignored so their secrets never land in the public repo.

create table if not exists public.awards (
  key         text primary key,
  title       text not null,
  description text not null,
  hint        text,             -- shown on hidden awards before they're unlocked
  icon        text not null default '🏆',
  hidden      boolean not null default false,
  target      int,              -- null = one-shot; n = progress award (unlocks at n)
  sort        int not null default 0
);

create table if not exists public.user_awards (
  user_id     uuid not null references auth.users on delete cascade,
  award_key   text not null references public.awards on delete cascade,
  progress    int not null default 0,
  unlocked_at timestamptz,
  primary key (user_id, award_key)
);

alter table public.awards add column if not exists buried boolean not null default false;

-- No policies on awards: nobody can read it directly, so hidden award text
-- only ever leaves the database through get_awards()/grant_award() below.
alter table public.awards enable row level security;
alter table public.user_awards enable row level security;

drop policy if exists "read own awards" on public.user_awards;
create policy "read own awards" on public.user_awards
  for select using (auth.uid() = user_id);

-- Every award with the caller's progress and how rare it is. Hidden awards the
-- caller hasn't earned come back with just a name and hint; buried awards the
-- caller hasn't earned don't come back at all.
drop function if exists public.get_awards(); -- return columns changed; replace can't do that
create function public.get_awards()
returns table (
  key text, title text, description text, hint text, icon text, hidden boolean, buried boolean,
  target int, sort int, progress int, unlocked_at timestamptz, rarity_pct numeric
)
language sql stable security definer set search_path = public as $$
  select
    a.key,
    a.title,
    case when a.hidden and ua.unlocked_at is null then null else a.description end,
    a.hint,
    case when a.hidden and ua.unlocked_at is null then '❓' else a.icon end,
    a.hidden,
    a.buried,
    -- Progress would give away what a hidden award is counting, so mask that too.
    case when a.hidden and ua.unlocked_at is null then null else a.target end,
    a.sort,
    case when a.hidden and ua.unlocked_at is null then 0 else coalesce(ua.progress, 0) end,
    ua.unlocked_at,
    round(100.0 * (select count(*) from public.user_awards x
                   where x.award_key = a.key and x.unlocked_at is not null)
                / (select greatest(count(*), 1) from auth.users), 1)
  from public.awards a
  left join public.user_awards ua on ua.award_key = a.key and ua.user_id = auth.uid()
  where auth.uid() is not null
    and (not a.buried or ua.unlocked_at is not null)
  order by a.sort, a.key;
$$;

-- Unlock (or advance progress on) an award for the signed-in caller. Progress
-- only ever ratchets up. Returns enough for the client to show a toast.
create or replace function public.grant_award(p_key text, p_progress int default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.awards;
  ua public.user_awards;
  was_unlocked boolean := false;
  new_progress int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into a from public.awards where public.awards.key = p_key;
  if not found then raise exception 'unknown award'; end if;

  select ua0.unlocked_at is not null into was_unlocked
    from public.user_awards ua0 where ua0.user_id = uid and ua0.award_key = p_key;
  was_unlocked := coalesce(was_unlocked, false);

  new_progress := case when a.target is null then 0 else least(coalesce(p_progress, 0), a.target) end;

  insert into public.user_awards as cur (user_id, award_key, progress, unlocked_at)
  values (uid, p_key, new_progress,
          case when a.target is null or new_progress >= a.target then now() end)
  on conflict (user_id, award_key) do update set
    progress    = greatest(cur.progress, excluded.progress),
    unlocked_at = coalesce(cur.unlocked_at, excluded.unlocked_at)
  returning * into ua;

  return json_build_object(
    'key', a.key,
    'unlocked', ua.unlocked_at is not null,
    'newly_unlocked', not was_unlocked and ua.unlocked_at is not null,
    'progress', ua.progress,
    'target', case when a.hidden and ua.unlocked_at is null then null else a.target end,
    'title', case when (a.hidden or a.buried) and ua.unlocked_at is null then null else a.title end,
    'description', case when (a.hidden or a.buried) and ua.unlocked_at is null then null else a.description end,
    'icon', a.icon,
    'buried', a.buried
  );
end;
$$;

revoke all on function public.get_awards() from public, anon;
revoke all on function public.grant_award(text, int) from public, anon;
grant execute on function public.get_awards() to authenticated;
grant execute on function public.grant_award(text, int) to authenticated;

-- ── Visible awards ────────────────────────────────────────────────────────
insert into public.awards (key, title, description, hint, icon, hidden, target, sort) values
  ('welcome',          'Foot in the Door',   'Knock on the door and get let in.',                                           null, '🚪',  false, null, 10),
  ('booked_chat',      'A Word With You',    'Book a time to chat with our dear Emmet.',                                    null, '📅',  false, null, 15),
  ('paperboy',         'Paperboy',           'Read eight different pages of the Enquirer.',                                 null, '🗞️', false, 8,    20),
  ('discipline_seven', 'On a Roll',          'Drop by the Personal Dispatch while Emmet is on a seven-day perfect streak.', null, '🔥',  false, null, 25),
  ('hex_one',          'Hexed',              'Solve a Hexdoku level.',                                                      null, '⬡',  false, null, 30),
  ('hex_all',          'Hexpert',            'Solve all three Hexdoku levels.',                                             null, '🐝',  false, 3,    40),
  ('ferryman',         'Ferryman',           'Get everyone across the river in one piece.',                                 null, '⛵',  false, null, 50),
  ('scales',           'Tipping the Scales', 'Find the odd coin in the Coin Riddle.',                                       null, '⚖️', false, null, 60),
  ('scales_perfect',   'Perfect Balance',    'Find the odd coin in three weighings or fewer.',                              null, '🪙',  false, null, 70),
  ('scales_streak',    'Prove It',           'Find the odd coin three times in a row.',                                     null, '🔁',  false, 3,    75),
  ('wordle_daily',     'Final Answer',       'Solve a daily Final Wordle.',                                                 null, '🟩',  false, null, 80),
  ('wordle_regular',   'The Regular',        'Solve ten daily Final Wordles while signed in.',                              null, '☕',  false, 10,   90),
  ('wordle_free10',    'Wordsmith',          'Solve ten words in a single freeplay session.',                               null, '✒️', false, null, 100),
  ('thermo_daily',     'Taking Temperature', 'Solve a daily Absolute 25.',                                                        null, '🌡️', false, null, 110),
  ('thermo_nohint',    'Cold Reading',       'Solve a daily Absolute 25 without a hint.',                                   null, '🧊',  false, null, 115),
  ('thermo_free10',    'Heat Wave',          'Solve ten free play Absolute puzzles.',                                       null, '🔥',  false, 10,   120)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, hint = excluded.hint,
  icon = excluded.icon, hidden = excluded.hidden, target = excluded.target, sort = excluded.sort;

-- BEGIN pixel-art award icons
-- Each icon is a 16x16 PNG stored right in the icon column, so secret art never
-- has to be a public file. Runs after the seed above, which would otherwise put
-- the emoji back. Shown by Awards.fillIcon in shared/awards.js.
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAATElEQVR4nGNgQAL5rmr/icEMuABIckOVK15MlAG4bCbJAGw209cAirxAcSBiw/9fdv1/sd+efANAmldUyYyoaByC6cDLP+Y/KRimDwCfA1vMWa2l+gAAAABJRU5ErkJggg==' where key = 'welcome'; -- door
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXElEQVR4nGNgQAP17VP+o4sRlHvgavUfhkGKkPn45LAaQAqGG7BYzeo/ORhuwH8ywNHTV1ANAPkPhIllU98AmnkBFuJke4FoA2jmBWQ2bQ2gyAsgDjkYV64lCQAAWlZ9ew+07u8AAAAASUVORK5CYII=' where key = 'booked_chat'; -- calendar
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUUlEQVR4nGNgoAb4TyI4evrKfwwDtHUtiMIwA+rbp/ynrgGkegHDAC//GBQMAiBFyJhkA4aYC7ABklyAS/EQdwHRBoAESMUoBoAAuhcIYZg+ANRllGLIiKO4AAAAAElFTkSuQmCC' where key = 'paperboy'; -- newspaper
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAcklEQVR4nGNgwAMeuFr9xyePF4A0U2zAhwUO5BkCsx2bAQQNRNYMMwBZE16voWvGZghOA3BpRjcErwHIGv6/7MJrEF7bQZphmGgDsGnG5wrCBsAAFoNIMwCLIXjDgJABREUjiiHEaCY2IRGdL9ATDT6NADOdkdxcneqZAAAAAElFTkSuQmCC' where key = 'discipline_seven'; -- flame
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPklEQVR4nGNgoAV4sd/+PyniKApgirCxPyxw+I8sTrStII3oGEP9MDCA4kAk1jV4NQ4jAxjwBCjJgGyNdAMAc5K6QgMQWasAAAAASUVORK5CYII=' where key = 'hex_one'; -- hexagon
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXklEQVR4nGNgoDZYcef7fxjGJ4ZTMzKAaUIXI9oAbIBkV5CkGZufifY/CGjrWvwH4Rf77cEYF5+gRkIGgNgomkGAVAPghsAEyTEA7h1yDcAIB7LCgCqxgM0gfPzBBQB+8GSN644+RwAAAABJRU5ErkJggg==' where key = 'hex_all'; -- bee
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgUlEQVR4nGNgwAPq26f8xydPEIAMAAGKDSDLkAeuVv+RDSDJEJBmbAYQZQhMMy4D8BqCrBmfAVgNQdeMz4Cjp6+AMVzzYjWr/9gwyACYYmyYYHgQnZDyXdX+b6hyJQmD9JBtCIZmZEOIwSia4rc8+A/C+vnz/8PYpPDBhlCkmVIAAAg2cakTldhxAAAAAElFTkSuQmCC' where key = 'ferryman'; -- boat
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAb0lEQVR4nGNgoCX4/7Lr/4v99v/JNgCkGWYAzDBkMaJdgK5hRZUMbgPQbcKlGcUQXDYRbQAuZ6EbgK4GzsdlKroB6N4j2QCYGhjG7ywcBmAAig3A6S9iDcDqL1INwAXIMgBbSsTmPZwA2TvYMLp6AND55MIzjw4kAAAAAElFTkSuQmCC' where key = 'scales'; -- scales
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYUlEQVR4nGNgoAV4sd/+PzZMtMb/L7uw4hVVMmCMUzNMIS4X4DSEGM14DYFJICuEKYJhbHIEDcDlCqIMQFZItgG4XEO7MCAmFpANxRqVxBqANTHhCjSiNGMzCB0T1DggAAB3wayK29kQzwAAAABJRU5ErkJggg==' where key = 'scales_perfect'; -- coin
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAT0lEQVR4nGNgoBeYfTnrP8UGEDQEpogQpkgzTkNAgsG9fjidCNOIUw0xBuCTJ6yAWoBilxAMB7INoDgaQQBkMjEYp//RXUNQIS5Al+iEAQCW676HXjH6egAAAABJRU5ErkJggg==' where key = 'scales_streak'; -- repeat
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARUlEQVR4nGNgoAaYfTnrPzkYxYDgXj+SsH68GQ0MgAFcmpDlh4gB+Pi0NwAdkGQALptJMgBXANI2FshOiSAOOZisnIsOAEy6C4Fq7ZvdAAAAAElFTkSuQmCC' where key = 'wordle_daily'; -- tile
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVElEQVR4nGNgwAKOnr7yHx8fL6BI8+BxAVngP5EAp4tAkvmuangxQQOIsR2EYYAsA2Aakdn0NQAZkxQOODURYwhBzfXtU0h2PkgPhiGkYIJeIRYAAFdtuOKghbYHAAAAAElFTkSuQmCC' where key = 'wordle_regular'; -- coffee
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAeUlEQVR4nGNgIBF4+cf819a1+E+qPhTNMEyy5q3ND/5n2S8g3RCYZpgBMENI1oxsAO01v9hv/x+EydL8/2XXf5gBIEyS5qOnr/yHAZgBK6pkSNcMAiA+WZpBUQQzoL59CmkGUKQZ2elEa0Y2AKaRZM1kaYQBsjQhAQCuH+sp15h+RgAAAABJRU5ErkJggg==' where key = 'wordle_free10'; -- pen
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAT0lEQVR4nGNgwAGOnr7yHxnjUodTMzogyRCYATA+ugH17VPwG0bIAPq54IGrFRiT7QJcBoy6gETNJBmCrvnDAgfSDMFlO0WuIDscsGFsagGBSU7fbYRflAAAAABJRU5ErkJggg==' where key = 'thermo_daily'; -- thermometer
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR4nGNgoAVYcef7f0IYr2Z8ACQfv+UBdgOI1YzVAGKcDdOM0wBkm/BpxmsAMbaT5QWyDEB2EckGoIcHsmb9/PnkuwCrZmLDAKdmYgzAqxkEQArwYbyaBxQAAE1V06o8+5KQAAAAAElFTkSuQmCC' where key = 'thermo_nohint'; -- ice
update public.awards set icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAcklEQVR4nGNgwAMeuFr9xyePF4A0U2zAhwUO5BkCsx2bAQQNRNYMMwBZE16voWvGZghOA3BpRjcErwHIGv6/7MJrEF7bQZphmGgDsGnG5wrCBsAAFoNIMwCLIXjDgJABREUjiiHEaCY2IRGdL9ATDT6NADOdkdxcneqZAAAAAElFTkSuQmCC' where key = 'thermo_free10'; -- flame
-- END pixel-art award icons
