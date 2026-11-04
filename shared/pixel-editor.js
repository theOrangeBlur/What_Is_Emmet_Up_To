// Pixel-art icon editor: a big window with a square grid (8×8 up to 64×64),
// pencil / eraser / fill / eyedropper, HSL color sliders, mirror mode and
// undo. Resolves with two PNGs, or null if closed:
//   png    - 384×384, each cell an exact block (384 divides by every size),
//            ready for Auth.uploadAvatar
//   source - size×size, one pixel per cell, for reopening later
//
//   const r = await PixelEditor.open({ initial: imgElementOrNull });
//
// Unfinished work is kept as a draft in localStorage until "use this icon".
// Styles: shared/pixel-editor.css (plus .authw-* from auth-widget.css).

window.PixelEditor = (function () {
  const SIZES = [8, 16, 24, 32, 48, 64];
  const DEFAULT_SIZE = 16;
  const EXPORT = 384;
  const UNDO_MAX = 50;
  const RECENT_MAX = 8;
  const DRAFT_KEY = 'pxe-draft';
  const PALETTE = [
    '#000000', '#3b3b4f', '#7a7670', '#c9c4bb', '#ffffff', '#6b3a2a',
    '#c0533a', '#e8a04a', '#f5d76e', '#538d4e', '#9bd36a', '#2f6f8f',
    '#5fb4e0', '#3d3a8c', '#9a5fd0', '#e07ab8',
  ];

  // ── Color helpers ──
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, Math.round(l * 100)];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
  }
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d && SIZES.includes(d.size) && Array.isArray(d.cells) && d.cells.length === d.size * d.size) return d;
    } catch {}
    return null;
  }
  function saveDraft(size, cells) {
    try {
      if (cells.some(c => c)) localStorage.setItem(DRAFT_KEY, JSON.stringify({ size, cells }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

  // Read an image back into cells. Its width picks the grid size (snapped to
  // the nearest allowed one); see-through pixels become empty cells.
  function cellsFromImage(img) {
    const w = img.naturalWidth || img.width;
    const size = SIZES.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const cells = new Array(size * size);
    for (let i = 0; i < cells.length; i++) {
      const o = i * 4;
      cells[i] = data[o + 3] < 128 ? null
        : '#' + [data[o], data[o + 1], data[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    return { size, cells };
  }

  // Nearest-neighbour resample, so changing size keeps the drawing.
  function resample(cells, from, to) {
    const out = new Array(to * to);
    for (let y = 0; y < to; y++)
      for (let x = 0; x < to; x++)
        out[y * to + x] = cells[Math.floor(y * from / to) * from + Math.floor(x * from / to)];
    return out;
  }

  function paintTo(ctx, cells, size, px) {
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      ctx.fillStyle = cells[i];
      ctx.fillRect((i % size) * px, Math.floor(i / size) * px, px, px);
    }
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('no blob')), 'image/png'));
  }

  function open(opts) {
    opts = opts || {};
    if (document.querySelector('.pxe-overlay')) return Promise.resolve(null);

    // ── State ──
    let start = loadDraft();
    if (!start && opts.initial) { try { start = cellsFromImage(opts.initial); } catch { start = null; } }
    let size = start ? start.size : (SIZES.includes(opts.size) ? opts.size : DEFAULT_SIZE);
    let cells = start ? start.cells.slice() : new Array(size * size).fill(null);
    let tool = 'pencil';
    let hsl = [120, 29, 43];   // the site's green, #538d4e-ish
    let mirror = false;
    let showGrid = true;
    let recents = [];
    const undo = [], redo = [];
    let hover = -1;

    return new Promise(resolve => {
      const overlay = el('div', 'authw-overlay pxe-overlay');
      const card = el('div', 'pxe-card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Draw your icon');
      overlay.appendChild(card);

      // ── Canvas side ──
      const stage = el('div', 'pxe-stage');
      const canvas = el('canvas', 'pxe-canvas');
      stage.appendChild(canvas);
      card.appendChild(stage);
      const ctx = canvas.getContext('2d');

      // ── Panel ──
      const panel = el('div', 'pxe-panel');
      card.appendChild(panel);
      panel.appendChild(el('div', 'authw-heading', 'draw your icon'));

      function section(label) {
        const s = el('div', 'pxe-section');
        s.appendChild(el('div', 'pxe-label', label));
        panel.appendChild(s);
        return s;
      }

      // Tools
      const TOOLS = [
        ['pencil', 'pencil', 'B'], ['eraser', 'eraser', 'E'],
        ['fill', 'fill', 'G'], ['picker', 'pick color', 'I'],
      ];
      const toolRow = el('div', 'pxe-row');
      const toolBtns = {};
      TOOLS.forEach(([id, label, key]) => {
        const b = el('button', 'pxe-btn', label);
        b.type = 'button';
        b.title = label + ' (' + key + ')';
        b.addEventListener('click', () => setTool(id));
        toolBtns[id] = b;
        toolRow.appendChild(b);
      });
      section('tools').appendChild(toolRow);

      const optRow = el('div', 'pxe-row');
      const mirrorBtn = el('button', 'pxe-btn', 'mirror');
      mirrorBtn.type = 'button'; mirrorBtn.title = 'paint both halves at once (M)';
      mirrorBtn.addEventListener('click', () => { mirror = !mirror; syncButtons(); draw(); });
      const gridBtn = el('button', 'pxe-btn', 'grid lines');
      gridBtn.type = 'button';
      gridBtn.addEventListener('click', () => { showGrid = !showGrid; syncButtons(); draw(); });
      const undoBtn = el('button', 'pxe-btn', 'undo');
      undoBtn.type = 'button'; undoBtn.title = 'undo (Ctrl+Z)';
      undoBtn.addEventListener('click', doUndo);
      const redoBtn = el('button', 'pxe-btn', 'redo');
      redoBtn.type = 'button'; redoBtn.title = 'redo (Ctrl+Y)';
      redoBtn.addEventListener('click', doRedo);
      [mirrorBtn, gridBtn, undoBtn, redoBtn].forEach(b => optRow.appendChild(b));
      panel.lastChild.appendChild(optRow);

      // Size
      const sizeRow = el('div', 'pxe-row');
      const sizeBtns = {};
      SIZES.forEach(n => {
        const b = el('button', 'pxe-btn pxe-size', String(n));
        b.type = 'button';
        b.title = n + ' × ' + n;
        b.addEventListener('click', () => setSize(n));
        sizeBtns[n] = b;
        sizeRow.appendChild(b);
      });
      section('grid size').appendChild(sizeRow);

      // Color
      const colorSec = section('color');
      const colorTop = el('div', 'pxe-color-top');
      const swatch = el('div', 'pxe-swatch');
      const hexInp = el('input', 'authw-input pxe-hex');
      hexInp.maxLength = 7; hexInp.spellcheck = false; hexInp.setAttribute('aria-label', 'hex color');
      hexInp.addEventListener('change', () => {
        let v = hexInp.value.trim();
        if (v[0] !== '#') v = '#' + v;
        if (HEX_RE.test(v)) setColor(v.toLowerCase()); else syncColor();
      });
      colorTop.appendChild(swatch); colorTop.appendChild(hexInp);
      colorSec.appendChild(colorTop);

      const sliders = [['hue', 360], ['saturation', 100], ['lightness', 100]].map(([name, max], i) => {
        const inp = el('input', 'pxe-slider');
        inp.type = 'range'; inp.min = 0; inp.max = max; inp.setAttribute('aria-label', name);
        inp.addEventListener('input', () => {
          hsl[i] = +inp.value;
          if (tool === 'eraser' || tool === 'picker') setTool('pencil');
          syncColor();
        });
        colorSec.appendChild(inp);
        return inp;
      });

      const palRow = el('div', 'pxe-swatches');
      PALETTE.forEach(hex => palRow.appendChild(chip(hex)));
      colorSec.appendChild(palRow);
      colorSec.appendChild(el('div', 'pxe-label pxe-sublabel', 'recent'));
      const recentRow = el('div', 'pxe-swatches pxe-recent');
      colorSec.appendChild(recentRow);

      function chip(hex) {
        const b = el('button', 'pxe-chip');
        b.type = 'button'; b.style.background = hex; b.title = hex;
        b.addEventListener('click', () => setColor(hex));
        return b;
      }

      // Preview at the sizes the site really shows it
      const prevSec = section('how it looks');
      const prevRow = el('div', 'pxe-previews');
      const previews = [112, 64, 34].map(n => {
        const c = el('canvas', 'pxe-preview');
        c.width = c.height = n;
        c.style.width = c.style.height = n + 'px';
        prevRow.appendChild(c);
        return c;
      });
      prevSec.appendChild(prevRow);

      const btns = el('div', 'authw-btns pxe-actions');
      const clearBtn = el('button', 'authw-btn', 'clear');
      clearBtn.type = 'button';
      clearBtn.addEventListener('click', () => {
        if (!cells.some(c => c)) return;
        snapshot(); cells.fill(null); changed();
      });
      const cancelBtn = el('button', 'authw-btn', 'cancel');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => close(null));
      const useBtn = el('button', 'authw-btn authw-btn-primary', 'use this icon');
      useBtn.type = 'button';
      useBtn.addEventListener('click', finish);
      [clearBtn, cancelBtn, useBtn].forEach(b => btns.appendChild(b));
      panel.appendChild(btns);
      panel.appendChild(el('div', 'pxe-hint', 'right-click erases · B E G I switch tools · M mirror · Ctrl+Z undo'));

      // ── Rendering ──
      let cellPx = 1, frame = 0;
      const ex = document.createElement('canvas');   // 384px render, feeds the previews
      ex.width = ex.height = EXPORT;
      const exCtx = ex.getContext('2d');

      function layout() {
        const dpr = window.devicePixelRatio || 1;
        const narrow = window.innerWidth < 760;
        const side = Math.max(160, Math.min(stage.clientWidth, narrow ? window.innerWidth - 64 : window.innerHeight - 80));
        cellPx = Math.max(1, Math.floor(side * dpr / size));
        canvas.width = canvas.height = cellPx * size;
        canvas.style.width = canvas.style.height = (cellPx * size / dpr) + 'px';
        draw();
      }

      function draw() {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; render(); });
      }

      function render() {
        const W = canvas.width;
        // Checkerboard shows see-through cells: two squares per cell.
        const half = cellPx / 2;
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, W, W);
        ctx.fillStyle = '#353535';
        for (let y = 0; y < size * 2; y++)
          for (let x = (y % 2); x < size * 2; x += 2) ctx.fillRect(x * half, y * half, half, half);
        paintTo(ctx, cells, size, cellPx);

        if (showGrid && cellPx >= 6) {
          ctx.strokeStyle = 'rgba(255,255,255,.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 1; i < size; i++) {
            const p = i * cellPx + .5;
            ctx.moveTo(p, 0); ctx.lineTo(p, W);
            ctx.moveTo(0, p); ctx.lineTo(W, p);
          }
          ctx.stroke();
        }
        if (mirror) {
          ctx.strokeStyle = 'rgba(106,175,99,.6)';
          ctx.lineWidth = Math.max(1, cellPx / 8);
          ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, W); ctx.stroke();
        }
        if (hover >= 0) {
          ctx.strokeStyle = 'rgba(255,255,255,.7)';
          ctx.lineWidth = Math.max(1, cellPx / 10);
          const targets = mirror ? [hover, mirrorOf(hover)] : [hover];
          targets.forEach(i => ctx.strokeRect((i % size) * cellPx, Math.floor(i / size) * cellPx, cellPx, cellPx));
        }

        exCtx.clearRect(0, 0, EXPORT, EXPORT);
        exCtx.imageSmoothingEnabled = false;
        paintTo(exCtx, cells, size, EXPORT / size);
        previews.forEach(c => {
          const p = c.getContext('2d');
          p.clearRect(0, 0, c.width, c.height);
          p.imageSmoothingEnabled = true;
          p.imageSmoothingQuality = 'high';
          p.drawImage(ex, 0, 0, c.width, c.height);
        });
      }

      // ── Editing ──
      const mirrorOf = i => Math.floor(i / size) * size + (size - 1 - (i % size));

      function snapshot() {
        undo.push({ size, cells: cells.slice() });
        if (undo.length > UNDO_MAX) undo.shift();
        redo.length = 0;
        syncButtons();
      }
      function restore(from, to) {
        const s = from.pop();
        if (!s) return;
        to.push({ size, cells: cells.slice() });
        size = s.size; cells = s.cells;
        syncButtons(); layout(); saveDraft(size, cells);
      }
      function doUndo() { restore(undo, redo); }
      function doRedo() { restore(redo, undo); }

      function changed() { draw(); saveDraft(size, cells); }

      function setCell(i, value) {
        cells[i] = value;
        if (mirror) cells[mirrorOf(i)] = value;
      }

      function fill(i, value) {
        const target = cells[i];
        if (target === value) return;
        const stack = [i];
        while (stack.length) {
          const j = stack.pop();
          if (cells[j] !== target) continue;
          cells[j] = value;
          const x = j % size, y = Math.floor(j / size);
          if (x > 0) stack.push(j - 1);
          if (x < size - 1) stack.push(j + 1);
          if (y > 0) stack.push(j - size);
          if (y < size - 1) stack.push(j + size);
        }
      }

      function setSize(n) {
        if (n === size) return;
        if (n < size && cells.some(c => c) && !confirm('Shrinking to ' + n + '×' + n + ' squashes the drawing and loses detail. Go ahead? (undo brings it back)')) return;
        snapshot();
        cells = resample(cells, size, n);
        size = n;
        syncButtons(); layout(); saveDraft(size, cells);
      }

      function currentHex() { return hslToHex(hsl[0], hsl[1], hsl[2]); }
      function setColor(hex) {
        hsl = hexToHsl(hex);
        if (tool === 'eraser' || tool === 'picker') setTool('pencil');
        syncColor();
      }
      function useColor(hex) {
        recents = [hex].concat(recents.filter(c => c !== hex)).slice(0, RECENT_MAX);
        recentRow.innerHTML = '';
        recents.forEach(c => recentRow.appendChild(chip(c)));
      }
      function setTool(t) { tool = t; syncButtons(); }

      function syncColor() {
        const hex = currentHex();
        swatch.style.background = hex;
        hexInp.value = hex;
        sliders.forEach((s, i) => { s.value = hsl[i]; });
        const [h, s, l] = hsl;
        sliders[0].style.background = 'linear-gradient(to right,' +
          [0, 60, 120, 180, 240, 300, 360].map(d => hslToHex(d, Math.max(s, 40), Math.min(Math.max(l, 30), 70))).join(',') + ')';
        sliders[1].style.background = 'linear-gradient(to right,' + hslToHex(h, 0, l) + ',' + hslToHex(h, 100, l) + ')';
        sliders[2].style.background = 'linear-gradient(to right,#000,' + hslToHex(h, s, 50) + ',#fff)';
      }

      function syncButtons() {
        Object.entries(toolBtns).forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === tool)));
        Object.entries(sizeBtns).forEach(([n, b]) => b.setAttribute('aria-pressed', String(+n === size)));
        mirrorBtn.setAttribute('aria-pressed', String(mirror));
        gridBtn.setAttribute('aria-pressed', String(showGrid));
        undoBtn.disabled = !undo.length;
        redoBtn.disabled = !redo.length;
        canvas.dataset.tool = tool;
      }

      // ── Pointer input ──
      let stroke = null;   // { value, last } while dragging

      function cellAt(e) {
        const r = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * size);
        const y = Math.floor((e.clientY - r.top) / r.height * size);
        return x < 0 || y < 0 || x >= size || y >= size ? -1 : y * size + x;
      }

      // Fill in every cell between two points, so fast drags leave no gaps.
      function line(a, b, value) {
        let x0 = a % size, y0 = Math.floor(a / size);
        const x1 = b % size, y1 = Math.floor(b / size);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          setCell(y0 * size + x0, value);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      }

      canvas.addEventListener('contextmenu', e => e.preventDefault());
      canvas.addEventListener('pointerdown', e => {
        const i = cellAt(e);
        if (i < 0 || (e.button !== 0 && e.button !== 2)) return;
        e.preventDefault();
        const erase = e.button === 2 || tool === 'eraser';
        if (tool === 'picker' && !erase) {
          if (cells[i]) setColor(cells[i]);
          return;
        }
        const value = erase ? null : currentHex();
        snapshot();
        if (tool === 'fill' && !erase) {
          fill(i, value);
          if (mirror) fill(mirrorOf(i), value);
          useColor(value);
          changed();
          return;
        }
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        stroke = { value, last: i };
        setCell(i, value);
        if (value) useColor(value);
        draw();
      });
      canvas.addEventListener('pointermove', e => {
        const i = cellAt(e);
        if (i !== hover) { hover = i; draw(); }
        if (!stroke || i < 0) return;
        if (i !== stroke.last) { line(stroke.last, i, stroke.value); stroke.last = i; draw(); }
      });
      const endStroke = () => { if (stroke) { stroke = null; saveDraft(size, cells); } };
      canvas.addEventListener('pointerup', endStroke);
      canvas.addEventListener('pointercancel', endStroke);
      canvas.addEventListener('pointerleave', () => { if (!stroke) { hover = -1; draw(); } });

      function onKey(e) {
        if (e.target === hexInp) { if (e.key === 'Escape') hexInp.blur(); return; }
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (e.key === 'Escape') close(null);
        else if (mod && k === 'z' && !e.shiftKey) doUndo();
        else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) doRedo();
        else if (mod) return;
        else if (k === 'b') setTool('pencil');
        else if (k === 'e') setTool('eraser');
        else if (k === 'g') setTool('fill');
        else if (k === 'i') setTool('picker');
        else if (k === 'm') { mirror = !mirror; syncButtons(); draw(); }
        else return;
        e.preventDefault();
      }

      async function finish() {
        useBtn.disabled = true;
        try {
          const out = document.createElement('canvas');
          out.width = out.height = EXPORT;
          const o = out.getContext('2d');
          o.imageSmoothingEnabled = false;
          paintTo(o, cells, size, EXPORT / size);
          const src = document.createElement('canvas');
          src.width = src.height = size;
          paintTo(src.getContext('2d'), cells, size, 1);
          const [png, source] = await Promise.all([toBlob(out), toBlob(src)]);
          clearDraft();
          close({ png, source });
        } catch {
          useBtn.disabled = false;
        }
      }

      function close(result) {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', layout);
        if (frame) cancelAnimationFrame(frame);
        overlay.remove();
        resolve(result);
      }

      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', layout);
      document.body.appendChild(overlay);
      syncButtons();
      syncColor();
      layout();
    });
  }

  return { open, SIZES };
})();
