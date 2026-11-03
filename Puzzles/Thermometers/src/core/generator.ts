import { makeLayout } from './layout';
import {
  cellStates,
  clueOf,
  cloneCore,
  countFor,
  lineCounts,
  setClueOf,
  type LineCounts,
} from './model';
import { Rng } from './rng';
import { makeSolution } from './solution';
import { aliveCount, buildCSP, fullDomain } from './solver/csp';
import { countSolutions } from './solver/exact';
import { deduce, logicSolve, type Grade } from './solver/logic';
import type { ClueKind, GenParams, Puzzle, PuzzleCore, ThermoState } from './types';

export const DEFAULT_PARAMS: GenParams = {
  size: 6,
  seed: 'demo',
  shape: 'mixed',
  minLen: 2,
  maxLen: 5,
  density: 0.5,
  pRed: 0.5,
  mix: { red: 3, blue: 3, black: 2 },
  minimize: true,
  avoidExtremes: -1,
  minTier: 1,
  maxTier: 5,
  minJumps: 0,
  maxJumps: 99,
  minChain: 0,
  maxChain: 0,
  maxAttempts: 30,
};

const NODE_LIMIT = 300_000;
/** Node budget for the many uniqueness checks made while polishing and minimizing. */
const EXACT_LIMIT = 40_000;
const CLUE_KINDS: ClueKind[] = ['red', 'blue', 'black'];

export interface GenStats {
  attempts: number;
  ms: number;
  targetMet: boolean;
  thermos: number;
  clueCounts: Record<ClueKind, number>;
  /** Shown clues within the extreme margin (margin 1 when avoidance is off). */
  extremes: number;
  failures: { nonUnique: number; offTarget: number; reasons: Record<string, number> };
  grade: Grade | null;
}

export interface GenResult {
  puzzle: Puzzle | null;
  stats: GenStats;
}

type Uniq = 'unique' | 'multiple' | 'none' | 'aborted';

export function checkUnique(p: PuzzleCore, nodeLimit = NODE_LIMIT): Uniq {
  const r = countSolutions(buildCSP(p), 2, nodeLimit);
  if (r.aborted) return 'aborted';
  return r.count === 1 ? 'unique' : r.count === 0 ? 'none' : 'multiple';
}

export function clueCounts(p: PuzzleCore): Record<ClueKind, number> {
  const out: Record<ClueKind, number> = { red: 0, blue: 0, black: 0, none: 0 };
  for (const c of [...p.rowClues, ...p.colClues]) out[c.kind]++;
  return out;
}

export function isExtreme(value: number, n: number, margin: number): boolean {
  return margin >= 0 && (value <= margin || value >= n - margin);
}

export function countExtremes(p: PuzzleCore, margin: number): number {
  return [...p.rowClues, ...p.colClues].filter((c) => c.kind !== 'none' && isExtreme(c.value, p.size, margin)).length;
}

function setKind(p: PuzzleCore, line: number, kind: ClueKind, counts: LineCounts) {
  setClueOf(p, line, { kind, value: kind === 'none' ? 0 : countFor(kind, counts, line) });
}

interface Ambiguity {
  /** Sum over thermos of (remaining options - 1) after line deductions. */
  rem: number;
  /** Thermometers that are not yet determined. */
  open: number[];
}

function ambiguity(p: PuzzleCore, pairs = false): Ambiguity {
  const csp = buildCSP(p);
  const dom = fullDomain(csp);
  deduce(csp, dom, pairs);
  let rem = 0;
  const open: number[] = [];
  for (let t = 0; t < csp.nT; t++) {
    const k = aliveCount(csp, dom, t);
    if (k > 1) {
      rem += k - 1;
      open.push(t);
    }
  }
  return { rem, open };
}

/** A black clue of 0 is never shown: it would be a giveaway "this whole line is empty". */
export function allowedClue(kind: ClueKind, counts: LineCounts, line: number): boolean {
  return kind !== 'black' || counts.total[line] > 0;
}

/**
 * Write clue values for every line. A black clue on an empty line is swapped (in
 * `kinds`, too) for red or blue, whichever has the larger mix weight.
 */
function applyKinds(p: PuzzleCore, kinds: ClueKind[], counts: LineCounts, mix: GenParams['mix']) {
  kinds.forEach((k, line) => {
    if (!allowedClue(k, counts, line)) {
      k = mix.red > mix.blue || (mix.red === mix.blue && line % 2 === 0) ? 'red' : 'blue';
      kinds[line] = k;
    }
    setKind(p, line, k, counts);
  });
}

/**
 * Local search toward a unique puzzle. Objective: how much is still undecided after
 * line-by-line deduction. Moves re-roll an undecided thermometer's hidden fill or
 * change the clue kind of a line it touches; non-worsening moves are kept. When
 * little is left undecided, an exact check accepts puzzles that are unique but
 * need harder logic.
 */
