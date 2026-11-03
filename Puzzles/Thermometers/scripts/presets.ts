// Benchmark the difficulty presets.  npm run presets -- [size] [count]
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
import { PRESETS } from '../src/core/presets';
const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const size = Number(argv[2]) || 6;
const N = Number(argv[3]) || 40;
for (const [name, pr] of Object.entries(PRESETS)) {
  const labels: Record<string, number> = {};
  const jh: Record<number, number> = {};
  const ch: Record<number, number> = {};
  let met = 0, ms = 0, maxMs = 0, att = 0, chainMax = 0, ext = 0;
  for (let i = 0; i < N; i++) {
    const r = generate({ ...DEFAULT_PARAMS, ...pr, size, seed: `q${i}` });
    ms += r.stats.ms; maxMs = Math.max(maxMs, r.stats.ms); att += r.stats.attempts;
    const g = r.stats.grade;
    if (!r.puzzle || !g) continue;
    if (r.stats.targetMet) met++;
    labels[g.label] = (labels[g.label] ?? 0) + 1;
    jh[g.jumps] = (jh[g.jumps] ?? 0) + 1;
    chainMax = Math.max(chainMax, g.maxChain);
    ch[g.maxChain] = (ch[g.maxChain] ?? 0) + 1;
    ext += g.extremes;
  }
  console.log(`${size}x${size} ${name.padEnd(6)} on-target ${met}/${N}  avg ${(ms / N).toFixed(0)}ms (max ${maxMs.toFixed(0)})  attempts ${(att / N).toFixed(1)}  ext ${(ext / N).toFixed(1)}  chains ${JSON.stringify(ch)}  labels ${JSON.stringify(labels)}  jumps ${JSON.stringify(jh)}`);
}
