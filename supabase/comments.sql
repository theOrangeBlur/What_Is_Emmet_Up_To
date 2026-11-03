-- Comments. Paste into the Supabase SQL editor and run, after unlocks.sql
-- (and awards-hidden.sql, for the fish page's Neptune's Fury rule). Safe to
-- re-run.
--
-- Every thread belongs to a (page, item) pair: page is one of the keys below
-- (movies, projects, wordle_daily, ...) and item is whatever the page threads
-- on (a review's id, a post's slug, a month, a day). Reading takes a signed-in
-- account; posting on a page takes that page's perk:comment_<page> unlock and
-- a username. Locked threads don't say how to open them up. Authors can
-- delete their own comments, and anyone in admins can delete any of them.
--
-- Threads nest one level, Slack-style: a top-level comment can gather
-- replies (parent_id), and a reply to a reply joins the same thread. A
-- deleted comment that still has replies comes back as a bodiless tombstone
-- so its thread stays put.
--
-- To make yourself an admin, run once with your account's id:
--   insert into public.admins (user_id) values ('<uuid from auth.users>');

create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  page       text not null,
  item       text not null check (char_length(item) between 1 and 120),
  user_id    uuid not null references auth.users on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists comments_thread on public.comments (page, item, created_at);
create index if not exists comments_author on public.comments (user_id, created_at);
alter table public.comments add column if not exists parent_id bigint references public.comments on delete cascade;
create index if not exists comments_parent on public.comments (parent_id, created_at) where parent_id is not null;

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