function repairToUnique(
  p: PuzzleCore,
  solution: ThermoState[],
  kinds: ClueKind[],
  params: GenParams,
  rng: Rng,
): string {
  const n = p.size;
  let counts = lineCounts(n, cellStates(n, p.thermos, solution));
  applyKinds(p, kinds, counts, params.mix);
  let cur = ambiguity(p);
  const budget = 8 * n * n;
  const kindW = CLUE_KINDS.map((k) => params.mix[k as 'red' | 'blue' | 'black']);
  const linesOf = p.thermos.map((t) => [...new Set(t.cells.flatMap((c) => [Math.floor(c / n), n + (c % n)]))]);
  const exactAt = Math.max(4, Math.round(n / 2));
  let lastExact = -1;
  for (let iter = 0; iter < budget; iter++) {
    if (cur.rem === 0) return 'ok';
    if (cur.rem <= exactAt && lastExact !== cur.rem) {
      lastExact = cur.rem;
      const u = checkUnique(p);
      if (u === 'unique') return 'ok';
    }
    const t = rng.pick(cur.open);
    const newSol = solution.slice();
    const newKinds = kinds.slice();
    if (rng.next() < 0.5) {
      newSol[t] = makeSolution([p.thermos[t]], params.density, params.pRed, rng)[0];
    } else {
      const line = rng.pick(linesOf[t]);
      const choices = CLUE_KINDS.filter((k) => k !== kinds[line]);
      newKinds[line] = choices[rng.weighted(choices.map((k) => kindW[CLUE_KINDS.indexOf(k)] || 0.05))];
    }
    const nCounts = lineCounts(n, cellStates(n, p.thermos, newSol));
    const saved = cloneCore(p);
    applyKinds(p, newKinds, nCounts, params.mix);
    const ev = ambiguity(p);
    if (ev.rem <= cur.rem) {
      solution.splice(0, solution.length, ...newSol);
      kinds.splice(0, kinds.length, ...newKinds);
      counts = nCounts;
      cur = ev;
    } else {
      p.rowClues = saved.rowClues;
      p.colClues = saved.colClues;
    }
  }
  return cur.rem === 0 || checkUnique(p) === 'unique' ? 'ok' : 'budget';
}

/**
 * Unique as far as the generator can tell. Normally: line deduction finishes, or a capped
 * exact check passes when little is left. With `hard` (presets that want jumps, i.e.
 * minJumps > 0 or minTier >= 4) it also uses crossing-line deduction and a full exact proof.
 * That lets the minimizer remove clues that line deduction alone can't do without, which is
 * where jumps come from.
 */
function isUnique(p: PuzzleCore, exactAt: number, hard = false): boolean {
  const a = ambiguity(p);
  if (a.rem === 0) return true;
  if (hard) {
    if (ambiguity(p, true).rem === 0) return true;
    return checkUnique(p) === 'unique';
  }
  // A capped search that gives up counts as "not unique", which just keeps the clue.
  return a.rem <= exactAt && checkUnique(p, EXACT_LIMIT) === 'unique';
}

/**
 * Reduce extreme clues on an already-unique puzzle: re-roll a thermometer crossing an
 * extreme line or switch that line's clue color; keep moves that stay unique and don't
 * add extremes.
 */
function polishExtremes(p: PuzzleCore, solution: ThermoState[], kinds: ClueKind[], params: GenParams, rng: Rng) {
  const n = p.size;
  const m = params.avoidExtremes;
  if (m < 0) return;
  const thermosOfLine: number[][] = [...Array(2 * n)].map(() => []);
  p.thermos.forEach((t, id) => {
    for (const line of new Set(t.cells.flatMap((c) => [Math.floor(c / n), n + (c % n)]))) thermosOfLine[line].push(id);
  });
  const exactAt = Math.max(4, Math.round(n / 2));
  const kindW = CLUE_KINDS.map((k) => params.mix[k as 'red' | 'blue' | 'black']);
  let cur = countExtremes(p, m);
  const budget = 4 * n * n;
  for (let iter = 0; iter < budget && cur > 0; iter++) {
    const ext = [...Array(2 * n).keys()].filter((l) => kinds[l] !== 'none' && isExtreme(clueOf(p, l).value, n, m));
    const line = rng.pick(ext);
    const newSol = solution.slice();
    const newKinds = kinds.slice();
    if (rng.next() < 0.6) {
      const t = rng.pick(thermosOfLine[line]);
      newSol[t] = makeSolution([p.thermos[t]], params.density, params.pRed, rng)[0];
    } else {
      const choices = CLUE_KINDS.filter((k) => k !== kinds[line]);
      newKinds[line] = choices[rng.weighted(choices.map((k) => kindW[CLUE_KINDS.indexOf(k)] || 0.05))];
    }
    const nCounts = lineCounts(n, cellStates(n, p.thermos, newSol));
    const saved = cloneCore(p);
    applyKinds(p, newKinds, nCounts, params.mix);
    const nExt = countExtremes(p, m);
    if (nExt <= cur && isUnique(p, exactAt)) {
      solution.splice(0, solution.length, ...newSol);
      kinds.splice(0, kinds.length, ...newKinds);
      cur = nExt;
    } else {
      p.rowClues = saved.rowClues;
      p.colClues = saved.colClues;
    }
  }
}

