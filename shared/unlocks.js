// Rewards that awards and records hand out (supabase/unlocks.sql). Pages ask
//   await Unlocks.has('skin:night_owl')    true if the visitor has it
//   await Unlocks.list('title')            every unlock of a kind (or all, with no kind)
//   await Unlocks.content('page:vault')    a gated page's body, or null
//   await Unlocks.status(['perk:x', ...])  { key: { unlocked, requirement, value, target } }
// and can gate markup without any script:
//   <div data-unlock="perk:comment" hidden>…</div>        shown once unlocked
//   <div data-unlock-not="perk:comment">🔒 …</div>        shown until then
// Start data-unlock elements with `hidden` so they don't flash for everyone.
//
// The list is cached per account in localStorage so cosmetics paint right
// away; that copy only decides looks. Gated content always comes from the
// server. Refreshes whenever an award or record changes (awards:changed /
// records:changed from shared/awards.js) or the visitor signs in or out, and pops a toast for
// anything new. Fires unlocks:changed on document after every refresh.
// Depends on window.Auth (shared/auth.js); load after shared/awards.js.
window.Unlocks = (function () {
  let current = [];        // [{ key, kind, title, description, icon }]
  let queue = Promise.resolve();

  function load(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }
  function cacheKey(uid) { return 'unlocks_' + uid; }

  async function getSession() {
    if (!window.Auth) return null;
    try { return await window.Auth.getSession(); } catch { return null; }
  }

  function owns(key) { return current.some(u => u.key === key); }

  function apply() {
    document.querySelectorAll('[data-unlock]').forEach(el => { el.hidden = !owns(el.dataset.unlock); });
    document.querySelectorAll('[data-unlock-not]').forEach(el => { el.hidden = owns(el.dataset.unlockNot); });
  }

  function set(list) {
    current = list;
    apply();
    document.dispatchEvent(new CustomEvent('unlocks:changed', { detail: current }));
  }

  function announce(u) {
    if (!window.Awards || !window.Awards.toast) return;
    window.Awards.toast({ label: 'reward unlocked', icon: u.icon, title: u.title, description: u.description });
  }

  async function fetchNow() {
    const session = await getSession();
    if (!session) { set([]); return; }
    const uid = session.user.id;
    const { data, error } = await window.Auth.rpc('get_my_unlocks');
    if (error || !Array.isArray(data)) return; // keep whatever we had
    // Only toast against a list we've seen before, so the very first fetch on
    // a browser doesn't announce everything at once.
    const prev = load(cacheKey(uid), null);
    if (prev) data.filter(u => !prev.some(p => p.key === u.key)).forEach(announce);
    save(cacheKey(uid), data);
    set(data);
  }

  // Serialized, so overlapping triggers can't toast the same unlock twice.
  function refresh() {
    queue = queue.then(fetchNow, fetchNow);
    return queue;
  }

  async function has(key) {
    await queue;
    return owns(key);
  }

  async function list(kind) {
    await queue;
    return kind ? current.filter(u => u.kind === kind) : current.slice();
  }

  async function status(keys) {
    if (!await getSession()) return {};
    const { data, error } = await window.Auth.rpc('get_unlock_status', { p_keys: keys });
    const out = {};
    if (!error && Array.isArray(data)) data.forEach(r => { out[r.key] = r; });
    return out;
  }

  async function content(key) {
    if (!await getSession()) return null;
    const { data, error } = await window.Auth.rpc('get_unlock_content', { p_key: key });
    return error ? null : data;
  }

  // Paint from the cache, then fetch. The queue starts as this whole startup,
  // so has()/list() called early wait for the first real fetch.
  async function init() {
    const session = await getSession();
    if (session) set(load(cacheKey(session.user.id), []));
    else apply();
    document.addEventListener('awards:changed', refresh);
    // Reads claimed at sign-in arrive in a burst; settle before re-checking.
    let recordsTimer = null;
    document.addEventListener('records:changed', () => {
      clearTimeout(recordsTimer);
      recordsTimer = setTimeout(refresh, 1500);
    });
    if (window.Auth) window.Auth.onAuthStateChange(refresh);
    await fetchNow();
  }

  const domReady = new Promise(resolve => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolve);
    else resolve();
  });
  queue = domReady.then(init).catch(() => {});

  return { has, list, status, content, refresh };
})();
