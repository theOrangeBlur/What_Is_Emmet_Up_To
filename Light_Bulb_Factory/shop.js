// Puzzle cube order page. Builds the option pickers from SHOP, keeps the
// preview and the estimate up to date, and sends the request to Supabase
// (submit_cube_order in supabase/orders.sql, which recomputes the price).

// ── Everything you'd want to change lives here. ──────────────────────────
// KEEP PRICES, COLOR NAMES AND maxLetters IN SYNC WITH
// supabase/orders.sql (cube_order_price and submit_cube_order).
const SHOP = {
  orderCutoff: '2026-12-10',   // last day to order for Christmas (inclusive)
  difficulties: [
    { id: 'medium', name: 'Medium', time: '7–15 min', price: 5000,
      blurb: 'A satisfying and straightforward solve.' },
    { id: 'hard', name: 'Hard', time: '30–60 min', price: 5000,
      blurb: 'A more challenging (and yet more satisfying!) conundrum.' },
  ],
  colors: [
    { name: 'Midnight Black', hex: '#24232a' },
    { name: 'Snow White',     hex: '#f1eee6' },
    { name: 'Holly Red',      hex: '#b3262e' },
    { name: 'Pine Green',     hex: '#2f6b3f' },
    { name: 'Ocean Blue',     hex: '#2a5d9f' },
    { name: 'Gold',           hex: '#d3a43c' },
  ],
  customColorPrice: 1000,
  messageTypes: [
    { id: 'blank',    name: 'Blank',          price: 0,    blurb: 'Clean pieces. The solved cube is the reward.' },
    { id: 'surprise', name: 'Surprise me',    price: 0,    blurb: 'I’ll pick a message. Nobody knows what it says until it’s solved.' },
    { id: 'custom',   name: 'Custom message', price: 1500, blurb: 'Your own words, revealed when it’s solved.' },
  ],
  maxLetters: 14,
  delivery: [
    { id: 'ship',   name: 'Ship it',       price: 800, blurb: 'US shipping, flat rate.' },
    { id: 'pickup', name: 'Pick up',       price: 0,   blurb: 'Brooklyn, by arrangement.' },
  ],
};

const $ = (sel) => document.querySelector(sel);
const form = $('#order');
const money = (cents) => '$' + (cents / 100).toFixed(cents % 100 ? 2 : 0);

// The order as it stands.
const state = {
  difficulty: 'medium',
  color: SHOP.colors[0].name,
  messageType: 'blank',
  delivery: 'ship',
};

// ── Pickers ────────────────────────────────────────────────────────────
function radioCards(container, name, items, selected, extra) {
  container.innerHTML = '';
  items.forEach((it) => {
    const label = document.createElement('label');
    label.className = 'card';
    const priceTag = it.price ? (extra === 'base' ? money(it.price) : '+' + money(it.price)) : (extra === 'base' ? '' : 'included');
    label.innerHTML = `
      <input type="radio" name="${name}" value="${it.id}" ${it.id === selected ? 'checked' : ''}>
      <span class="card-top"><span class="card-name"></span><span class="card-price"></span></span>
      ${it.time ? '<span class="card-time"></span>' : ''}
      <span class="card-blurb"></span>`;
    label.querySelector('.card-name').textContent = it.name;
    label.querySelector('.card-price').textContent = priceTag;
    if (it.time) label.querySelector('.card-time').textContent = it.time;
    label.querySelector('.card-blurb').textContent = it.blurb;
    container.appendChild(label);
  });
}

function buildColors() {
  const box = $('#colors');
  const all = [...SHOP.colors, { name: 'custom', label: 'Any other color', hex: null }];
  all.forEach((c) => {
    const label = document.createElement('label');
    label.className = 'swatch' + (c.hex ? '' : ' swatch-custom');
    label.innerHTML = `<input type="radio" name="color" value="${c.name}" ${c.name === state.color ? 'checked' : ''}>
      <span class="dot"></span><span class="swatch-name"></span>`;
    if (c.hex) label.querySelector('.dot').style.background = c.hex;
    label.querySelector('.swatch-name').textContent = c.hex ? c.name : `${c.label} (+${money(SHOP.customColorPrice)})`;
    box.appendChild(label);
  });
}

// ── Derived values ─────────────────────────────────────────────────────
const customText = () => form.message_custom.value.toUpperCase();
const letters = (s) => s.replace(/[^A-Z0-9]/g, '');

function message() {
  return state.messageType === 'custom' ? customText().trim() : '';
}

function colorHex() {
  if (state.color === 'custom') return form.color_hex.value;
  return SHOP.colors.find((c) => c.name === state.color).hex;
}

function quantity() {
  const q = parseInt(form.quantity.value, 10);
  return Number.isFinite(q) ? Math.min(10, Math.max(1, q)) : 1;
}

// Mirrors cube_order_price() in orders.sql.
function priceLines() {
  const d = SHOP.difficulties.find((x) => x.id === state.difficulty);
  const m = SHOP.messageTypes.find((x) => x.id === state.messageType);
  const del = SHOP.delivery.find((x) => x.id === state.delivery);
  const q = quantity();
  const lines = [[`${d.name} cube`, d.price]];
  if (state.color === 'custom') lines.push(['Custom color', SHOP.customColorPrice]);
  if (m.price) lines.push(['Custom message', m.price]);
  const each = lines.reduce((s, l) => s + l[1], 0);
  if (q > 1) lines.push([`× ${q} cubes`, each * (q - 1)]);
  if (del.price) lines.push(['Shipping', del.price]);
  return lines;
}

