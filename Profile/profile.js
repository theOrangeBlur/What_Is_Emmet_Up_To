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
const PIXEL_ICON_UNLOCK = 'perk:pixel_icon';
const NAME_FONTS = NameFonts.FONTS;

// The page's <link> already carries these.
NameFonts.markLoaded('Bricolage+Grotesque:opsz,wght@12..96,800', 'Syne:wght@800', 'Space+Mono:wght@700', 'Space+Mono:wght@400;700');
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

// ── Text font ───────────────────────────────────────────────────────────
// The typeface for the rest of the owner's own words: bio and answers. Opened
// up by perk:text_fonts, the reward for a hidden award (unlocks-hidden.sql).
const TEXT_FONT_DEFAULT = NameFonts.TEXT_DEFAULT;
const TEXT_FONT_UNLOCK = 'perk:text_fonts';
const TEXT_FONTS = NameFonts.TEXT_FONTS;
const textFontKey = NameFonts.textKeyOf;

function applyTextFont(key) {
  const k = textFontKey(key);
  const f = TEXT_FONTS[k];
  NameFonts.load(k);
  const style = document.documentElement.style;
  style.setProperty('--text-font', f.family);
  style.setProperty('--text-scale', String(f.scale || 1));
}

// ── Visiting other profiles ─────────────────────────────────────────────
// Dropping in on three other residents earns the hidden h_v3 award. Who's
// been visited is kept per account (or for signed-out browsing), and the
// awards system holds signed-out progress until sign-in.
const NEIGHBOR_AWARD = 'h_v3';
const NEIGHBOR_TARGET = 3;

async function countVisit(p) {
  if (p.is_me || !window.Awards) return;
  const session = await window.Auth.getSession();
  const key = 'awards_profiles_' + (session ? session.user.id : 'anon');
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  const name = p.username.toLowerCase();
  if (!seen.includes(name)) {
    seen.push(name);
    try { localStorage.setItem(key, JSON.stringify(seen)); } catch {}
  }
  window.Awards.progress(NEIGHBOR_AWARD, Math.min(seen.length, NEIGHBOR_TARGET), NEIGHBOR_TARGET);
}

// Text people typed, with its **bold**, *italics*, links and lists.
function richEl(tag, className, text, block) {
  const node = el(tag, className);
  node.appendChild(window.RichText.render(text, { block }));
  return node;
}

// A pixel lock in front of a line of text, for the "🔒 do this to unlock" notes.
function setLockLine(node, text) {
  node.textContent = '';
  const img = el('img', 'pixel-lock');
  img.src = '/media/badges/lock.png'; img.alt = '';
  node.appendChild(img);
  node.appendChild(document.createTextNode(text));
}

