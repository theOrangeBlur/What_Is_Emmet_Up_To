import type { CellState, Clue, ClueKind, PuzzleCore, Thermo, ThermoState } from './types';

/** Lines are numbered 0..n-1 for rows and n..2n-1 for columns. */
export function lineName(line: number, n: number): string {
  return line < n ? `Row ${line + 1}` : `Column ${line - n + 1}`;
}

export function cellName(cell: number, n: number): string {
  return `R${Math.floor(cell / n) + 1}C${(cell % n) + 1}`;
}

export function clueOf(p: PuzzleCore, line: number): Clue {
  return line < p.size ? p.rowClues[line] : p.colClues[line - p.size];
}

export function setClueOf(p: PuzzleCore, line: number, clue: Clue): void {
  if (line < p.size) p.rowClues[line] = clue;
  else p.colClues[line - p.size] = clue;
}

export function clueLabel(c: Clue): string {
  return c.kind === 'none' ? 'blank' : `${c.kind} ${c.value}`;
}

export interface CellIndex {
  /** Thermometer id per cell. */
  thermo: Int32Array;
  /** Position of the cell within its thermometer (0 = bulb). */
  pos: Int32Array;
}

export function buildIndex(n: number, thermos: Thermo[]): CellIndex {
  const thermo = new Int32Array(n * n).fill(-1);
  const pos = new Int32Array(n * n).fill(-1);
  thermos.forEach((t, id) =>
    t.cells.forEach((c, p) => {
      thermo[c] = id;
      pos[c] = p;
    }),
  );
  return { thermo, pos };
}

/** Expand thermometer fills into per-cell states. */
export function cellStates(n: number, thermos: Thermo[], states: ThermoState[]): Uint8Array {
  const out = new Uint8Array(n * n);
  thermos.forEach((t, id) => {
    const s = states[id];
    const v: CellState = s.color === 'R' ? 1 : s.color === 'B' ? 2 : 3;
    for (let p = 0; p < s.level; p++) out[t.cells[p]] = v;
  });
  return out;
}

export interface LineCounts {
  red: number[];
  blue: number[];
  total: number[];
}

export function lineCounts(n: number, cells: Uint8Array): LineCounts {
  const red = new Array(2 * n).fill(0);
  const blue = new Array(2 * n).fill(0);
  const total = new Array(2 * n).fill(0);
  for (let i = 0; i < n * n; i++) {
    const s = cells[i];
    if (!s) continue;
    const r = Math.floor(i / n);
    const c = n + (i % n);
    total[r]++;
    total[c]++;
    if (s === 1) {
      red[r]++;
      red[c]++;
    } else if (s === 2) {
      blue[r]++;
      blue[c]++;
    }
  }
  return { red, blue, total };
}

export function countFor(kind: ClueKind, counts: LineCounts, line: number): number {
  if (kind === 'red') return counts.red[line];
  if (kind === 'blue') return counts.blue[line];
  return counts.total[line];
}

export function sameCells(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function emptyStates(thermos: Thermo[]): ThermoState[] {
  return thermos.map(() => ({ color: 'U', level: 0 }));
}

export function cloneCore(p: PuzzleCore): PuzzleCore {
  return {
    size: p.size,
    thermos: p.thermos,
    rowClues: p.rowClues.map((c) => ({ ...c })),
    colClues: p.colClues.map((c) => ({ ...c })),
  };
}
