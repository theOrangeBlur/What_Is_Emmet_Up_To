-- Public profile pages (Profile/profile.html). Paste into the Supabase SQL
-- editor and run after profiles.sql, records.sql, awards.sql and comments.sql
-- (which creates is_admin()). Safe to re-run.
--
-- Anyone can read a profile by username: name, avatar, member-since date,
-- earned awards, personal records, and whichever of the bio and question
-- answers the owner has marked public (profiles.public_fields). Private
-- fields and emails never leave the database for anyone but the owner. Secret (hidden or buried) awards show up as just an icon so
-- profiles can't be used to spoil them. The bio/avatar/answers columns
-- themselves (and public_fields) are added in profiles.sql.

-- ── Avatars and art ───────────────────────────────────────────────────────
-- Per account: avatars/<user id>/avatar.webp, shrunk to 256px, and
-- avatars/<user id>/art.webp, the art window, shrunk to 1200px on its long
-- side. The page shrinks both before uploading, so the 2 MB cap is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
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

-- ── Sounds ────────────────────────────────────────────────────────────────
-- One clip per account at sounds/<user id>/sound. Audio can't be shrunk in the
-- browser the way pictures are, so it gets its own bucket with a 5 MB cap
-- (a few minutes of mp3) and audio types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sounds', 'sounds', true, 5242880,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav',
              'audio/wave', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sounds: upload own" on storage.objects;
create policy "sounds: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'sounds' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "sounds: replace own" on storage.objects;
create policy "sounds: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'sounds' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "sounds: delete own" on storage.objects;
create policy "sounds: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'sounds' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "sounds: read own" on storage.objects;
create policy "sounds: read own" on storage.objects for select to authenticated
  using (bucket_id = 'sounds' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Reading ───────────────────────────────────────────────────────────────
-- Everything a profile page shows, or null if nobody goes by that name.
-- Visible awards come back in full; secret ones as { icon, secret, unlocked_at }.
-- The owner gets every field plus public_fields, so the edit form can show
-- the toggles; everyone else gets only the public ones. The favorite colors
-- (color1-3) are never public answers, but always come back as `theme`, which
-- repaints the page for every visitor.
create or replace function public.get_public_profile(p_username text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'username',     p.username,
    'bio',          case when p.user_id = auth.uid() or 'bio' = any (p.public_fields) then p.bio end,
    'avatar_path',  p.avatar_path,
    'art_path',     case when p.user_id = auth.uid() or 'art' = any (p.public_fields) then p.art_path end,
    'art_title',    case when p.user_id = auth.uid() or 'art' = any (p.public_fields) then p.art_title end,
    'sound_path',   case when p.user_id = auth.uid() or 'sound' = any (p.public_fields) then p.sound_path end,
    'sound_title',  case when p.user_id = auth.uid() or 'sound' = any (p.public_fields) then p.sound_title end,
    'name_font',    p.name_font,
    'updated_at',   p.updated_at,
    'answers',      (select coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb)
                     from jsonb_each(p.answers) a
                     where p.user_id = auth.uid()
                        or (a.key = any (p.public_fields) and a.key not in ('color1', 'color2', 'color3'))),
    'theme',        json_build_array(p.answers->>'color1', p.answers->>'color2', p.answers->>'color3'),
    'public_fields', case when p.user_id = auth.uid() then p.public_fields end,
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
    'records', public.personal_records(p.user_id, null),
    -- Emmet's notes (profile_notes): the public one for everyone, the
    -- private one only for the person it's about (and admins, to edit it).
    'emmet_note',   n.public_note,
    'emmet_private_note', case when p.user_id = auth.uid() or public.is_admin() then n.private_note end,
    'can_note',     public.is_admin()
  )
  from public.profiles p
  left join public.profile_notes n on n.user_id = p.user_id
  where lower(p.username) = lower(trim(p_username));
$$;

