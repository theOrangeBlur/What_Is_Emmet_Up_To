import { buildIndex, cellStates, clueOf, countFor, lineCounts } from '../core/model';
import { M_BLUE, M_EMPTY, M_RED } from '../core/solver/logic';
import type { Puzzle, ThermoState } from '../core/types';

export const CELL = 40;
const MARGIN = 34;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BoardView {
  puzzle: Puzzle;
  states: ThermoState[];
  xs: Uint8Array;
  highlightLines?: number[];
  highlightCells?: { cell: number; mask: number }[];
  focusCell?: number;
  errorCells?: number[];
  /** Faded preview of a move: a fill color (R/B) or a ✕ (X) per cell. */
  ghostCells?: GhostCell[];
}

export interface GhostCell {
  cell: number;
  kind: 'R' | 'B' | 'X';
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function boardGeometry(n: number) {
  const size = MARGIN + n * CELL + 6;
  return { size, origin: MARGIN };
}

/** Map a client point to a cell index, or -1. */
export function cellAt(svg: SVGSVGElement, n: number, clientX: number, clientY: number): number {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return -1;
  const p = pt.matrixTransform(ctm.inverse());
  const c = Math.floor((p.x - MARGIN) / CELL);
  const r = Math.floor((p.y - MARGIN) / CELL);
  if (r < 0 || c < 0 || r >= n || c >= n) return -1;
  return r * n + c;
}

export function renderBoard(svg: SVGSVGElement, v: BoardView): void {
  const { puzzle: p } = v;
  const n = p.size;
  const { size, origin: O } = boardGeometry(n);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.replaceChildren();

  const cx = (cell: number) => O + (cell % n) * CELL + CELL / 2;
  const cy = (cell: number) => O + Math.floor(cell / n) * CELL + CELL / 2;

  // background + highlights
  svg.append(el('rect', { x: O, y: O, width: n * CELL, height: n * CELL, class: 'grid-bg' }));
  for (const line of v.highlightLines ?? []) {
    if (line < n) svg.append(el('rect', { x: O - MARGIN, y: O + line * CELL, width: n * CELL + MARGIN, height: CELL, class: 'hl-line' }));
    else svg.append(el('rect', { x: O + (line - n) * CELL, y: O - MARGIN, width: CELL, height: n * CELL + MARGIN, class: 'hl-line' }));
  }

  // grid lines
  const grid = el('g', { class: 'grid' });
  for (let i = 0; i <= n; i++) {
    grid.append(el('line', { x1: O, y1: O + i * CELL, x2: O + n * CELL, y2: O + i * CELL }));
    grid.append(el('line', { x1: O + i * CELL, y1: O, x2: O + i * CELL, y2: O + n * CELL }));
  }
  svg.append(grid);

  // thermometers
  const tubeW = CELL * 0.38;
  const bulbR = CELL * 0.34;
  const fillW = CELL * 0.22;
  const fillR = CELL * 0.24;
  // How far (in cells) a tube or fill runs past the last cell's center. Round caps add half the
  // stroke width on top, so these keep every end inside its own cell with a small gap.
  const tubeTip = 0.15; // + 0.19 cap = 0.34 of the cell's 0.5 half-width
  const fillTip = 0.15;
  // A partial fill stops just short of the next cell, so its cap doesn't spill over.
  const fillStep = 0.5 - fillW / CELL / 2 - 0.04;
  const tubes = el('g', { class: 'tubes' });
  const fills = el('g', { class: 'fills' });
  p.thermos.forEach((t, id) => {
    const pts = t.cells.map((c) => [cx(c), cy(c)] as [number, number]);
    const last = pts.length - 1;
    const tipExt = (k: number, amount: number): [number, number] => {
      // point `amount` cells beyond pts[k] toward pts[k+1] (or continuing the last segment)
      const [x, y] = pts[k];
      let dx: number;
      let dy: number;
      if (k < last) {
        dx = pts[k + 1][0] - x;
        dy = pts[k + 1][1] - y;
      } else if (k > 0) {
        dx = x - pts[k - 1][0];
        dy = y - pts[k - 1][1];
      } else return [x, y];
      const len = Math.hypot(dx, dy);
      return [x + (dx / len) * CELL * amount, y + (dy / len) * CELL * amount];
    };
    const path = (arr: [number, number][]) => arr.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const s = v.states[id];
    const tint = s.color === 'R' ? ' tint-red' : s.color === 'B' ? ' tint-blue' : '';
    if (pts.length > 1) {
      tubes.append(el('path', { d: path([...pts, tipExt(last, tubeTip)]), class: `tube${tint}`, 'stroke-width': tubeW }));
    }
    tubes.append(el('circle', { cx: pts[0][0], cy: pts[0][1], r: bulbR, class: `tube-bulb${tint}` }));

    if (s.level > 0) {
      const cls = s.color === 'R' ? 'fill-red' : s.color === 'B' ? 'fill-blue' : 'fill-any';
      if (pts.length > 1) {
        const seg = pts.slice(0, s.level);
        const end = s.level - 1 === last ? tipExt(last, fillTip) : tipExt(s.level - 1, fillStep);
        fills.append(el('path', { d: path([...seg, end]), class: `fill ${cls}`, 'stroke-width': fillW }));
      }
      fills.append(el('circle', { cx: pts[0][0], cy: pts[0][1], r: fillR, class: `fill-bulb ${cls}` }));
    }
  });
  svg.append(tubes, fills);

  // ghost preview: each cell as a faded piece of fill (bulb dot, or a segment from the
  // previous cell), so a run of them grows along the thermometer like a real fill
  if (v.ghostCells?.length) {
    const idx = buildIndex(n, p.thermos);
    const ghosts = el('g', { class: 'ghosts' });
    for (const { cell, kind } of v.ghostCells) {
      const x = cx(cell);
      const y = cy(cell);
      if (kind === 'X') {
        const d = CELL * 0.14;
        ghosts.append(el('path', { d: `M${x - d},${y - d}L${x + d},${y + d}M${x + d},${y - d}L${x - d},${y + d}`, class: 'ghost-x' }));
        continue;
      }
      const cls = kind === 'R' ? 'ghost ghost-red' : 'ghost ghost-blue';
      const t = idx.thermo[cell];
      const pos = idx.pos[cell];
      if (pos === 0) ghosts.append(el('circle', { cx: x, cy: y, r: fillR, class: cls }));
      else {
        const prev = p.thermos[t].cells[pos - 1];
        ghosts.append(el('path', { d: `M${cx(prev)},${cy(prev)}L${x},${y}`, class: cls, 'stroke-width': fillW, fill: 'none' }));
      }
    }
    svg.append(ghosts);
  }

  // X marks
  const marks = el('g', { class: 'xmarks' });
  const filled = cellStates(n, p.thermos, v.states);
  v.xs.forEach((x, cell) => {
    if (!x || (x === 1 && filled[cell])) return;
    // Color ✕ on a filled cell sits small in the corner so the fill stays readable.
    const small = filled[cell] !== 0;
    const X = small ? cx(cell) + CELL * 0.3 : cx(cell);
    const Y = small ? cy(cell) - CELL * 0.3 : cy(cell);
    const d = CELL * (small ? 0.08 : 0.14);
    const cls = x === 2 ? 'xm-red' : x === 3 ? 'xm-blue' : 'xm';
    marks.append(el('path', { d: `M${X - d},${Y - d}L${X + d},${Y + d}M${X + d},${Y - d}L${X - d},${Y + d}`, class: cls }));
  });
  svg.append(marks);

  // hint / error overlays
  const over = el('g', { class: 'overlay' });
  for (const { cell, mask } of v.highlightCells ?? []) {
    const cls =
      mask === M_EMPTY ? 'hint-empty'
      : mask === M_RED ? 'hint-red'
      : mask === M_BLUE ? 'hint-blue'
      : mask === (M_RED | M_BLUE) ? 'hint-filled'
      : mask === (M_EMPTY | M_BLUE) ? 'hint-notred'
      : mask === (M_EMPTY | M_RED) ? 'hint-notblue'
      : 'hint-filled';
    over.append(el('rect', { x: O + (cell % n) * CELL + 3, y: O + Math.floor(cell / n) * CELL + 3, width: CELL - 6, height: CELL - 6, rx: 6, class: `hint ${cls}` }));
  }
  if (v.focusCell !== undefined) {
    const cell = v.focusCell;
    over.append(el('rect', { x: O + (cell % n) * CELL + 1, y: O + Math.floor(cell / n) * CELL + 1, width: CELL - 2, height: CELL - 2, class: 'focus' }));
  }
  for (const cell of v.errorCells ?? []) {
    over.append(el('rect', { x: O + (cell % n) * CELL + 2, y: O + Math.floor(cell / n) * CELL + 2, width: CELL - 4, height: CELL - 4, class: 'error' }));
  }
  svg.append(over);

  // outer border
  svg.append(el('rect', { x: O, y: O, width: n * CELL, height: n * CELL, class: 'border' }));

  // clues
  const counts = lineCounts(n, filled);
  const clues = el('g', { class: 'clues' });
  for (let line = 0; line < 2 * n; line++) {
    const clue = clueOf(p, line);
    if (clue.kind === 'none') continue;
    const have = countFor(clue.kind, counts, line);
    const state = have === clue.value ? ' done' : have > clue.value ? ' over' : '';
    const x = line < n ? O - MARGIN / 2 : O + (line - n) * CELL + CELL / 2;
    const y = line < n ? O + line * CELL + CELL / 2 : O - MARGIN / 2;
    if (state === ' over') clues.append(el('circle', { cx: x, cy: y, r: 13, class: 'over-ring' }));
    const t = el('text', { x, y, class: `clue clue-${clue.kind}${state}` });
    t.textContent = String(clue.value);
    clues.append(t);
  }
  svg.append(clues);
}
