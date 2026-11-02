// Site-wide "knock on the door" login widget. Injects a fixed top-right
// link into the page and a matching sign-in/sign-up modal. Depends on
// window.Auth (shared/auth.js) already being loaded, plus window.SUPABASE_URL
// / window.SUPABASE_ANON_KEY / the supabase-js UMD bundle being set up by the
// including page.
window.AuthWidget = (function () {
  let linkEl = null;
  let awardsEl = null;
  const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const USERNAME_RULES = '3–16 letters, numbers or underscores';

  // Set by the profile page while you're looking at your own profile: the
  // box there becomes the way out instead of a link back to the same page.
  let onOwnProfile = false;
  function setOnOwnProfile(value) {
    if (onOwnProfile === !!value) return;
    onOwnProfile = !!value;
    renderLink();
  }

  const onAwardsPage = /\/Awards\/awards(\.html)?$/i.test(window.location.pathname);

  function setAction(text, onClick) {
    linkEl.className = 'authw-link';
    linkEl.removeAttribute('href');
    linkEl.setAttribute('role', 'button');
    linkEl.tabIndex = 0;
    linkEl.textContent = text;
    linkEl.onclick = onClick;
    linkEl.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } };
  }

  async function renderLink() {
    if (!linkEl || !window.Auth) return;
    const session = await window.Auth.getSession();
    linkEl.removeAttribute('title');
    if (!session) {
      setAction('knock on the door', () => showAuthModal('login'));
    } else if (onOwnProfile) {
      setAction('wait, is this not you...?', () => window.Auth.signOut());
      linkEl.title = 'slip out the back';
    } else {
      // Signed in: the box is your picture (or initial), linking to your profile.
      const me = await window.Auth.getMyProfile();
      linkEl.className = 'authw-link authw-avatar';
      linkEl.removeAttribute('role');
      linkEl.removeAttribute('tabindex');
      linkEl.onclick = null; linkEl.onkeydown = null;
      linkEl.href = me ? window.Auth.profileUrl(me.username) : '/Profile/profile.html';
      linkEl.title = me ? me.username : 'pick a name';
      linkEl.textContent = '';
      const url = me && window.Auth.avatarUrl(me.avatar_path, me.updated_at);
      if (url) {
        const img = document.createElement('img');
        img.src = url; img.alt = me.username;
        linkEl.appendChild(img);
      } else {
        linkEl.textContent = ((me && me.username) || session.user.email || '?').charAt(0).toUpperCase();
      }
    }
    if (awardsEl) awardsEl.style.display = session && !onAwardsPage ? '' : 'none';
  }

  // A person's name, linked to their profile when they have one. Every page
  // that shows someone's name should build it with this.
  function profileLink(username, text) {
    const label = text != null && text !== '' ? text : username;
    if (!username || !window.Auth) return document.createTextNode(label == null ? '' : String(label));
    const a = document.createElement('a');
    a.className = 'name-link';
    a.href = window.Auth.profileUrl(username);
    a.textContent = label;
    if (label !== username) a.title = username;
    return a;
  }

  function showAuthModal(initialMode) {
    let mode = initialMode || 'login';
    const overlay = document.createElement('div'); overlay.className = 'authw-overlay';
    const card = document.createElement('div'); card.className = 'authw-card';
    const peephole = document.createElement('div'); peephole.className = 'authw-peephole-wrap';
    peephole.innerHTML = `<svg viewBox="0 0 84 56" width="84" height="56" role="img" aria-label="a wary eye peers through the door slit">
      <defs>
        <clipPath id="authw-peephole-eye-clip">
          <path d="M16,28 C16,18.5 28,12 42,12 C56,12 68,18.5 68,28 C68,37.5 56,44 42,44 C28,44 16,37.5 16,28 Z"/>
        </clipPath>
      </defs>
      <rect x="2" y="4" width="80" height="48" rx="6" fill="#1c1c1c" stroke="#3d3d3d" stroke-width="1.5"/>
      <path d="M16,28 C16,18.5 28,12 42,12 C56,12 68,18.5 68,28 C68,37.5 56,44 42,44 C28,44 16,37.5 16,28 Z" fill="#0f0f0f" stroke="#7a7670" stroke-width="1.25"/>
      <g clip-path="url(#authw-peephole-eye-clip)">
        <g class="authw-peephole-iris">
          <circle cx="42" cy="28" r="10" fill="#6aaf63"/>
          <circle cx="42" cy="28" r="4.5" fill="#0f0f0f"/>
          <circle cx="39.5" cy="25" r="1.4" fill="#e5e0d8"/>
        </g>
      </g>
      <rect x="6" y="4" width="4" height="48" fill="#3d3d3d"/>
      <rect x="20" y="4" width="4" height="48" fill="#3d3d3d"/>
      <rect x="60" y="4" width="4" height="48" fill="#3d3d3d"/>
      <rect x="74" y="4" width="4" height="48" fill="#3d3d3d"/>
    </svg>`;
    peephole.addEventListener('click', () => {
      peephole.classList.remove('authw-poked'); void peephole.offsetWidth; peephole.classList.add('authw-poked');
      if (window.Awards) window.Awards.unlock('h_k9');
    });
    const heading = document.createElement('div'); heading.className = 'authw-heading';
    const emailInp = document.createElement('input');
    emailInp.className = 'authw-input'; emailInp.type = 'email'; emailInp.placeholder = 'whatsit.tooya@yahoo.com';
    emailInp.autocomplete = 'email'; emailInp.spellcheck = false;
    const passInp = document.createElement('input');
    passInp.className = 'authw-input'; passInp.type = 'password'; passInp.placeholder = 'secret knock';
    passInp.spellcheck = false;
    const nameInp = document.createElement('input');
    nameInp.className = 'authw-input'; nameInp.placeholder = 'what do we call you?';
    nameInp.maxLength = 16; nameInp.autocomplete = 'username'; nameInp.spellcheck = false;
    const msg = document.createElement('div'); msg.className = 'authw-msg'; msg.style.display = 'none';
    const btnRow = document.createElement('div'); btnRow.className = 'authw-btns';
    const submitBtn = document.createElement('button'); submitBtn.className = 'authw-btn authw-btn-primary';
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'authw-btn'; cancelBtn.textContent = "i'll pass";
    const forgotLink = document.createElement('div'); forgotLink.className = 'authw-link-row'; forgotLink.textContent = 'i misplaced my info!';
    const toggleLink = document.createElement('div'); toggleLink.className = 'authw-link-row';

    function render() {
      heading.textContent = mode === 'login' ? 'who are you?' : 'state your business';
      submitBtn.textContent = mode === 'login' ? "let's boogy" : "i'm new here";
      passInp.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      toggleLink.textContent = mode === 'login' ? 'how do i join?' : 'already in? let me back';
      nameInp.style.display = mode === 'signup' ? '' : 'none';
      msg.style.display = 'none';
    }
    render();

    function showMsg(text) { msg.textContent = text; msg.style.display = 'block'; }

    async function doSubmit() {
      const email = emailInp.value.trim();
      const password = passInp.value;
      if (!email || !password) { showMsg("you'll need an email and a secret knock to get in"); return; }
      const username = nameInp.value.trim();
      if (mode === 'signup' && !USERNAME_RE.test(username)) { showMsg('your name needs to be ' + USERNAME_RULES); return; }
      submitBtn.disabled = true;
      if (mode === 'signup' && await window.Auth.usernameAvailable(username) === false) {
        submitBtn.disabled = false;
        showMsg('someone already goes by that — try another name');
        return;
      }
      const { error } = mode === 'login'
        ? await window.Auth.signIn(email, password)
        : await window.Auth.signUp(email, password, username);
      submitBtn.disabled = false;
      if (error) { showMsg(error.message); return; }
      if (mode === 'signup') { showMsg("check your email — we slipped a note under the door to confirm it's you"); return; }
      overlay.remove();
      await renderLink();
    }

    submitBtn.addEventListener('click', doSubmit);
    passInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    cancelBtn.addEventListener('click', () => overlay.remove());
    toggleLink.addEventListener('click', () => { mode = mode === 'login' ? 'signup' : 'login'; render(); });
    forgotLink.addEventListener('click', async () => {
      const email = emailInp.value.trim();
      if (!email) { showMsg('the doorman needs your email first'); return; }
      const { error } = await window.Auth.resetPasswordForEmail(email);
      showMsg(error ? error.message : 'new key slipped under the door — check your email');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    btnRow.appendChild(submitBtn); btnRow.appendChild(cancelBtn);
    card.appendChild(peephole); card.appendChild(heading); card.appendChild(emailInp); card.appendChild(passInp);
    card.appendChild(nameInp); card.appendChild(msg); card.appendChild(btnRow);
    card.appendChild(forgotLink); card.appendChild(toggleLink);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => emailInp.focus(), 50);
  }

  // Pick or change a username. Also shown once per browser session to
  // signed-in accounts that don't have one yet.
  function showUsernameModal() {
    if (document.querySelector('.authw-name-overlay')) return;
    const overlay = document.createElement('div'); overlay.className = 'authw-overlay authw-name-overlay';
    const card = document.createElement('div'); card.className = 'authw-card';
    const heading = document.createElement('div'); heading.className = 'authw-heading'; heading.textContent = 'what do we call you?';
    const hint = document.createElement('div'); hint.className = 'authw-msg';
    hint.textContent = USERNAME_RULES + '. Be unique.';
    const nameInp = document.createElement('input');
    nameInp.className = 'authw-input'; nameInp.placeholder = 'a name for the records';
    nameInp.maxLength = 16; nameInp.autocomplete = 'username'; nameInp.spellcheck = false;
    const msg = document.createElement('div'); msg.className = 'authw-msg'; msg.style.display = 'none';
    const btnRow = document.createElement('div'); btnRow.className = 'authw-btns';
    const saveBtn = document.createElement('button'); saveBtn.className = 'authw-btn authw-btn-primary'; saveBtn.textContent = "that's me";
    const laterBtn = document.createElement('button'); laterBtn.className = 'authw-btn'; laterBtn.textContent = 'later';

    window.Auth.getUsername().then(name => { if (name && !nameInp.value) nameInp.value = name; });

    function close() {
      try { sessionStorage.setItem('username_prompt_skipped', '1'); } catch {}
      overlay.remove();
    }
    function showMsg(text) { msg.textContent = text; msg.style.display = 'block'; }

    async function save() {
      const name = nameInp.value.trim();
      if (!USERNAME_RE.test(name)) { showMsg('it needs to be ' + USERNAME_RULES); return; }
      saveBtn.disabled = true;
      const result = await window.Auth.setUsername(name);
      saveBtn.disabled = false;
      if (!result.ok) {
        showMsg(result.reason === 'taken' ? 'someone already goes by that — try another name'
              : result.reason === 'invalid' ? 'it needs to be ' + USERNAME_RULES
              : 'the doorman lost his pen — try again in a bit');
        return;
      }
      overlay.remove();
      await renderLink();
      document.dispatchEvent(new CustomEvent('username:changed', { detail: result.username }));
    }

    saveBtn.addEventListener('click', save);
    nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    laterBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    btnRow.appendChild(saveBtn); btnRow.appendChild(laterBtn);
    card.appendChild(heading); card.appendChild(hint); card.appendChild(nameInp);
    card.appendChild(msg); card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => nameInp.focus(), 50);
  }

  // After sign-in: claim the name picked at sign-up, or ask for one.
  let checkedUid = null;
  async function ensureUsername(session) {
    if (!session || checkedUid === session.user.id) return;
    checkedUid = session.user.id;
    if (await window.Auth.getUsername()) return;
    const picked = session.user.user_metadata && session.user.user_metadata.username;
    if (picked && (await window.Auth.setUsername(picked)).ok) {
      await renderLink();
      document.dispatchEvent(new CustomEvent('username:changed', { detail: picked }));
      return;
    }
    let skipped = false;
    try { skipped = sessionStorage.getItem('username_prompt_skipped') === '1'; } catch {}
    if (!skipped) showUsernameModal();
  }

  function init() {
    if (linkEl || !window.Auth) return;
    const row = document.createElement('div');
    row.className = 'authw-row';
    linkEl = document.createElement('a');
    linkEl.className = 'authw-link';
    linkEl.id = 'site-auth-link';
    awardsEl = document.createElement('a');
    awardsEl.className = 'authw-link authw-awards-link';
    awardsEl.href = '/Awards/awards.html';
    awardsEl.textContent = '🏆 awards';
    awardsEl.style.display = 'none';
    row.appendChild(awardsEl);
    row.appendChild(linkEl);
    // Pages that already have something at the top of the page (e.g. a
    // dateline) can add an empty <div id="authw-mount"></div> wherever the
    // button should land instead of it defaulting to the very top of <body>.
    const mount = document.getElementById('authw-mount');
    if (mount) mount.appendChild(row);
    else document.body.insertBefore(row, document.body.firstChild);
    renderLink();
    window.Auth.getSession().then(ensureUsername);
    window.Auth.onAuthStateChange(session => {
      if (!session) checkedUid = null;
      renderLink();
      ensureUsername(session);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { renderLink, showAuthModal, showUsernameModal, profileLink, setOnOwnProfile };
})();
