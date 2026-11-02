-- Public profile pages (Profile/profile.html). Paste into the Supabase SQL
-- editor and run after profiles.sql, records.sql and awards.sql. Safe to re-run.
--
-- Anyone can read a profile by username: name, bio, avatar, trivia answers,
-- member-since date, earned awards and personal records. Emails never leave
-- the database. Secret (hidden or buried) awards show up as just an icon so
-- profiles can't be used to spoil them. The bio/avatar/answers columns
-- themselves are added in profiles.sql.

-- ── Avatars ───────────────────────────────────────────────────────────────
-- One small image per account at avatars/<user id>/avatar.webp. The page
-- shrinks it to 256px before uploading, so the 1 MB cap is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars: replace own" on storage.objects;
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- Upserts also need to see the existing object.
drop policy if exists "avatars: read own" on storage.objects;
create policy "avatars: read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Reading ───────────────────────────────────────────────────────────────
-- Everything a profile page shows, or null if nobody goes by that name.
-- Visible awards come back in full; secret ones as { icon, secret, unlocked_at }.
create or replace function public.get_public_profile(p_username text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'username',     p.username,
    'bio',          p.bio,
    'avatar_path',  p.avatar_path,
    'updated_at',   p.updated_at,
    'answers',      p.answers,
    'member_since', (select u.created_at from auth.users u where u.id = p.user_id),
    'is_me',        p.user_id = auth.uid(),
    'awards', coalesce((
      select json_agg(
        case when a.hidden or a.buried
          then json_build_object('icon', a.icon, 'secret', true, 'unlocked_at', ua.unlocked_at)
          else json_build_object('key', a.key, 'title', a.title, 'description', a.description,
                                 'icon', a.icon, 'unlocked_at', ua.unlocked_at)
        end
        order by ua.unlocked_at desc)
      from public.user_awards ua
      join public.awards a on a.key = ua.award_key
      where ua.user_id = p.user_id and ua.unlocked_at is not null), '[]'::json),
    'awards_total', (select count(*) from public.awards a where not a.buried),
    'records', public.personal_records(p.user_id, null)
  )
  from public.profiles p
  where lower(p.username) = lower(trim(p_username));
$$;

-- Usernames for a batch of accounts, so leaderboards can link arcade names
-- to profiles. Accounts without a username are simply left out.
create or replace function public.usernames_for(p_ids uuid[])
returns table (user_id uuid, username text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.username from public.profiles p
  where p.user_id = any (p_ids[1:200]);
$$;

-- ── Writing ───────────────────────────────────────────────────────────────
-- Update the caller's bio, trivia answers and/or avatar. A null argument
-- leaves that field alone; '' clears the bio or avatar. Answers replace the
-- whole set, and blank answers are dropped. The username is changed through
-- set_username() in profiles.sql.
create or replace function public.update_profile(
  p_bio text default null, p_answers jsonb default null, p_avatar_path text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_clean jsonb := '{}';
  v_key text;
  v_val jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where user_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'no_username');
  end if;

  if p_bio is not null and char_length(trim(p_bio)) > 140 then
    return json_build_object('ok', false, 'reason', 'bio_too_long');
  end if;

  if p_answers is not null then
    if jsonb_typeof(p_answers) <> 'object' then
      return json_build_object('ok', false, 'reason', 'invalid');
    end if;
    for v_key, v_val in select * from jsonb_each(p_answers) loop
      if v_key !~ '^[a-z0-9_]{1,32}$' or jsonb_typeof(v_val) <> 'string'
         or char_length(v_val #>> '{}') > 140 then
        return json_build_object('ok', false, 'reason', 'invalid');
      end if;
      if char_length(trim(v_val #>> '{}')) > 0 then
        v_clean := v_clean || jsonb_build_object(v_key, trim(v_val #>> '{}'));
      end if;
    end loop;
    if (select count(*) from jsonb_object_keys(v_clean)) > 30 then
      return json_build_object('ok', false, 'reason', 'invalid');
    end if;
  end if;

  if p_avatar_path is not null and p_avatar_path <> ''
     and p_avatar_path not like v_uid::text || '/%' then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  update public.profiles set
    bio         = case when p_bio is null then bio else nullif(trim(p_bio), '') end,
    answers     = case when p_answers is null then answers else v_clean end,
    avatar_path = case when p_avatar_path is null then avatar_path else nullif(p_avatar_path, '') end,
    updated_at  = now()
  where user_id = v_uid;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.get_public_profile(text) from public;
revoke all on function public.usernames_for(uuid[]) from public;
revoke all on function public.update_profile(text, jsonb, text) from public, anon;
grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.usernames_for(uuid[]) to anon, authenticated;
grant execute on function public.update_profile(text, jsonb, text) to authenticated;
