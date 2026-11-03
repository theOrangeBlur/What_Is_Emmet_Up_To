// Comment threads (supabase/comments.sql). A thread is a (page, item) pair:
// page is one of the comment unlocks' names (movies, projects, wordle_daily,
// ...) and item is whatever that page threads on.
//
// Static markup mounts itself when it scrolls near view:
//   <div data-comments="hexdoku" data-comments-item="page"></div>
// Pages whose items come and go mount from script instead:
//   Comments.mount(container, 'movies', card.id)
// Mounting the same container again with a new item swaps the thread.
//
// Comments nest one level, Slack-style: replies hide behind an "N replies"
// link under their comment and open in place, with their own composer.
//
// Signed out, a thread is a knock-on-the-door prompt. Signed in, anyone can
// read; posting takes the page's perk:comment_<page> unlock, and until then
// the composer is a lock that doesn't let on how to open it.
// Depends on window.Auth, window.Unlocks and (for buttons and names)
// window.AuthWidget.
window.Comments = (function () {
  const MAX_LEN = 2000;
  const mounted = new Set();   // containers with a live thread

  const REASONS = {
    locked: "you haven't unlocked comments here yet",
    no_username: 'pick a username first',
    too_fast: 'easy there — give it a few seconds',
    too_many: "that's plenty for today",
    empty: 'say something first',
    unknown_page: "comments aren't open here",
    no_parent: 'that comment is gone'
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function unlockKey(page) { return 'perk:comment_' + page; }

  async function getSession() {
    if (!window.Auth) return null;
    try { return await window.Auth.getSession(); } catch { return null; }
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function renderSignedOut(section) {
    const lock = el('div', 'cmt-lock');
    lock.appendChild(el('p', 'cmt-lock-text', '🔒 The comments are behind the door.'));
    const btn = el('button', 'cmt-btn', 'knock on the door');
    btn.type = 'button';
    btn.addEventListener('click', () => window.AuthWidget && window.AuthWidget.showAuthModal('login'));
    lock.appendChild(btn);
    section.appendChild(lock);
  }

  function formatDay(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderComment(c, onDelete, onReply) {
    const li = el('li', 'cmt-item' + (c.mine ? ' cmt-mine' : ''));
    if (c.deleted) {
      li.classList.add('cmt-deleted');
      li.appendChild(el('div', 'cmt-body', 'this comment was deleted'));
      return li;
    }
    const head = el('div', 'cmt-head');
    const url = c.avatar_path && window.Auth.avatarUrl && window.Auth.avatarUrl(c.avatar_path, c.profile_updated_at);
    if (url) {
      const img = el('img', 'cmt-avatar');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      head.appendChild(img);
    } else {
      head.appendChild(el('span', 'cmt-avatar cmt-avatar-blank', (c.username || '?')[0].toUpperCase()));
    }
    const name = el('span', 'cmt-name');
    name.appendChild(window.AuthWidget
      ? window.AuthWidget.profileLink(c.username, c.username || 'A MYSTERY GUEST')
      : document.createTextNode(c.username || 'A MYSTERY GUEST'));
    head.appendChild(name);
    head.appendChild(el('time', 'cmt-when', formatWhen(c.created_at)));
    const actions = el('span', 'cmt-actions');
    if (onReply) {
      const reply = el('button', 'cmt-link', 'reply');
      reply.type = 'button';
      reply.addEventListener('click', onReply);
      actions.appendChild(reply);
    }
    if (c.can_delete) {
      const del = el('button', 'cmt-link', c.mine ? 'delete' : 'remove');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(c.mine ? 'Delete your comment?' : 'Remove this comment?')) return;
        del.disabled = true;
        const { data } = await window.Auth.rpc('delete_comment', { p_id: c.id });
        if (data) onDelete(); else del.disabled = false;
      });
      actions.appendChild(del);
    }
    if (actions.firstChild) head.appendChild(actions);
    li.appendChild(head);
    li.appendChild(el('div', 'cmt-body', c.body));
    return li;
  }

  // Just the sparkle by the heading, the same mark the trophy case uses for
  // awards that unlock something. How to open a thread up is for visitors to
  // discover. Focusable, so a tap shows the tooltip on touch screens too.
  function renderLock(section) {
    const text = 'that feature is locked, but Emmet wants you to find its key!';
    const mark = el('span', 'cmt-sparkle', '✦');
    mark.tabIndex = 0;
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', text);
    mark.dataset.tip = text;
    section.firstChild.appendChild(mark);
  }

  // The page's composer, or with parentId, a thread's reply box.
  function renderComposer(parentEl, page, item, onPosted, parentId) {
    const form = el('form', 'cmt-form' + (parentId ? ' cmt-form-reply' : ''));
    const box = el('textarea', 'cmt-input');
    box.maxLength = MAX_LEN;
    box.rows = parentId ? 2 : 3;
    box.placeholder = parentId ? 'reply in thread' : 'say your piece';
    const row = el('div', 'cmt-form-row');
    const msg = el('span', 'cmt-msg');
    const btn = el('button', 'cmt-btn', parentId ? 'reply' : 'post');
    btn.type = 'submit';
    row.appendChild(msg); row.appendChild(btn);
    form.appendChild(box); form.appendChild(row);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = box.value.trim();
      if (!body) { msg.textContent = REASONS.empty; return; }
      btn.disabled = true; msg.textContent = '';
      const args = { p_page: page, p_item: item, p_body: body };
      if (parentId) args.p_parent = parentId;
      const { data, error } = await window.Auth.rpc('post_comment', args);
      btn.disabled = false;
      if (error || !data) { msg.textContent = "couldn't post that — try again in a bit"; return; }
      if (!data.ok) {
        msg.textContent = REASONS[data.reason] || "couldn't post that";
        if (data.reason === 'no_username' && window.AuthWidget) window.AuthWidget.showUsernameModal();
        return;
      }
      box.value = '';
      onPosted();
    });
    parentEl.appendChild(form);
    return form;
  }

  // A top-level comment plus its thread: an "N replies" toggle and, when
  // open, the replies and a reply box. Open threads are remembered in
  // container._cmt.open so a redraw after posting keeps them open.
  function renderThread(container, c, replies, canPost, again) {
    const { page, item, open } = container._cmt;
    const resized = () => container.dispatchEvent(new CustomEvent('comments:rendered', { bubbles: true }));
    let thread, toggle, form;

    function setOpen(on) {
      if (on) open.add(c.id); else open.delete(c.id);
      thread.hidden = !on;
      if (toggle) toggle.textContent = on ? 'hide replies' : repliesLabel();
      resized();
    }
    function repliesLabel() {
      const last = replies[replies.length - 1];
      return replies.length + (replies.length === 1 ? ' reply' : ' replies') +
             ' · last reply ' + formatDay(last.created_at);
    }

    const onReply = canPost && !c.deleted ? () => {
      setOpen(true);
      if (form) form.querySelector('textarea').focus();
    } : null;
    const li = renderComment(c, again, onReply);

    if (replies.length) {
      toggle = el('button', 'cmt-link cmt-thread-toggle');
      toggle.type = 'button';
      toggle.addEventListener('click', () => setOpen(thread.hidden));
      li.appendChild(toggle);
    }
    thread = el('div', 'cmt-thread');
    if (replies.length) {
      const list = el('ol', 'cmt-list cmt-replies');
      replies.forEach(r => list.appendChild(renderComment(r, again)));
      thread.appendChild(list);
    }
    if (canPost) form = renderComposer(thread, page, item, again, c.id);
    li.appendChild(thread);

    thread.hidden = !open.has(c.id);
    if (toggle) toggle.textContent = thread.hidden ? repliesLabel() : 'hide replies';
    return li;
  }

  async function render(container) {
    const { page, item } = container._cmt;
    const token = container._cmt.token = (container._cmt.token || 0) + 1;
    const stale = () => container._cmt.token !== token || container._cmt.page !== page || container._cmt.item !== item;

    const section = el('section', 'cmt');
    section.appendChild(el('h3', 'cmt-heading', 'comments'));

    const session = await getSession();
    if (stale()) return;
    if (!session) {
      renderSignedOut(section);
      container.replaceChildren(section);
      return;
    }

    const key = unlockKey(page);
    const [{ data, error }, canPost] = await Promise.all([
      window.Auth.rpc('get_comments', { p_page: page, p_item: item }),
      window.Unlocks ? window.Unlocks.has(key) : Promise.resolve(false)
    ]);
    if (stale()) return;

    const comments = error || !Array.isArray(data) ? [] : data;
    const live = comments.filter(c => !c.deleted).length;
    if (live) section.firstChild.appendChild(el('span', 'cmt-count', ' (' + live + ')'));
    const top = [], replies = new Map();
    comments.forEach(c => {
      if (c.parent_id == null) top.push(c);
      else (replies.get(c.parent_id) || replies.set(c.parent_id, []).get(c.parent_id)).push(c);
    });
    const again = () => render(container);
    if (error) {
      section.appendChild(el('p', 'cmt-empty', 'the comments are stuck — try again in a bit'));
    } else if (!top.length) {
      section.appendChild(el('p', 'cmt-empty', canPost ? 'nobody has said anything yet — be the first' : 'nobody has said anything yet'));
    } else {
      const list = el('ol', 'cmt-list');
      top.forEach(c => list.appendChild(renderThread(container, c, replies.get(c.id) || [], canPost, again)));
      section.appendChild(list);
    }
    if (canPost) renderComposer(section, page, item, again);
    else renderLock(section);
    container.replaceChildren(section);
    container.dispatchEvent(new CustomEvent('comments:rendered', { bubbles: true }));
  }

  function mount(container, page, item) {
    if (!container || !page || !item) return;
    item = String(item).slice(0, 120);
    if (!container._cmt) {
      container._cmt = {};
      container.classList.add('cmt-host');
      // The thread lives inside clickable cards and keyboard-driven puzzles;
      // keep its clicks and typing to itself.
      ['click', 'keydown', 'keyup', 'keypress'].forEach(type =>
        container.addEventListener(type, e => e.stopPropagation()));
    }
    const same = container._cmt.page === page && container._cmt.item === item && container.firstChild;
    if (!same) container._cmt.open = new Set();
    container._cmt.page = page;
    container._cmt.item = item;
    mounted.add(container);
    if (!same) render(container);
  }

  function refreshAll() {
    mounted.forEach(c => { if (c.isConnected) render(c); else mounted.delete(c); });
  }

  function mountDeclared() {
    const nodes = document.querySelectorAll('[data-comments]');
    if (!nodes.length) return;
    const go = n => mount(n, n.dataset.comments, n.dataset.commentsItem || 'page');
    if (!('IntersectionObserver' in window)) { nodes.forEach(go); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { io.unobserve(e.target); go(e.target); }
    }), { rootMargin: '400px 0px' });
    nodes.forEach(n => io.observe(n));
  }

  function init() {
    mountDeclared();
    // Composer vs. lock depends on unlocks; the whole thread on being signed in.
    let wasUnlocked = null;
    document.addEventListener('unlocks:changed', e => {
      const keys = (e.detail || []).filter(u => u.key.startsWith('perk:comment_')).map(u => u.key).sort().join();
      if (wasUnlocked !== null && keys !== wasUnlocked) refreshAll();
      wasUnlocked = keys;
    });
    // Token refreshes fire this too; only redraw (and lose a half-typed
    // comment) when the account actually changes.
    let lastUid;
    getSession().then(s => { if (lastUid === undefined) lastUid = s ? s.user.id : null; });
    if (window.Auth) window.Auth.onAuthStateChange(session => {
      const uid = session ? session.user.id : null;
      if (lastUid !== undefined && uid === lastUid) return;
      lastUid = uid;
      refreshAll();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { mount };
})();
