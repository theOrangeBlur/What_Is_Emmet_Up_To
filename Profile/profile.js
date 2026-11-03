// Public profile page: /Profile/profile.html?u=<username>. Anyone can view
// one via the get_public_profile RPC (supabase/public_profiles.sql); the
// owner also gets an edit form for their name, bio, avatar and question
// answers, each with a public/private toggle. Visitors only ever receive the
// public ones. With no ?u, signed-in visitors are sent to their own profile.

const root = document.getElementById('profile-root');
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const USERNAME_RULES = '3–16 letters, numbers or underscores';
const BIO_MAX = 140;
const ANSWER_MAX = 140;
const AVATAR_SIZE = 256;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let profile = null;   // last get_public_profile result
let editing = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ALWAYS_PRIVATE = new Set((window.PROFILE_QUESTIONS || []).filter(q => q.private).map(q => q.id));

// The owner sees every field; these are the ones nobody else can.
function isPrivate(p, id) {
  return p.is_me && (ALWAYS_PRIVATE.has(id) || !(p.public_fields || []).includes(id));
}

function withPrivateTag(node, p, id) {
  if (isPrivate(p, id)) {
    node.appendChild(document.createTextNode(' '));
    node.appendChild(el('span', 'profile-private', 'only you can see this'));
  }
  return node;
}

function requestedName() {
  return (new URLSearchParams(window.location.search).get('u') || '').trim();
}

// ── Theme ───────────────────────────────────────────────────────────────
// A profile's three favorite colors repaint the page's tokens (Awards/
// awards.css): first = the background, kept deep and dark in that color's
// hue so it always looks good; second = all the text and third = the accent
// (--green), both exactly as picked. Dimmer text is a blend of text and
// background.
// The answers themselves stay private; the server sends the colors to every
// visitor as profile.theme.
const THEME_COLORS = ['color1', 'color2', 'color3'];
const THEME_VARS = ['--bg', '--panel', '--panel-2', '--line', '--text', '--soft', '--muted', '--green', '--green-hi'];
const HEX_RE = /^#[0-9a-f]{6}$/i;

