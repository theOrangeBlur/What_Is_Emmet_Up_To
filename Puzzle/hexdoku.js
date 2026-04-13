// ── DATA ────────────────────────────────────────────────────────────────────

// Raw data format (matches input.txt exactly):
// 9 scan-line rows per grid. Every 3 rows cover one hex-row (hexes left→right):
//   scan-row 0 of hex-row: [hex0_topLeft, hex0_topRight, hex1_topLeft, hex1_topRight, hex2_topLeft, hex2_topRight]
//   scan-row 1 of hex-row: [hex0_midLeft, hex0_midRight, ...]
//   scan-row 2 of hex-row: [hex0_botLeft, hex0_botRight, ...]
// 0 = empty cell (incomplete grids). These map to visual triangle indices:
//   topLeft→ti5, topRight→ti0, midLeft→ti4, midRight→ti1, botLeft→ti3, botRight→ti2

const RAW_COMPLETE = [
  // Level 1
  [
    [6,1,2,1,3,2],[5,2,3,6,4,1],[4,3,4,5,5,6],
    [5,6,4,5,1,6],[4,1,3,6,2,5],[3,2,2,1,3,4],
    [3,2,4,3,2,1],[4,1,5,2,3,6],[5,6,6,1,4,5],
  ],
  // Level 2
  [
    [2,1,6,5,4,3],[3,6,1,4,5,2],[4,5,2,3,6,1],
    [5,6,4,3,2,1],[4,1,5,2,3,6],[3,2,6,1,4,5],
    [1,2,3,4,6,5],[6,3,2,5,1,4],[5,4,1,6,2,3],
  ],
  // Level 3
  [
    [4,3,6,5,2,1],[5,2,1,4,3,6],[6,1,2,3,4,5],
    [6,5,2,1,1,6],[1,4,3,6,2,5],[2,3,4,5,3,4],
    [5,4,4,3,6,5],[6,3,5,2,1,4],[1,2,6,1,2,3],
  ],
];

const RAW_INCOMPLETE = [
  // Level 1
  [
    [0,0,0,5,0,0],[0,0,0,0,0,0],[0,2,0,0,6,0],
    [0,2,0,0,0,0],[0,0,0,0,0,0],[0,0,3,0,0,5],
    [0,4,0,0,3,0],[0,0,0,0,0,0],[0,0,4,0,0,0],
  ],
  // Level 2
  [
    [2,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],
    [0,0,0,1,0,0],[0,0,0,0,0,0],[0,0,0,0,1,0],
    [0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],
  ],
  // Level 3
  [
    [0,0,1,0,0,3],[5,0,0,0,0,0],[0,0,0,0,0,0],
    [0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,6],
    [0,0,0,0,0,0],[6,0,0,0,0,0],[0,0,0,0,0,0],
  ],
];

const RAW_SOLUTIONS = [
  // Level 1
  [
    [5,6,4,5,4,3],[4,1,3,6,5,2],[3,2,2,1,6,1],
    [3,2,1,6,2,1],[4,1,2,5,3,6],[5,6,3,4,4,5],
    [3,4,2,1,3,2],[2,5,3,6,4,1],[1,6,4,5,5,6],
  ],
  // Level 2
  [
    [2,3,4,5,1,6],[1,4,3,6,2,5],[6,5,2,1,3,4],
    [3,2,6,1,5,4],[4,1,5,2,6,3],[5,6,4,3,1,2],
    [6,1,2,3,4,5],[5,2,1,4,3,6],[4,3,6,5,2,1],
  ],
  // Level 3
  [
    [4,3,1,2,2,3],[5,2,6,3,1,4],[6,1,5,4,6,5],
    [3,2,5,4,3,4],[4,1,6,3,2,5],[5,6,1,2,1,6],
    [5,4,1,6,3,2],[6,3,2,5,4,1],[1,2,3,4,5,6],
  ],
];

// Converts raw scan-line grid into grid[hexIdx][ti] (ti = visual clockwise index 0-5)
// sub-row 0: topLeft→ti5, topRight→ti0
// sub-row 1: midLeft→ti4, midRight→ti1
// sub-row 2: botLeft→ti3, botRight→ti2
const SUB_ROW_TO_TI = [[5,0],[4,1],[3,2]];

