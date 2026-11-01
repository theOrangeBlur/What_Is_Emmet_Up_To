// Trophy case page: lists every award via the get_awards RPC. Hidden awards
// the visitor hasn't earned arrive already masked from the database, and
// buried ones don't arrive at all until they're earned.

const root = document.getElementById('awards-root');

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

function renderSignedOut() {
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

function renderAward(a) {
  const unlocked = !!a.unlocked_at;
  const row = el('article', 'award' + (unlocked ? ' award-unlocked' : ' award-locked') + (a.hidden && !unlocked ? ' award-secret' : ''));
  row.appendChild(el('div', 'award-icon', a.icon));

  const body = el('div', 'award-body');
  const title = el('h3', 'award-title', a.title);
  if (a.buried) title.appendChild(el('span', 'award-tag', 'buried'));
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

function renderSection(title, awards) {
  if (!awards.length) return null;
  const section = el('section', 'case-section');
  section.appendChild(el('h2', 'case-section-title', title));
  awards.forEach(a => section.appendChild(renderAward(a)));
  return section;
}

async function renderAwards() {
  const { data, error } = await window.Auth.rpc('get_awards');
  if (error || !data) {
    root.innerHTML = '';
    root.appendChild(el('div', 'case-loading', "the trophy case is jammed shut — try again in a bit"));
    return;
  }
  const unlocked = data.filter(a => a.unlocked_at).sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at));
  const locked = data.filter(a => !a.unlocked_at && !a.hidden);
  const secret = data.filter(a => !a.unlocked_at && a.hidden);

  root.innerHTML = '';
  const summary = el('div', 'case-summary');
  summary.appendChild(el('div', 'case-summary-text', `${unlocked.length} of ${data.length} awards earned`));
  summary.appendChild(progressBar(unlocked.length, data.length || 1));
  root.appendChild(summary);

  [
    renderSection('Earned', unlocked),
    renderSection('Still out there', locked),
    renderSection(`Hidden (${secret.length})`, secret)
  ].forEach(s => { if (s) root.appendChild(s); });
}

let renderQueued = null;
async function render() {
  // Collapse bursts (e.g. several awards claimed right after signing in) into one fetch.
  clearTimeout(renderQueued);
  renderQueued = setTimeout(async () => {
    const session = await window.Auth.getSession();
    if (session) await renderAwards(); else renderSignedOut();
  }, 150);
}

window.Auth.onAuthStateChange(render);
document.addEventListener('awards:changed', render);
render();
