import { describe, expect, it } from 'vitest';
import { makeLayout } from '../src/core/layout';
import { cellStates, clueOf, countFor, lineCounts, sameCells } from '../src/core/model';
import { Rng } from '../src/core/rng';
import { makeSolution } from '../src/core/solution';
import { buildCSP, optToState } from '../src/core/solver/csp';
import { countSolutions, solutionToStates } from '../src/core/solver/exact';
import { logicSolve } from '../src/core/solver/logic';
import { DEFAULT_PARAMS, checkUnique, generate } from '../src/core/generator';
import type { ClueKind, PuzzleCore } from '../src/core/types';
import { PRESETS } from '../src/core/presets';
import { addDays, dailyParams, dayKey, msUntilNextDay, siteDailyParams } from '../src/core/daily';

function randomPuzzle(n: number, seed: string): PuzzleCore {
  const rng = new Rng(seed);
  const thermos = makeLayout(n, 'mixed', 1, 3, rng);
  const sol = makeSolution(thermos, 0.5, 0.5, rng);
  const counts = lineCounts(n, cellStates(n, thermos, sol));
  const kinds: ClueKind[] = ['red', 'blue', 'black', 'none'];
  const clue = (line: number) => {
    const kind = rng.pick(kinds);
    return { kind, value: kind === 'none' ? 0 : countFor(kind, counts, line) };
  };
  return {
    size: n,
    thermos,
    rowClues: [...Array(n).keys()].map(clue),
    colClues: [...Array(n).keys()].map((i) => clue(n + i)),
  };
}

/** Count distinct cell assignments satisfying all clues by full enumeration. */
function bruteCount(p: PuzzleCore): number {
  const n = p.size;
  const lens = p.thermos.map((t) => t.cells.length);
  const choice = new Array(lens.length).fill(0);
  const seen = new Set<string>();
  const rec = (t: number) => {
    if (t === lens.length) {
      const cells = cellStates(n, p.thermos, choice.map((o, i) => optToState(o, lens[i])));
      const cnt = lineCounts(n, cells);
      for (let line = 0; line < 2 * n; line++) {
        const c = clueOf(p, line);
        if (c.kind !== 'none' && countFor(c.kind, cnt, line) !== c.value) return;
      }
      seen.add(cells.join(''));
      return;
    }
    for (let o = 0; o <= 2 * lens[t]; o++) {
      choice[t] = o;
      rec(t + 1);
    }
  };
  rec(0);
  return seen.size;
}

describe('layout', () => {
  it('covers every cell exactly once with connected paths', () => {
    for (let i = 0; i < 30; i++) {
      const n = 6 + (i % 10);
      const rng = new Rng(`L${i}`);
      const shape = (['straight', 'bent', 'mixed'] as const)[i % 3];
      const ts = makeLayout(n, shape, 2, 5, rng);
      const seen = new Uint8Array(n * n);
      for (const t of ts) {
        t.cells.forEach((c, k) => {
          seen[c]++;
          if (k > 0) {
            const a = t.cells[k - 1];
            const d = Math.abs(Math.floor(a / n) - Math.floor(c / n)) + Math.abs((a % n) - (c % n));
            expect(d).toBe(1);
          }
        });
      }
      expect([...seen].every((v) => v === 1)).toBe(true);
    }
  });
});

describe('exact solver', () => {
  it('matches brute force on small boards', () => {
    for (let i = 0; i < 60; i++) {
      const n = i < 30 ? 3 : 4;
      const p = randomPuzzle(n, `B${i}`);
      const lens = p.thermos.map((t) => t.cells.length);
      const combos = lens.reduce((a, L) => a * (2 * L + 1), 1);
      if (combos > 3_000_000) continue;
      const brute = bruteCount(p);
      const r = countSolutions(buildCSP(p), 1_000_000, 50_000_000);
      expect(r.count).toBe(brute);
    }
  });
});