// ── Preview: an isometric 3×3×3 cube in the chosen color ──────────────
// (No message on it: where the letters sit would give the solve away.)
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Each face maps a 3×3 grid (u across, v down) onto the drawing.
const FACES = [
  { m: [70, 40, 0, 80, 30, 60],    tone: 0 },
  { m: [70, -40, 0, 80, 100, 100], tone: -0.28 },
  { m: [70, -40, 70, 40, 30, 60],  tone: 0.22 },
];

function drawCube() {
  const base = colorHex();
  let out = '<title id="cube-title">Preview of your cube</title>';
  FACES.forEach((f) => {
    const [ux, uy, vx, vy, ox, oy] = f.m;
    out += `<g transform="matrix(${ux / 3} ${uy / 3} ${vx / 3} ${vy / 3} ${ox} ${oy})">`;
    out += `<rect width="3" height="3" fill="${shade(base, f.tone)}"/>`;
    for (let v = 0; v < 3; v++) {
      for (let u = 0; u < 3; u++) {
        out += `<rect x="${u}" y="${v}" width="1" height="1" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".04"/>`;
      }
    }
    out += '</g>';
  });
  $('#cube').innerHTML = out;
}

// ── Render ─────────────────────────────────────────────────────────────
function render() {
  $('#custom-color').hidden = state.color !== 'custom';
  $('#custom-message').hidden = state.messageType !== 'custom';
  $('#address-wrap').hidden = state.delivery !== 'ship';

  const used = letters(customText()).length;
  const lc = $('#letter-count');
  lc.textContent = `${used} / ${SHOP.maxLetters} letters.`;
  lc.classList.toggle('over', used > SHOP.maxLetters);

  const lines = priceLines();
  $('#lines').innerHTML = '';
  lines.forEach(([label, cents]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><span></span>';
    li.children[0].textContent = label;
    li.children[1].textContent = money(cents);
    $('#lines').appendChild(li);
  });
  $('#total').textContent = money(lines.reduce((s, l) => s + l[1], 0));
  drawCube();
}

// ── Validation & submit ────────────────────────────────────────────────
const REASONS = {
  difficulty: 'Pick a difficulty.',
  color: 'Tell me what color you have in mind.',
  message: `Messages can use letters A–Z and numbers, up to ${SHOP.maxLetters} characters (spaces don't count).`,
  quantity: 'Quantity should be between 1 and 10. Need more? Mention it in the notes or book a consultation.',
  name: 'What name should I put on the order?',
  email: "That email doesn't look right.",
  delivery: 'Choose shipping or pickup.',
  address: 'Add a shipping address (or choose pickup).',
  rate: "You've sent a few requests today. I'll be in touch; reply to my email if you need changes.",
};

function check() {
  if (state.color === 'custom' && !form.color_custom.value.trim()) return 'color';
  if (state.messageType === 'custom') {
    const t = customText().trim();
    if (!t || !/^[A-Z0-9 ]+$/.test(t) || letters(t).length > SHOP.maxLetters) return 'message';
  }
  if (!form.name.value.trim()) return 'name';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.value.trim())) return 'email';
  if (state.delivery === 'ship' && form.address.value.trim().length < 10) return 'address';
  return null;
}

const closed = () => new Date().toISOString().slice(0, 10) > SHOP.orderCutoff;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#error');
  err.textContent = '';
  if (closed()) { err.textContent = 'Christmas orders are closed. Book a consultation for anything custom!'; return; }
  if (form.website.value) return;   // honeypot
  const bad = check();
  if (bad) { err.textContent = REASONS[bad]; return; }

  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const { data, error } = await window.Auth.rpc('submit_cube_order', {
    p_difficulty: state.difficulty,
    p_color: state.color,
    p_color_custom: state.color === 'custom' ? `${form.color_custom.value.trim()} (preview ${form.color_hex.value})` : null,
    p_message_type: state.messageType,
    p_message_text: message() || null,
    p_quantity: quantity(),
    p_name: form.name.value.trim(),
    p_email: form.email.value.trim(),
    p_delivery: state.delivery,
    p_address: state.delivery === 'ship' ? form.address.value.trim() : null,
    p_needed_by: form.needed_by.value || null,
    p_notes: form.notes.value.trim() || null,
  });
  btn.disabled = false;
  btn.textContent = 'Request my cube';

  if (error || !data) { err.textContent = 'Something went wrong sending that. Try again in a moment.'; return; }
  if (!data.ok) { err.textContent = REASONS[data.reason] || 'Something about that order didn’t check out.'; return; }

  $('#done-id').textContent = '#' + data.id;
  $('#done-price').textContent = money(data.price_cents);
  $('#done-email').textContent = form.email.value.trim();
  document.querySelector('.shop').hidden = true;
  $('#done').hidden = false;
  $('#done').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Wire up ────────────────────────────────────────────────────────────
radioCards($('#difficulty'), 'difficulty', SHOP.difficulties, state.difficulty, 'base');
radioCards($('#message-type'), 'message_type', SHOP.messageTypes, state.messageType);
radioCards($('#delivery'), 'delivery', SHOP.delivery, state.delivery);
buildColors();

form.addEventListener('input', (e) => {
  const t = e.target;
  if (t.name === 'difficulty') state.difficulty = t.value;
  if (t.name === 'color') state.color = t.value;
  if (t.name === 'message_type') state.messageType = t.value;
  if (t.name === 'delivery') state.delivery = t.value;
  render();
});

$('#cutoff-note').textContent = closed() ? 'closed for this year' : 'Order soon for Christmas!';
if (closed()) $('#submit').disabled = true;
form.needed_by.min = new Date().toISOString().slice(0, 10);

// Signed in on the main site? Save them some typing.
if (window.Auth) {
  window.Auth.getSession().then((s) => {
    if (s && s.user && s.user.email && !form.email.value) form.email.value = s.user.email;
  }).catch(() => {});
}

render();