function parseRawGrid(raw) {
  const grid = Array.from({length: 9}, () => Array(6).fill(0));
  for (let hexRow = 0; hexRow < 3; hexRow++) {
    for (let subRow = 0; subRow < 3; subRow++) {
      const rowData = raw[hexRow * 3 + subRow];
      for (let hexCol = 0; hexCol < 3; hexCol++) {
        const hexIdx = hexRow * 3 + hexCol;
        const left  = rowData[hexCol * 2];
        const right = rowData[hexCol * 2 + 1];
        grid[hexIdx][SUB_ROW_TO_TI[subRow][0]] = left;
        grid[hexIdx][SUB_ROW_TO_TI[subRow][1]] = right;
      }
    }
  }
  return grid;
}

const COMPLETE   = RAW_COMPLETE.map(parseRawGrid);
const INCOMPLETE = RAW_INCOMPLETE.map(parseRawGrid);
const SOLUTIONS  = RAW_SOLUTIONS.map(parseRawGrid);

// Level 2 arrows: 'cw', 'ccw', or null for each of 9 hexes
const ARROWS = [
  null, // level 1 — no arrows
  // level 2 complete
  [null,'ccw','ccw','cw',null,'ccw','cw','cw',null],
  null, // level 3 — no arrows
];
const ARROWS_INCOMPLETE = [
  null,
  [null,'cw',null,null,null,null,null,null,null],
  null,
];

// Level 3 inner hexagon outlines. Each hexagon = 6 vertex specs:
//   {type:'center', hex:N}         — center of 0-indexed hex N
//   {type:'shared', hexes:[A,B,…]} — vertex shared by those 0-indexed hexes (eps-matched)
const INNER_HEXAGONS = {
  complete: [
    [
      {type:'center', hex:0},
      {type:'shared', hexes:[0,1,4]},
      {type:'center', hex:4},
      {type:'shared', hexes:[3,4,7]},
      {type:'center', hex:3},
      {type:'shared', hexes:[0,3]},
    ],
  ],
  incomplete: [
    [
      {type:'center', hex:3},
      {type:'shared', hexes:[3,4,7]},
      {type:'center', hex:7},
      {type:'shared', hexes:[6,7]},
      {type:'center', hex:6},
      {type:'shared', hexes:[3,6]},
    ],
    [
      {type:'center', hex:4},
      {type:'shared', hexes:[4,5,8]},
      {type:'center', hex:8},
      {type:'shared', hexes:[7,8]},
      {type:'center', hex:7},
      {type:'shared', hexes:[3,4,7]},
    ],
  ],
};

// ── GEOMETRY ─────────────────────────────────────────────────────────────────

// Pointy-top hexagon. Row layout (SW staircase):
//   Row 0 (top):    cols 0,1,2 → offset +1.0 col-widths right
//   Row 1 (middle): cols 0,1,2 → offset +0.5 col-widths right
//   Row 2 (bottom): cols 0,1,2 → no offset
// Hex indices 0-8 map to (gridRow, gridCol): 0→(0,0), 1→(0,1), 2→(0,2),
//                                            3→(1,0), 4→(1,1), 5→(1,2),
//                                            6→(2,0), 7→(2,1), 8→(2,2)

function hexIndexToRowCol(i) {
  return [Math.floor(i / 3), i % 3];
}

function hexCenter(gridRow, gridCol, r, ox, oy) {
  const colW = r * Math.sqrt(3);
  const rowH = r * 1.5;
  const offset = (2 - gridRow) * colW * 0.5;
  return {
    x: ox + offset + gridCol * colW,
    y: oy + gridRow * rowH,
  };
}

// Returns 6 vertices of pointy-top hex, starting from top (angle=90°), going clockwise
function hexVertices(cx, cy, r) {
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (90 - 60 * i); // 90,30,-30,-90,-150,-210 (=150)
    verts.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) });
  }
  return verts;
}

