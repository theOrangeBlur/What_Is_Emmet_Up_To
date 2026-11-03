import { buildIndex, cellName, clueLabel, clueOf, lineName } from '../model';
import type { PuzzleCore } from '../types';
import {
  aliveCount,
  boundsOnce,
  buildCSP,
  fullDomain,
  optColor,
  optLevel,
  propagate,
  type CSP,
  type Domain,
} from './csp';

/** Cell knowledge bitmask: 1 = could be empty, 2 = could be red, 4 = could be blue. */
export const M_EMPTY = 1;
export const M_RED = 2;
export const M_BLUE = 4;

export const TIER_NAMES = [
  '',
  'Saturation',
  'Line bounds',
  'Line combinations',
  'Crossing lines',
  'Contradiction',
] as const;
export const TIER_WEIGHTS = [0, 1, 2, 4, 8, 16];

/** Score of one step. A contradiction costs more the longer its chain is. */
export function stepWeight(s: Step): number {
  return s.tier === 5 ? 8 + 2 * (s.chain ?? 4) : TIER_WEIGHTS[s.tier];
}

export interface Step {
  tier: number;
  lines: number[];
  /** Cells whose knowledge changed, with their new mask. */
  cells: { cell: number; mask: number }[];
  /** Hypothesis cell for contradiction steps. */
  focus?: number;
  /**
   * Lines this jump has to hold at once: 1 for a line combination, 2 for crossing lines,
   * and for a contradiction the line counts it follows, including the one that breaks.
   */
  chain?: number;
  note: string;
}

export interface Grade {
  solved: boolean;
  maxTier: number;
  score: number;
  label: string;
  /** Clues within 1 of 0 or of the line length: they give cells away. */
  extremes: number;
  /** Number of steps per tier (index = tier). */
  techCounts: number[];
  /** Steps that just count along one row or column (tiers 1-2). */
  counting: number;
  /** Steps that need more than counting one line: combinations, crossing lines, contradictions (tiers 3-5). */
  jumps: number;
  /** jumps / all steps. */
  jumpShare: number;
  /** Longest chain of any jump, in lines (0 if there are no jumps). */
  maxChain: number;
  steps: Step[];
  ms: number;
}

/**
 * Labels by logic jumps (steps beyond counting one line) and how many lines the widest
 * jump has to hold at once (its chain): 1 for a line combination, 2 for crossing lines,
 * the full chain for a contradiction.
 */
export const BANDS = {
  medium: { jumps: 2, chain: 2 },
  hard: { jumps: 4, chain: 4 },
} as const;

export function difficultyLabel(solved: boolean, jumps: number, maxChain: number): string {
  if (!solved) return 'Needs guessing';
  if (jumps === 0) return 'Easy';
  if (jumps <= BANDS.medium.jumps && maxChain <= BANDS.medium.chain) return 'Medium';
  if (jumps <= BANDS.hard.jumps && maxChain <= BANDS.hard.chain) return 'Hard';
  return 'Expert';
}

export function extremeClues(p: PuzzleCore, margin = 1): number {
  return [...p.rowClues, ...p.colClues].filter(
    (c) => c.kind !== 'none' && (c.value <= margin || c.value >= p.size - margin),
  ).length;
}

export function cellMasks(csp: CSP, p: PuzzleCore, dom: Domain): Uint8Array {
  const masks = new Uint8Array(p.size * p.size);
  p.thermos.forEach((th, t) => {
    const L = csp.lens[t];
    const o0 = csp.off[t];
    for (let o = 0; o <= 2 * L; o++) {
      if (!dom[o0 + o]) continue;
      const lv = optLevel(o, L);
      const col = optColor(o, L) === 1 ? M_RED : M_BLUE;
      for (let pos = 0; pos < L; pos++) masks[th.cells[pos]] |= pos < lv ? col : M_EMPTY;
    }
  });
  return masks;
}

function restrict(csp: CSP, dom: Domain, t: number, keep: (o: number) => boolean): boolean {
  const o0 = csp.off[t];
  const sz = 2 * csp.lens[t] + 1;
  let ch = false;
  for (let o = 0; o < sz; o++)
    if (dom[o0 + o] && !keep(o)) {
      dom[o0 + o] = 0;
      ch = true;
    }
  return ch;
}

