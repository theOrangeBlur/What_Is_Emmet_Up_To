// Site-wide awards (Steam-style achievements). Pages call
//   Awards.unlock('key')                 for one-shot awards
//   Awards.progress('key', n, target)    for counting awards
// Signed in, this goes straight to the grant_award RPC and pops a toast on a
// fresh unlock. Signed out, the award is held in localStorage and claimed the
// next time the visitor signs in. Depends on window.Auth (shared/auth.js) and,
// for the "log in" button, window.AuthWidget (shared/auth-widget.js).
window.Awards = (function () {
  const PENDING_KEY = 'awards_pending';   // { key: progress | true } earned while signed out
  const NUDGED_KEY = 'awards_nudged';     // { key: true } signed-out popups already shown
  const PAGES_KEY = 'awards_pages';       // [page filename, ...] visited on this browser
  const PAPERBOY_COUNT = 8;
  // Every page that counts toward visiting the whole site. Adding a page here
  // means bumping h_s1's target in awards-hidden.sql to match the new length.
  const SITE_PAGES = [
    'index.html', 'snapshots.html', 'blog.html', 'projects.html', 'movies.html',
    'games.html', 'discipline.html', 'fish.html', 'hexdoku.html', 'boat.html',
    'balance.html', 'final-wordle.html', 'absolute.html', 'awards.html'
  ];

  function load(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }
  // What this account has already reported, so repeat calls skip the network.
  function doneKey(uid) { return 'awards_done_' + uid; }

  async function getSession() {
    if (!window.Auth) return null;
    try { return await window.Auth.getSession(); } catch { return null; }
  }

  async function grant(session, key, progress) {
    const done = load(doneKey(session.user.id), {});
    if (done[key] === true) return true;
    if (progress != null && done[key] >= progress) return true;
    const { data, error } = await window.Auth.rpc('grant_award', { p_key: key, p_progress: progress == null ? null : progress });
    if (error || !data) return false;
    done[key] = data.unlocked ? true : data.progress;
    save(doneKey(session.user.id), done);
    if (data.newly_unlocked) showUnlockToast(data);
    document.dispatchEvent(new CustomEvent('awards:changed', { detail: data }));
    return true;
  }

  function holdForLater(key, progress, reachedGoal) {
    const pending = load(PENDING_KEY, {});
    if (pending[key] === true) return;
    pending[key] = progress == null ? true : Math.max(pending[key] || 0, progress);
    save(PENDING_KEY, pending);
    if (!reachedGoal) return;
    const nudged = load(NUDGED_KEY, {});
    if (nudged[key]) return;
    nudged[key] = true;
    save(NUDGED_KEY, nudged);
    showLoginNudge();
  }

  async function unlock(key) {
    const session = await getSession();
    if (session) return grant(session, key, null);
    holdForLater(key, null, true);
  }

  async function progress(key, n, target) {
    const session = await getSession();
    if (session) return grant(session, key, n);
    holdForLater(key, n, target != null && n >= target);
  }

  // Lets shared/unlocks.js re-check stat-based unlocks once numbers move.
  function recordsChanged() {
    document.dispatchEvent(new CustomEvent('records:changed'));
  }

  // ── Records: running tallies (fish nips, video watch time, ...) ──────────
  // Counted up in memory and sent in batches, since some of these tick many
  // times a second. Signed out, they wait in localStorage like awards do.
  const TALLY_PENDING_KEY = 'records_pending';
  const TALLY_FLUSH_MS = 15000;
  const tallies = {};
  let tallyTimer = null;

  function tally(key, delta) {
    if (!(delta > 0)) return;
    tallies[key] = (tallies[key] || 0) + delta;
    if (!tallyTimer) tallyTimer = setTimeout(flushTallies, TALLY_FLUSH_MS);
  }

  function stashTallies(batch) {
    const pending = load(TALLY_PENDING_KEY, {});
    for (const key of Object.keys(batch)) pending[key] = (pending[key] || 0) + batch[key];
    save(TALLY_PENDING_KEY, pending);
  }

  let flushing = false;
  async function flushTallies() {
    clearTimeout(tallyTimer);
    tallyTimer = null;
    // Stash synchronously before any await, so a tab closing mid-send keeps them.
    stashTallies(tallies);
    for (const key of Object.keys(tallies)) delete tallies[key];
    if (flushing) return;
    const session = await getSession();
    if (!session) return;
    flushing = true;
    const batch = load(TALLY_PENDING_KEY, {});
    save(TALLY_PENDING_KEY, {});
    let sent = false;
    for (const key of Object.keys(batch)) {
      const { error } = await window.Auth.rpc('add_stat', { p_key: key, p_delta: Math.round(batch[key]) });
      if (error) stashTallies({ [key]: batch[key] }); // try again next flush
      else sent = true;
    }
    flushing = false;
    if (sent) recordsChanged();
  }

  // Time spent actually on a page, tallied into `key` in ms. Only counts while
  // the tab is showing and the visitor has touched the page in the last two
  // minutes, so a forgotten background tab doesn't rack up hours.
  const IDLE_MS = 2 * 60 * 1000;
  function tallyActiveTime(key) {
    let lastInput = Date.now();
    const poke = () => { lastInput = Date.now(); };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(type =>
      window.addEventListener(type, poke, { passive: true, capture: true }));
    setInterval(() => {
      if (!document.hidden && Date.now() - lastInput < IDLE_MS) tally(key, 1000);
    }, 1000);
  }

  // ── Records: reviews opened (movies, games, projects) ──────────────────
  // Each review counts once per account. Signed out, ids wait in localStorage.
  const READS_PENDING_KEY = 'records_reads_pending';   // { kind: [id, ...] }
  function readsDoneKey(uid) { return 'records_reads_' + uid; }

  function addRead(store, kind, id) {
    const list = store[kind] || (store[kind] = []);
    if (list.includes(id)) return false;
    list.push(id);
    return true;
  }

  async function sendRead(session, kind, id) {
    const done = load(readsDoneKey(session.user.id), {});
    if ((done[kind] || []).includes(id)) return true;
    const { error } = await window.Auth.rpc('mark_read', { p_kind: kind, p_item: id });
    if (error) return false;
    addRead(done, kind, id);
    save(readsDoneKey(session.user.id), done);
    recordsChanged();
    return true;
  }

  async function markRead(kind, id) {
    if (!id) return;
    const session = await getSession();
    if (session && await sendRead(session, kind, id)) return;
    const pending = load(READS_PENDING_KEY, {});
    if (addRead(pending, kind, id)) save(READS_PENDING_KEY, pending);
  }

  async function claimPendingReads(session) {
    const pending = load(READS_PENDING_KEY, {});
    for (const kind of Object.keys(pending)) {
      const left = [];
      for (const id of pending[kind]) if (!await sendRead(session, kind, id)) left.push(id);
      pending[kind] = left;
    }
    save(READS_PENDING_KEY, pending);
  }

  // Same Eastern day boundary as the Wordle and record_visit().
  function estDayKey() {
    const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  async function recordVisit(uid) {
    const k = 'records_visit_' + uid;
    const today = estDayKey();
    if (load(k, 0) === today) return;
    const { error } = await window.Auth.rpc('record_visit');
    if (!error) { save(k, today); recordsChanged(); }
  }

  // ── Sign-in: welcome award + claim anything earned while signed out ──────
  let syncedUid = null;
  async function onSignedIn(session) {
    if (!session || syncedUid === session.user.id) return;
    syncedUid = session.user.id;
    recordVisit(session.user.id);
    await grant(session, 'welcome', null);
    const pending = load(PENDING_KEY, {});
    for (const key of Object.keys(pending)) {
      if (await grant(session, key, pending[key] === true ? null : pending[key])) delete pending[key];
    }
    save(PENDING_KEY, pending);
    flushTallies();
    claimPendingReads(session);
  }

  // ── Toasts ──────────────────────────────────────────────────────────────
  function stack() {
    let el = document.getElementById('awd-stack');
    if (!el) {
      el = document.createElement('div');
      el.id = 'awd-stack';
      el.className = 'awd-stack';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  function dismiss(toast) {
    toast.classList.add('awd-leaving');
    setTimeout(() => toast.remove(), 300);
  }

  // A clickable toast in the awards stack. Also used by shared/unlocks.js.
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Shrink a toast down into the 🏆 awards link in the auth widget, as if
  // dropping it into the trophy case. Where that link isn't showing (the
  // awards page itself), it shrinks away where it stands.
  function flyToCase(toast) {
    if (toast.dataset.leaving) return;
    toast.dataset.leaving = '1';
    const target = document.querySelector('.authw-awards-link');
    const to = target && target.getBoundingClientRect();
    if (prefersReducedMotion() || !toast.animate) { toast.remove(); return; }

    const from = toast.getBoundingClientRect();
    let dx = 0, dy = 0;
    const visible = to && to.width > 0 && to.height > 0;
    if (visible) {
      dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    }
    // Keep its spot in the stack while it flies, so the others don't jump.
    toast.style.pointerEvents = 'none';
    toast.classList.add('awd-flying');
    const flight = toast.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) scale(0.55)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.04)`, opacity: visible ? 0.6 : 0 }
    ], { duration: 650, easing: 'cubic-bezier(.5, 0, .75, .3)', fill: 'forwards' });
    flight.onfinish = () => {
      toast.remove();
      if (visible) {
        target.classList.remove('awd-catch');
        void target.offsetWidth; // restart the pulse if it's already running
        target.classList.add('awd-catch');
        setTimeout(() => target.classList.remove('awd-catch'), 700);
      }
    };
  }

  // A glowing toast that waits for the visitor to dismiss it, then flies into
  // the trophy case. Clicking anywhere else on it goes to the trophy case.
  function toast(opts) {
    const toast = document.createElement('div'); toast.className = 'awd-toast awd-glow';
    const icon = document.createElement('div'); icon.className = 'awd-icon'; icon.textContent = opts.icon || '🏆';
    const body = document.createElement('div'); body.className = 'awd-body';
    const label = document.createElement('div'); label.className = 'awd-label'; label.textContent = opts.label;
    const title = document.createElement('div'); title.className = 'awd-title'; title.textContent = opts.title;
    body.appendChild(label); body.appendChild(title);
    if (opts.description) {
      const desc = document.createElement('div'); desc.className = 'awd-desc'; desc.textContent = opts.description;
      body.appendChild(desc);
    }
    const close = document.createElement('button'); close.className = 'awd-close'; close.textContent = '×';
    close.setAttribute('aria-label', 'dismiss');
    close.addEventListener('click', e => { e.stopPropagation(); flyToCase(toast); });
    toast.appendChild(icon); toast.appendChild(body); toast.appendChild(close);
    toast.addEventListener('click', () => { window.location.href = opts.href || '/Awards/awards.html'; });
    stack().appendChild(toast);
  }

  function showUnlockToast(award) {
    toast({ label: 'award unlocked', icon: award.icon, title: award.title || 'A mystery', description: award.description });
  }

  function showLoginNudge() {
    const toast = document.createElement('div'); toast.className = 'awd-toast awd-nudge';
    const icon = document.createElement('div'); icon.className = 'awd-icon'; icon.textContent = '✨';
    const body = document.createElement('div'); body.className = 'awd-body';
    const label = document.createElement('div'); label.className = 'awd-label'; label.textContent = 'well, well, well';
    const title = document.createElement('div'); title.className = 'awd-title'; title.textContent = "you've done something extraordinary";
    const desc = document.createElement('div'); desc.className = 'awd-desc'; desc.textContent = "knock on the door to get credit for it — we'll hold onto it until you do";
    const btn = document.createElement('button'); btn.className = 'awd-btn'; btn.textContent = 'knock on the door';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      dismiss(toast);
      if (window.AuthWidget) window.AuthWidget.showAuthModal('login');
    });
    const close = document.createElement('button'); close.className = 'awd-close'; close.textContent = '×';
    close.setAttribute('aria-label', 'dismiss');
    close.addEventListener('click', e => { e.stopPropagation(); dismiss(toast); });
    body.appendChild(label); body.appendChild(title); body.appendChild(desc); body.appendChild(btn);
    toast.appendChild(icon); toast.appendChild(body); toast.appendChild(close);
    stack().appendChild(toast);
    setTimeout(() => { if (toast.isConnected) dismiss(toast); }, 15000);
  }

  // ── Site-wide triggers ──────────────────────────────────────────────────
  // The page's filename, or 'index.html' for the bare root.
  function currentPage() {
    const file = window.location.pathname.toLowerCase().split('/').pop();
    return file || 'index.html';
  }

  function trackPage() {
    const page = currentPage();
    if (!SITE_PAGES.includes(page)) return;
    // Thermometers became Absolute 25 (2026-11-04); an old visit still counts.
    const visited = [...new Set(load(PAGES_KEY, []).map(p => p === 'thermometers.html' ? 'absolute.html' : p))]
      .filter(p => SITE_PAGES.includes(p));
    if (!visited.includes(page)) { visited.push(page); save(PAGES_KEY, visited); }
    progress('paperboy', visited.length, PAPERBOY_COUNT);
    progress('h_s1', visited.length, SITE_PAGES.length);
  }

  // Major (US) holidays, by the visitor's local date.
  function isMajorHoliday(d) {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const md = m + '/' + day;
    if (['1/1', '2/14', '7/4', '10/31', '12/24', '12/25', '12/31'].includes(md)) return true;
    // Thanksgiving: fourth Thursday of November
    if (m === 11 && d.getDay() === 4 && day >= 22 && day <= 28) return true;
    // Easter Sunday (anonymous Gregorian computus)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((8 * b + 13) / 25)) / 3) + 15) % 30;
    const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
    const mm = Math.floor((a + 11 * h + 22 * l) / 451);
    const easterMonth = Math.floor((h + l - 7 * mm + 114) / 31);
    const easterDay = ((h + l - 7 * mm + 114) % 31) + 1;
    return m === easterMonth && day === easterDay;
  }

  function watchKonami() {
    const code = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'].join();
    // Compare against the last ten keys, so extra presses before the code
    // (e.g. mashing up three times) don't spoil it.
    const recent = [];
    document.addEventListener('keydown', e => {
      recent.push(e.key.toLowerCase());
      if (recent.length > 10) recent.shift();
      if (recent.join() === code) { recent.length = 0; unlock('h_z4'); }
    });
  }

  // ── Records reset ───────────────────────────────────────────────────────
  // When awards and records are wiped on the server, bump RESET_EPOCH so
  // every browser forgets what it had cached. Otherwise the "already granted"
  // list would stop awards from being earned again, and saved progress (pages
  // visited, signed-out awards, streaks) would hand them straight back.
  const RESET_EPOCH = '2026-11-03';
  const RESET_KEY = 'records_reset';
  const RESET_PREFIXES = ['awards_done_', 'records_reads_', 'records_visit_', 'unlocks_'];
  const RESET_KEYS = ['awards_pages', 'awards_pending', 'awards_nudged', 'records_pending', 'balance_streak'];

  function applyReset() {
    try {
      if (localStorage.getItem(RESET_KEY) === RESET_EPOCH) return;
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (RESET_KEYS.includes(k) || RESET_PREFIXES.some(p => k.startsWith(p)))) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(RESET_KEY, RESET_EPOCH);
    } catch {}
  }

  async function init() {
    applyReset();
    if (window.Auth) window.Auth.onAuthStateChange(session => { if (session) onSignedIn(session); else syncedUid = null; });
    await onSignedIn(await getSession());
    trackPage();
    const hour = new Date().getHours();
    if (hour < 4) unlock('h_m2');
    if (isMajorHoliday(new Date())) unlock('b_h8');
    watchKonami();
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushTallies(); });
    window.addEventListener('pagehide', flushTallies);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { unlock, progress, tally, tallyActiveTime, markRead, toast };
})();