// Center of triangle i (for label placement)
function triCenter(cx, cy, verts, i) {
  const v0 = verts[i];
  const v1 = verts[(i + 1) % 6];
  return {
    x: (cx + v0.x + v1.x) / 3,
    y: (cy + v0.y + v1.y) / 3,
  };
}

// ── SVG HELPERS ──────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function svgText(x, y, content, cls) {
  const t = el('text', { x, y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  t.textContent = content;
  return t;
}

// ── HEX DIRECTION TINT ───────────────────────────────────────────────────────

function drawHexTint(svg, verts, direction) {
  const pts = verts.map(v => `${v.x},${v.y}`).join(' ');
  const cls = direction === 'cw' ? 'hex-tint-cw' : 'hex-tint-ccw';
  svg.appendChild(el('polygon', { points: pts, class: cls }));
}

// ── INNER HEXAGON OUTLINES (Level 3) ─────────────────────────────────────────

function resolveVertex(spec, r, ox, oy) {
  if (spec.type === 'center') {
    const [gr, gc] = hexIndexToRowCol(spec.hex);
    return hexCenter(gr, gc, r, ox, oy);
  }
  // type === 'shared': eps-match across all spec hex vertex lists
  const EPS = r * 0.15;
  const specVerts = spec.hexes.map(hi => {
    const [gr, gc] = hexIndexToRowCol(hi);
    const { x: cx, y: cy } = hexCenter(gr, gc, r, ox, oy);
    return hexVertices(cx, cy, r);
  });

  // Collect all candidate vertices from the first hex that appear in every other spec hex
  const candidates = specVerts[0].filter(v0 =>
    specVerts.slice(1).every(verts =>
      verts.some(v => Math.hypot(v0.x - v.x, v0.y - v.y) < EPS)
    )
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates means a 2-hex edge spec — two hexes share an edge with 2 vertices.
  // The outer-edge vertex is the one NOT shared by any other hex in the grid.
  const specHexSet = new Set(spec.hexes);
  const otherVerts = [];
  for (let hi = 0; hi < 9; hi++) {
    if (specHexSet.has(hi)) continue;
    const [gr, gc] = hexIndexToRowCol(hi);
    const { x: cx, y: cy } = hexCenter(gr, gc, r, ox, oy);
    otherVerts.push(...hexVertices(cx, cy, r));
  }

  const outerCandidate = candidates.find(c =>
    !otherVerts.some(v => Math.hypot(c.x - v.x, c.y - v.y) < EPS)
  );
  return outerCandidate ?? candidates[0];
}

function drawInnerHexagon(svg, vertexSpecs, r, ox, oy) {
  const points = vertexSpecs.map(s => resolveVertex(s, r, ox, oy));
  if (points.some(p => p === null)) return; // geometry mismatch — skip
  const pts = points.map(p => `${p.x},${p.y}`).join(' ');
  svg.appendChild(el('polygon', { points: pts, class: 'inner-hex-outline' }));
}

// ── CONFETTI ──────────────────────────────────────────────────────────────────

const levelSolved = [false, false, false];

function launchConfetti(count, duration) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9a3c','#ff84b7','#00c9c9'];
  const big = count > 150;
  const FADE_MS = 400;

  const pieces = Array.from({length: count}, () => ({
    x:        Math.random() * canvas.width,
    y:        -10 - Math.random() * (big ? 300 : 120),
    w:        (big ? 10 : 7) + Math.random() * (big ? 10 : 7),
    h:        (big ? 5  : 3) + Math.random() * (big ? 8  : 5),
    color:    colors[Math.floor(Math.random() * colors.length)],
    rot:      Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * (big ? 0.25 : 0.15),
    vx:       (Math.random() - 0.5) * (big ? 5 : 2.5),
    vy:       (big ? 4 : 2.5) + Math.random() * (big ? 5 : 3),
    circle:   big && Math.random() < 0.2,
  }));

  let rafId;
  const startTime = performance.now();

  function animate(now) {
    const elapsed  = now - startTime;
    const remaining = duration - elapsed;

    if (remaining <= 0) {
      cancelAnimationFrame(rafId);
      canvas.remove();
      return;
    }

    const alpha = remaining < FADE_MS ? remaining / FADE_MS : 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of pieces) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.rotSpeed;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }

    rafId = requestAnimationFrame(animate);
  }

  rafId = requestAnimationFrame(animate);
}

