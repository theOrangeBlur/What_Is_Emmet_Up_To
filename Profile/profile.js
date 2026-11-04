// Public profile page: /Profile/profile.html?u=<username>. Anyone can view
// one via the get_public_profile RPC (supabase/public_profiles.sql); the
// owner also gets an edit form for their name, bio, avatar, art window, sound and
// question answers, each with a public/private toggle. Visitors only ever receive the
// public ones. With no ?u, signed-in visitors are sent to their own profile.

const root = document.getElementById('profile-root');
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const USERNAME_RULES = '3–16 letters, numbers or underscores';
const BIO_MAX = 140;
const ANSWER_MAX = 140;
// "Another name you might go by": stored in answers like a question, but
// shown under the username rather than in the questions list.
const ALT_NAME_ID = 'alt_name';
const ALT_NAME_MAX = 40;
const AVATAR_SIZE = 256;
const ART_SIZE = 1200;       // longest side of an art window picture
const ART_TITLE_MAX = 80;
const ART_TITLE_HINT = 'type any heading you like — or leave it blank';
const SOUND_TITLE_MAX = 80;
const SOUND_TITLE_DEFAULT = 'listen to this!';   // the input's hint, and the heading when left blank
const SOUND_MAX_BYTES = 5 * 1024 * 1024;         // the sounds bucket's cap (public_profiles.sql)
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

// ── Name font ───────────────────────────────────────────────────────────
// The typeface the name (and the avatar's fallback letter) is set in. The
// list lives in shared/name-fonts.js so other pages can show a name in its
// owner's font too. Only the default and the page's own faces load with the
// page; the others are fetched when a profile or the picker needs them.
const NAME_FONT_DEFAULT = NameFonts.DEFAULT;
const NAME_FONT_UNLOCK = 'perk:name_fonts';
const NAME_FONTS = NameFonts.FONTS;

// The page's <link> already carries these.
NameFonts.markLoaded('Bricolage+Grotesque:opsz,wght@12..96,800', 'Syne:wght@800', 'Space+Mono:wght@700');
const loadNameFont = NameFonts.load;
const nameFontKey = NameFonts.keyOf;

