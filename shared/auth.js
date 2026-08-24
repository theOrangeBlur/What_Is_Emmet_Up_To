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
    client.auth.onAuthStateChange((_event, session) => listeners.forEach(fn => fn(session)));
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

  async function signUp(email, password) {
    const c = getClient();
    if (!c) return { error: { message: 'auth unavailable' } };
    return c.auth.signUp({ email, password });
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

  return { getSession, onAuthStateChange, signUp, signIn, signOut, resetPasswordForEmail, getAuthHeader };
})();