// badge is a file name in /media/badges, without the .png.
function card(badge, heading, text, button) {
  applyTheme(null);
  root.innerHTML = '';
  const c = el('div', 'case-locked');
  const icon = el('div', 'case-locked-icon');
  window.Awards.fillIcon(icon, `/media/badges/${badge}.png`);
  c.appendChild(icon);
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
  if (p.bio) {
    const bio = richEl('div', 'profile-bio', p.bio, true);
    if (isPrivate(p, 'bio')) {
      // After the last paragraph, not after a list.
      const last = bio.lastElementChild;
      withPrivateTag(last && last.tagName === 'P' ? last : bio, p, 'bio');
    }
    info.appendChild(bio);
  }
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
  } else if (!q.type || q.type === 'text' || q.type === 'long') {
    wrap.appendChild(window.RichText.render(value, { block: q.type === 'long' }));
    return wrap;
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
  const icon = el('div', 'award-icon');
  window.Awards.fillIcon(icon, a.icon);
  row.appendChild(icon);
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
      row.appendChild(recordIcon(def));
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

// ── Emmet's notes ───────────────────────────────────────────────────────
// Two notes only admins can write (profile_notes, public_profiles.sql): a
// public one every visitor sees, and a private one only this person sees.

const NOTE_MAX = 1000;

function noteBlock(heading, text, tag) {
  const section = el('section', 'case-section profile-emmet-note');
  const title = el('h2', 'case-section-title', heading);
  if (tag) { title.appendChild(document.createTextNode(' ')); title.appendChild(el('span', 'profile-private', tag)); }
  section.appendChild(title);
  section.appendChild(richEl('div', 'profile-emmet-note-text', text, true));
  section.appendChild(el('p', 'profile-emmet-note-sig', '— Emmet'));
  return section;
}

function renderNotesEditor(p, wrap) {
  wrap.innerHTML = '';
  const form = el('section', 'case-section profile-emmet-editor');
  form.appendChild(el('h2', 'case-section-title', 'Your notes on ' + p.username));
  const pubInp = el('textarea', 'authw-input profile-textarea');
  pubInp.value = p.emmet_note || ''; pubInp.maxLength = NOTE_MAX; pubInp.rows = 4;
  pubInp.placeholder = 'everyone who visits sees this';
  form.appendChild(field('public note', pubInp, charCounter(pubInp, NOTE_MAX), null,
    window.RichText.toolbar(pubInp, { block: true })));
  const privInp = el('textarea', 'authw-input profile-textarea');
  privInp.value = p.emmet_private_note || ''; privInp.maxLength = NOTE_MAX; privInp.rows = 4;
  privInp.placeholder = p.is_me ? 'only you see this' : 'only ' + p.username + ' sees this';
  form.appendChild(field('private note', privInp, charCounter(privInp, NOTE_MAX), null,
    window.RichText.toolbar(privInp, { block: true })));

  const msg = el('div', 'authw-msg'); msg.style.display = 'none';
  form.appendChild(msg);
  const btns = el('div', 'authw-btns profile-btns');
  const saveBtn = el('button', 'authw-btn authw-btn-primary', 'save notes');
  const cancelBtn = el('button', 'authw-btn', 'never mind');
  cancelBtn.addEventListener('click', () => renderNotes(p, wrap));
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const saved = await window.Auth.setProfileNotes(p.username, pubInp.value.trim(), privInp.value.trim());
      if (!saved.ok) {
        msg.textContent = saved.reason === 'forbidden' ? "only Emmet can write these"
          : saved.reason === 'too_long' ? 'that note runs long — trim it a bit'
          : "couldn't save that — try again in a bit";
        msg.style.display = 'block';
        return;
      }
      await load();
    } finally {
      saveBtn.disabled = false;
    }
  });
  btns.appendChild(saveBtn); btns.appendChild(cancelBtn);
  form.appendChild(btns);
  wrap.appendChild(form);
  setTimeout(() => pubInp.focus(), 50);
}