function applyNameFont(key) {
  const f = NAME_FONTS[nameFontKey(key)];
  loadNameFont(nameFontKey(key));
  const style = document.documentElement.style;
  style.setProperty('--name-font', f.family);
  style.setProperty('--name-weight', String(f.weight));
  style.setProperty('--name-style', f.italic ? 'italic' : 'normal');
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
  const altName = (p.answers || {})[ALT_NAME_ID];
  if (altName) info.appendChild(withPrivateTag(el('p', 'profile-alt-name', 'a.k.a. ' + altName), p, ALT_NAME_ID));
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

// The art window: whatever picture the owner wants to show off, under a
// heading they typed. Nothing shows until there's a picture.
function renderArt(p) {
  const url = window.Auth.avatarUrl(p.art_path, p.updated_at);
  if (!url) return null;
  const section = el('section', 'case-section');
  const title = el('h2', 'case-section-title profile-art-title', p.art_title || '');
  if (!p.art_title) title.classList.add('profile-art-title-blank');
  section.appendChild(withPrivateTag(title, p, 'art'));
  const frame = el('figure', 'profile-art');
  const img = el('img');
  img.src = url;
  img.alt = p.art_title || p.username + "'s art";
  frame.appendChild(img);
  section.appendChild(frame);
  return section;
}

// The sound clip, under its heading ("listen to this!" unless they typed one).
function renderSound(p) {
  const url = window.Auth.soundUrl(p.sound_path, p.updated_at);
  if (!url) return null;
  const section = el('section', 'case-section');
  const title = el('h2', 'case-section-title profile-art-title', p.sound_title || SOUND_TITLE_DEFAULT);
  section.appendChild(withPrivateTag(title, p, 'sound'));
  const box = el('div', 'profile-sound');
  const audio = el('audio', 'profile-sound-player');
  audio.controls = true; audio.preload = 'metadata'; audio.src = url;
  box.appendChild(audio);
  section.appendChild(box);
  return section;
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
  [renderArt(p), renderSound(p), renderTrivia(p), renderAwards(p), renderRecords(p)].forEach(s => { if (s) root.appendChild(s); });
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

// Keep the shape, cap the longest side. Browsers that can't write webp hand
// back a png, which can be huge, so those go out as jpeg instead.
async function shrinkArt(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, ART_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const toBlob = (type, q) => new Promise(resolve => canvas.toBlob(resolve, type, q));
    const webp = await toBlob('image/webp', 0.85);
    return webp && webp.type === 'image/webp' ? webp : await toBlob('image/jpeg', 0.85);
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
  form.appendChild(field('username - what should we call you?', nameInp, el('span', 'profile-note', USERNAME_RULES)));

  // Which fields anyone can see. Ids for removed questions are kept as is.
  const publicSet = new Set(p.public_fields || []);

  // Another name: optional, free text, kept in answers under ALT_NAME_ID.
  const altNameInp = el('input', 'authw-input');
  altNameInp.value = (p.answers || {})[ALT_NAME_ID] || ''; altNameInp.maxLength = ALT_NAME_MAX;
  altNameInp.placeholder = 'optional';
  form.appendChild(field('another name you might go by', altNameInp, null, privacyToggle(ALT_NAME_ID, publicSet)));
  form.appendChild(el('p', 'profile-note',
    'Fill in as much or as little as you like. Everything stays 🔒 private until you flip it to 🌐 public. ' +
    'Your favorite colors stay private, but they paint your page for everyone who visits.'));

  // Bio
  const bioInp = el('textarea', 'authw-input profile-textarea');
  bioInp.value = p.bio || ''; bioInp.maxLength = BIO_MAX; bioInp.rows = 3;
  bioInp.placeholder = 'a line about yourself';
  form.appendChild(field('bio', bioInp, charCounter(bioInp, BIO_MAX), privacyToggle('bio', publicSet)));

  // Art window: a heading and a picture
  let newArt = null;         // Blob to upload on save
  let removeArt = false;
  const artWrap = el('div', 'profile-art-edit');
  const artTitleInp = el('input', 'authw-input profile-art-title-input');
  artTitleInp.value = p.art_title || ''; artTitleInp.maxLength = ART_TITLE_MAX;
  artTitleInp.placeholder = ART_TITLE_HINT;
  artTitleInp.setAttribute('aria-label', 'art heading');
  artWrap.appendChild(artTitleInp);

  const artInp = el('input');
  artInp.type = 'file'; artInp.accept = 'image/*'; artInp.hidden = true;
  const artDrop = el('button', 'profile-art profile-art-drop');
  artDrop.type = 'button';
  const artEmpty = () => {
    artDrop.innerHTML = '';
    artDrop.classList.add('is-empty');
    artDrop.appendChild(el('span', 'profile-art-drop-icon', '🖼️'));
    artDrop.appendChild(el('span', 'profile-art-drop-text', 'click or drop a picture here'));
  };
  const artShow = src => {
    artDrop.innerHTML = '';
    artDrop.classList.remove('is-empty');
    const img = el('img'); img.src = src; img.alt = '';
    artDrop.appendChild(img);
  };
  const artUrl = window.Auth.avatarUrl(p.art_path, p.updated_at);
  if (artUrl) artShow(artUrl); else artEmpty();

  const artClear = el('button', 'authw-btn', 'remove picture');
  artClear.type = 'button';
  artClear.hidden = !p.art_path;
  async function takeArt(file) {
    if (!file || !file.type.startsWith('image/')) { showMsg("that doesn't look like a picture — try another"); return; }
    try {
      newArt = await shrinkArt(file);
      removeArt = false;
      artShow(URL.createObjectURL(newArt));
      artClear.hidden = false;
    } catch { showMsg("couldn't read that picture — try another"); }
  }
  artDrop.addEventListener('click', () => artInp.click());
  artInp.addEventListener('change', () => takeArt(artInp.files && artInp.files[0]));
  artDrop.addEventListener('dragover', e => { e.preventDefault(); artDrop.classList.add('is-over'); });
  artDrop.addEventListener('dragleave', () => artDrop.classList.remove('is-over'));
  artDrop.addEventListener('drop', e => {
    e.preventDefault();
    artDrop.classList.remove('is-over');
    takeArt(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  artClear.addEventListener('click', () => {
    newArt = null; removeArt = true; artInp.value = '';
    artEmpty();
    artClear.hidden = true;
  });
  artWrap.appendChild(artDrop);
  const artBtns = el('div', 'profile-avatar-row');
  artBtns.appendChild(artClear); artBtns.appendChild(artInp);
  artWrap.appendChild(artBtns);
  form.appendChild(field('art window', artWrap,
    el('span', 'profile-note', 'show off a drawing, a photo, anything — it gets its own window on your page'),
    privacyToggle('art', publicSet)));

  // Sound: a heading and an audio file. Uploaded as is, so it's size-checked here.
  let newSound = null;       // File to upload on save
  let removeSound = false;
  const soundWrap = el('div', 'profile-sound-edit');
  const soundTitleInp = el('input', 'authw-input profile-art-title-input');
  soundTitleInp.value = p.sound_title || ''; soundTitleInp.maxLength = SOUND_TITLE_MAX;
  soundTitleInp.placeholder = SOUND_TITLE_DEFAULT;
  soundTitleInp.setAttribute('aria-label', 'sound heading');
  soundWrap.appendChild(soundTitleInp);

  const soundInp = el('input');
  soundInp.type = 'file'; soundInp.accept = 'audio/*'; soundInp.hidden = true;
  const soundPlayer = el('audio', 'profile-sound-player');
  soundPlayer.controls = true; soundPlayer.preload = 'metadata';
  const soundStart = window.Auth.soundUrl(p.sound_path, p.updated_at);
  if (soundStart) soundPlayer.src = soundStart; else soundPlayer.hidden = true;
  const soundName = el('span', 'profile-note');
  const soundPick = el('button', 'authw-btn', p.sound_path ? 'new sound' : 'pick a sound');
  soundPick.type = 'button';
  const soundClear = el('button', 'authw-btn', 'remove sound');
  soundClear.type = 'button';
  soundClear.hidden = !p.sound_path;
  let soundObjectUrl = null;
  function takeSound(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/')) { showMsg("that doesn't look like a sound file — try an mp3"); return; }
    if (file.size > SOUND_MAX_BYTES) { showMsg('that sound is over 5 MB — try a shorter clip or an mp3'); return; }
    newSound = file; removeSound = false;
    if (soundObjectUrl) URL.revokeObjectURL(soundObjectUrl);
    soundObjectUrl = URL.createObjectURL(file);
    soundPlayer.src = soundObjectUrl; soundPlayer.hidden = false;
    soundName.textContent = file.name;
    soundPick.textContent = 'new sound';
    soundClear.hidden = false;
  }
  soundPick.addEventListener('click', () => soundInp.click());
  soundInp.addEventListener('change', () => takeSound(soundInp.files && soundInp.files[0]));
  soundWrap.addEventListener('dragover', e => { e.preventDefault(); });
  soundWrap.addEventListener('drop', e => {
    e.preventDefault();
    takeSound(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  soundClear.addEventListener('click', () => {
    newSound = null; removeSound = true; soundInp.value = '';
    soundPlayer.pause(); soundPlayer.removeAttribute('src'); soundPlayer.hidden = true;
    soundName.textContent = '';
    soundPick.textContent = 'pick a sound';
    soundClear.hidden = true;
  });
  soundWrap.appendChild(soundPlayer);
  const soundBtns = el('div', 'profile-avatar-row');
  soundBtns.appendChild(soundPick); soundBtns.appendChild(soundClear); soundBtns.appendChild(soundName); soundBtns.appendChild(soundInp);
  soundWrap.appendChild(soundBtns);
  form.appendChild(field('sound', soundWrap,
    el('span', 'profile-note', 'a song, a voice memo, a sound effect — mp3, m4a, wav or ogg, up to 5 MB'),
    privacyToggle('sound', publicSet)));

  // Name font: a row of samples, locked until ten games are played.
  const startFont = nameFontKey(p.name_font);
  let nameFont = startFont;
  const fontWrap = el('div', 'profile-fonts is-locked');
  const fontLock = el('p', 'profile-font-lock', 'checking whether you’ve unlocked these…');
  fontWrap.appendChild(fontLock);
  const fontGrid = el('div', 'profile-font-grid');
  const fontBtns = {};
  Object.entries(NAME_FONTS).forEach(([key, f]) => {
    loadNameFont(key);
    const b = el('button', 'profile-font-opt');
    b.type = 'button';
    b.disabled = true;
    b.setAttribute('aria-pressed', String(key === nameFont));
    const sample = el('span', 'profile-font-sample');
    sample.style.fontFamily = f.family;
    sample.style.fontWeight = f.weight;
    sample.style.fontStyle = f.italic ? 'italic' : 'normal';
    b.appendChild(sample);
    b.appendChild(el('span', 'profile-font-label', f.label + (key === NAME_FONT_DEFAULT ? ' (default)' : '')));
    b.addEventListener('click', () => {
      nameFont = key;
      Object.entries(fontBtns).forEach(([k, btn]) => btn.setAttribute('aria-pressed', String(k === key)));
      applyNameFont(key);
    });
    fontBtns[key] = b;
    fontGrid.appendChild(b);
  });
  fontWrap.appendChild(fontGrid);
  const syncSamples = () => {
    const text = nameInp.value.trim() || p.username;
    fontGrid.querySelectorAll('.profile-font-sample').forEach(s => { s.textContent = text; });
  };
  nameInp.addEventListener('input', syncSamples);
  syncSamples();
  form.appendChild(field('name font', fontWrap));
  (window.Unlocks ? window.Unlocks.status([NAME_FONT_UNLOCK]) : Promise.resolve({})).then(all => {
    const st = all[NAME_FONT_UNLOCK];
    if (st && st.unlocked) {
      fontWrap.classList.remove('is-locked');
      fontLock.remove();
      Object.values(fontBtns).forEach(b => { b.disabled = false; });
      return;
    }
    const target = (st && st.target) || 10;
    const played = Math.min((st && st.value) || 0, target);
    fontLock.textContent = `🔒 Play ${target} games to pick your own — ${played} / ${target} so far. ` +
      'Wordle, Thermometers, Hexdoku levels, the River Crossing and up to three Coin Riddle solves all count.';
  }).catch(() => {});

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
    answers[ALT_NAME_ID] = altNameInp.value.trim();
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
      const artTitle = artTitleInp.value.trim();
      const soundTitle = soundTitleInp.value.trim();
      const saved = await window.Auth.updateProfile({
        bio: bioInp.value.trim(), answers, publicFields: [...publicSet].filter(id => !ALWAYS_PRIVATE.has(id)),
        artTitle: artTitle !== (p.art_title || '') ? artTitle : null,
        soundTitle: soundTitle !== (p.sound_title || '') ? soundTitle : null,
        // '' puts the name back on the default.
        nameFont: nameFont !== startFont ? (nameFont === NAME_FONT_DEFAULT ? '' : nameFont) : null,
      });
      if (!saved.ok) {
        showMsg(saved.reason === 'bio_too_long' ? 'that bio runs long — trim it a bit'
              : saved.reason === 'art_title_too_long' ? 'that art heading runs long — trim it a bit'
              : saved.reason === 'sound_title_too_long' ? 'that sound heading runs long — trim it a bit'
              : saved.reason === 'locked' ? 'play ten games to unlock the other fonts'
              : "couldn't save that — try again in a bit");
        return;
      }
      if (newAvatar) {
        const up = await window.Auth.uploadAvatar(newAvatar);
        if (!up.ok) { showMsg("everything saved but the picture — try it again"); return; }
      } else if (removeAvatar) {
        await window.Auth.updateProfile({ avatarPath: '' });
      }
      if (newArt) {
        const up = await window.Auth.uploadArt(newArt);
        if (!up.ok) { showMsg("everything saved but the art — try it again"); return; }
      } else if (removeArt) {
        await window.Auth.updateProfile({ artPath: '' });
      }
      if (newSound) {
        const up = await window.Auth.uploadSound(newSound);
        if (!up.ok) { showMsg("everything saved but the sound — try it again, or try an mp3"); return; }
      } else if (removeSound) {
        await window.Auth.updateProfile({ soundPath: '' });
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
  applyNameFont(profile.name_font);
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
