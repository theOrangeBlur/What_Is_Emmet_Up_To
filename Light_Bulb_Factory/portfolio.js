// The Lightbulb Factory's portfolio: a sideways carousel of project cards
// below the fold, there to scroll down to once the light is on. Choosing a
// card opens its full write-up in a panel below the carousel, which slides
// open like the cards on the Projects page. Everything comes from
// portfolio.generated.json; edit portfolio.json and rebuild
// (node Projects/build.js) to change the order or wording.
(function () {
  'use strict';

  const section = document.getElementById('work');
  const track = section && section.querySelector('.carousel-track');
  if (!track) return;
  const buttons = section.querySelectorAll('.carousel-btn');
  const panel = document.getElementById('work-details');
  const root = document.documentElement;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function card(p) {
    const li = el('li', 'card');
    const media = el('div', 'card-media');
    if (p.thumbnail) {
      const img = el('img');
      img.src = p.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      media.appendChild(img);
    }
    li.appendChild(media);

    const body = el('div', 'card-body');
    body.appendChild(el('h3', 'card-title', p.title));
    if (p.dates) body.appendChild(el('p', 'card-date', p.dates));
    if (p.description) body.appendChild(el('p', 'card-desc', p.description));
    if (p.tags && p.tags.length) {
      const tags = el('ul', 'card-tags');
      p.tags.forEach((t) => tags.appendChild(el('li', '', t)));
      body.appendChild(tags);
    }
    // The button's hit area covers the whole card (see .card-open::after).
    const open = el('button', 'card-open', 'Read more');
    open.type = 'button';
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-controls', 'work-details');
    open.setAttribute('aria-label', `Read more: ${p.title}`);
    open.addEventListener('click', () => (openSlug === p.slug ? closeDetails(false) : openDetails(p)));
    body.appendChild(open);
    li.appendChild(body);
    li.dataset.slug = p.slug;
    return li;
  }

  // ── The details panel ─────────────────────────────────────────────────
  let openSlug = null;

  const smooth = () => (motion.matches ? 'auto' : 'smooth');
  const fullHeight = () => panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);

  function markOpen(slug) {
    openSlug = slug;
    track.querySelectorAll('.card').forEach((c) => {
      const on = c.dataset.slug === slug;
      c.classList.toggle('is-open', on);
      c.querySelector('.card-open').setAttribute('aria-expanded', String(on));
    });
  }

  function fill(p) {
    panel.querySelectorAll('video').forEach((v) => v.pause());
    panel.innerHTML = '';
    const inner = el('div', 'work-details__inner');
    const head = el('header', 'work-details__head');
    head.appendChild(el('h3', 'work-details__title', p.title));
    if (p.dates) head.appendChild(el('p', 'card-date', p.dates));
    inner.appendChild(head);
    const body = el('div', 'work-details__body');
    body.innerHTML = p.details || ''; // rendered from your own process.md files at build time
    inner.appendChild(body);
    const close = el('button', 'work-details__close', '▲ Collapse');
    close.type = 'button';
    close.addEventListener('click', () => closeDetails(true));
    inner.appendChild(close);
    panel.appendChild(inner);
    initSteppers(body);
  }

  function openDetails(p) {
    const wasOpen = openSlug !== null;
    fill(p);
    markOpen(p.slug);
    if (wasOpen || motion.matches) {
      panel.classList.add('expanded');
      panel.style.maxHeight = 'none';
    } else {
      // Slide open from nothing to its full height; once there, it tracks
      // its content (late-loading photos, resizes).
      panel.style.maxHeight = '0px';
      panel.offsetHeight; // flush, so the transition starts from zero
      panel.classList.add('expanded');
      panel.style.maxHeight = fullHeight() + 'px';
    }
    // Bring the start of the write-up into view if it's far down the screen.
    const top = panel.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.7 || top < 0) {
      window.scrollBy({ top: top - window.innerHeight * 0.3, behavior: smooth() });
    }
  }

  // returnToCards: if the panel was read far down the page, scroll the
  // carousel back into view and put focus back on the card.
  function closeDetails(returnToCards) {
    if (openSlug === null) return;
    const slug = openSlug;
    markOpen(null);
    panel.querySelectorAll('video').forEach((v) => v.pause());
    panel.style.maxHeight = fullHeight() + 'px';
    panel.offsetHeight;
    panel.classList.remove('expanded');
    panel.style.maxHeight = '0px';
    if (motion.matches) panel.innerHTML = '';
    if (!returnToCards) return;
    if (section.getBoundingClientRect().top < 0) {
      section.scrollIntoView({ behavior: smooth(), block: 'start' });
    }
    const btn = track.querySelector(`.card[data-slug="${slug}"] .card-open`);
    if (btn) btn.focus({ preventScroll: true });
  }

  panel.addEventListener('transitionend', (e) => {
    if (e.target !== panel || e.propertyName !== 'max-height') return;
    if (panel.classList.contains('expanded')) panel.style.maxHeight = 'none';
    else panel.innerHTML = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openSlug !== null) closeDetails(true);
  });
  // Turning the light off closes it.
  new MutationObserver(() => {
    if (!root.classList.contains('is-lit')) closeDetails(false);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  // Step-by-step photo sets (step_N images), as on the Projects page: click
  // to advance.
  function initSteppers(scope) {
    scope.querySelectorAll('.step-stepper').forEach((stepper) => {
      const stage = stepper.querySelector('.step-stepper__stage');
      const imgs = stepper.querySelectorAll('.step-stepper__img');
      const counter = stepper.querySelector('.step-stepper__counter');
      const hint = stepper.querySelector('.step-stepper__hint');
      if (!imgs.length) return;
      let current = 0;
      imgs[0].classList.add('active');
      imgs.forEach((img) => { img.loading = 'eager'; });
      stage.addEventListener('click', () => {
        imgs[current].classList.remove('active');
        current = (current + 1) % imgs.length;
        imgs[current].classList.add('active');
        counter.textContent = `Step ${current + 1} / ${imgs.length}`;
        hint.textContent = current === imgs.length - 1 ? 'click to restart' : 'click to advance';
      });
    });
  }

  function fallback() {
    const p = el('p', 'portfolio-fallback');
    const a = el('a', '', 'See all projects →');
    a.href = '/Projects/projects.html';
    p.appendChild(a);
    track.replaceWith(p);
    buttons.forEach((b) => { b.hidden = true; });
  }

  // ── Scrolling ─────────────────────────────────────────────────────────
  // One card (plus the gap) per press.
  function stepSize() {
    const first = track.firstElementChild;
    if (!first) return track.clientWidth;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return first.getBoundingClientRect().width + gap;
  }

  function go(dir) {
    track.scrollBy({ left: dir * stepSize(), behavior: motion.matches ? 'auto' : 'smooth' });
  }

  function syncButtons() {
    const max = track.scrollWidth - track.clientWidth - 2;
    buttons.forEach((b) => {
      b.disabled = Number(b.dataset.dir) < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= max;
    });
  }

  buttons.forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.dir))));
  track.addEventListener('keydown', (e) => {
    if (e.target !== track) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  track.addEventListener('scroll', syncButtons, { passive: true });
  window.addEventListener('resize', syncButtons);

  // The "Selected work" cue at the bottom of the screen goes once the page
  // has been scrolled.
  function syncCue() { root.classList.toggle('scrolled', window.scrollY > 40); }
  window.addEventListener('scroll', syncCue, { passive: true });
  syncCue();
  // Scroll there without putting #work in the address bar, so a reload
  // still opens at the top, in the dark.
  const cue = document.querySelector('.scroll-cue');
  if (cue) {
    cue.addEventListener('click', (e) => {
      e.preventDefault();
      section.scrollIntoView({ behavior: motion.matches ? 'auto' : 'smooth', block: 'start' });
      track.focus({ preventScroll: true });
    });
  }

  // ── Load ──────────────────────────────────────────────────────────────
  // no-cache: always check for a newer build, so this file needs no ?v= bump.
  fetch('./portfolio.generated.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      const projects = (data && data.projects) || [];
      if (!projects.length) { fallback(); return; }
      const frag = document.createDocumentFragment();
      projects.forEach((p) => frag.appendChild(card(p)));
      track.appendChild(frag);
      syncButtons();
    })
    .catch((err) => { console.error('portfolio failed to load', err); fallback(); });
})();