function applyTheme(hexes) {
  const style = document.documentElement.style;
  THEME_VARS.forEach(v => style.removeProperty(v));
  const [background, text, accent] = (hexes || []).map(c => HEX_RE.test(c || '') ? c : null);
  const bg = background && window.ColorWheel.hexToHsl(background);
  if (bg) {
    const [h, s] = bg;
    const hsl = (sat, l) => `hsl(${h.toFixed(1)} ${(sat * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
    style.setProperty('--bg', hsl(s, 0.12));
    style.setProperty('--panel', hsl(s, 0.16));
    style.setProperty('--panel-2', hsl(s, 0.2));
    style.setProperty('--line', hsl(s * 0.8, 0.32));
  }
  if (text) style.setProperty('--text', text);
  if (bg || text) {
    const mix = pct => `color-mix(in srgb, var(--text) ${pct}%, var(--bg))`;
    style.setProperty('--soft', mix(75));
    style.setProperty('--muted', mix(55));
  }
  if (accent) {
    style.setProperty('--green', accent);
    style.setProperty('--green-hi', `color-mix(in srgb, ${accent} 80%, white)`);
  }
}

// The owner's own answers hold the colors too, so their page still themes if
// the server's theme is missing.
function themeOf(p) {
  if (p.theme) return p.theme;
  return THEME_COLORS.map(id => (p.answers || {})[id]);
}

function card(icon, heading, text, button) {
  applyTheme(null);
  root.innerHTML = '';
  const c = el('div', 'case-locked');
  c.appendChild(el('div', 'case-locked-icon', icon));
  c.appendChild(el('div', 'case-locked-heading', heading));
  c.appendChild(el('p', 'case-locked-text', text));
  if (button) {
    const btn = el('button', 'case-btn', button.label);
    btn.addEventListener('click', button.onClick);
    c.appendChild(btn);
  }
  root.appendChild(c);
}

// ── Viewing ─────────────────────────────────────────────────────────────

function avatarEl(p, extraClass) {
  const wrap = el('div', 'profile-avatar' + (extraClass ? ' ' + extraClass : ''));
  const url = window.Auth.avatarUrl(p.avatar_path, p.updated_at);
  if (url) {
    const img = el('img');
    img.src = url;
    img.alt = p.username + "'s picture";
    wrap.appendChild(img);
  } else {
    wrap.textContent = p.username.charAt(0).toUpperCase();
  }
  return wrap;
}

function renderHeader(p) {
  const head = el('section', 'profile-head');
  head.appendChild(avatarEl(p));
  const info = el('div', 'profile-info');
  info.appendChild(el('h1', 'profile-name', p.username));
  if (p.bio) info.appendChild(withPrivateTag(el('p', 'profile-bio', p.bio), p, 'bio'));
  if (p.member_since) info.appendChild(el('div', 'profile-since', 'resident since ' + formatDate(p.member_since)));
  if (p.is_me) {
    const btn = el('button', 'case-btn profile-edit-btn', 'edit profile');
    btn.addEventListener('click', () => { editing = true; render(); });
    info.appendChild(btn);
  }
  head.appendChild(info);
  return head;
}

// An answer as it reads on the page, by question type. Anything that doesn't
// parse is shown as typed.
function formatAnswer(q, value) {
  const wrap = el('div', 'profile-a');
  if (q.type === 'color' && /^#[0-9a-f]{6}$/i.test(value)) {
    const sw = el('span', 'profile-swatch');
    sw.style.background = value;
    wrap.appendChild(sw);
    wrap.appendChild(document.createTextNode(value));
    return wrap;
  }
  let text = value;
  const n = Number(value);
  if (q.type === 'date' && DATE_RE.test(value) && !isNaN(Date.parse(value))) {
    text = new Date(value + 'T00:00:00Z').toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } else if (q.type === 'number' && value !== '' && Number.isFinite(n)) {
    text = q.money
      ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : n.toLocaleString('en-US');
  }
  wrap.textContent = text;
  return wrap;
}

function renderTrivia(p) {
  const answers = p.answers || {};
  const answered = (window.PROFILE_QUESTIONS || []).filter(q => answers[q.id]);
  if (!answered.length) {
    if (!p.is_me) return null;
    const section = el('section', 'case-section');
    section.appendChild(el('h2', 'case-section-title', 'Getting to know you'));
    section.appendChild(el('p', 'profile-empty', "nothing here yet — hit “edit profile” and fill in a field or two"));
    return section;
  }
  const section = el('section', 'case-section');
  section.appendChild(el('h2', 'case-section-title', 'Getting to know ' + p.username));
  answered.forEach(q => {
    const row = el('div', 'profile-qa');
    row.appendChild(withPrivateTag(el('div', 'profile-q', q.q), p, q.id));
    row.appendChild(formatAnswer(q, answers[q.id]));
    section.appendChild(row);
  });
  return section;
}

function renderAwardRow(a) {
  const row = el('article', 'award award-unlocked' + (a.secret ? ' award-secret' : ''));
  row.appendChild(el('div', 'award-icon', a.icon));
  const body = el('div', 'award-body');
  if (a.secret) {
    body.appendChild(el('h3', 'award-title', 'This person has discovered a super-secret award!'));
  } else {
    body.appendChild(el('h3', 'award-title', a.title));
    if (a.description) body.appendChild(el('p', 'award-desc', a.description));
  }
  row.appendChild(body);
  const meta = el('div', 'award-meta');
  meta.appendChild(el('div', 'award-date', 'Unlocked ' + formatDate(a.unlocked_at)));
  row.appendChild(meta);
  return row;
}

function renderAwards(p) {
  const awards = p.awards || [];
  const section = el('section', 'case-section');
  section.appendChild(el('h2', 'case-section-title', `Trophies (${awards.length})`));
  if (!awards.length) section.appendChild(el('p', 'profile-empty', 'the shelf is bare — for now'));
  awards.forEach(a => section.appendChild(renderAwardRow(a)));
  return section;
}

function renderRecords(p) {
  const records = p.records || {};
  const has = v => v != null && v !== 0;
  const frag = document.createDocumentFragment();
  RECORD_GROUPS.forEach(group => {
    const section = el('section', 'case-section');
    section.appendChild(el('h2', 'case-section-title', group.title));
    group.records.forEach(def => {
      const raw = records[def.key];
      const r = raw != null && typeof raw === 'object' ? raw : { value: raw };
      if (def.hiddenUntilEarned && !has(r.value)) return;
      const row = el('article', 'record');
      row.appendChild(el('div', 'award-icon', def.icon));
      const body = el('div', 'award-body');
      body.appendChild(el('h3', 'award-title', def.title));
      const val = el('p', 'record-you', has(r.value) ? def.fmt(r.value) : '—');
      if (has(r.value) && r.date) val.appendChild(el('span', 'record-date', formatRecordDate(r.date)));
      body.appendChild(val);
      row.appendChild(body);
      section.appendChild(row);
    });
    frag.appendChild(section);
  });
  return frag;
}

function renderView(p) {
  root.innerHTML = '';
  root.appendChild(renderHeader(p));
  [renderTrivia(p), renderAwards(p), renderRecords(p)].forEach(s => { if (s) root.appendChild(s); });
}

// ── Editing (own profile only) ──────────────────────────────────────────

// Center-crop to a square and shrink, so uploads stay small.
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = AVATAR_SIZE;
    canvas.getContext('2d').drawImage(img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

let fieldCount = 0;

// A labelled form row. The label points at real inputs with `for` rather than
// wrapping them, so the privacy toggle beside it isn't clicked along with it.
function field(labelText, input, note, toggle) {
  const wrap = el('div', 'profile-field');
  const head = el('div', 'profile-field-head');
  const isInput = input.matches('input, textarea');
  const label = el(isInput ? 'label' : 'span', 'record-label', labelText);
  if (isInput) {
    input.id = input.id || 'profile-field-' + (++fieldCount);
    label.htmlFor = input.id;
  }
  head.appendChild(label);
  if (toggle) head.appendChild(toggle);
  wrap.appendChild(head);
  wrap.appendChild(input);
  if (note) wrap.appendChild(note);
  return wrap;
}

// Flips one field id in or out of publicSet; saved along with the form.
function privacyToggle(id, publicSet) {
  const btn = el('button', 'profile-privacy');
  btn.type = 'button';
  const sync = () => {
    const on = publicSet.has(id);
    btn.textContent = on ? '🌐 public' : '🔒 private';
    btn.classList.toggle('is-public', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'anyone can see this — click to hide it' : 'only you can see this — click to share it';
  };
  btn.addEventListener('click', () => {
    if (publicSet.has(id)) publicSet.delete(id); else publicSet.add(id);
    sync();
  });
  sync();
  return btn;
}

function charCounter(inp, max) {
  const count = el('span', 'profile-note');
  const update = () => { count.textContent = `${inp.value.length} / ${max}`; };
  inp.addEventListener('input', update); update();
  return count;
}

// The control for one question, by type: { el, get(), note? }.
function inputFor(q, value, onChange) {
  const type = q.type || 'text';
  if (type === 'color') return window.ColorWheel.create(value, onChange);
  if (type === 'long') {
    const inp = el('textarea', 'authw-input profile-textarea');
    inp.value = value; inp.maxLength = q.max || ANSWER_MAX; inp.rows = 3;
    return { el: inp, get: () => inp.value.trim(), note: charCounter(inp, inp.maxLength) };
  }
  const inp = el('input', 'authw-input');
  inp.value = value;
  if (type === 'number') {
    inp.type = 'number'; inp.min = 0;
    inp.step = q.integer ? 1 : q.money ? 0.01 : 'any';
    inp.inputMode = q.integer ? 'numeric' : 'decimal';
  } else if (type === 'date') {
    inp.type = 'date';
  } else {
    inp.maxLength = q.max || ANSWER_MAX;
  }
  return { el: inp, get: () => inp.value.trim() };
}

// [cleanValue, null], or [null, message] when the answer doesn't fit its type.
function checkAnswer(q, value) {
  if (!value) return ['', null];
  if (q.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return [null, `“${q.q}” needs a number, 0 or more`];
    if (q.integer && !Number.isInteger(n)) return [null, `“${q.q}” takes whole numbers only`];
    return [q.money ? n.toFixed(2) : String(n), null];
  }
  if (q.type === 'date' && (!DATE_RE.test(value) || isNaN(Date.parse(value)))) {
    return [null, `“${q.q}” needs a real date`];
  }
  return [value, null];
}

async function renderEdit(p) {
  const session = await window.Auth.getSession();
  root.innerHTML = '';
  const form = el('section', 'profile-edit');
  form.appendChild(el('h2', 'case-section-title', 'Edit your profile'));

  // Email: shown only to its owner, straight from the session.
  if (session) {
    const email = el('div', 'profile-email', session.user.email);
    form.appendChild(field('email (only you can see this)', email));
  }

  // Avatar
  let newAvatar = null;      // Blob to upload on save
  let removeAvatar = false;
  const avatarRow = el('div', 'profile-avatar-row');
  let preview = avatarEl(p, 'profile-avatar-small');
  avatarRow.appendChild(preview);
  const fileInp = el('input');
  fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.hidden = true;
  const pickBtn = el('button', 'authw-btn', 'new picture');
  pickBtn.type = 'button';
  pickBtn.addEventListener('click', () => fileInp.click());
  const clearBtn = el('button', 'authw-btn', 'remove');
  clearBtn.type = 'button';
  clearBtn.hidden = !p.avatar_path;
  function setPreview(src) {
    const next = el('div', 'profile-avatar profile-avatar-small');
    if (src) { const img = el('img'); img.src = src; img.alt = ''; next.appendChild(img); }
    else next.textContent = p.username.charAt(0).toUpperCase();
    preview.replaceWith(next); preview = next;
  }
  fileInp.addEventListener('change', async () => {
    const file = fileInp.files && fileInp.files[0];
    if (!file) return;
    try {
      newAvatar = await shrinkImage(file);
      removeAvatar = false;
      setPreview(URL.createObjectURL(newAvatar));
      clearBtn.hidden = false;
    } catch { showMsg("couldn't read that picture — try another"); }
  });
  clearBtn.addEventListener('click', () => {
    newAvatar = null; removeAvatar = true;
    setPreview(null);
    clearBtn.hidden = true;
  });
  avatarRow.appendChild(pickBtn); avatarRow.appendChild(clearBtn); avatarRow.appendChild(fileInp);
  form.appendChild(field('picture', avatarRow));

  // Username
  const nameInp = el('input', 'authw-input');
  nameInp.value = p.username; nameInp.maxLength = 16; nameInp.spellcheck = false; nameInp.autocomplete = 'username';
  form.appendChild(field('name', nameInp, el('span', 'profile-note', USERNAME_RULES)));

  // Which fields anyone can see. Ids for removed questions are kept as is.
  const publicSet = new Set(p.public_fields || []);
  form.appendChild(el('p', 'profile-note',
    'Fill in as much or as little as you like. Everything stays 🔒 private until you flip it to 🌐 public. ' +
    'Your favorite colors stay private, but they paint your page for everyone who visits.'));

  // Bio
  const bioInp = el('textarea', 'authw-input profile-textarea');
  bioInp.value = p.bio || ''; bioInp.maxLength = BIO_MAX; bioInp.rows = 3;
  bioInp.placeholder = 'a line about yourself';
  form.appendChild(field('bio', bioInp, charCounter(bioInp, BIO_MAX), privacyToggle('bio', publicSet)));

  // Questions
  const answers = Object.assign({}, p.answers || {});
  const answerInps = {};
  // Picking a favorite color previews the theme straight away.
  const previewTheme = () => applyTheme(THEME_COLORS.map(id =>
    answerInps[id] ? answerInps[id].control.get() : answers[id]));
  (window.PROFILE_QUESTIONS || []).forEach(q => {
    const control = inputFor(q, answers[q.id] || '', previewTheme);
    answerInps[q.id] = { q, control };
    form.appendChild(field(q.q, control.el, control.note, q.private ? null : privacyToggle(q.id, publicSet)));
  });

  const msg = el('div', 'authw-msg'); msg.style.display = 'none';
  function showMsg(text) { msg.textContent = text; msg.style.display = 'block'; }
  form.appendChild(msg);

  const btns = el('div', 'authw-btns profile-btns');
  const saveBtn = el('button', 'authw-btn authw-btn-primary', 'save');
  const cancelBtn = el('button', 'authw-btn', 'never mind');
  cancelBtn.addEventListener('click', () => { editing = false; render(); });
  btns.appendChild(saveBtn); btns.appendChild(cancelBtn);
  form.appendChild(btns);

  saveBtn.addEventListener('click', async () => {
    const name = nameInp.value.trim();
    if (!USERNAME_RE.test(name)) { showMsg('your name needs to be ' + USERNAME_RULES); return; }
    // Answers to questions since removed from the list stay in `answers`.
    for (const { q, control } of Object.values(answerInps)) {
      const [value, problem] = checkAnswer(q, control.get());
      if (problem) { showMsg(problem); return; }
      answers[q.id] = value;
    }
    saveBtn.disabled = true;
    try {
      if (name !== p.username) {
        const result = await window.Auth.setUsername(name);
        if (!result.ok) {
          showMsg(result.reason === 'taken' ? 'someone already goes by that — try another name'
                : result.reason === 'invalid' ? 'your name needs to be ' + USERNAME_RULES
                : 'the doorman lost his pen — try again in a bit');
          return;
        }
        history.replaceState(null, '', window.Auth.profileUrl(result.username));
        if (window.AuthWidget) window.AuthWidget.renderLink();
      }
      const saved = await window.Auth.updateProfile({ bio: bioInp.value.trim(), answers, publicFields: [...publicSet].filter(id => !ALWAYS_PRIVATE.has(id)) });
      if (!saved.ok) { showMsg(saved.reason === 'bio_too_long' ? 'that bio runs long — trim it a bit' : "couldn't save that — try again in a bit"); return; }
      if (newAvatar) {
        const up = await window.Auth.uploadAvatar(newAvatar);
        if (!up.ok) { showMsg("everything saved but the picture — try it again"); return; }
      } else if (removeAvatar) {
        await window.Auth.updateProfile({ avatarPath: '' });
      }
      editing = false;
      await load();
    } finally {
      saveBtn.disabled = false;
    }
  });

  root.appendChild(form);
  setTimeout(() => nameInp.focus(), 50);
}

// ── Loading ─────────────────────────────────────────────────────────────

function render() {
  if (!profile) return;
  // Re-applied on every render, so cancelling an edit drops the preview.
  applyTheme(themeOf(profile));
  if (editing && profile.is_me) renderEdit(profile);
  else renderView(profile);
}

// On your own page the top-right box becomes the sign-out button.
function setOwnPage(value) {
  if (window.AuthWidget && window.AuthWidget.setOnOwnProfile) window.AuthWidget.setOnOwnProfile(value);
}

async function load() {
  const wanted = requestedName();
  if (!wanted) {
    const session = await window.Auth.getSession();
    const mine = session && await window.Auth.getUsername();
    if (mine) { window.location.replace(window.Auth.profileUrl(mine)); return; }
    setOwnPage(!!session);
    if (session) {
      card('📛', 'no name on the door', "Pick a name and you'll get a page of your own that anyone can drop by.",
        { label: 'pick a name', onClick: () => window.AuthWidget && window.AuthWidget.showUsernameModal() });
    } else {
      card('🔒', 'members only', "Knock on the door to get a page of your own — awards, records and all.",
        { label: 'knock on the door', onClick: () => window.AuthWidget && window.AuthWidget.showAuthModal('login') });
    }
    return;
  }

  const { data, error } = await window.Auth.getPublicProfile(wanted);
  if (error) { setOwnPage(false); card('📪', 'directory closed', "the directory is closed for lunch — try again in a bit"); return; }
  if (!data) {
    profile = null;
    setOwnPage(false);
    card('🚪', 'nobody home', `Nobody by the name “${wanted}” lives here. Maybe they changed it?`);
    return;
  }
  profile = data;
  setOwnPage(!!data.is_me);
  document.title = `${data.username} | The Emmet Enquirer`;
  // The name in the URL may differ in case from the real one.
  if (data.username !== wanted) history.replaceState(null, '', window.Auth.profileUrl(data.username));
  render();
}

// Signing in or out changes whether this is "your" profile (and, with no ?u,
// where to go). A freshly picked username triggers this too.
let loadQueued = null;
function queueLoad() {
  clearTimeout(loadQueued);
  loadQueued = setTimeout(() => { if (!editing) load(); }, 100);
}
window.Auth.onAuthStateChange(queueLoad);
document.addEventListener('username:changed', queueLoad);
queueLoad();