-- Write Emmet's notes on someone's profile. Admins only. A null argument
-- leaves that note alone; '' clears it.
create or replace function public.set_profile_notes(p_username text, p_public text default null, p_private text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  if not public.is_admin() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select p.user_id into v_uid from public.profiles p where lower(p.username) = lower(trim(p_username));
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if char_length(trim(coalesce(p_public, ''))) > 1000 or char_length(trim(coalesce(p_private, ''))) > 1000 then
    return json_build_object('ok', false, 'reason', 'too_long');
  end if;

  insert into public.profile_notes as n (user_id, public_note, private_note)
  values (v_uid, nullif(trim(p_public), ''), nullif(trim(p_private), ''))
  on conflict (user_id) do update set
    public_note  = case when p_public  is null then n.public_note  else nullif(trim(p_public), '')  end,
    private_note = case when p_private is null then n.private_note else nullif(trim(p_private), '') end,
    updated_at   = now();
  return json_build_object('ok', true);
end;
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
-- Update the caller's bio, question answers, public fields, avatar and/or art
-- window. A null argument leaves that field alone; '' clears the bio, avatar,
-- art picture, art heading, sound, sound heading or name font (back to the
-- default). Any other name
-- font takes the perk:name_fonts unlock (unlocks.sql). Answers
-- and public fields each replace the whole set, and blank answers are dropped. The username is changed through
-- set_username() in profiles.sql.
drop function if exists public.update_profile(text, jsonb, text);
drop function if exists public.update_profile(text, jsonb, text, text[]);
drop function if exists public.update_profile(text, jsonb, text, text[], text, text);
drop function if exists public.update_profile(text, jsonb, text, text[], text, text, text);
create or replace function public.update_profile(
  p_bio text default null, p_answers jsonb default null, p_avatar_path text default null,
  p_public_fields text[] default null, p_art_path text default null, p_art_title text default null,
  p_name_font text default null, p_sound_path text default null, p_sound_title text default null)
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
         or char_length(v_val #>> '{}') > 500 then
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

  if p_public_fields is not null and (
       cardinality(p_public_fields) > 40
       or exists (select 1 from unnest(p_public_fields) f where f is null or f !~ '^[a-z0-9_]{1,32}$')) then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_avatar_path is not null and p_avatar_path <> ''
     and p_avatar_path not like v_uid::text || '/%' then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_art_path is not null and p_art_path <> ''
     and p_art_path not like v_uid::text || '/%' then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_art_title is not null and char_length(trim(p_art_title)) > 80 then
    return json_build_object('ok', false, 'reason', 'art_title_too_long');
  end if;

  if p_sound_path is not null and p_sound_path <> ''
     and p_sound_path not like v_uid::text || '/%' then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if p_sound_title is not null and char_length(trim(p_sound_title)) > 80 then
    return json_build_object('ok', false, 'reason', 'sound_title_too_long');
  end if;

  if p_name_font is not null and p_name_font <> '' then
    if p_name_font !~ '^[a-z_]{1,24}$' then
      return json_build_object('ok', false, 'reason', 'invalid');
    end if;
    if not exists (select 1 from public.get_my_unlocks() m where m.key = 'perk:name_fonts') then
      return json_build_object('ok', false, 'reason', 'locked');
    end if;
  end if;

  update public.profiles set
    bio         = case when p_bio is null then bio else nullif(trim(p_bio), '') end,
    answers     = case when p_answers is null then answers else v_clean end,
    avatar_path = case when p_avatar_path is null then avatar_path else nullif(p_avatar_path, '') end,
    art_path    = case when p_art_path is null then art_path else nullif(p_art_path, '') end,
    art_title   = case when p_art_title is null then art_title else nullif(trim(p_art_title), '') end,
    name_font   = case when p_name_font is null then name_font else nullif(p_name_font, '') end,
    sound_path  = case when p_sound_path is null then sound_path else nullif(p_sound_path, '') end,
    sound_title = case when p_sound_title is null then sound_title else nullif(trim(p_sound_title), '') end,
    public_fields = case when p_public_fields is null then public_fields
                         else array(select distinct unnest(p_public_fields)) end,
    updated_at  = now()
  where user_id = v_uid;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.get_public_profile(text) from public;
revoke all on function public.usernames_for(uuid[]) from public;
revoke all on function public.update_profile(text, jsonb, text, text[], text, text, text, text, text) from public, anon;
grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.usernames_for(uuid[]) to anon, authenticated;
grant execute on function public.update_profile(text, jsonb, text, text[], text, text, text, text, text) to authenticated;
revoke all on function public.set_profile_notes(text, text, text) from public, anon;
grant execute on function public.set_profile_notes(text, text, text) to authenticated;
