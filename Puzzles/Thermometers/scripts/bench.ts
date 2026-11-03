// Usage: npm run bench -- [sizes...]   e.g. npm run bench -- 4 6 8
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
const sizes = ((globalThis as unknown as { process: { argv: string[] } }).process).argv.slice(2).map(Number).filter(Boolean);
for (const size of sizes.length ? sizes : [4, 5, 6, 7, 8]) {
  for (let i = 0; i < 5; i++) {
    const r = generate({ ...DEFAULT_PARAMS, size, seed: `bench${size}-${i}`, maxTier: 6 });
    const g = r.stats.grade;
    const c = r.stats.clueCounts;
    console.log(
      `${size}x${size} #${i}`,
      r.puzzle ? 'ok  ' : 'FAIL',
      `${Math.round(r.stats.ms)}ms`.padStart(7),
      `att ${r.stats.attempts}`,
      g ? `${g.label.padEnd(14)} score ${g.score}` : '',
      `clues r${c.red} b${c.blue} k${c.black} -${c.none}`,
    );
  }
}
