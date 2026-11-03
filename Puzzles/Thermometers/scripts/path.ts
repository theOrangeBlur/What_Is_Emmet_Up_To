// Print a puzzle's solve path.  npm run path -- [preset|daily] [seed or YYYY-MM-DD] [size]
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
import { PRESETS, type PresetName } from '../src/core/presets';
import { dailyParams } from '../src/core/daily';
const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const preset = (argv[2] || 'medium') as PresetName;
const r = generate(
  (argv[2] as string) === 'daily'
    ? dailyParams(argv[3])
    : { ...DEFAULT_PARAMS, ...PRESETS[preset], size: Number(argv[4]) || 6, seed: argv[3] || 'path' },
);
const p = r.puzzle!;
const clue = (c: { kind: string; value: number }) => (c.kind === 'none' ? '-' : `${c.kind === 'black' ? 'k' : c.kind[0]}${c.value}`);
console.log(`(r red, b blue, k black, - blank)  rows ${p.rowClues.map(clue).join(' ')} · cols ${p.colClues.map(clue).join(' ')}`);
const g = r.stats.grade!;
console.log(`${preset} · ${g.label} · ${g.counting} counting, ${g.jumps} jumps, longest chain ${g.maxChain}`);
g.steps.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. T${s.tier} ${s.note}`));
