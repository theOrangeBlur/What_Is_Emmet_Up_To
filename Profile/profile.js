// Public profile page: /Profile/profile.html?u=<username>. Anyone can view
// one via the get_public_profile RPC (supabase/public_profiles.sql); the
// owner also gets an edit form for their name, bio, avatar and trivia answers.
// With no ?u, signed-in visitors are sent to their own profile.

const root = document.getElementById('profile-root');
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const USERNAME_RULES = '3–16 letters, numbers or underscores';
const BIO_MAX = 140;
const ANSWER_MAX = 140;
const AVATAR_SIZE = 256;

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

function requestedName() {
  return (new URLSearchParams(window.location.search).get('u') || '').trim();
}

function card(icon, heading, text, button) {
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
  if (p.bio) info.appendChild(el('p', 'profile-bio', p.bio));
  if (p.member_since) info.appendChild(el('div', 'profile-since', 'resident since ' + formatDate(p.member_since)));
  if (p.is_me) {
    const btn = el('button', 'case-btn profile-edit-btn', 'edit profile');
    btn.addEventListener('click', () => { editing = true; render(); });
    info.appendChild(btn);
  }
  head.appendChild(info);
  return head;
}

function renderTrivia(p) {
  const answers = p.answers || {};
  const answered = (window.PROFILE_QUESTIONS || []).filter(q => answers[q.id]);
  if (!answered.length) {
    if (!p.is_me) return null;
    const section = el('section', 'case-section');
    section.appendChild(el('h2', 'case-section-title', 'Getting to know you'));
    section.appendChild(el('p', 'profile-empty', "nothing here yet — hit “edit profile” and answer a question or two"));
    return section;
  }
  const section = el('section', 'case-section');
  section.appendChild(el('h2', 'case-section-title', 'Getting to know ' + p.username));
  answered.forEach(q => {
    const row = el('div', 'profile-qa');
    row.appendChild(el('div', 'profile-q', q.q));
    row.appendChild(el('div', 'profile-a', answers[q.id]));
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

function field(labelText, input, note) {
  // Only wrap real inputs in a <label>: a label around buttons clicks them.
  const isInput = input.matches('input, textarea');
  const wrap = el(isInput ? 'label' : 'div', 'profile-field');
  wrap.appendChild(el('span', 'record-label', labelText));
  wrap.appendChild(input);
  if (note) wrap.appendChild(note);
  return wrap;
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

  // Bio
  const bioInp = el('textarea', 'authw-input profile-textarea');
  bioInp.value = p.bio || ''; bioInp.maxLength = BIO_MAX; bioInp.rows = 3;
  bioInp.placeholder = 'a line about yourself';
  const bioCount = el('span', 'profile-note');
  const updateCount = () => { bioCount.textContent = `${bioInp.value.length} / ${BIO_MAX}`; };
  bioInp.addEventListener('input', updateCount); updateCount();
  form.appendChild(field('bio', bioInp, bioCount));

  // Trivia
  const answers = Object.assign({}, p.answers || {});
  const answerInps = {};
  (window.PROFILE_QUESTIONS || []).forEach(q => {
    const inp = el('input', 'authw-input');
    inp.value = answers[q.id] || ''; inp.maxLength = ANSWER_MAX;
    answerInps[q.id] = inp;
    form.appendChild(field(q.q, inp));
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
      // Keep answers to questions that have since been removed from the list.
      Object.keys(answerInps).forEach(id => { answers[id] = answerInps[id].value.trim(); });
      const saved = await window.Auth.updateProfile({ bio: bioInp.value.trim(), answers });
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
