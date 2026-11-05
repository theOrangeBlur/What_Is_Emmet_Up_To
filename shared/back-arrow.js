// A "go back" arrow pinned to the right edge of the screen, for pages people
// reach from somewhere else on the site (the trophy case, profiles). It only
// shows up when the visitor arrived from another page on this site, and takes
// them straight back to it.
(function () {
  let prev;
  try {
    if (!document.referrer) return;
    prev = new URL(document.referrer);
  } catch (e) { return; }
  if (prev.origin !== location.origin) return;
  // Same page (a reload, or a hash/tab change) isn't somewhere to go back to.
  if (prev.pathname === location.pathname && prev.search === location.search) return;

  const style = document.createElement('style');
  style.textContent = `
    .back-arrow {
      position: fixed;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 900;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--panel, #141414);
      border: 1px solid var(--line, #2e2e2e);
      color: var(--soft, #a8a39b);
      font: 700 20px/1 'Space Mono', monospace;
      text-decoration: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, .45);
      opacity: .85;
      transition: opacity .15s, color .15s, border-color .15s;
    }
    .back-arrow:hover, .back-arrow:focus-visible {
      opacity: 1;
      color: var(--green-hi, #6aaf63);
      border-color: var(--green-hi, #6aaf63);
      outline: none;
    }
    @media (max-width: 600px) {
      .back-arrow { right: 8px; width: 38px; height: 38px; font-size: 17px; }
    }
  `;
  document.head.appendChild(style);

  const a = document.createElement('a');
  a.className = 'back-arrow';
  a.href = prev.href;
  a.innerHTML = '&rarr;';
  a.title = 'Back to the previous page';
  a.setAttribute('aria-label', 'Back to the previous page');
  a.addEventListener('click', e => {
    // Prefer a real "back" so the previous page keeps its scroll position;
    // fall back to the link when there's no history (e.g. opened in a new tab).
    if (history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });

  const add = () => document.body.appendChild(a);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();