/** Remove or downgrade clues (color → black → blank) while staying unique. Extreme clues go first. */
function minimizeClues(p: PuzzleCore, counts: LineCounts, params: GenParams, rng: Rng) {
  const m = params.avoidExtremes;
  const clued = rng.shuffle([...Array(2 * p.size).keys()].filter((l) => clueOf(p, l).kind !== 'none'));
  const ext = (l: number) => isExtreme(clueOf(p, l).value, p.size, m);
  const lines = [...clued.filter(ext), ...clued.filter((l) => !ext(l))];
  for (const line of lines) {
    const orig = clueOf(p, line);
    const tries: ClueKind[] = ['none'];
    if (
      (orig.kind === 'red' || orig.kind === 'blue') &&
      params.mix.black > 0 &&
      allowedClue('black', counts, line) &&
      !isExtreme(counts.total[line], p.size, m)
    )
      tries.push('black');
    let kept = false;
    const exactAt = Math.max(4, Math.round(p.size / 2));
    for (const k of tries) {
      setKind(p, line, k, counts);
      if (isUnique(p, exactAt, params.minTier >= 4 || params.minJumps > 0)) {
        kept = true;
        break;
      }
    }
    if (!kept) setClueOf(p, line, orig);
  }
}

export function generate(params: GenParams): GenResult {
  const t0 = performance.now();
  const n = params.size;
  const rng = new Rng(`${params.seed}|${n}`);
  const failures = { nonUnique: 0, offTarget: 0, reasons: {} as Record<string, number> };
  let last: { puzzle: Puzzle; grade: Grade } | null = null;
  let attempts = 0;
  // Thermometers no longer than the board is wide.
  const maxLen = Math.max(1, Math.min(params.maxLen, n));
  const minLen = Math.max(1, Math.min(params.minLen, maxLen));
  // Boards under 6x6 rarely have room for jumps, but each attempt takes only a few ms,
  // so they get more tries: 3x at 4x4, 2x at 5x5.
  const maxAttempts = params.maxAttempts * Math.max(1, Math.ceil((6 / n) ** 2));

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    const thermos = makeLayout(n, params.shape, minLen, maxLen, rng);
    const solution = makeSolution(thermos, params.density, params.pRed, rng);
    const weights = CLUE_KINDS.map((k) => params.mix[k as 'red' | 'blue' | 'black']);
    const kinds = [...Array(2 * n)].map(() => CLUE_KINDS[rng.weighted(weights)]);
    const core: PuzzleCore = { size: n, thermos, rowClues: [], colClues: [] };
    for (let line = 0; line < 2 * n; line++) (line < n ? core.rowClues : core.colClues).push({ kind: 'none', value: 0 });
    const u = repairToUnique(core, solution, kinds, params, rng);
    if (u !== 'ok') {
      failures.nonUnique++;
      failures.reasons[u] = (failures.reasons[u] ?? 0) + 1;
      continue;
    }
    polishExtremes(core, solution, kinds, params, rng);
    const counts = lineCounts(n, cellStates(n, thermos, solution));
    if (params.minimize) minimizeClues(core, counts, params, rng);
    const grade = logicSolve(core);
    const puzzle: Puzzle = { ...cloneCore(core), solution, seed: params.seed, params };
    last = { puzzle, grade };
    const tierOk =
      (grade.solved
        ? grade.maxTier >= params.minTier && grade.maxTier <= Math.min(5, params.maxTier)
        : params.maxTier >= 6) &&
      (params.avoidExtremes < 0 || countExtremes(core, params.avoidExtremes) <= 1) &&
      grade.jumps >= params.minJumps &&
      grade.jumps <= params.maxJumps &&
      grade.maxChain >= params.minChain &&
      (params.maxChain <= 0 || grade.maxChain <= params.maxChain);
    if (tierOk) {
      return { puzzle, stats: stats(true) };
    }
    failures.offTarget++;
  }
  return { puzzle: last?.puzzle ?? null, stats: stats(false) };

  function stats(targetMet: boolean): GenStats {
    return {
      attempts: Math.min(attempts, maxAttempts),
      ms: performance.now() - t0,
      targetMet,
      thermos: last?.puzzle.thermos.length ?? 0,
      clueCounts: last ? clueCounts(last.puzzle) : { red: 0, blue: 0, black: 0, none: 0 },
      extremes: last ? countExtremes(last.puzzle, Math.max(1, params.avoidExtremes)) : 0,
      failures,
      grade: last?.grade ?? null,
    };
  }
}
