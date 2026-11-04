import { buildIndex, cellStates, sameCells, type CellIndex } from '../core/model';
import { M_BLUE, M_EMPTY, M_RED, type Grade, type Step } from '../core/solver/logic';
import type { FillColor, Puzzle, ThermoState } from '../core/types';
import { cellAt, renderBoard, type BoardView } from './board';

/** 'any' fills with a neutral color: filled, but red/blue not decided yet. */
export type Tool = 'red' | 'blue' | 'any' | 'x' | 'xr' | 'xb';

/** Cell marks (stored in Game.xs): ✕ = empty, red ✕ = not red, blue ✕ = not blue. */
export const MARK_NONE = 0;
export const MARK_X = 1;
export const MARK_NOT_RED = 2;
export const MARK_NOT_BLUE = 3;
const MARK_OF: Partial<Record<Tool, number>> = { x: MARK_X, xr: MARK_NOT_RED, xb: MARK_NOT_BLUE };
/** Right-click gives the counterpart of the current tool. */
const RIGHT_OF: Record<Tool, Tool> = { red: 'blue', blue: 'red', any: 'blue', x: 'blue', xr: 'xb', xb: 'xr' };

interface Snapshot {
  states: ThermoState[];
  xs: Uint8Array;
}

interface Overlay {
  lines?: number[];
  cells?: { cell: number; mask: number }[];
  focus?: number;
  errors?: number[];
}

export interface GameEvents {
  onChange?: () => void;
  onSolved?: (g: Game) => void;
  onMessage?: (text: string, kind?: 'info' | 'good' | 'bad') => void;
}

export class Game {
  puzzle: Puzzle;
  grade: Grade | null;
  states: ThermoState[];
  xs: Uint8Array;
  tool: Tool = 'red';
  /** When on, red/blue/either taps set the whole thermometer's color instead of filling. */
  wholeMode = false;
  solved = false;
  revealed = false;
  hints = 0;
  checks = 0;
  startedAt = performance.now();
  finishedMs: number | null = null;
  private idx: CellIndex;
  private solCells: Uint8Array;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private overlay: Overlay | null = null;
  private overlayTimer: number | undefined;
  private drag: null | {
    mode: 'x' | 'fill' | 'unfill' | 'mark';
    color: FillColor;
    xVal: number;
    before: Snapshot;
  } = null;

  constructor(
    private svg: SVGSVGElement,
    puzzle: Puzzle,
    grade: Grade | null,
    private ev: GameEvents = {},
  ) {
    this.puzzle = puzzle;
    this.grade = grade;
    this.states = puzzle.thermos.map(() => ({ color: 'U', level: 0 }));
    this.xs = new Uint8Array(puzzle.size * puzzle.size);
    this.idx = buildIndex(puzzle.size, puzzle.thermos);
    this.solCells = cellStates(puzzle.size, puzzle.thermos, puzzle.solution);
    this.render();
  }

  get elapsedMs(): number {
    return this.finishedMs ?? performance.now() - this.startedAt;
  }

  private snap(): Snapshot {
    return { states: this.states.map((s) => ({ ...s })), xs: this.xs.slice() };
  }

  private restore(s: Snapshot) {
    this.states = s.states.map((x) => ({ ...x }));
    this.xs = s.xs.slice();
  }

  private sameSnap(a: Snapshot, b: Snapshot) {
    return sameCells(a.xs, b.xs) && a.states.every((s, i) => s.level === b.states[i].level && s.color === b.states[i].color);
  }

  render(): void {
    const v: BoardView = {
      puzzle: this.puzzle,
      states: this.states,
      xs: this.xs,
      highlightLines: this.overlay?.lines,
      highlightCells: this.overlay?.cells,
      focusCell: this.overlay?.focus,
      errorCells: this.overlay?.errors,
    };
    renderBoard(this.svg, v);
  }

  setOverlay(o: Overlay | null, ms = 0): void {
    window.clearTimeout(this.overlayTimer);
    this.overlay = o;
    this.render();
    if (o && ms) this.overlayTimer = window.setTimeout(() => this.setOverlay(null), ms);
  }

  // ---- input -------------------------------------------------------------