-- No policies: comments only come and go through the functions below.
alter table public.comments enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- A thread, oldest first, replies mixed in (the client groups them by
-- parent_id). Deleted comments only show up, as tombstones, while they still
-- have live replies.
drop function if exists public.get_comments(text, text);
create function public.get_comments(p_page text, p_item text)
returns table (id bigint, parent_id bigint, body text, created_at timestamptz, username text,
               avatar_path text, profile_updated_at timestamptz, mine boolean, can_delete boolean,
               deleted boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.parent_id,
         case when c.deleted_at is null then c.body end,
         c.created_at,
         case when c.deleted_at is null then p.username end,
         case when c.deleted_at is null then p.avatar_path end,
         p.updated_at,
         c.deleted_at is null and c.user_id = auth.uid(),
         c.deleted_at is null and (c.user_id = auth.uid() or public.is_admin()),
         c.deleted_at is not null
  from public.comments c
  left join public.profiles p on p.user_id = c.user_id
  where auth.uid() is not null
    and c.page = p_page and c.item = p_item
    and (c.deleted_at is null
         or (c.parent_id is null and exists (
               select 1 from public.comments r where r.parent_id = c.id and r.deleted_at is null)))
  order by c.created_at, c.id
  limit 500;
$$;

-- Post to a thread, or with p_parent, reply in one. Returns { ok, reason? };
-- reasons are locked, no_username, too_fast, too_many, empty, unknown_page
-- and no_parent.
drop function if exists public.post_comment(text, text, text);
create or replace function public.post_comment(p_page text, p_item text, p_body text, p_parent bigint default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text := 'perk:comment_' || p_page;
  v_parent bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.unlocks where key = v_key) then
    return json_build_object('ok', false, 'reason', 'unknown_page');
  end if;
  if not exists (select 1 from public.get_my_unlocks() m where m.key = v_key) then
    return json_build_object('ok', false, 'reason', 'locked');
  end if;
  if not exists (select 1 from public.profiles where user_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'no_username');
  end if;
  p_body := trim(p_body);
  if p_body is null or p_body = '' or p_item is null or p_item = '' then
    return json_build_object('ok', false, 'reason', 'empty');
  end if;
  if exists (select 1 from public.comments
             where user_id = v_uid and created_at > now() - interval '15 seconds') then
    return json_build_object('ok', false, 'reason', 'too_fast');
  end if;
  if (select count(*) from public.comments
      where user_id = v_uid and created_at > now() - interval '1 day') >= 40 then
    return json_build_object('ok', false, 'reason', 'too_many');
  end if;
  -- Replying to a reply lands in the same thread; threads are one level deep.
  -- A tombstoned thread can still take replies, a deleted reply can't.
  if p_parent is not null then
    select coalesce(c.parent_id, c.id) into v_parent
    from public.comments c
    where c.id = p_parent and c.page = p_page and c.item = left(p_item, 120)
      and (c.deleted_at is null or c.parent_id is null);
    if v_parent is null or exists (select 1 from public.comments
        where id = v_parent and deleted_at is not null
          and not exists (select 1 from public.comments r
                          where r.parent_id = v_parent and r.deleted_at is null)) then
      return json_build_object('ok', false, 'reason', 'no_parent');
    end if;
  end if;

  insert into public.comments (page, item, user_id, body, parent_id)
  values (p_page, left(p_item, 120), v_uid, left(p_body, 2000), v_parent);
  return json_build_object('ok', true);
end;
$$;

-- Soft-delete: the author's own, or anything for an admin.
create or replace function public.delete_comment(p_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.comments set deleted_at = now()
  where id = p_id and deleted_at is null
    and (user_id = auth.uid() or public.is_admin());
  return found;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.get_comments(text, text) from public, anon;
revoke all on function public.post_comment(text, text, text, bigint) from public, anon;
revoke all on function public.delete_comment(bigint) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_comments(text, text) to authenticated;
grant execute on function public.post_comment(text, text, text, bigint) to authenticated;
grant execute on function public.delete_comment(bigint) to authenticated;

-- ── Comment unlocks, one per page ─────────────────────────────────────────
-- Puzzles open up by solving them once (award_unlocks below) or by spending
-- half an hour on the page (stat rule); either one counts.
insert into public.unlocks (key, kind, title, description, icon, sort, stat_key, stat_target) values
  ('perk:comment_snapshots',    'perk', 'Snapshots comments',    'Comment on the Daily Snapshots.',     '💬', 100, 'snapshot_watch_ms',   300000),
  ('perk:comment_editorial',    'perk', 'Editorial comments',    'Comment on Editorial posts.',         '💬', 101, null,                  null),
  ('perk:comment_projects',     'perk', 'Projects comments',     'Comment on projects.',                '💬', 102, 'project_reads',       5),
  ('perk:comment_movies',       'perk', 'Picture Show comments', 'Comment on movie reviews.',           '💬', 103, 'movie_reads',         7),
  ('perk:comment_games',        'perk', 'Gaming comments',       'Comment on game reviews.',            '💬', 104, 'game_reads',          7),
  ('perk:comment_dispatch',     'perk', 'Dispatch comments',     'Comment on the Personal Dispatch.',   '💬', 105, 'visit_days',          20),
  ('perk:comment_fish',         'perk', 'Natural History comments', 'Comment on the fish tanks.',       '💬', 106, null,                  null),
  ('perk:comment_hexdoku',      'perk', 'Hexdoku comments',      'Comment on Hexdoku.',                 '💬', 107, 'hexdoku_ms',          1800000),
  ('perk:comment_boat',         'perk', 'River Crossing comments', 'Comment on the River Crossing.',    '💬', 108, 'boat_ms',             1800000),
  ('perk:comment_balance',      'perk', 'Coin Riddle comments',  'Comment on the Coin Riddle.',         '💬', 109, 'balance_ms',          1800000),
  ('perk:comment_wordle_daily', 'perk', 'Daily Wordle comments', 'Talk about the daily Final Wordle.',  '💬', 110, 'wordle_daily_solves', 5),
  ('perk:comment_wordle_free',  'perk', 'Free Play comments',    'Talk about Final Wordle free play.',  '💬', 111, 'wordle_free_plays',   3)
on conflict (key) do update set
  kind = excluded.kind, title = excluded.title, description = excluded.description, icon = excluded.icon,
  sort = excluded.sort, stat_key = excluded.stat_key, stat_target = excluded.stat_target,
  requirement = null;  -- how to unlock comments is for visitors to discover

-- Only map awards that exist, so this still runs before awards-hidden.sql.
insert into public.award_unlocks (award_key, unlock_key)
select v.award_key, v.unlock_key
from (values
  ('paperboy', 'perk:comment_editorial'),
  ('h_n5',     'perk:comment_fish'),
  ('hex_one',  'perk:comment_hexdoku'),
  ('ferryman', 'perk:comment_boat'),
  ('scales',   'perk:comment_balance')
) as v(award_key, unlock_key)
where exists (select 1 from public.awards a where a.key = v.award_key)
on conflict do nothing;
