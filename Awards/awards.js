// Trophy case page, in two tabs:
//   Awards   every award via the get_awards RPC. Hidden awards the visitor
//            hasn't earned arrive already masked from the database, and
//            buried ones don't arrive at all until they're earned.
//   Records  the visitor's personal bests next to the all-time record for
//            each, via the get_records RPC (supabase/records.sql).

const root = document.getElementById('awards-root');
const recordsRoot = document.getElementById('records-root');
const tabs = document.querySelectorAll('.case-tab');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function progressBar(value, max) {
  const bar = el('div', 'case-bar');
  const fill = el('div', 'case-bar-fill');
  fill.style.width = Math.min(100, Math.round(100 * value / max)) + '%';
  bar.appendChild(fill);
  return bar;
}

function renderSignedOut(root) {
  root.innerHTML = '';
  const card = el('div', 'case-locked');
  card.appendChild(el('div', 'case-locked-icon', '🔒'));
  card.appendChild(el('div', 'case-locked-heading', 'members only'));
  card.appendChild(el('p', 'case-locked-text',
    "The trophy case is behind the door. Knock, and you'll find a list of challenges waiting — some of them in plain sight, some of them not."));
  const btn = el('button', 'case-btn', 'knock on the door');
  btn.addEventListener('click', () => window.AuthWidget && window.AuthWidget.showAuthModal('login'));
  card.appendChild(btn);
  root.appendChild(card);
}

function renderAward(a, rewarding) {
  const unlocked = !!a.unlocked_at;
  const row = el('article', 'award' + (unlocked ? ' award-unlocked' : ' award-locked') + (a.hidden && !unlocked ? ' award-secret' : ''));
  row.appendChild(el('div', 'award-icon', a.icon));

  const body = el('div', 'award-body');
  const title = el('h3', 'award-title', a.title);
  if (a.buried) title.appendChild(el('span', 'award-tag', 'buried'));
  // Marks an award that opens something up somewhere, without saying what.
  if (rewarding) {
    const mark = el('span', 'award-reward-mark', '✦');
    mark.title = 'this might do something special for you...';
    title.appendChild(mark);
  }
  body.appendChild(title);
  if (a.description) body.appendChild(el('p', 'award-desc', a.description));
  if (a.hidden && !unlocked) {
    body.appendChild(el('p', 'award-hint', a.hint ? a.hint :'...?'));
  }
  if (!unlocked && a.target) {
    const prog = el('div', 'award-progress');
    prog.appendChild(progressBar(a.progress, a.target));
    prog.appendChild(el('span', 'award-progress-text', `${a.progress} / ${a.target}`));
    body.appendChild(prog);
  }
  row.appendChild(body);

  const meta = el('div', 'award-meta');
  if (unlocked) meta.appendChild(el('div', 'award-date', 'Unlocked ' + formatDate(a.unlocked_at)));
  const pct = Number(a.rarity_pct) || 0;
  meta.appendChild(el('div', 'award-rarity' + (pct < 10 ? ' award-rare' : ''), `${pct}% of visitors`));
  row.appendChild(meta);
  return row;
}

function renderSection(title, awards, rewarding) {
  if (!awards.length) return null;
  const section = el('section', 'case-section');
  section.appendChild(el('h2', 'case-section-title', title));
  awards.forEach(a => section.appendChild(renderAward(a, rewarding.has(a.key))));
  return section;
}

async function renderAwards() {
  const [{ data, error }, rewardRes] = await Promise.all([
    window.Auth.rpc('get_awards'),
    window.Auth.rpc('get_rewarding_awards')
  ]);
  if (error || !data) {
    root.innerHTML = '';
    root.appendChild(el('div', 'case-loading', "the trophy case is jammed shut — try again in a bit"));
    return;
  }
  const unlocked = data.filter(a => a.unlocked_at).sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at));
  const locked = data.filter(a => !a.unlocked_at && !a.hidden);
  const secret = data.filter(a => !a.unlocked_at && a.hidden);
  // Awards that unlock something. Missing just means no marks.
  const rewarding = new Set((rewardRes.data || []).map(r => r.award_key));

  root.innerHTML = '';
  const summary = el('div', 'case-summary');
  summary.appendChild(el('div', 'case-summary-text', `${unlocked.length} of ${data.length} awards earned`));
  summary.appendChild(progressBar(unlocked.length, data.length || 1));
  root.appendChild(summary);

  [
    renderSection('Earned', unlocked, rewarding),
    renderSection('Still out there', locked, rewarding),
    renderSection(`Hidden (${secret.length})`, secret, rewarding)
  ].forEach(s => { if (s) root.appendChild(s); });
}

