-- Unlocks: the rewards awards give out (skins, titles, secret pages, perks).
-- Paste into the Supabase SQL editor and run, after awards.sql,
-- records.sql, thermometers.sql and profiles.sql (stat rules read their tables). Safe to
-- re-run: tables are created if missing, functions are replaced, and rows are
-- upserted so edits here overwrite what's live.
--
-- Unlocks are one-way. A visitor earns one the first time any of these hold:
--   they've earned an award mapped to it in award_unlocks
--   their total award count reaches its min_awards
--   their stat_key number (see unlock_stat_value) reaches its stat_target
-- get_my_unlocks() then records it in user_unlocks, and from there on it's
-- theirs even if the rule stops holding (e.g. they make fields private
-- again). Adding a rule later still hands it out retroactively.
--
-- Taking one away is a back-end job: set revoked_at on its user_unlocks row.
-- A revoked row stays put, so the rules can't hand it straight back. Delete
-- the row instead to let them earn it again.
--
-- Keys are kind:name, e.g. skin:midnight, title:hexpert, page:vault, perk:comment.
-- Rewards tied to hidden or buried awards (and any secret page content) go in
-- unlocks-hidden.sql, which is gitignored like awards-hidden.sql.

create table if not exists public.unlocks (
  key         text primary key,
  kind        text not null check (kind in ('skin', 'title', 'flair', 'page', 'perk')),
  title       text not null,
  description text,
  icon        text not null default '🎁',
  min_awards  int,              -- null = only via award_unlocks; n = also unlocked at n awards earned
  sort        int not null default 0
);

alter table public.unlocks add column if not exists stat_key text;      -- see unlock_stat_value()
alter table public.unlocks add column if not exists stat_target bigint;
-- Shown on the lock before it's earned, e.g. "Read seven reviews". Leave null
-- on anything whose requirement should stay a secret.
alter table public.unlocks add column if not exists requirement text;

create table if not exists public.award_unlocks (
  award_key  text not null references public.awards on delete cascade,
  unlock_key text not null references public.unlocks on delete cascade,
  primary key (award_key, unlock_key)
);

-- Body of a gated page. Lives here rather than in the repo, since anything in
-- the repo is public.
create table if not exists public.unlock_content (
  unlock_key text primary key references public.unlocks on delete cascade,
  body       text not null
);

-- Who has earned what. Written by get_my_unlocks(), never by clients.
create table if not exists public.user_unlocks (
  user_id     uuid not null references auth.users on delete cascade,
  unlock_key  text not null references public.unlocks on delete cascade,
  unlocked_at timestamptz not null default now(),
  revoked_at  timestamptz,      -- set by hand to take it away; see the top of this file
  primary key (user_id, unlock_key)
);

-- No policies: these only leave the database through the functions below, so
-- the rewards behind hidden awards stay secret.
alter table public.user_unlocks enable row level security;
alter table public.unlocks enable row level security;
alter table public.award_unlocks enable row level security;
alter table public.unlock_content enable row level security;

