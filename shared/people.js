// People mentioned on the site, linked to their profile (bio) page.
//
// To add a person: add a row with their site username and the names they're
// written as. Any of those names in page text becomes a link to their profile,
// including text that page scripts render later. Longer names win, so
// "Jamie Simon" links as one name rather than just "Jamie".
//
// Text inside links, buttons, form fields, code, or anything marked
// data-no-people is left alone.
(function () {
  const PEOPLE = [
    { username: 'jimbo', names: ['Jamie Simon', 'Jamie', 'Jimbo'] },
  ];
  window.PEOPLE = PEOPLE;

  const SKIP = 'a, script, style, textarea, input, button, select, option, code, pre, svg, [contenteditable], [data-no-people], .authw-overlay';

  // Don't link someone to the profile page you're already on.
  let ownProfile = null;
  if (/\/Profile\/profile\.html$/i.test(location.pathname)) {
    ownProfile = (new URLSearchParams(location.search).get('u') || '').toLowerCase();
  }

  const byName = new Map();
  PEOPLE.forEach(p => {
    if (p.username.toLowerCase() === ownProfile) return;
    const variants = new Set(p.names);
    const u = p.username;
    [u, u.toLowerCase(), u.toUpperCase(), u.charAt(0).toUpperCase() + u.slice(1)].forEach(v => variants.add(v));
    variants.forEach(n => byName.set(n, p.username));
  });
  if (!byName.size) { window.People = { linkify() {} }; return; }

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(?<![\\w@])(?:' + names.map(escapeRe).join('|') + ')(?![\\w])', 'g');

  function makeLink(username, text) {
    if (window.AuthWidget && window.AuthWidget.profileLink) return window.AuthWidget.profileLink(username, text);
    const a = document.createElement('a');
    a.className = 'name-link';
    a.href = window.Auth && window.Auth.profileUrl
      ? window.Auth.profileUrl(username)
      : '/Profile/profile.html?u=' + encodeURIComponent(username);
    a.textContent = text;
    return a;
  }

  function linkTextNode(node) {
    const text = node.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = pattern.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeLink(byName.get(m[0]), m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function linkify(root) {
    root = root || document.body;
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (parent && !parent.closest(SKIP)) linkTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(linkTextNode);
  }

  // Content that page scripts add after load (logs, filtered lists, modals).
  let pending = new Set(), timer = null;
  function flush() {
    timer = null;
    const roots = [...pending]; pending = new Set();
    roots.forEach(n => { if (n.isConnected) linkify(n); });
  }
  function start() {
    linkify(document.body);
    new MutationObserver(muts => {
      muts.forEach(m => {
        if (m.type === 'characterData') pending.add(m.target);
        else m.addedNodes.forEach(n => pending.add(n));
      });
      if (pending.size && !timer) timer = setTimeout(flush, 50);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.People = { linkify };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