/** Tier 1: the clue equals the min or max any combination could give. */
function saturation(csp: CSP, dom: Domain, ci: number): boolean {
  const con = csp.cons[ci];
  let sumMin = 0;
  let sumMax = 0;
  const mins: number[] = [];
  const maxs: number[] = [];
  con.ts.forEach((t, i) => {
    let mn = 1e9;
    let mx = -1;
    const o0 = csp.off[t];
    for (let o = 0; o <= 2 * csp.lens[t]; o++) {
      if (!dom[o0 + o]) continue;
      const c = con.contrib[i][o];
      mn = Math.min(mn, c);
      mx = Math.max(mx, c);
    }
    mins.push(mn);
    maxs.push(mx);
    sumMin += mn;
    sumMax += mx;
  });
  if (sumMin === sumMax) return false;
  let ch = false;
  if (sumMax === con.value)
    con.ts.forEach((t, i) => (ch = restrict(csp, dom, t, (o) => con.contrib[i][o] === maxs[i]) || ch));
  else if (sumMin === con.value)
    con.ts.forEach((t, i) => (ch = restrict(csp, dom, t, (o) => con.contrib[i][o] === mins[i]) || ch));
  return ch;
}

/** Tier 3: keep only options that appear in some exact combination summing to the clue. */
function lineGAC(csp: CSP, dom: Domain, ci: number): boolean {
  const con = csp.cons[ci];
  const k = con.ts.length;
  const v = con.value;
  const full = (1 << (v + 1)) - 1;
  const F = new Array<number>(k + 1);
  const B = new Array<number>(k + 1);
  const shiftSet = (set: number, i: number): number => {
    const t = con.ts[i];
    const o0 = csp.off[t];
    let out = 0;
    for (let o = 0; o <= 2 * csp.lens[t]; o++) if (dom[o0 + o]) out |= set << con.contrib[i][o];
    return out & full;
  };
  F[0] = 1;
  for (let i = 0; i < k; i++) F[i + 1] = shiftSet(F[i], i);
  B[k] = 1; // B[i] holds achievable sums of entries i..k-1
  for (let i = k - 1; i >= 0; i--) B[i] = shiftSet(B[i + 1], i);
  let ch = false;
  for (let i = 0; i < k; i++) {
    const t = con.ts[i];
    ch =
      restrict(csp, dom, t, (o) => {
        const c = con.contrib[i][o];
        for (let a = 0; a <= v - c; a++) if ((F[i] >> a) & 1 && (B[i + 1] >> (v - a - c)) & 1) return true;
        return false;
      }) || ch;
  }
  return ch;
}

/** Tier 4: joint enumeration over two constraints that share a thermometer. */
function pairGAC(csp: CSP, dom: Domain, ca: number, cb: number): boolean {
  const A = csp.cons[ca];
  const Bc = csp.cons[cb];
  const ts = [...new Set([...A.ts, ...Bc.ts])];
  const va = A.value;
  const vb = Bc.value;
  const W = vb + 1;
  const S = (va + 1) * W;
  const ia = new Map(A.ts.map((t, i) => [t, i]));
  const ib = new Map(Bc.ts.map((t, i) => [t, i]));
  const cA = (t: number, o: number) => (ia.has(t) ? A.contrib[ia.get(t)!][o] : 0);
  const cB = (t: number, o: number) => (ib.has(t) ? Bc.contrib[ib.get(t)!][o] : 0);
  const k = ts.length;
  const opts: number[][] = ts.map((t) => {
    const out: number[] = [];
    const o0 = csp.off[t];
    for (let o = 0; o <= 2 * csp.lens[t]; o++) if (dom[o0 + o]) out.push(o);
    return out;
  });
  const F: Uint8Array[] = [new Uint8Array(S)];
  F[0][0] = 1;
  for (let i = 0; i < k; i++) {
    const nx = new Uint8Array(S);
    const cur = F[i];
    for (let s = 0; s < S; s++) {
      if (!cur[s]) continue;
      const a = Math.floor(s / W);
      const b = s % W;
      for (const o of opts[i]) {
        const a2 = a + cA(ts[i], o);
        const b2 = b + cB(ts[i], o);
        if (a2 <= va && b2 <= vb) nx[a2 * W + b2] = 1;
      }
    }
    F.push(nx);
  }
  const Bk: Uint8Array[] = new Array(k + 1);
  Bk[k] = new Uint8Array(S);
  Bk[k][0] = 1;
  for (let i = k - 1; i >= 0; i--) {
    const nx = new Uint8Array(S);
    const cur = Bk[i + 1];
    for (let s = 0; s < S; s++) {
      if (!cur[s]) continue;
      const a = Math.floor(s / W);
      const b = s % W;
      for (const o of opts[i]) {
        const a2 = a + cA(ts[i], o);
        const b2 = b + cB(ts[i], o);
        if (a2 <= va && b2 <= vb) nx[a2 * W + b2] = 1;
      }
    }
    Bk[i] = nx;
  }
  let ch = false;
  for (let i = 0; i < k; i++) {
    const t = ts[i];
    const fi = F[i];
    const bi = Bk[i + 1];
    ch =
      restrict(csp, dom, t, (o) => {
        const ea = cA(t, o);
        const eb = cB(t, o);
        for (let s = 0; s < S; s++) {
          if (!fi[s]) continue;
          const ra = va - Math.floor(s / W) - ea;
          const rb = vb - (s % W) - eb;
          if (ra >= 0 && rb >= 0 && bi[ra * W + rb]) return true;
        }
        return false;
      }) || ch;
  }
  return ch;
}