-- One of an account's numbers, by name. Read/visit/Wordle counts come from
-- the records tables; anything else is a user_stats tally.
create or replace function public.unlock_stat_value(p_uid uuid, p_key text)
returns bigint
language sql stable security definer set search_path = public as $$
  select case p_key
    when 'movie_reads'   then (select count(*) from public.user_reads r where r.user_id = p_uid and r.kind = 'movie')
    when 'game_reads'    then (select count(*) from public.user_reads r where r.user_id = p_uid and r.kind = 'game')
    when 'project_reads' then (select count(*) from public.user_reads r where r.user_id = p_uid and r.kind = 'project')
    when 'visit_days'    then (select count(*) from public.user_visit_days d where d.user_id = p_uid)
    when 'wordle_daily_solves' then (select count(distinct s.date) from public.wordle_scores s where s.user_id = p_uid)
    -- Every game finished anywhere on the site: daily and free play Wordles and
    -- Thermometers, each Hexdoku level, the River Crossing once, and up to
    -- three Coin Riddle solves (solves from before balance_solves was counted
    -- still earn one, through the award).
    when 'games_played' then
        (select count(distinct s.date) from public.wordle_scores s where s.user_id = p_uid)
      + (select count(distinct t.date) from public.thermo_scores t where t.user_id = p_uid)
      + coalesce((select sum(st.value) from public.user_stats st
                  where st.user_id = p_uid and st.key in ('wordle_free_plays', 'thermo_free_solves')), 0)
      + greatest(
          coalesce((select ua.progress from public.user_awards ua where ua.user_id = p_uid and ua.award_key = 'hex_all'), 0),
          (select count(*) from public.user_awards ua where ua.user_id = p_uid and ua.award_key = 'hex_one' and ua.unlocked_at is not null))
      + (select count(*) from public.user_awards ua
         where ua.user_id = p_uid and ua.award_key = 'ferryman' and ua.unlocked_at is not null)
      + greatest(
          least(coalesce((select st.value from public.user_stats st where st.user_id = p_uid and st.key = 'balance_solves'), 0), 3),
          (select count(*) from public.user_awards ua where ua.user_id = p_uid and ua.award_key = 'scales' and ua.unlocked_at is not null))
    -- Profile fields others can see: marked public AND filled in, so flipping
    -- empty fields to public doesn't count. Favorite colors are never shown
    -- as answers (they become the theme), so they don't count either.
    when 'public_fields' then
      (select count(*) from public.profiles p, unnest(p.public_fields) f
       where p.user_id = p_uid
         and case f
               when 'bio'   then coalesce(p.bio, '') <> ''
               when 'art'   then p.art_path is not null
               when 'sound' then p.sound_path is not null
               else f not in ('color1', 'color2', 'color3') and coalesce(p.answers->>f, '') <> ''
             end)
    else (select st.value from public.user_stats st where st.user_id = p_uid and st.key = p_key)
  end;
$$;

-- The unlocks whose rules hold for p_uid right now. Only get_my_unlocks()
-- and the backfill below use this; what a visitor has is user_unlocks.
create or replace function public.unlocks_qualifying(p_uid uuid)
returns table (key text)
language sql stable security definer set search_path = public as $$
  with earned as (
    select award_key from public.user_awards
    where user_id = p_uid and unlocked_at is not null
  )
  select u.key
  from public.unlocks u
  where p_uid is not null
    and (exists (select 1 from public.award_unlocks au
                 join earned e on e.award_key = au.award_key
                 where au.unlock_key = u.key)
         or (u.min_awards is not null and (select count(*) from earned) >= u.min_awards)
         or (u.stat_key is not null and coalesce(public.unlock_stat_value(p_uid, u.stat_key), 0) >= u.stat_target));
$$;