describe('generator', () => {
  const sizes = [4, 6, 8];
  for (const size of sizes) {
    it(`produces unique, logic-consistent ${size}x${size} puzzles`, () => {
      for (let i = 0; i < 4; i++) {
        const { puzzle, stats } = generate({ ...DEFAULT_PARAMS, size, seed: `G${size}-${i}`, maxTier: 6 });
        expect(puzzle).not.toBeNull();
        const p = puzzle!;
        expect(checkUnique(p)).toBe('unique');
        // stored solution satisfies clues
        const cells = cellStates(size, p.thermos, p.solution);
        const cnt = lineCounts(size, cells);
        for (let line = 0; line < 2 * size; line++) {
          const c = clueOf(p, line);
          if (c.kind !== 'none') expect(countFor(c.kind, cnt, line)).toBe(c.value);
        }
        // the exact solver's one solution is the stored one
        const csp = buildCSP(p);
        const r = countSolutions(csp, 2);
        expect(sameCells(cellStates(size, p.thermos, solutionToStates(csp, r.solutions[0])), cells)).toBe(true);
        expect(stats.grade).not.toBeNull();
      }
    });
  }

  it('never produces a black 0 clue', () => {
    for (let i = 0; i < 40; i++) {
      const size = [4, 6, 8][i % 3];
      // sparse fills and black-heavy mixes make empty lines (and thus black 0s) likely
      const { puzzle } = generate({ ...DEFAULT_PARAMS, size, seed: `Z${i}`, density: 0.2, mix: { red: 1, blue: 1, black: 6 }, maxTier: 6, maxAttempts: 10 });
      if (!puzzle) continue;
      for (const c of [...puzzle.rowClues, ...puzzle.colClues]) expect(c.kind === 'black' && c.value === 0).toBe(false);
    }
  });

  it('is deterministic for a seed', () => {
    const a = generate({ ...DEFAULT_PARAMS, seed: 'same' });
    const b = generate({ ...DEFAULT_PARAMS, seed: 'same' });
    expect(JSON.stringify(a.puzzle)).toBe(JSON.stringify(b.puzzle));
  });
});

describe('logic solver', () => {
  it('only ever reaches the true solution', () => {
    for (let i = 0; i < 6; i++) {
      const { puzzle } = generate({ ...DEFAULT_PARAMS, size: 8, seed: `S${i}`, maxTier: 6 });
      const g = logicSolve(puzzle!);
      // every resolved cell in every step must agree with the solution
      const sol = cellStates(8, puzzle!.thermos, puzzle!.solution);
      for (const st of g.steps)
        for (const { cell, mask } of st.cells) {
          const truth = sol[cell] === 0 ? 1 : sol[cell] === 1 ? 2 : 4;
          expect(mask & truth).toBe(truth);
        }
    }
  });
});

describe('difficulty presets', () => {
  it('hit their jump targets at 5x5 and 6x6', () => {
    for (const [name, pr] of Object.entries(PRESETS))
      for (let i = 0; i < 4; i++) {
        const r = generate({ ...DEFAULT_PARAMS, ...pr, size: 5 + (i % 2), seed: `preset-${name}-${i}` });
        expect(r.puzzle, name).not.toBeNull();
        expect(r.stats.targetMet, `${name} ${i}`).toBe(true);
        const g = r.stats.grade!;
        expect(g.jumps).toBeGreaterThanOrEqual(pr.minJumps);
        expect(g.jumps).toBeLessThanOrEqual(pr.maxJumps);
        if (pr.maxChain) expect(g.maxChain).toBeLessThanOrEqual(pr.maxChain);
        expect(g.maxChain).toBeGreaterThanOrEqual(pr.minChain);
        expect(g.label).toBe(name[0].toUpperCase() + name.slice(1));
        expect(checkUnique(r.puzzle!)).toBe('unique');
      }
  });
});

describe('website daily', () => {
  it('rolls the day over at midnight EST (05:00 UTC)', () => {
    expect(dayKey(Date.UTC(2026, 10, 4, 4, 59))).toBe(20261103);
    expect(dayKey(Date.UTC(2026, 10, 4, 5, 0))).toBe(20261104);
    expect(addDays(20261231, 1)).toBe(20270101);
    expect(addDays(20260301, -1)).toBe(20260228);
    expect(msUntilNextDay(Date.UTC(2026, 10, 4, 4, 0))).toBe(60 * 60 * 1000);
  });

  it('uses the same seed and settings as the lab daily', () => {
    expect(siteDailyParams(20261103)).toEqual(dailyParams('2026-11-03'));
    const r = generate(siteDailyParams(20261103));
    expect(r.puzzle && r.stats.grade?.label).toBe('Medium');
  });
});

describe('large free play boards', () => {
  // One seed each: 9x9 / 10x10 Medium and Hard take seconds each.
  it.each([
    [9, 'medium'],
    [10, 'easy'],
  ] as const)('size %i %s is unique, on target and has no black 0', (size, diff) => {
    const { puzzle, stats } = generate({ ...DEFAULT_PARAMS, ...PRESETS[diff], size, seed: 'big-0' });
    expect(puzzle).not.toBeNull();
    expect(stats.targetMet).toBe(true);
    expect(checkUnique(puzzle!)).toBe('unique');
    for (const c of [...puzzle!.rowClues, ...puzzle!.colClues]) expect(c.kind === 'black' && c.value === 0).toBe(false);
  });
});