const STATE_WORD: Record<number, string> = { [M_EMPTY]: 'empty', [M_RED]: 'red', [M_BLUE]: 'blue' };

export function maskWord(m: number): string {
  return STATE_WORD[m] ?? (m === (M_RED | M_BLUE) ? 'filled' : '?');
}


/** One link in a counting chain: a line whose count forced something on these thermometers. */
interface Link {
  ci: number;
  ts: number[];
  before?: Domain;
  after?: Domain;
}

/**
 * Bounds propagation that remembers which line forced what. Breadth-first, so chains stay
 * short. Returns the links and the line whose clue can no longer be met (-1 if none).
 */
function tracePropagate(csp: CSP, dom: Domain, initial: number[], snap = false): { links: Link[]; broke: number } {
  const q = [...initial];
  const inQ = new Uint8Array(csp.cons.length);
  for (const c of q) inQ[c] = 1;
  const links: Link[] = [];
  for (let head = 0; head < q.length; head++) {
    const ci = q[head];
    inQ[ci] = 0;
    const before = snap ? dom.slice() : undefined;
    const changed = boundsOnce(csp, dom, ci);
    if (changed === null) return { links, broke: ci };
    if (!changed.length) continue;
    links.push({ ci, ts: changed, before, after: snap ? dom.slice() : undefined });
    for (const t of changed)
      for (const c2 of csp.consOfT[t])
        if (!inQ[c2]) {
          inQ[c2] = 1;
          q.push(c2);
        }
  }
  return { links, broke: -1 };
}

/** Work back from the broken line and keep only the links it depends on. */
function relevantLinks(csp: CSP, links: Link[], broke: number): Link[] {
  const need = new Set(csp.cons[broke].ts);
  const kept: Link[] = [];
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    if (!l.ts.some((t) => need.has(t))) continue;
    kept.push(l);
    for (const t of csp.cons[l.ci].ts) need.add(t);
  }
  return kept.reverse();
}

/** Cell masks of one thermometer, by position. */
function thermoMasks(csp: CSP, dom: Domain, t: number): number[] {
  const L = csp.lens[t];
  const o0 = csp.off[t];
  const out = new Array<number>(L).fill(0);
  for (let o = 0; o <= 2 * L; o++) {
    if (!dom[o0 + o]) continue;
    const lv = optLevel(o, L);
    const col = optColor(o, L) === 1 ? M_RED : M_BLUE;
    for (let pos = 0; pos < L; pos++) out[pos] |= pos < lv ? col : M_EMPTY;
  }
  return out;
}

const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

/** How a cell's knowledge reads: "red", "filled", "not blue", ... */
export function maskPhrase(m: number): string {
  if (m === (M_EMPTY | M_BLUE)) return 'not red';
  if (m === (M_EMPTY | M_RED)) return 'not blue';
  return maskWord(m);
}