-- Every unlock the caller has. Records any newly earned ones first, so they
-- stick. Not stable (it writes), so anything calling it can't be either.
create or replace function public.get_my_unlocks()
returns table (key text, kind text, title text, description text, icon text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.user_unlocks (user_id, unlock_key)
  select v_uid, q.key from public.unlocks_qualifying(v_uid) q
  on conflict do nothing;
  return query
    select u.key, u.kind, u.title, u.description, u.icon
    from public.user_unlocks uu
    join public.unlocks u on u.key = uu.unlock_key
    where uu.user_id = v_uid and uu.revoked_at is null
    order by u.sort, u.key;
end;
$$;

-- Where the caller stands on each of p_keys, for drawing a lock: whether
-- they have it, the requirement text, and progress when there's a number to
-- show (the stat rule, or else a visible counting award mapped to it).
drop function if exists public.get_unlock_status(text[]); -- return columns changed; replace can't do that
create function public.get_unlock_status(p_keys text[])
returns table (key text, unlocked boolean, requirement text, value bigint, target bigint, stat_key text)
language sql volatile security definer set search_path = public as $$
  select u.key,
         exists (select 1 from public.get_my_unlocks() m where m.key = u.key),
         u.requirement,
         coalesce(case when u.stat_key is not null then coalesce(public.unlock_stat_value(auth.uid(), u.stat_key), 0) end,
                  aw.progress),
         coalesce(u.stat_target, aw.target),
         u.stat_key
  from public.unlocks u
  left join lateral (
    select coalesce(ua.progress, 0)::bigint as progress, a.target::bigint as target
    from public.award_unlocks au
    join public.awards a on a.key = au.award_key
    left join public.user_awards ua on ua.award_key = a.key and ua.user_id = auth.uid()
    where au.unlock_key = u.key and a.target is not null and not a.hidden and not a.buried
    order by a.sort limit 1
  ) aw on true
  where auth.uid() is not null and u.key = any(p_keys);
$$;

-- A gated page's body, or null if the caller hasn't unlocked it.
create or replace function public.get_unlock_content(p_key text)
returns text
language sql volatile security definer set search_path = public as $$
  select c.body
  from public.unlock_content c
  where c.unlock_key = p_key
    and exists (select 1 from public.get_my_unlocks() m where m.key = p_key);
$$;

-- Which awards open something up, for the trophy case's little mark. Only
-- that it does, never what: visitors find out when they earn it. Hidden and
-- buried awards don't get the mark until they're earned.
drop function if exists public.get_award_rewards(); -- older version that named the rewards
create or replace function public.get_rewarding_awards()
returns table (award_key text)
language sql stable security definer set search_path = public as $$
  select distinct au.award_key
  from public.award_unlocks au
  join public.awards a on a.key = au.award_key
  left join public.user_awards ua
    on ua.award_key = au.award_key and ua.user_id = auth.uid()
  where auth.uid() is not null
    and (not (a.hidden or a.buried) or ua.unlocked_at is not null);
$$;

revoke all on function public.get_my_unlocks() from public, anon;
revoke all on function public.get_unlock_content(text) from public, anon;
revoke all on function public.get_rewarding_awards() from public, anon;
revoke all on function public.get_unlock_status(text[]) from public, anon;
revoke all on function public.unlock_stat_value(uuid, text) from public, anon, authenticated;
revoke all on function public.unlocks_qualifying(uuid) from public, anon, authenticated;
grant execute on function public.get_my_unlocks() to authenticated;
grant execute on function public.get_unlock_content(text) to authenticated;
grant execute on function public.get_rewarding_awards() to authenticated;
grant execute on function public.get_unlock_status(text[]) to authenticated;

-- ── Visible unlocks ───────────────────────────────────────────────────────
-- Retired: the Night Owl skin was never built. Night Owl is now just the
-- hidden h_m2 award.
delete from public.unlocks where key = 'skin:night_owl';

insert into public.unlocks (key, kind, title, description, icon, min_awards, sort) values
  ('title:hexpert',   'title', 'Hexpert',   'Wear the title on your profile.',         '🐝', null, 10)
on conflict (key) do update set
  kind = excluded.kind, title = excluded.title, description = excluded.description,
  icon = excluded.icon, min_awards = excluded.min_awards, sort = excluded.sort;

insert into public.unlocks (key, kind, title, description, icon, sort, stat_key, stat_target, requirement) values
  ('perk:name_fonts', 'perk', 'Name in lights', 'Pick the typeface your name is set in on your profile.', '🔤', 30,
   'games_played', 10, 'Play ten games'),
  ('perk:pixel_icon', 'perk', 'Pixel pusher', 'Draw your own 8-bit icon on your profile.', '👾', 40,
   'public_fields', 3, 'Make three profile fields public')
on conflict (key) do update set
  kind = excluded.kind, title = excluded.title, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, stat_key = excluded.stat_key, stat_target = excluded.stat_target,
  requirement = excluded.requirement;

insert into public.award_unlocks (award_key, unlock_key) values
  ('hex_all', 'title:hexpert')
on conflict do nothing;

-- ── Backfill ──────────────────────────────────────────────────────────────
-- Record everything people qualify for right now, so nobody who has an
-- unlock today loses it if a rule stops holding before their next visit.
-- Last in the file so it sees the rules above. Safe to re-run.
insert into public.user_unlocks (user_id, unlock_key)
select usr.id, q.key
from auth.users usr
cross join lateral public.unlocks_qualifying(usr.id) q
on conflict do nothing;
