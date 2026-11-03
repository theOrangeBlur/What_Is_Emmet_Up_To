import { clueOf } from '../model';
import type { ClueKind, PuzzleCore, ThermoState } from '../types';

/**
 * Constraint model. Each thermometer t of length L has 2L+1 options:
 *   o = 0         → empty
 *   o = 1..L      → red, level o
 *   o = L+1..2L   → blue, level o-L
 * Each clued line is a sum constraint: sum over touching thermos of contrib[o] == value.
 */
export interface LineCon {
  line: number;
  kind: ClueKind;
  value: number;
  /** Thermometers touching the line. */
  ts: number[];
  /** contrib[i][o]: what option o of ts[i] adds to this line's clued quantity. */
  contrib: Int8Array[];
}

export interface CSP {
  n: number;
  nT: number;
  lens: number[];
  /** Offset of thermo t's options in a flat domain array. */
  off: number[];
  total: number;
  cons: LineCon[];
  /** Constraint indices touching each thermo. */
  consOfT: number[][];
}

/** Domain: dom[off[t] + o] = 1 if option o of thermo t is still possible. */
export type Domain = Uint8Array;

export const optColor = (o: number, L: number): 0 | 1 | 2 => (o === 0 ? 0 : o <= L ? 1 : 2);
export const optLevel = (o: number, L: number): number => (o === 0 ? 0 : o <= L ? o : o - L);

export function optToState(o: number, L: number): ThermoState {
  return { color: optColor(o, L) === 2 ? 'B' : 'R', level: optLevel(o, L) };
}

export function stateToOpt(s: ThermoState, L: number): number {
  if (s.level === 0) return 0;
  return s.color === 'R' ? s.level : L + s.level;
}

export function buildCSP(p: PuzzleCore): CSP {
  const n = p.size;
  const lens = p.thermos.map((t) => t.cells.length);
  const off: number[] = [];
  let total = 0;
  for (const L of lens) {
    off.push(total);
    total += 2 * L + 1;
  }
  // positions of each thermo on each line
  const onLine: Map<number, number[]>[] = p.thermos.map((t) => {
    const m = new Map<number, number[]>();
    t.cells.forEach((c, pos) => {
      for (const line of [Math.floor(c / n), n + (c % n)]) {
        if (!m.has(line)) m.set(line, []);
        m.get(line)!.push(pos);
      }
    });
    return m;
  });

  const cons: LineCon[] = [];
  const consOfT: number[][] = p.thermos.map(() => []);
  for (let line = 0; line < 2 * n; line++) {
    const clue = clueOf(p, line);
    if (clue.kind === 'none') continue;
    const ts: number[] = [];
    const contrib: Int8Array[] = [];
    p.thermos.forEach((_, t) => {
      const positions = onLine[t].get(line);
      if (!positions) return;
      const L = lens[t];
      const arr = new Int8Array(2 * L + 1);
      for (let o = 0; o <= 2 * L; o++) {
        const lv = optLevel(o, L);
        const col = optColor(o, L);
        let cnt = 0;
        for (const pos of positions) if (pos < lv) cnt++;
        arr[o] =
          clue.kind === 'black' ? cnt : clue.kind === 'red' ? (col === 1 ? cnt : 0) : col === 2 ? cnt : 0;
      }
      ts.push(t);
      contrib.push(arr);
    });
    const ci = cons.length;
    cons.push({ line, kind: clue.kind, value: clue.value, ts, contrib });
    for (const t of ts) consOfT[t].push(ci);
  }
  return { n, nT: lens.length, lens, off, total, cons, consOfT };
}

export function fullDomain(csp: CSP): Domain {
  return new Uint8Array(csp.total).fill(1);
}

export function aliveCount(csp: CSP, dom: Domain, t: number): number {
  const o0 = csp.off[t];
  const sz = 2 * csp.lens[t] + 1;
  let k = 0;
  for (let o = 0; o < sz; o++) k += dom[o0 + o];
  return k;
}

/**
 * One pass of bounds reasoning on a constraint. Returns the changed thermos,
 * or null on contradiction.
 */
export function boundsOnce(csp: CSP, dom: Domain, ci: number): number[] | null {
  const con = csp.cons[ci];
  const k = con.ts.length;
  const mins = new Array<number>(k);
  const maxs = new Array<number>(k);
  let sumMin = 0;
  let sumMax = 0;
  for (let i = 0; i < k; i++) {
    const t = con.ts[i];
    const o0 = csp.off[t];
    const sz = 2 * csp.lens[t] + 1;
    let mn = 1e9;
    let mx = -1;
    for (let o = 0; o < sz; o++) {
      if (!dom[o0 + o]) continue;
      const c = con.contrib[i][o];
      if (c < mn) mn = c;
      if (c > mx) mx = c;
    }
    if (mx < 0) return null;
    mins[i] = mn;
    maxs[i] = mx;
    sumMin += mn;
    sumMax += mx;
  }
  const v = con.value;
  if (sumMin > v || sumMax < v) return null;
  const changed: number[] = [];
  for (let i = 0; i < k; i++) {
    const lo = v - (sumMax - maxs[i]);
    const hi = v - (sumMin - mins[i]);
    if (lo <= mins[i] && hi >= maxs[i]) continue;
    const t = con.ts[i];
    const o0 = csp.off[t];
    const sz = 2 * csp.lens[t] + 1;
    let ch = false;
    let left = 0;
    for (let o = 0; o < sz; o++) {
      if (!dom[o0 + o]) continue;
      const c = con.contrib[i][o];
      if (c < lo || c > hi) {
        dom[o0 + o] = 0;
        ch = true;
      } else left++;
    }
    if (!left) return null;
    if (ch) changed.push(t);
  }
  return changed;
}

/** Run bounds reasoning to a fixpoint. Returns false on contradiction. */
export function propagate(csp: CSP, dom: Domain, initial?: number[]): boolean {
  const q = initial ? [...initial] : csp.cons.map((_, i) => i);
  const inQ = new Uint8Array(csp.cons.length);
  for (const c of q) inQ[c] = 1;
  while (q.length) {
    const ci = q.pop()!;
    inQ[ci] = 0;
    const changed = boundsOnce(csp, dom, ci);
    if (changed === null) return false;
    for (const t of changed)
      for (const c2 of csp.consOfT[t])
        if (!inQ[c2]) {
          inQ[c2] = 1;
          q.push(c2);
        }
  }
  return true;
}