  pointerDown(e: PointerEvent): void {
    if (this.solved) return;
    const n = this.puzzle.size;
    const cell = cellAt(this.svg, n, e.clientX, e.clientY);
    if (cell < 0) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    let action: Tool = this.tool;
    if (e.shiftKey || e.button === 1) action = 'x';
    else if (e.altKey) action = 'any';
    else if (e.button === 2) action = RIGHT_OF[this.tool];
    const before = this.snap();
    this.setOverlay(null);
    const whole = this.wholeMode || e.ctrlKey || e.metaKey;
    const mark = MARK_OF[action];
    if (whole && mark === undefined) {
      // Mark the whole thermometer's color without filling. Same color again clears it.
      const want: FillColor = action === 'red' ? 'R' : action === 'blue' ? 'B' : 'U';
      const t = this.idx.thermo[cell];
      const color: FillColor = this.states[t].color === want ? 'U' : want;
      this.drag = { mode: 'mark', color, xVal: 0, before };
      this.states[t].color = color;
    } else if (mark !== undefined) {
      const xVal = this.xs[cell] === mark ? MARK_NONE : mark;
      this.drag = { mode: 'x', color: 'R', xVal, before };
      this.applyX(cell, xVal);
    } else {
      const color: FillColor = action === 'red' ? 'R' : action === 'blue' ? 'B' : 'U';
      const t = this.idx.thermo[cell];
      const p = this.idx.pos[cell];
      const s = this.states[t];
      const unfill = s.level === p + 1 && (color === 'U' || s.color === color);
      this.drag = { mode: unfill ? 'unfill' : 'fill', color, xVal: 0, before };
      this.applyFill(cell, color, unfill);
    }
    this.render();
  }

  pointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    const cell = cellAt(this.svg, this.puzzle.size, e.clientX, e.clientY);
    if (cell < 0) return;
    const d = this.drag;
    if (d.mode === 'x') this.applyX(cell, d.xVal);
    else if (d.mode === 'mark') this.states[this.idx.thermo[cell]].color = d.color;
    else if (d.mode === 'fill') {
      const t = this.idx.thermo[cell];
      const p = this.idx.pos[cell];
      const s = this.states[t];
      if ((d.color !== 'U' && s.color !== d.color) || s.level < p + 1) this.applyFill(cell, d.color, false);
    } else {
      const t = this.idx.thermo[cell];
      const p = this.idx.pos[cell];
      if (this.states[t].level > p) this.states[t].level = p;
    }
    this.render();
  }

  pointerUp(): void {
    if (!this.drag) return;
    const before = this.drag.before;
    this.drag = null;
    if (!this.sameSnap(before, this.snap())) {
      this.undoStack.push(before);
      this.redoStack = [];
      this.afterChange();
    }
  }

  private applyFill(cell: number, color: FillColor, unfill: boolean) {
    const t = this.idx.thermo[cell];
    const p = this.idx.pos[cell];
    const s = this.states[t];
    if (unfill) {
      s.level = p;
      return;
    }
    const cells = this.puzzle.thermos[t].cells;
    if (color === 'U') {
      // "Either" fills without choosing a color, keeping any color already marked.
      s.level = p + 1;
      this.clearMarks(cells, p + 1);
      return;
    }
    // Clicking inside an already-filled part with another color recolors the whole
    // thermometer (it can only hold one color) and keeps its level.
    if (s.color !== color && p < s.level) {
      s.color = color;
      this.clearMarks(cells, s.level);
      return;
    }
    this.states[t] = { color, level: p + 1 };
    this.clearMarks(cells, p + 1);
  }

  /** Coloring a cell in removes any ✕ on it: clear marks on the first `upTo` cells. */
  private clearMarks(cells: number[], upTo: number) {
    for (let k = 0; k < upTo; k++) this.xs[cells[k]] = MARK_NONE;
  }

  private applyX(cell: number, val: number) {
    // Not red + not blue = empty: a red ✕ on a blue ✕ (or vice versa) becomes a plain ✕.
    const cur = this.xs[cell];
    if ((val === MARK_NOT_RED && cur === MARK_NOT_BLUE) || (val === MARK_NOT_BLUE && cur === MARK_NOT_RED)) val = MARK_X;
    const t = this.idx.thermo[cell];
    const p = this.idx.pos[cell];
    const s = this.states[t];
    // A color ✕ on a bulb means the thermometer is the other color (or empty, where color
    // doesn't matter), so it becomes a whole-thermometer color mark instead.
    if (p === 0 && (val === MARK_NOT_RED || val === MARK_NOT_BLUE)) {
      s.color = val === MARK_NOT_RED ? 'B' : 'R';
      this.xs[cell] = MARK_NONE;
      this.clearMarks(this.puzzle.thermos[t].cells, s.level);
      return;
    }
    // ✕ empties the cell; a color ✕ empties it only if the thermometer is filled with that color.
    const empties = val === MARK_X || (val === MARK_NOT_RED && s.color === 'R') || (val === MARK_NOT_BLUE && s.color === 'B');
    if (empties && s.level > p) s.level = p;
    this.xs[cell] = val;
  }

  private afterChange() {
    this.ev.onChange?.();
    const cells = cellStates(this.puzzle.size, this.puzzle.thermos, this.states);
    if (!this.solved && sameCells(cells, this.solCells)) {
      this.solved = true;
      this.finishedMs = performance.now() - this.startedAt;
      this.ev.onMessage?.(this.revealed ? 'Solution revealed.' : 'Solved!', 'good');
      if (!this.revealed) this.ev.onSolved?.(this);
    }
  }

  // ---- toolbar actions ---------------------------------------------------

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap());
    this.restore(s);
    this.setOverlay(null);
    this.ev.onChange?.();
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap());
    this.restore(s);
    this.setOverlay(null);
    this.afterChange();
  }

  reset(): void {
    if (this.solved && !this.revealed) return;
    this.undoStack.push(this.snap());
    this.states = this.puzzle.thermos.map(() => ({ color: 'U', level: 0 }));
    this.xs.fill(0);
    this.setOverlay(null);
    this.ev.onChange?.();
  }

  reveal(): void {
    this.undoStack.push(this.snap());
    this.revealed = true;
    // An empty thermometer's stored color is arbitrary, so show it unmarked.
    this.states = this.puzzle.solution.map((s) => ({ color: s.level ? s.color : 'U', level: s.level }));
    this.xs.fill(0);
    this.setOverlay(null);
    this.afterChange();
  }

  /** Cells that contradict the solution (wrong fill, wrong color, or ✕ on a filled cell). */
  mistakes(): number[] {
    const cur = cellStates(this.puzzle.size, this.puzzle.thermos, this.states);
    const out: number[] = [];
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === 3) {
        if (!this.solCells[i]) out.push(i);
      } else if (cur[i] && cur[i] !== this.solCells[i]) out.push(i);
      else if (!cur[i] && this.xs[i] === MARK_X && this.solCells[i]) out.push(i);
      if (out[out.length - 1] === i) continue;
      if ((this.xs[i] === MARK_NOT_RED && this.solCells[i] === 1) || (this.xs[i] === MARK_NOT_BLUE && this.solCells[i] === 2))
        out.push(i);
    }
    // A color mark is wrong if the solution fills that thermometer with the other color.
    this.states.forEach((st, t) => {
      const sol = this.puzzle.solution[t];
      const bulb = this.puzzle.thermos[t].cells[0];
      if (st.color !== 'U' && sol.level > 0 && sol.color !== st.color && !out.includes(bulb)) out.push(bulb);
    });
    return out;
  }

  check(): void {
    this.checks++;
    const m = this.mistakes();
    if (!m.length) this.ev.onMessage?.('No mistakes so far.', 'good');
    else this.ev.onMessage?.(`${m.length} cell${m.length > 1 ? 's' : ''} conflict with the solution.`, 'bad');
    this.setOverlay({ errors: m }, 3000);
  }

  hint(): void {
    if (this.solved) return;
    this.hints++;
    const m = this.mistakes();
    if (m.length) {
      this.ev.onMessage?.('Fix the highlighted cells first.', 'bad');
      this.setOverlay({ errors: m }, 3000);
      return;
    }
    const step = this.nextStep();
    if (!step) {
      this.ev.onMessage?.(
        this.grade?.solved === false
          ? 'The logic solver gets stuck here. This puzzle needs guessing (see the solve path).'
          : 'No hint available.',
        'info',
      );
      return;
    }
    this.ev.onMessage?.(step.note, 'info');
    this.setOverlay({ lines: step.lines, cells: step.cells, focus: step.focus });
  }

  /** The first solver step whose conclusions aren't yet reflected on the board. */
  nextStep(): Step | null {
    if (!this.grade) return null;
    const cur = cellStates(this.puzzle.size, this.puzzle.thermos, this.states);
    const known = this.playerMasks(cur);
    // Satisfied when the player has pinned the cell down at least as far as the step did.
    // An unmarked empty cell counts as "empty" so hints don't nag about ✕ marks.
    const ok = (cell: number, mask: number) => (known[cell] & ~mask) === 0 || (mask === M_EMPTY && cur[cell] === 0);
    return this.grade.steps.find((st) => st.cells.some(({ cell, mask }) => !ok(cell, mask))) ?? null;
  }

  /** What the board says about each cell, as a solver-style mask (empty/red/blue bits). */
  private playerMasks(cur: Uint8Array): Uint8Array {
    const all = M_EMPTY | M_RED | M_BLUE;
    const out = new Uint8Array(cur.length).fill(all);
    for (let i = 0; i < cur.length; i++) {
      const s = cur[i];
      if (s === 1) out[i] = M_RED;
      else if (s === 2) out[i] = M_BLUE;
      else if (s === 3) out[i] = M_RED | M_BLUE;
      const m = this.xs[i];
      if (m === MARK_X) out[i] &= M_EMPTY;
      else if (m === MARK_NOT_RED) out[i] &= ~M_RED;
      else if (m === MARK_NOT_BLUE) out[i] &= ~M_BLUE;
    }
    this.states.forEach((st, t) => {
      if (st.color === 'U') return;
      const drop = st.color === 'R' ? M_BLUE : M_RED;
      for (const c of this.puzzle.thermos[t].cells) if (out[c] & ~drop) out[c] &= ~drop;
    });
    return out;
  }

  showStep(step: Step): void {
    this.setOverlay({ lines: step.lines, cells: step.cells, focus: step.focus });
  }
}
