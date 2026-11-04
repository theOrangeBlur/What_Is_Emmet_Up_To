// Thin Supabase Auth wrapper for static pages with no build step.
// Expects window.SUPABASE_URL / window.SUPABASE_ANON_KEY and the supabase-js
// UMD bundle to already be loaded by the including page before this script.

window.Auth = (function () {
  let client = null;
  const listeners = [];

  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    client.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== profileFor) { profileFor = null; profileCache = null; }
      listeners.forEach(fn => fn(session));
    });
    return client;
  }

  function onAuthStateChange(fn) {
    listeners.push(fn);
  }

  async function getSession() {
    const c = getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session;
  }

  // The username rides along in user_metadata so it survives the email
  // confirmation round trip; it's claimed into profiles on first sign-in.
  async function signUp(email, password, username) {
    const c = getClient();
    if (!c) return { error: { message: 'auth unavailable' } };
    return c.auth.signUp({ email, password, options: { data: { username } } });
  }

  async function signIn(email, password) {
    const c = getClient();
    if (!c) return { error: { message: 'auth unavailable' } };
    return c.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    const c = getClient();
    if (c) await c.auth.signOut();
  }

  async function resetPasswordForEmail(email) {
    const c = getClient();
    if (!c) return { error: { message: 'auth unavailable' } };
    return c.auth.resetPasswordForEmail(email);
  }

  // apikey stays the anon key regardless of auth state; only the Authorization
  // bearer token changes so RLS policies keyed to auth.uid() can see who's asking.
  async function getAuthHeader() {
    const session = await getSession();
    return `Bearer ${session ? session.access_token : window.SUPABASE_ANON_KEY}`;
  }

  async function rpc(name, args) {
    const c = getClient();
    if (!c) return { error: { message: 'auth unavailable' } };
    return c.rpc(name, args);
  }

  // ── Usernames (supabase/profiles.sql) ─────────────────────────────────
  let profileFor = null;     // user id the cache belongs to
  let profileCache = null;   // Promise<{ username, avatar_path, updated_at } | null>

  // The signed-in account's own username and avatar, or null.
  async function getMyProfile() {
    const session = await getSession();
    if (!session) return null;
    if (profileFor !== session.user.id || !profileCache) {
      profileFor = session.user.id;
      profileCache = rpc('get_my_profile').then(({ data }) => (data && data.username ? data : null), () => null);
    }
    return profileCache;
  }

  async function getUsername() {
    const me = await getMyProfile();
    return me ? me.username : null;
  }

  // Resolves to { ok: true, username } or { ok: false, reason: 'taken' | 'invalid' | 'error' }.
  async function setUsername(name) {
    const { data, error } = await rpc('set_username', { p_name: name });
    if (error || !data) return { ok: false, reason: 'error' };
    if (data.ok) {
      const session = await getSession();
      if (session) usernameById.set(session.user.id, data.username);
      profileCache = null;   // re-fetched on next use
    }
    return data;
  }

  async function usernameAvailable(name) {
    const { data, error } = await rpc('username_available', { p_name: name });
    return error ? null : !!data;
  }

  // ── Profiles (supabase/public_profiles.sql) ───────────────────────────
  function profileUrl(username) {
    return '/Profile/profile.html?u=' + encodeURIComponent(username);
  }

  // Map<user id, username> for the given accounts. Accounts without a
  // username aren't in the result. Answers are cached for the page's lifetime.
  const usernameById = new Map();
  async function usernamesFor(ids) {
    const wanted = [...new Set(ids.filter(Boolean))];
    const missing = wanted.filter(id => !usernameById.has(id));
    if (missing.length) {
      const { data, error } = await rpc('usernames_for', { p_ids: missing });
      if (!error && data) {
        missing.forEach(id => usernameById.set(id, null));
        data.forEach(r => usernameById.set(r.user_id, r.username));
      }
    }
    const out = new Map();
    wanted.forEach(id => { if (usernameById.get(id)) out.set(id, usernameById.get(id)); });
    return out;
  }

  async function getPublicProfile(username) {
    const { data, error } = await rpc('get_public_profile', { p_username: username });
    return error ? { error } : { data };
  }

  // Resolves to { ok: true } or { ok: false, reason }. Null fields are left alone.
  async function updateProfile({ bio = null, answers = null, avatarPath = null, publicFields = null, artPath = null, artTitle = null, nameFont = null,
                                 soundPath = null, soundTitle = null } = {}) {
    const args = { p_bio: bio, p_answers: answers, p_avatar_path: avatarPath, p_public_fields: publicFields };
    // Sent only when set, so saves still work against an update_profile from
    // before the art window and name fonts existed.
    if (artPath != null) args.p_art_path = artPath;
    if (artTitle != null) args.p_art_title = artTitle;
    if (nameFont != null) args.p_name_font = nameFont;
    if (soundPath != null) args.p_sound_path = soundPath;
    if (soundTitle != null) args.p_sound_title = soundTitle;
    const { data, error } = await rpc('update_profile', args);
    if (error || !data) return { ok: false, reason: 'error' };
    if (data.ok) profileCache = null;   // avatar may have changed
    return data;
  }

  async function uploadAvatar(blob) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) return { ok: false, reason: 'error' };
    const path = session.user.id + '/avatar.webp';
    const { error } = await c.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp' });
    if (error) return { ok: false, reason: 'error' };
    return updateProfile({ avatarPath: path });
  }

  // The art window's picture, kept next to the avatar.
  async function uploadArt(blob) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) return { ok: false, reason: 'error' };
    const path = session.user.id + '/art.webp';
    const { error } = await c.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp' });
    if (error) return { ok: false, reason: 'error' };
    return updateProfile({ artPath: path });
  }

  // A drawn icon's editable original (one image pixel per grid cell), kept
  // next to the avatar so the pixel editor can reopen it. Not tracked in the
  // profile row: it lives at a fixed path.
  async function uploadPixelSource(blob) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) return { ok: false, reason: 'error' };
    const { error } = await c.storage.from('avatars').upload(session.user.id + '/pixel.png', blob, { upsert: true, contentType: 'image/png' });
    return error ? { ok: false, reason: 'error' } : { ok: true };
  }

  function pixelSourceUrl(userId, version) {
    return userId ? avatarUrl(userId + '/pixel.png', version) : null;
  }

  // The profile's sound clip, in its own bucket (audio only, bigger cap).
  async function uploadSound(file) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) return { ok: false, reason: 'error' };
    const path = session.user.id + '/sound';
    const { error } = await c.storage.from('sounds').upload(path, file, { upsert: true, contentType: file.type || 'audio/mpeg' });
    if (error) return { ok: false, reason: 'error' };
    return updateProfile({ soundPath: path });
  }

  function soundUrl(path, version) {
    const c = getClient();
    if (!c || !path) return null;
    const url = c.storage.from('sounds').getPublicUrl(path).data.publicUrl;
    return version ? url + '?v=' + encodeURIComponent(version) : url;
  }

  // version busts the browser cache after the same path is re-uploaded.
  function avatarUrl(path, version) {
    const c = getClient();
    if (!c || !path) return null;
    const url = c.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    return version ? url + '?v=' + encodeURIComponent(version) : url;
  }

  return { getMyProfile, getUsername, setUsername, usernameAvailable, getSession, onAuthStateChange, signUp, signIn, signOut, resetPasswordForEmail, getAuthHeader, rpc,
           profileUrl, usernamesFor, getPublicProfile, updateProfile, uploadAvatar, uploadArt, uploadSound, uploadPixelSource, avatarUrl, pixelSourceUrl, soundUrl };
})();