function playCheer() {
  const actx = new AudioContext();
  const master = actx.createGain();
  master.gain.value = 0.35;
  master.connect(actx.destination);

  // Ascending arpeggio: C5 E5 G5 C6
  [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
    const osc  = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(master);

    const t = actx.currentTime + i * 0.13;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

function playZeldaFanfare() {
  const actx   = new AudioContext();
  const master = actx.createGain();
  master.gain.value = 0.28;
  master.connect(actx.destination);

  // Slight low-pass to soften harsh square-wave edges
  const lpf = actx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 3200;
  lpf.connect(master);

  function staccato(freq, start, dur) {
    const osc  = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0,   start);
    gain.gain.linearRampToValueAtTime(1, start + 0.012);
    gain.gain.setValueAtTime(1,   start + dur - 0.025);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain);
    gain.connect(lpf);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  const t0 = actx.currentTime + 0.04;

  // Quick ascending arpeggio — G major: G4 B4 D5 G5
  staccato(392.00, t0 + 0.000, 0.10);  // G4
  staccato(493.88, t0 + 0.105, 0.10);  // B4
  staccato(587.33, t0 + 0.210, 0.10);  // D5
  staccato(783.99, t0 + 0.315, 0.10);  // G5

  // Brief accent step up
  staccato(987.77, t0 + 0.455, 0.13);  // B5

  // Big held final note (G5 up an octave = G6... soften to D6) with vibrato
  const tFinal  = t0 + 0.63;
  const finalOsc  = actx.createOscillator();
  const finalGain = actx.createGain();
  const vibLfo    = actx.createOscillator();
  const vibDepth  = actx.createGain();

  finalOsc.type = 'square';
  finalOsc.frequency.value = 783.99; // G5

  vibLfo.frequency.value = 6.5;      // ~6.5 Hz vibrato
  vibDepth.gain.value    = 7;        // ±7 Hz pitch wobble
  vibLfo.connect(vibDepth);
  vibDepth.connect(finalOsc.frequency);

  finalGain.gain.setValueAtTime(0,   tFinal);
  finalGain.gain.linearRampToValueAtTime(1, tFinal + 0.02);
  finalGain.gain.setValueAtTime(1,   tFinal + 0.60);
  finalGain.gain.linearRampToValueAtTime(0, tFinal + 0.90);

  finalOsc.connect(finalGain);
  finalGain.connect(lpf);

  vibLfo.start(tFinal);
  finalOsc.start(tFinal);
  vibLfo.stop(tFinal + 0.95);
  finalOsc.stop(tFinal + 0.95);
}

// ── STATE ─────────────────────────────────────────────────────────────────────

// userValues[levelIdx][hexIdx][ti] = 1-9 or 0 (ti = visual clockwise index, matches INCOMPLETE/SOLUTIONS)
const userValues = [
  Array.from({ length: 9 }, () => Array(6).fill(0)),
  Array.from({ length: 9 }, () => Array(6).fill(0)),
  Array.from({ length: 9 }, () => Array(6).fill(0)),
];

let selectedCell = null; // { levelIdx, hexIdx, triIdx, pathEl, labelEl }
let mobileNumbar = null; // assigned in init() after DOM ready
let leftyBtn = null;     // assigned in init() after DOM ready

function updateMobileNumbar() {
  if (!mobileNumbar) return;
  const show = selectedCell && !isGiven(selectedCell.levelIdx, selectedCell.hexIdx, selectedCell.triIdx);
  mobileNumbar.classList.toggle('numbar-visible', !!show);
  if (leftyBtn) leftyBtn.classList.toggle('btn-visible', !!show);
}

// cellElements[levelIdx][hexIdx][ti] = { pathEl, labelEl } for interactive grids
const cellElements = Array.from({ length: 3 }, () =>
  Array.from({ length: 9 }, () => Array(6).fill(null))
);

// navMap[hexIdx][ti][dir] = { hexIdx, triIdx } or null
// dir: 0=ArrowRight, 1=ArrowDown, 2=ArrowLeft, 3=ArrowUp
let navMap = null;

function buildNavMap() {
  const r = 42;
  const pad = 10;
  const ox = pad + r * Math.sqrt(3) * 0.5;
  const oy = pad + r;

  // Compute screen centroid of each cell
  const centroids = [];
  for (let hi = 0; hi < 9; hi++) {
    const [gr, gc] = hexIndexToRowCol(hi);
    const { x: cx, y: cy } = hexCenter(gr, gc, r, ox, oy);
    const verts = hexVertices(cx, cy, r);
    centroids[hi] = [];
    for (let ti = 0; ti < 6; ti++) {
      centroids[hi][ti] = triCenter(cx, cy, verts, ti);
    }
  }

  // Direction vectors: right, down, left, up
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];

  const map = Array.from({ length: 9 }, () =>
    Array.from({ length: 6 }, () => Array(4).fill(null))
  );

  for (let hi = 0; hi < 9; hi++) {
    for (let ti = 0; ti < 6; ti++) {
      const { x: sx, y: sy } = centroids[hi][ti];

      for (let d = 0; d < 4; d++) {
        const { dx, dy } = dirs[d];
        let bestHi = null, bestTi = null, bestScore = Infinity, bestAlign = -1;

        for (let hi2 = 0; hi2 < 9; hi2++) {
          for (let ti2 = 0; ti2 < 6; ti2++) {
            if (hi2 === hi && ti2 === ti) continue;
            const { x: tx, y: ty } = centroids[hi2][ti2];
            const relX = tx - sx;
            const relY = ty - sy;
            const dot = relX * dx + relY * dy;
            if (dot < 0) continue;
            const dist = Math.hypot(relX, relY);
            if (dist < 1e-6) continue;
            const alignment = dot / dist;
            if (alignment < 0.5) continue; // within 60° of direction
            const score = dist / alignment;

            if (score < bestScore - 1e-6 ||
                (score < bestScore + 1e-6 && alignment > bestAlign)) {
              bestScore = score;
              bestAlign = alignment;
              bestHi = hi2;
              bestTi = ti2;
            }
          }
        }

        if (bestHi !== null) {
          map[hi][ti][d] = { hexIdx: bestHi, triIdx: bestTi };
        }
      }
    }
  }

  return map;
}

