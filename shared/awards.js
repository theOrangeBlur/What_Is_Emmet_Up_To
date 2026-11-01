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
    'balance.html', 'final-wordle.html', 'awards.html'
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

  // ── Sign-in: welcome award + claim anything earned while signed out ──────
  let syncedUid = null;
  async function onSignedIn(session) {
    if (!session || syncedUid === session.user.id) return;
    syncedUid = session.user.id;
    await grant(session, 'welcome', null);
    const pending = load(PENDING_KEY, {});
    for (const key of Object.keys(pending)) {
      if (await grant(session, key, pending[key] === true ? null : pending[key])) delete pending[key];
    }
    save(PENDING_KEY, pending);
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

  function showUnlockToast(award) {
    const toast = document.createElement('div'); toast.className = 'awd-toast';
    const icon = document.createElement('div'); icon.className = 'awd-icon'; icon.textContent = award.icon || '🏆';
    const body = document.createElement('div'); body.className = 'awd-body';
    const label = document.createElement('div'); label.className = 'awd-label'; label.textContent = 'award unlocked';
    const title = document.createElement('div'); title.className = 'awd-title'; title.textContent = award.title || 'A mystery';
    body.appendChild(label); body.appendChild(title);
    if (award.description) {
      const desc = document.createElement('div'); desc.className = 'awd-desc'; desc.textContent = award.description;
      body.appendChild(desc);
    }
    toast.appendChild(icon); toast.appendChild(body);
    toast.addEventListener('click', () => { window.location.href = '/Awards/awards.html'; });
    stack().appendChild(toast);
    setTimeout(() => dismiss(toast), 6000);
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
    const visited = load(PAGES_KEY, []).filter(p => SITE_PAGES.includes(p));
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

  async function init() {
    if (window.Auth) window.Auth.onAuthStateChange(session => { if (session) onSignedIn(session); else syncedUid = null; });
    await onSignedIn(await getSession());
    trackPage();
    const hour = new Date().getHours();
    if (hour === 2 || hour === 3) unlock('h_m2');
    if (isMajorHoliday(new Date())) unlock('b_h8');
    watchKonami();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { unlock, progress };
})();
