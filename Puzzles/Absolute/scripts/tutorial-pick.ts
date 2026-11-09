// Find candidate tutorial puzzles: 4x4, counting only, with red, blue and black clues.
//   npm run tutorial-pick -- [count] [show]
// Prints each candidate's board, clues and solve path. The chosen one is copied into
// src/core/tutorial-puzzle.ts by hand, so later generator changes can't alter it.
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
import { PRESETS } from '../src/core/presets';
import { M_BLUE, M_EMPTY, M_RED } from '../src/core/solver/logic';
import type { Puzzle } from '../src/core/types';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const tries = Number(argv[2]) || 300;
const show = Number(argv[3]) || 6;
const single = (m: number) => m === M_RED || m === M_BLUE || m === M_EMPTY;

function draw(p: Puzzle): string {
  const n = p.size;
  const grid: string[] = new Array(n * n).fill('.');
  p.thermos.forEach((t, id) => {
    const s = p.solution[id];
    t.cells.forEach((c, k) => {
      const ch = String.fromCharCode(97 + id);
      grid[c] = k < s.level ? (s.color === 'R' ? ch.toUpperCase() + 'r' : ch.toUpperCase() + 'b') : ch + (k === 0 ? 'o' : '-');
    });
  });
  const clue = (c: { kind: string; value: number }) => (c.kind === 'none' ? ' -' : `${c.kind === 'black' ? 'k' : c.kind[0]}${c.value}`);
  const lines = [`     ${p.colClues.map(clue).join(' ')}`];
  for (let r = 0; r < n; r++) lines.push(`${clue(p.rowClues[r])}   ${grid.slice(r * n, r * n + n).join(' ')}`);
  return lines.join('\n');
}

let shown = 0;
for (let i = 1; i <= tries && shown < show; i++) {
  const seed = `tutorial-${i}`;
  const r = generate({ ...DEFAULT_PARAMS, ...PRESETS.easy, size: 4, seed, maxLen: 4 });
  const p = r.puzzle;
  const g = r.stats.grade;
  if (!p || !g || g.jumps !== 0) continue;
  const clues = [...p.rowClues, ...p.colClues];
  const kinds = new Set(clues.map((c) => c.kind));
  if (!kinds.has('red') || !kinds.has('blue') || !kinds.has('black')) continue;
  if (clues.some((c) => c.kind === 'black' && c.value === 0)) continue;
  const filled = p.solution.filter((s) => s.level > 0);
  if (!filled.some((s) => s.color === 'R') || !filled.some((s) => s.color === 'B')) continue;
  if (!p.solution.some((s, t) => s.level < p.thermos[t].cells.length)) continue;
  if (g.steps.length < 4 || g.steps.length > 9) continue;
  if (!g.steps.slice(0, 3).every((s) => s.cells.every((c) => single(c.mask)))) continue;
  shown++;
  console.log(`\n=== ${seed} · ${g.steps.length} steps · tiers ${g.steps.map((s) => s.tier).join('')}`);
  console.log('(cells: letter = thermometer, o = bulb, R/b = filled red/blue in solution, - = empty)');
  console.log(draw(p));
  g.steps.forEach((s, k) => console.log(`${String(k + 1).padStart(2)}. T${s.tier} ${s.note}`));
}
if (!shown) console.log('no candidates');