// Fills `wrap` (created when not given) with the notes, plus the edit
// button for admins. Null when there's nothing to show.
function renderNotes(p, wrap) {
  const pub = p.emmet_note, priv = p.emmet_private_note;
  if (!pub && !priv && !p.can_note) return null;
  wrap = wrap || el('div', 'profile-emmet-notes');
  wrap.innerHTML = '';
  if (pub) wrap.appendChild(noteBlock('A word from Emmet', pub));
  if (priv) wrap.appendChild(noteBlock('Just between us', priv, p.is_me ? 'only you can see this' : 'only ' + p.username + ' can see this'));
  if (p.can_note) {
    const btn = el('button', 'case-btn profile-emmet-edit-btn', pub || priv ? 'edit your notes' : 'write a note');
    btn.addEventListener('click', () => renderNotesEditor(p, wrap));
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderView(p) {
  root.innerHTML = '';
  root.appendChild(renderHeader(p));
  [renderNotes(p), renderArt(p), renderSound(p), renderTrivia(p), renderAwards(p), renderRecords(p)].forEach(s => { if (s) root.appendChild(s); });
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
// `tools` (optional) sits between the label and the input: the formatting buttons.
function field(labelText, input, note, toggle, tools) {
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
  if (tools) wrap.appendChild(tools);
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

// The control for one question, by type: { el, get(), note?, tools? }.
function inputFor(q, value, onChange) {
  const type = q.type || 'text';
  if (type === 'color') return window.ColorWheel.create(value, onChange);
  if (type === 'long') {
    const inp = el('textarea', 'authw-input profile-textarea');
    inp.value = value; inp.maxLength = q.max || ANSWER_MAX; inp.rows = 3;
    return { el: inp, get: () => inp.value.trim(), note: charCounter(inp, inp.maxLength),
             tools: window.RichText.toolbar(inp, { block: true }) };
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
    return { el: inp, get: () => inp.value.trim(), tools: window.RichText.toolbar(inp) };
  }
  return { el: inp, get: () => inp.value.trim() };
}

// A grid of samples to pick a typeface from, locked until `unlockKey` is
// earned. lockText(status) is the line shown while it's locked.
// Returns { el, get(), setSample(text) }.
function fontPicker({ fonts, defaultKey, startKey, unlockKey, lockText, onPick }) {
  let picked = startKey;
  const wrap = el('div', 'profile-fonts is-locked');
  const lock = el('p', 'profile-font-lock', 'checking whether you’ve unlocked these…');
  wrap.appendChild(lock);
  const grid = el('div', 'profile-font-grid');
  const btns = {};
  Object.entries(fonts).forEach(([key, f]) => {
    NameFonts.load(key);
    const b = el('button', 'profile-font-opt');
    b.type = 'button';
    b.disabled = true;
    b.setAttribute('aria-pressed', String(key === picked));
    const sample = el('span', 'profile-font-sample');
    sample.style.fontFamily = f.family;
    if (f.weight) sample.style.fontWeight = f.weight;
    sample.style.fontStyle = f.italic ? 'italic' : 'normal';
    if (f.scale) sample.style.setProperty('--sample-scale', String(f.scale));
    b.appendChild(sample);
    b.appendChild(el('span', 'profile-font-label', f.label + (key === defaultKey ? ' (default)' : '')));
    b.addEventListener('click', () => {
      picked = key;
      Object.entries(btns).forEach(([k, btn]) => btn.setAttribute('aria-pressed', String(k === key)));
      onPick(key);
    });
    btns[key] = b;
    grid.appendChild(b);
  });
  wrap.appendChild(grid);
  (window.Unlocks ? window.Unlocks.status([unlockKey]) : Promise.resolve({})).then(all => {
    const st = all[unlockKey];
    if (st && st.unlocked) {
      wrap.classList.remove('is-locked');
      lock.remove();
      Object.values(btns).forEach(b => { b.disabled = false; });
      return;
    }
    setLockLine(lock, lockText(st));
  }).catch(() => {});
  return {
    el: wrap,
    get: () => picked,
    setSample: text => grid.querySelectorAll('.profile-font-sample').forEach(s => { s.textContent = text; }),
  };
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
  // Draw one in the pixel editor. Reopens your last drawing (or the one in
  // progress this visit) so it can be touched up.
  let newPixelSource = null;   // the drawing's one-pixel-per-cell original
  let lastDrawing = null;      // <img> of the most recent drawing, fed back in
  const drawBtn = el('button', 'authw-btn', 'draw one');
  drawBtn.type = 'button';
  drawBtn.hidden = !window.PixelEditor;
  // Locked until three filled-in fields are public (perk:pixel_icon).
  drawBtn.disabled = true;
  const drawLock = el('p', 'profile-font-lock', '');
  drawLock.hidden = true;
  if (window.PixelEditor) {
    (window.Unlocks ? window.Unlocks.status([PIXEL_ICON_UNLOCK]) : Promise.resolve({})).then(all => {
      const st = all[PIXEL_ICON_UNLOCK];
      if (st && st.unlocked) { drawBtn.disabled = false; return; }
      const target = (st && st.target) || 3;
      const done = Math.min((st && st.value) || 0, target);
      setLockLine(drawBtn, 'draw one');
      setLockLine(drawLock, `Make ${target} fields public to draw your own pixel icon — ${done} / ${target} so far. ` +
        'Only filled-in fields count, and they count once you save.');
      drawLock.hidden = false;
    }).catch(() => {});
  }
  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  drawBtn.addEventListener('click', async () => {
    drawBtn.disabled = true;
    try {
      if (!lastDrawing && session) {
        const url = window.Auth.pixelSourceUrl(session.user.id, Date.now());
        if (url) lastDrawing = await loadImage(url);
      }
      const result = await window.PixelEditor.open({ initial: lastDrawing });
      if (!result) return;
      newAvatar = result.png;
      newPixelSource = result.source;
      removeAvatar = false;
      lastDrawing = await loadImage(URL.createObjectURL(result.source));
      setPreview(URL.createObjectURL(result.png));
      clearBtn.hidden = false;
    } finally {
      drawBtn.disabled = false;
    }
  });
  // A photo replaces any drawing waiting to be saved.
  fileInp.addEventListener('change', () => { newPixelSource = null; });

  avatarRow.appendChild(pickBtn); avatarRow.appendChild(drawBtn); avatarRow.appendChild(clearBtn); avatarRow.appendChild(fileInp);
  form.appendChild(field('picture', avatarRow, drawLock));

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
  form.appendChild(field('bio', bioInp, charCounter(bioInp, BIO_MAX), privacyToggle('bio', publicSet),
    window.RichText.toolbar(bioInp, { block: true })));

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
    const artIcon = el('span', 'profile-art-drop-icon');
    window.Awards.fillIcon(artIcon, '/media/badges/frame.png');
    artDrop.appendChild(artIcon);
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
  const namePicker = fontPicker({
    fonts: NAME_FONTS, defaultKey: NAME_FONT_DEFAULT, startKey: startFont, unlockKey: NAME_FONT_UNLOCK,
    onPick: applyNameFont,
    lockText: st => {
      const target = (st && st.target) || 10;
      const played = Math.min((st && st.value) || 0, target);
      return `Play ${target} games to pick your own — ${played} / ${target} so far. ` +
        'Wordle, Absolute 25, Hexdoku levels, the River Crossing and up to three Coin Riddle solves all count.';
    },
  });
  const syncSamples = () => namePicker.setSample(nameInp.value.trim() || p.username);
  nameInp.addEventListener('input', syncSamples);
  syncSamples();
  form.appendChild(field('name font', namePicker.el));

  // Text font: for the bio and answers. Its award is hidden, so the lock
  // doesn't say what it takes.
  const startTextFont = textFontKey(p.text_font);
  const textPicker = fontPicker({
    fonts: TEXT_FONTS, defaultKey: TEXT_FONT_DEFAULT, startKey: startTextFont, unlockKey: TEXT_FONT_UNLOCK,
    onPick: applyTextFont,
    lockText: () => 'A secret award opens this one up. Keep exploring the Enquirer.',
  });
  textPicker.setSample('the quick brown fox');
  form.appendChild(field('text font', textPicker.el));

  // Questions
  const answers = Object.assign({}, p.answers || {});
  const answerInps = {};
  // Picking a favorite color previews the theme straight away.
  const previewTheme = () => applyTheme(THEME_COLORS.map(id =>
    answerInps[id] ? answerInps[id].control.get() : answers[id]));
  (window.PROFILE_QUESTIONS || []).forEach(q => {
    const control = inputFor(q, answers[q.id] || '', previewTheme);
    answerInps[q.id] = { q, control };
    form.appendChild(field(q.q, control.el, control.note, q.private ? null : privacyToggle(q.id, publicSet), control.tools));
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
        // '' puts the font back on the default.
        nameFont: namePicker.get() !== startFont ? (namePicker.get() === NAME_FONT_DEFAULT ? '' : namePicker.get()) : null,
        textFont: textPicker.get() !== startTextFont ? (textPicker.get() === TEXT_FONT_DEFAULT ? '' : textPicker.get()) : null,
      });
      if (!saved.ok) {
        showMsg(saved.reason === 'bio_too_long' ? 'that bio runs long — trim it a bit'
              : saved.reason === 'art_title_too_long' ? 'that art heading runs long — trim it a bit'
              : saved.reason === 'sound_title_too_long' ? 'that sound heading runs long — trim it a bit'
              : saved.reason === 'locked' ? "that font isn't unlocked yet"
              : "couldn't save that — try again in a bit");
        return;
      }
      if (newAvatar) {
        const up = await window.Auth.uploadAvatar(newAvatar);
        if (!up.ok) { showMsg("everything saved but the picture — try it again"); return; }
        // Best effort: the icon itself is already saved.
        if (newPixelSource) await window.Auth.uploadPixelSource(newPixelSource);
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
      // Public fields feed perk:pixel_icon; re-check so its toast shows now.
      if (window.Unlocks) window.Unlocks.refresh();
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
  applyTextFont(profile.text_font);
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
      card('nametag', 'no name on the door', "Pick a name and you'll get a page of your own that anyone can drop by.",
        { label: 'pick a name', onClick: () => window.AuthWidget && window.AuthWidget.showUsernameModal() });
    } else {
      card('lock', 'members only', "Knock on the door to get a page of your own — awards, records and all.",
        { label: 'knock on the door', onClick: () => window.AuthWidget && window.AuthWidget.showAuthModal('login') });
    }
    return;
  }

  const { data, error } = await window.Auth.getPublicProfile(wanted);
  if (error) { setOwnPage(false); card('mailbox', 'directory closed', "the directory is closed for lunch — try again in a bit"); return; }
  if (!data) {
    profile = null;
    setOwnPage(false);
    card('door', 'nobody home', `Nobody by the name “${wanted}” lives here. Maybe they changed it?`);
    return;
  }
  profile = data;
  setOwnPage(!!data.is_me);
  document.title = `${data.username} | The Emmet Enquirer`;
  // The name in the URL may differ in case from the real one.
  if (data.username !== wanted) history.replaceState(null, '', window.Auth.profileUrl(data.username));
  render();
  countVisit(data).catch(() => {});
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