// ── Records ─────────────────────────────────────────────────────────────

// RECORD_GROUPS and the formatters live in shared/records-format.js.

function getWordleDeviceId() {
  try { return localStorage.getItem('wordle_device_id'); } catch { return null; }
}

function renderRecord(def, personal, site) {
  // Personal values come back either bare or as { value, date }.
  const mine = personal != null && typeof personal === 'object' ? personal : { value: personal };
  const has = v => v != null && v !== 0;

  const row = el('article', 'record' + (site && site.mine ? ' record-held' : ''));
  row.appendChild(el('div', 'award-icon', def.icon));

  const body = el('div', 'award-body');
  body.appendChild(el('h3', 'award-title', def.title));
  const you = el('p', 'record-you');
  you.appendChild(el('span', 'record-label', 'you'));
  you.appendChild(document.createTextNode(has(mine.value) ? def.fmt(mine.value) : '—'));
  if (has(mine.value) && mine.date) you.appendChild(el('span', 'record-date', formatRecordDate(mine.date)));
  body.appendChild(you);
  row.appendChild(body);

  if (!def.personalOnly) {
    const best = el('div', 'record-best');
    best.appendChild(el('div', 'record-label', 'record'));
    if (site && has(site.value)) {
      best.appendChild(el('div', 'record-value', def.fmt(site.value)));
      const who = el('div', 'record-holder');
      who.appendChild(window.AuthWidget
        ? window.AuthWidget.profileLink(site.holder_username, site.holder || 'A MYSTERY GUEST')
        : document.createTextNode(site.holder || 'A MYSTERY GUEST'));
      if (site.date) who.appendChild(el('span', 'record-date', formatRecordDate(site.date)));
      best.appendChild(who);
      if (site.mine) best.appendChild(el('div', 'record-badge', "🏅 that's you"));
    } else {
      best.appendChild(el('div', 'record-holder', 'up for grabs'));
    }
    row.appendChild(best);
  }
  return row;
}

async function renderRecords() {
  const { data, error } = await window.Auth.rpc('get_records', { p_device_id: getWordleDeviceId() });
  if (error || !data) {
    recordsRoot.innerHTML = '';
    recordsRoot.appendChild(el('div', 'case-loading', "the record books are locked up — try again in a bit"));
    return;
  }
  const personal = data.personal || {}, site = data.site || {};
  recordsRoot.innerHTML = '';
  RECORD_GROUPS.forEach(group => {
    const section = el('section', 'case-section');
    section.appendChild(el('h2', 'case-section-title', group.title));
    group.records.forEach(def => section.appendChild(renderRecord(def, personal[def.key], site[def.key])));
    recordsRoot.appendChild(section);
  });
}

// ── Tabs ────────────────────────────────────────────────────────────────

function activeTab() {
  return window.location.hash === '#records' ? 'records' : 'awards';
}

function showTab(name) {
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('case-tab-active', on);
    t.setAttribute('aria-selected', on);
  });
  root.hidden = name !== 'awards';
  recordsRoot.hidden = name !== 'records';
}

tabs.forEach(t => t.addEventListener('click', () => {
  history.replaceState(null, '', t.dataset.tab === 'records' ? '#records' : window.location.pathname);
  showTab(t.dataset.tab);
  render();
}));
window.addEventListener('hashchange', () => { showTab(activeTab()); render(); });

let renderQueued = null;
async function render() {
  // Collapse bursts (e.g. several awards claimed right after signing in) into one fetch.
  clearTimeout(renderQueued);
  renderQueued = setTimeout(async () => {
    const tab = activeTab();
    const target = tab === 'records' ? recordsRoot : root;
    const session = await window.Auth.getSession();
    if (!session) renderSignedOut(target);
    else if (tab === 'records') await renderRecords();
    else await renderAwards();
  }, 150);
}

showTab(activeTab());
window.Auth.onAuthStateChange(render);
document.addEventListener('awards:changed', render);
render();
