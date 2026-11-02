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
      if (!session || session.user.id !== usernameFor) { usernameFor = null; usernameCache = null; }
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
  let usernameFor = null;     // user id the cache belongs to
  let usernameCache = null;   // Promise<string|null>

  async function getUsername() {
    const session = await getSession();
    if (!session) return null;
    if (usernameFor !== session.user.id || !usernameCache) {
      usernameFor = session.user.id;
      usernameCache = rpc('get_my_profile').then(({ data }) => (data && data.username) || null, () => null);
    }
    return usernameCache;
  }

  // Resolves to { ok: true, username } or { ok: false, reason: 'taken' | 'invalid' | 'error' }.
  async function setUsername(name) {
    const { data, error } = await rpc('set_username', { p_name: name });
    if (error || !data) return { ok: false, reason: 'error' };
    if (data.ok) {
      const session = await getSession();
      usernameFor = session && session.user.id;
      usernameCache = Promise.resolve(data.username);
    }
    return data;
  }

  async function usernameAvailable(name) {
    const { data, error } = await rpc('username_available', { p_name: name });
    return error ? null : !!data;
  }

  return { getUsername, setUsername, usernameAvailable, getSession, onAuthStateChange, signUp, signIn, signOut, resetPasswordForEmail, getAuthHeader, rpc };
})();