function isGiven(levelIdx, hexIdx, ti) {
  return INCOMPLETE[levelIdx][hexIdx][ti] !== 0;
}

function selectCell(levelIdx, hexIdx, triIdx, pathEl, labelEl) {
  if (selectedCell) {
    // deselect old
    selectedCell.pathEl.classList.remove('cell-selected');
  }
  if (
    selectedCell &&
    selectedCell.levelIdx === levelIdx &&
    selectedCell.hexIdx === hexIdx &&
    selectedCell.triIdx === triIdx
  ) {
    selectedCell = null;
    updateMobileNumbar();
    return;
  }
  selectedCell = { levelIdx, hexIdx, triIdx, pathEl, labelEl };
  pathEl.classList.add('cell-selected');
  updateMobileNumbar();
}

const ARROW_DIR = { ArrowRight: 0, ArrowDown: 1, ArrowLeft: 2, ArrowUp: 3 };

document.addEventListener('pointerdown', e => {
  if (!selectedCell) return;
  if (e.target.closest('.hex-grid, #mobile-numbar, #lefty-btn')) return;
  selectedCell.pathEl.classList.remove('cell-selected');
  selectedCell = null;
  updateMobileNumbar();
});

document.addEventListener('keydown', e => {
  if (!selectedCell) return;
  const { levelIdx, hexIdx, triIdx, labelEl } = selectedCell;

  if (e.key in ARROW_DIR) {
    e.preventDefault();
    const dest = navMap[hexIdx][triIdx][ARROW_DIR[e.key]];
    if (dest) {
      const cell = cellElements[levelIdx][dest.hexIdx][dest.triIdx];
      if (cell) selectCell(levelIdx, dest.hexIdx, dest.triIdx, cell.pathEl, cell.labelEl);
    }
    return;
  }

  if (isGiven(levelIdx, hexIdx, triIdx)) return;

  if (e.key >= '1' && e.key <= '9') {
    const n = parseInt(e.key);
    userValues[levelIdx][hexIdx][triIdx] = n;
    labelEl.textContent = n;
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    userValues[levelIdx][hexIdx][triIdx] = 0;
    labelEl.textContent = '';
  }
});