/** Per-thermometer min/max contribution to a line, and their sums. */
function lineSums(csp: CSP, dom: Domain, ci: number) {
  const con = csp.cons[ci];
  const mins: number[] = [];
  const maxs: number[] = [];
  con.ts.forEach((t, i) => {
    let mn = 1e9;
    let mx = -1;
    const o0 = csp.off[t];
    for (let o = 0; o <= 2 * csp.lens[t]; o++) {
      if (!dom[o0 + o]) continue;
      mn = Math.min(mn, con.contrib[i][o]);
      mx = Math.max(mx, con.contrib[i][o]);
    }
    mins.push(mn);
    maxs.push(mx);
  });
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return { mins, maxs, sumMin: sum(mins), sumMax: sum(maxs) };
}

/** "red", "blue" or "filled": what a line's clue counts. */
const countWord = (kind: string) => (kind === 'black' ? 'filled' : kind);

/** Largest value a line's clued quantity could ever take (all options alive). */
function lineMax(csp: CSP, ci: number): number {
  return csp.cons[ci].contrib.reduce((a, c) => a + Math.max(...c), 0);
}

/** Bitset of totals line ci can reach with the current domain. */
function lineReach(csp: CSP, dom: Domain, ci: number): boolean[] {
  const con = csp.cons[ci];
  let set = [true];
  con.ts.forEach((t, i) => {
    const nx: boolean[] = [];
    const o0 = csp.off[t];
    for (let s = 0; s < set.length; s++) {
      if (!set[s]) continue;
      for (let o = 0; o <= 2 * csp.lens[t]; o++) if (dom[o0 + o]) nx[s + con.contrib[i][o]] = true;
    }
    set = nx;
  });
  return set;
}

/** All (a, b) totals two lines can reach together: reach[a][b]. */
function pairReach(csp: CSP, dom: Domain, ca: number, cb: number): boolean[][] {
  const A = csp.cons[ca];
  const B = csp.cons[cb];
  const ia = new Map(A.ts.map((t, i) => [t, i]));
  const ib = new Map(B.ts.map((t, i) => [t, i]));
  const ts = [...new Set([...A.ts, ...B.ts])];
  let cur = new Map<number, [number, number]>([[0, [0, 0]]]);
  const W = lineMax(csp, cb) + 1;
  for (const t of ts) {
    const nx = new Map<number, [number, number]>();
    const o0 = csp.off[t];
    for (const [a, b] of cur.values())
      for (let o = 0; o <= 2 * csp.lens[t]; o++) {
        if (!dom[o0 + o]) continue;
        const a2 = a + (ia.has(t) ? A.contrib[ia.get(t)!][o] : 0);
        const b2 = b + (ib.has(t) ? B.contrib[ib.get(t)!][o] : 0);
        nx.set(a2 * W + b2, [a2, b2]);
      }
    cur = nx;
  }
  const out: boolean[][] = [];
  for (const [a, b] of cur.values()) (out[a] ??= [])[b] = true;
  return out;
}

