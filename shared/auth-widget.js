// Site-wide "knock on the door" login widget. Injects a fixed top-right
// link into the page and a matching sign-in/sign-up modal. Depends on
// window.Auth (shared/auth.js) already being loaded, plus window.SUPABASE_URL
// / window.SUPABASE_ANON_KEY / the supabase-js UMD bundle being set up by the
// including page.
window.AuthWidget = (function () {
  let linkEl = null;

  async function renderLink() {
    if (!linkEl || !window.Auth) return;
    const session = await window.Auth.getSession();
    if (session) {
      linkEl.textContent = session.user.email + ' · slip out the back';
      linkEl.onclick = () => window.Auth.signOut();
    } else {
      linkEl.textContent = 'knock on the door';
      linkEl.onclick = () => showAuthModal('login');
    }
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
    const heading = document.createElement('div'); heading.className = 'authw-heading';
    const emailInp = document.createElement('input');
    emailInp.className = 'authw-input'; emailInp.type = 'email'; emailInp.placeholder = 'whatsit.tooya@yahoo.com';
    emailInp.autocomplete = 'email'; emailInp.spellcheck = false;
    const passInp = document.createElement('input');
    passInp.className = 'authw-input'; passInp.type = 'password'; passInp.placeholder = 'secret knock';
    passInp.spellcheck = false;
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
      msg.style.display = 'none';
    }
    render();

    function showMsg(text) { msg.textContent = text; msg.style.display = 'block'; }

    async function doSubmit() {
      const email = emailInp.value.trim();
      const password = passInp.value;
      if (!email || !password) { showMsg("you'll need an email and a secret knock to get in"); return; }
      submitBtn.disabled = true;
      const { error } = mode === 'login'
        ? await window.Auth.signIn(email, password)
        : await window.Auth.signUp(email, password);
      submitBtn.disabled = false;
      if (error) { showMsg(error.message); return; }
      if (mode === 'signup') { showMsg("check your email — we slipped a note under the door to confirm it's you"); return; }
      overlay.remove();
      await renderLink();
    }

    submitBtn.addEventListener('click', doSubmit);
    passInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
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
    card.appendChild(msg); card.appendChild(btnRow);
    card.appendChild(forgotLink); card.appendChild(toggleLink);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => emailInp.focus(), 50);
  }

  function init() {
    if (linkEl || !window.Auth) return;
    const row = document.createElement('div');
    row.className = 'authw-row';
    linkEl = document.createElement('div');
    linkEl.className = 'authw-link';
    linkEl.id = 'site-auth-link';
    row.appendChild(linkEl);
    // Pages that already have something at the top of the page (e.g. a
    // dateline) can add an empty <div id="authw-mount"></div> wherever the
    // button should land instead of it defaulting to the very top of <body>.
    const mount = document.getElementById('authw-mount');
    if (mount) mount.appendChild(row);
    else document.body.insertBefore(row, document.body.firstChild);
    renderLink();
    window.Auth.onAuthStateChange(() => renderLink());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { renderLink, showAuthModal };
})();