// ── DRAWING ───────────────────────────────────────────────────────────────────

function drawGrid(svgEl, levelIdx, gridData, opts) {
  const {
    interactive = false,
    arrows = null,
    innerHexagons = null,
  } = opts;

  const r = 42;
  const pad = 10;
  const ox = pad + r * Math.sqrt(3) * 0.5; // shift for offset rows
  const oy = pad + r;

  // SVG dimensions: 3 cols (offset rows add 0.5) × 3 rows
  // Width:  row-1 hexes span 3 col-widths; offset rows start 0.5 col-width in,
  //         so rightmost edge = ox + 2.5*colW + r*sqrt(3)/2. Use ox + 3*colW as simpler bound.
  // Height: bottom of lowest hex = oy + 2*(1.5r) + r = oy + 4r; add pad.
  const colW = r * Math.sqrt(3);
  const W = colW * 4 + pad * 2;
  const H = r * 5 + pad * 2;
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('width', W);
  svgEl.setAttribute('height', H);

  for (let hi = 0; hi < 9; hi++) {
    const [gr, gc] = hexIndexToRowCol(hi);
    const { x: cx, y: cy } = hexCenter(gr, gc, r, ox, oy);
    const verts = hexVertices(cx, cy, r);

    // Hex outline
    const pts = verts.map(v => `${v.x},${v.y}`).join(' ');
    svgEl.appendChild(el('polygon', { points: pts, class: 'hex-outline' }));

    // Direction tint (drawn before triangles so numbers sit on top)
    if (arrows && arrows[hi]) {
      drawHexTint(svgEl, verts, arrows[hi]);
    }

    // Triangles
    for (let ti = 0; ti < 6; ti++) {
      const v0 = verts[ti];
      const v1 = verts[(ti + 1) % 6];
      const triPts = `${cx},${cy} ${v0.x},${v0.y} ${v1.x},${v1.y}`;

      const given = interactive && isGiven(levelIdx, hi, ti);
      const cls = given ? 'cell-given' : 'cell-empty';
      const pathEl = el('polygon', { points: triPts, class: cls });
      svgEl.appendChild(pathEl);

      // Value label
      const tc = triCenter(cx, cy, verts, ti);
      const val = gridData[hi][ti];
      const displayVal = val !== 0 ? val : (interactive && userValues[levelIdx][hi][ti] !== 0 ? userValues[levelIdx][hi][ti] : '');
      const labelCls = given ? 'tri-label-given' : 'tri-label';
      const labelEl = svgText(tc.x, tc.y, displayVal !== 0 ? displayVal : '', labelCls);
      svgEl.appendChild(labelEl);

      // Interactivity
      if (interactive) {
        cellElements[levelIdx][hi][ti] = { pathEl, labelEl };
        if (!given) {
          pathEl.style.cursor = 'pointer';
          pathEl.addEventListener('click', () => selectCell(levelIdx, hi, ti, pathEl, labelEl));
        }
      }
    }

    // Divider lines (hex spokes)
    for (let ti = 0; ti < 6; ti++) {
      const v = verts[ti];
      svgEl.appendChild(el('line', {
        x1: cx, y1: cy, x2: v.x, y2: v.y,
        class: 'hex-spoke',
      }));
    }

  }

  // Inner hexagon outlines (drawn on top)
  if (innerHexagons) {
    for (const specs of innerHexagons) {
      drawInnerHexagon(svgEl, specs, r, ox, oy);
    }
  }
}

// ── CHECK ─────────────────────────────────────────────────────────────────────