const listOr = (xs: (string | number)[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/**
 * Why a set of reachable totals misses the clue: "couldn't reach 4 blue", "would have more than 2 filled".
 * Returns null when the clue is reachable.
 */
function missText(totals: number[], v: number, w: string): string | null {
  if (totals.includes(v)) return null;
  if (!totals.length) return `couldn't be met at all`;
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  // ⟦n⟧ marks the number that may differ between merged cases (see whyNot).
  if (hi < v) return `could get at most ⟦${hi}⟧ ${w}, not ${v}`;
  if (lo > v) return `would have at least ⟦${lo}⟧ ${w}, more than ${v}`;
  return `could only total ${listOr(totals)} ${w}, never ${v}`;
}

/**
 * Human-style solver. At each step it uses the lowest tier that makes progress,
 * then restarts from tier 1.
 */
export function logicSolve(p: PuzzleCore): Grade {
  const t0 = performance.now();
  const csp = buildCSP(p);
  const dom = fullDomain(csp);
  const n = p.size;
  const steps: Step[] = [];
  const techCounts = [0, 0, 0, 0, 0, 0];
  let masks = cellMasks(csp, p, dom);
  let prevDom = dom.slice();
  const idx = buildIndex(n, p.thermos);

  const pairs: [number, number][] = [];
  for (let a = 0; a < csp.cons.length; a++)
    for (let b = a + 1; b < csp.cons.length; b++) {
      const sa = new Set(csp.cons[a].ts);
      if (csp.cons[b].ts.some((t) => sa.has(t))) pairs.push([a, b]);
    }

  const record = (
    tier: number,
    lines: number[],
    note: string | ((settled: string) => string),
    focus?: number,
    chain?: number,
  ) => {
    const nm = cellMasks(csp, p, dom);
    const cells: { cell: number; mask: number }[] = [];
    for (let i = 0; i < nm.length; i++) if (nm[i] !== masks[i]) cells.push({ cell: i, mask: nm[i] });
    masks = nm;
    techCounts[tier]++;
    let settled = settledText(cells);
    if (!settled) {
      const narrowed: string[] = [];
      for (let t = 0; t < csp.nT; t++) {
        const o0 = csp.off[t];
        const sz = 2 * csp.lens[t] + 1;
        let ch = false;
        for (let o = 0; o < sz; o++) if (prevDom[o0 + o] !== dom[o0 + o]) ch = true;
        if (!ch) continue;
        const gone = prevDom.map((x, i) => (x && !dom[i] ? 1 : 0)) as Domain;
        narrowed.push(`${thermoName(t)} can't be ${thermoCan(gone, t)}`);
      }
      settled = narrowed.join('; ');
    }
    prevDom = dom.slice();
    const text = typeof note === 'string' ? note : note(settled);
    steps.push({ tier, lines, cells, note: text, focus, chain });
  };
  /** "R1C3 blue; R1C1, R1C2 not red" */
  const settledText = (cells: { cell: number; mask: number }[]) => {
    const groups = new Map<string, string[]>();
    for (const { cell, mask } of cells) {
      const k = maskPhrase(mask);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(cellName(cell, n));
    }
    return [...groups].map(([k, cs]) => `${cs.join(', ')} ${k}`).join('; ');
  };
  /**
   * For each option a step ruled out, say why: "if the R5C3 thermometer were completely red,
   * Column 3 could reach at most 3 blue (it needs 4)". Options with the same reason are merged.
   */
  const whyNot = (before: Domain, ts: number[], reason: (d: Domain) => string | null) => {
    // reason -> thermometer -> ruled-out options
    const byReason = new Map<string, Map<number, number[]>>();
    const nums = new Map<string, number>();
    for (const t of ts) {
      const o0 = csp.off[t];
      for (let o = 0; o <= 2 * csp.lens[t]; o++) {
        if (!before[o0 + o] || dom[o0 + o]) continue;
        const d = before.slice();
        d.fill(0, o0, o0 + 2 * csp.lens[t] + 1);
        d[o0 + o] = 1;
        const raw = reason(d) ?? 'the clues conflict';
        // Merge cases that differ only in how far they miss; report the closest miss.
        const num = /⟦(\d+)⟧/.exec(raw);
        const r = raw.replace(/⟦\d+⟧/, '⟦⟧');
        if (num) {
          const k = Number(num[1]);
          const prev = nums.get(r);
          nums.set(r, prev === undefined ? k : r.includes('at most') ? Math.max(prev, k) : Math.min(prev, k));
        }
        if (!byReason.has(r)) byReason.set(r, new Map());
        const m = byReason.get(r)!;
        if (!m.has(t)) m.set(t, []);
        m.get(t)!.push(o);
      }
    }
    const sentences = [...byReason].map(([r, m]) => {
      const ifs = [...m].map(([t, os]) => {
        const g = new Uint8Array(csp.total);
        for (const o of os) g[csp.off[t] + o] = 1;
        return `${thermoName(t)} were ${thermoCan(g, t)}`;
      });
      const more = ifs.length - 3;
      const shown = more > 0 ? [...ifs.slice(0, 3), `${more} other case${more === 1 ? '' : 's'}`] : ifs;
      return `If ${shown.join(', or if ')}: ${r.replace('⟦⟧', String(nums.get(r)))}.`;
    });
    return sentences.length > 3
      ? `${sentences.slice(0, 3).join(' ')} (${sentences.length - 3} more similar.)`
      : sentences.join(' ');
  };
  /** Thermometers are named by their bulb. */
  const thermoName = (t: number) => `the ${cellName(p.thermos[t].cells[0], n)} thermometer`;
  /** What a thermometer can still be: "blue to R1C5 or R1C6", "empty or red to R2C1", ... */
  const thermoCan = (d: Domain, t: number) => {
    const L = csp.lens[t];
    const o0 = csp.off[t];
    const cells = p.thermos[t].cells;
    const parts: string[] = [];
    if (d[o0]) parts.push('empty');
    const one = (word: string, k: number) =>
      k === 1 ? `${word} in just the bulb` : k === L ? `completely ${word}` : `${word} to ${cellName(cells[k - 1], n)}`;
    for (const [col, word] of [[1, 'red'], [2, 'blue']] as const) {
      const lv: number[] = [];
      for (let o = 1; o <= 2 * L; o++) if (d[o0 + o] && optColor(o, L) === col) lv.push(optLevel(o, L));
      if (!lv.length) continue;
      const lo = lv[0];
      const hi = lv[lv.length - 1];
      const contiguous = hi - lo === lv.length - 1;
      if (lv.length === L) parts.push(L === 1 ? word : `${word} at any level`);
      else if (lv.length === 1) parts.push(one(word, lo));
      else if (contiguous && lo === 1) parts.push(`${word} up to ${cellName(cells[hi - 1], n)}`);
      else if (contiguous && hi === L) parts.push(`${word} reaching at least ${cellName(cells[lo - 1], n)}`);
      else parts.push(`${word} ${lv.map((k) => (k === 1 ? 'in just the bulb' : `to ${cellName(cells[k - 1], n)}`)).join(' or ')}`);
    }
    if (parts.length <= 1) return parts.join('');
    if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
  };
  const lineDesc = (ci: number) => {
    const line = csp.cons[ci].line;
    return `${lineName(line, n)} (${clueLabel(clueOf(p, line))})`;
  };

  const solved = () => {
    for (let t = 0; t < csp.nT; t++) if (aliveCount(csp, dom, t) !== 1) return false;
    return true;
  };

  const tryTier = (tier: number): boolean => {
    if (tier === 1) {
      for (let ci = 0; ci < csp.cons.length; ci++) {
        const { sumMin, sumMax } = lineSums(csp, dom, ci);
        if (saturation(csp, dom, ci)) {
          const con = csp.cons[ci];
          const w = countWord(con.kind);
          const why =
            con.value === 0
              ? `nothing in this line can be ${w}`
              : sumMax === con.value
                ? `this line can hold at most ${sumMax} ${w}, so every cell that could be ${w} must be`
                : `this line already has ${sumMin} ${w} for certain, so nothing else can be ${w}`;
          record(1, [con.line], (s) => `${lineDesc(ci)}: ${why}. So ${s}.`);
          return true;
        }
      }
    } else if (tier === 2) {
      for (let ci = 0; ci < csp.cons.length; ci++) {
        const { mins, maxs, sumMin, sumMax } = lineSums(csp, dom, ci);
        const ch = boundsOnce(csp, dom, ci);
        if (ch && ch.length) {
          const con = csp.cons[ci];
          const w = countWord(con.kind);
          const v = con.value;
          const why = ch.map((t) => {
            const i = con.ts.indexOf(t);
            const restMax = sumMax - maxs[i];
            const restMin = sumMin - mins[i];
            const out: string[] = [];
            const name = thermoName(t);
            if (v - restMax > mins[i])
              out.push(
                restMax === 0
                  ? `nothing else in the line can be ${w}, so ${name} must give all ${v}`
                  : `the rest of the line can give at most ${restMax} ${w}, so ${name} must give at least ${v - restMax}`,
              );
            if (v - restMin < maxs[i])
              out.push(
                restMin === 0
                  ? `${name} can give at most ${v} ${w} here`
                  : `the rest of the line already gives ${restMin} ${w}, so ${name} can give at most ${v - restMin}`,
              );
            return out.join(', and ');
          });
          record(2, [con.line], (s) => `${lineDesc(ci)}: ${why.join('; ')}. So ${s}.`);
          return true;
        }
      }
    } else if (tier === 3) {
      for (let ci = 0; ci < csp.cons.length; ci++) {
        const before = dom.slice();
        if (lineGAC(csp, dom, ci)) {
          const con = csp.cons[ci];
          const w = countWord(con.kind);
          const why = whyNot(before, con.ts, (d) => {
            const r = lineReach(csp, d, ci);
            const totals = r.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
            const m = missText(totals, con.value, w);
            return m && `${lineName(con.line, n)} ${m}`;
          });
          record(
            3,
            [con.line],
            (s) => `${lineDesc(ci)} has to total exactly ${con.value}. ${why} So ${s}.`,
            undefined,
            1,
          );
          return true;
        }
      }
    } else if (tier === 4) {
      for (const [a, b] of pairs) {
        const before = dom.slice();
        if (pairGAC(csp, dom, a, b)) {
          const A = csp.cons[a];
          const B = csp.cons[b];
          const sb = new Set(B.ts);
          const shared = A.ts.filter((t) => sb.has(t));
          // For each ruled-out option: hold one line to its clue and show the other falls short.
          const holdShort = (hold: number, other: number, reach: boolean[][]) => {
            const H = csp.cons[hold];
            const O = csp.cons[other];
            const totals: number[] = [];
            if (hold === a) reach[H.value]?.forEach((x, i) => x && totals.push(i));
            else reach.forEach((row, i) => row?.[H.value] && totals.push(i));
            const m = missText(totals, O.value, countWord(O.kind));
            if (!m) return null;
            if (!totals.length) return `${lineDesc(hold)} and ${lineDesc(other)} can't both be met`;
            return `keeping ${lineName(H.line, n)} at ${H.value} ${countWord(H.kind)}, ${lineName(O.line, n)} ${m}`;
          };
          const why = whyNot(before, [...new Set([...A.ts, ...B.ts])], (d) => {
            const reach = pairReach(csp, d, a, b);
            const own = (ci: number) => {
              const r = lineReach(csp, d, ci);
              const m = missText(r.map((x, i) => (x ? i : -1)).filter((i) => i >= 0), csp.cons[ci].value, countWord(csp.cons[ci].kind));
              return m && `${lineName(csp.cons[ci].line, n)} ${m}`;
            };
            return own(a) ?? own(b) ?? holdShort(a, b, reach) ?? holdShort(b, a, reach);
          });
          const bulbs = shared.map((t) => cellName(p.thermos[t].cells[0], n));
          const share =
            bulbs.length === 1
              ? thermoName(shared[0])
              : `the thermometers at ${bulbs.slice(0, -1).join(', ')} and ${bulbs[bulbs.length - 1]}`;
          record(
            4,
            [csp.cons[a].line, csp.cons[b].line],
            (s) =>
              `${lineDesc(a)} and ${lineDesc(b)} both cross ${share}, so they have to be worked out together. ${why} So ${s}.`,
            undefined,
            2,
          );
          return true;
        }
      }
    } else if (tier === 5) {
      // Try every assumption about every open cell and keep the one whose contradiction
      // needs the shortest chain of line counts.
      type Trial = { cell: number; t: number; S: number; m: number; keep: (o: number) => boolean; len: number };
      let best: Trial | null = null;
      for (let cell = 0; cell < n * n && !(best && best.len === 1); cell++) {
        const m = masks[cell];
        if (popcount(m) < 2) continue;
        const t = idx.thermo[cell];
        const pos = idx.pos[cell];
        const L = csp.lens[t];
        const gives = (o: number) => {
          const lv = optLevel(o, L);
          if (pos >= lv) return M_EMPTY;
          return optColor(o, L) === 1 ? M_RED : M_BLUE;
        };
        const bits = [M_EMPTY, M_RED, M_BLUE].filter((b) => m & b);
        const assumptions = bits.length === 3 ? [...bits, ...bits.map((b) => m & ~b)] : bits;
        for (const S of assumptions) {
          const keep = (o: number) => (gives(o) & S) !== 0;
          const trial = dom.slice();
          restrict(csp, trial, t, keep);
          const r = tracePropagate(csp, trial, csp.consOfT[t]);
          if (r.broke < 0) continue;
          const len = relevantLinks(csp, r.links, r.broke).length + 1;
          // Shorter chain wins; on a tie, prefer the conclusion that settles more.
          if (!best || len < best.len || (len === best.len && popcount(S) > popcount(best.S)))
            best = { cell, t, S, m, keep, len };
        }
      }
      if (!best) return false;
      const { cell, t, S, m, keep } = best;
      const trial = dom.slice();
      restrict(csp, trial, t, keep);
      const r = tracePropagate(csp, trial, csp.consOfT[t], true);
      const chain = relevantLinks(csp, r.links, r.broke);
      const brokeLine = csp.cons[r.broke].line;
      // Only mention the cells a later line in the chain actually uses.
      const what = (l: Link, i: number) => {
        const later = new Set([...chain.slice(i + 1).map((x) => csp.cons[x.ci].line), brokeLine]);
        const onLater = (c: number) => later.has(Math.floor(c / n)) || later.has(n + (c % n));
        const groups = new Map<string, string[]>();
        for (const tt of l.ts) {
          const b = thermoMasks(csp, l.before!, tt);
          const a = thermoMasks(csp, l.after!, tt);
          p.thermos[tt].cells.forEach((c, pos) => {
            if (a[pos] === b[pos] || c === cell || !onLater(c)) return;
            const k = maskPhrase(a[pos]);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(cellName(c, n));
          });
        }
        const parts = [...groups].map(([k, cs]) => `${cs.length > 3 ? `${cs.slice(0, 3).join(', ')}…` : cs.join(', ')} ${k}`);
        return `${lineDesc(l.ci)} makes ${parts.join(', ') || 'a thermometer shorter or recolors it'}`;
      };
      let links = chain.map(what);
      if (links.length > 6) links = [...links.slice(0, 3), `… ${links.length - 5} more …`, ...links.slice(-2)];
      const cn = cellName(cell, n);
      const assume =
        popcount(S) === 1 ? `were ${maskWord(S)}` : (m & ~S) === M_EMPTY ? 'were filled' : `weren't ${maskWord(m & ~S)}`;
      restrict(csp, dom, t, (o) => !keep(o));
      const lines = [...new Set([...chain.map((l) => csp.cons[l.ci].line), brokeLine])];
      record(
        5,
        lines,
        `Suppose ${cn} ${assume}. ${links.length ? `${links.join('; ')}; then ` : 'Then '}${lineDesc(r.broke)} can't be met. So ${cn} is ${maskPhrase(m & ~S)}.`,
        cell,
        best.len,
      );
      return true;
    }
    return false;
  };

  let stuck = false;
  while (!solved()) {
    let progressed = false;
    for (let tier = 1; tier <= 5; tier++) {
      if (tryTier(tier)) {
        progressed = true;
        break;
      }
    }
    if (!progressed) {
      stuck = true;
      break;
    }
  }
  const isSolved = !stuck;
  const maxTier = steps.reduce((m, s) => Math.max(m, s.tier), 0);
  const score = steps.reduce((a, s) => a + stepWeight(s), 0);
  const counting = steps.filter((s) => s.tier <= 2).length;
  const jumps = steps.length - counting;
  const maxChain = steps.reduce((m, s) => Math.max(m, s.chain ?? 0), 0);
  return {
    solved: isSolved,
    maxTier,
    score,
    label: difficultyLabel(isSolved, jumps, maxChain),
    extremes: extremeClues(p),
    techCounts,
    counting,
    jumps,
    jumpShare: steps.length ? jumps / steps.length : 0,
    maxChain,
    steps,
    ms: performance.now() - t0,
  };
}

/**
 * Silent deduction to a fixpoint using bounds + single-line combinations
 * (+ crossing-line pairs when `pairs` is true). Returns false on contradiction.
 */
export function deduce(csp: CSP, dom: Domain, pairs = false): boolean {
  if (!propagate(csp, dom)) return false;
  for (;;) {
    let ch = false;
    for (let ci = 0; ci < csp.cons.length; ci++) if (lineGAC(csp, dom, ci)) ch = true;
    if (pairs && !ch)
      for (let a = 0; a < csp.cons.length && !ch; a++)
        for (let b = a + 1; b < csp.cons.length; b++) {
          const sa = new Set(csp.cons[a].ts);
          if (csp.cons[b].ts.some((t) => sa.has(t)) && pairGAC(csp, dom, a, b)) ch = true;
        }
    if (!ch) return true;
    for (let t = 0; t < csp.nT; t++) if (aliveCount(csp, dom, t) === 0) return false;
    if (!propagate(csp, dom)) return false;
  }
}
