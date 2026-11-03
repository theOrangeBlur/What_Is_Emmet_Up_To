// How much of each solve is plain counting vs. logical jumps?  npm run jumps -- [size] [count]
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
import { PRESETS } from '../src/core/presets';
const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const size = Number(argv[2]) || 10;
const N = Number(argv[3]) || 20;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const samples: string[] = [];
for (const [name, pr] of Object.entries(PRESETS)) {
  const steps: number[] = [], jumps: number[] = [], share: number[] = [], chains: number[] = [], maxChain: number[] = [], solveMs: number[] = [];
  const byTier = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const r = generate({ ...DEFAULT_PARAMS, ...pr, size, seed: `j${i}` });
    const g = r.stats.grade;
    if (!r.puzzle || !g) continue;
    steps.push(g.steps.length);
    jumps.push(g.jumps);
    share.push(g.jumpShare);
    maxChain.push(g.maxChain);
    solveMs.push(g.ms);
    g.techCounts.forEach((c, t) => (byTier[t] += c));
    for (const s of g.steps) if (s.chain) chains.push(s.chain);
    if (samples.length < 4 && name === 'hard') { const s = g.steps.find((x) => x.tier === 5); if (s) samples.push(s.note); }
  }
  const jh: Record<number, number> = {};
  for (const j of jumps) jh[j] = (jh[j] ?? 0) + 1;
  const hist: Record<number, number> = {};
  for (const c of chains) hist[c] = (hist[c] ?? 0) + 1;
  console.log(
    `${size}x${size} ${name.padEnd(6)} steps ${avg(steps).toFixed(1)}  jumps ${avg(jumps).toFixed(1)} (${(avg(share) * 100).toFixed(0)}%)  ` +
      `per-tier ${byTier.slice(1).map((c) => (c / steps.length).toFixed(1)).join('/')}  ` +
      `chain avg ${avg(chains).toFixed(1)} max ${Math.max(0, ...maxChain)} hist ${JSON.stringify(hist)}  solve ${avg(solveMs).toFixed(0)}ms  jumps/puzzle ${JSON.stringify(jh)}`,
  );
}
console.log('\nSample contradiction hints:\n' + samples.map((s) => '- ' + s).join('\n'));