function checkAnswers(levelIdx) {
  const sol = SOLUTIONS[levelIdx];
  const inc = INCOMPLETE[levelIdx];
  let wrong = 0;
  for (let hi = 0; hi < 9; hi++) {
    for (let ti = 0; ti < 6; ti++) {
      if (inc[hi][ti] !== 0) continue; // given cell
      const user = userValues[levelIdx][hi][ti];
      if (user !== sol[hi][ti]) wrong++;
    }
  }
  const resultEl = document.getElementById(`l${levelIdx + 1}-result`);
  if (wrong === 0) {
    resultEl.textContent = 'All correct!';
    resultEl.className = 'check-result correct';
    levelSolved[levelIdx] = true;
    if (levelSolved.every(Boolean)) {
      launchConfetti(450, 5000);
      playZeldaFanfare();
    } else {
      launchConfetti(75, 1000);
      playCheer();
    }
  } else {
    resultEl.textContent = `${wrong} cell${wrong === 1 ? '' : 's'} incorrect`;
    resultEl.className = 'check-result incorrect';
  }
}

// ── DEBUG ─────────────────────────────────────────────────────────────────────

function fillAnswers(levelIdx) {
  const sol = SOLUTIONS[levelIdx];
  const inc = INCOMPLETE[levelIdx];
  for (let hi = 0; hi < 9; hi++) {
    for (let ti = 0; ti < 6; ti++) {
      if (inc[hi][ti] !== 0) continue; // skip givens
      userValues[levelIdx][hi][ti] = sol[hi][ti];
      const cell = cellElements[levelIdx][hi][ti];
      if (cell) cell.labelEl.textContent = sol[hi][ti];
    }
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function init() {
  navMap = buildNavMap();
  mobileNumbar = document.getElementById('mobile-numbar');
  leftyBtn = document.getElementById('lefty-btn');
  const applyLefty = isLefty => {
    mobileNumbar.classList.toggle('numbar-left', isLefty);
    leftyBtn.classList.toggle('btn-left', isLefty);
    leftyBtn.textContent = isLefty ? 'Righty Tighty!' : 'Lefty mode!';
  };
  applyLefty(localStorage.getItem('hexdoku-lefty') === '1');
  leftyBtn.addEventListener('click', () => {
    const isLefty = !mobileNumbar.classList.contains('numbar-left');
    applyLefty(isLefty);
    localStorage.setItem('hexdoku-lefty', isLefty ? '1' : '0');
  });
  mobileNumbar.addEventListener('click', e => {
    const btn = e.target.closest('.numbar-btn');
    if (!btn || !selectedCell) return;
    const { levelIdx, hexIdx, triIdx, labelEl } = selectedCell;
    if (isGiven(levelIdx, hexIdx, triIdx)) return;
    const value = parseInt(btn.dataset.value, 10);
    if (value === 0) {
      userValues[levelIdx][hexIdx][triIdx] = 0;
      labelEl.textContent = '';
    } else {
      userValues[levelIdx][hexIdx][triIdx] = value;
      labelEl.textContent = value;
    }
  });
  const debugMode = window.location.search.includes('debug');

  for (let lvl = 0; lvl < 3; lvl++) {
    const completeEl = document.getElementById(`l${lvl + 1}-complete`);
    const puzzleEl   = document.getElementById(`l${lvl + 1}-puzzle`);

    const completeArrows = lvl === 1 ? ARROWS[1] : null;
    const puzzleArrows   = lvl === 1 ? ARROWS_INCOMPLETE[1] : null;
    const completeInner = lvl === 2 ? INNER_HEXAGONS.complete : null;
    const puzzleInner   = lvl === 2 ? INNER_HEXAGONS.incomplete : null;

    drawGrid(completeEl, lvl, COMPLETE[lvl], {
      interactive: false,
      arrows: completeArrows,
      innerHexagons: completeInner,
    });

    drawGrid(puzzleEl, lvl, INCOMPLETE[lvl], {
      interactive: true,
      arrows: puzzleArrows,
      innerHexagons: puzzleInner,
    });

    const checkBtn = document.getElementById(`check-btn-${lvl + 1}`);
    checkBtn.addEventListener('click', () => checkAnswers(lvl));

    if (debugMode) {
      const fillBtn = document.createElement('button');
      fillBtn.textContent = 'Fill';
      fillBtn.className = 'check-btn';
      fillBtn.addEventListener('click', () => fillAnswers(lvl));
      checkBtn.after(fillBtn);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
