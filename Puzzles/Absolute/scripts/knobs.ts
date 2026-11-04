// Which generator settings move the jump count at 6x6?  (exploratory)  npm run knobs
import { generate, DEFAULT_PARAMS } from '../src/core/generator';
import type { GenParams } from '../src/core/types';
const N = 60;
const base: GenParams = { ...DEFAULT_PARAMS, size: 6, minTier: 4, maxTier: 5, maxAttempts: 1 };
const variants: [string, Partial<GenParams>][] = [
  ['default', {}],
  ['avoidExt1', { avoidExtremes: 1 }],
  ['avoidExt0', { avoidExtremes: 0 }],
  ['len2-4', { minLen: 2, maxLen: 4 }],
  ['len3-6', { minLen: 3, maxLen: 6 }],
  ['bent', { shape: 'bent' }],
  ['straight', { shape: 'straight' }],
  ['dens.35', { density: 0.35 }],
  ['dens.65', { density: 0.65 }],
  ['colorHeavy', { mix: { red: 4, blue: 4, black: 1 } }],
  ['blackHeavy', { mix: { red: 1, blue: 1, black: 4 } }],
  ['noMinimize', { minimize: false }],
  ['ext1+bent', { avoidExtremes: 1, shape: 'bent' }],
  ['ext1+color', { avoidExtremes: 1, mix: { red: 4, blue: 4, black: 1 } }],
];
for (const [name, v] of variants) {
  const hist: Record<string, number> = {};
  let ok = 0, jumps = 0, chainMax = 0, chainSum = 0, chainN = 0, ms = 0;
  for (let i = 0; i < N; i++) {
    const r = generate({ ...base, ...v, seed: `k${i}` });
    ms += r.stats.ms;
    const g = r.stats.grade;
    if (!r.puzzle || !g) continue;
    ok++;
    jumps += g.jumps;
    const b = !g.solved ? 'X' : g.jumps >= 6 ? '6+' : String(g.jumps);
    hist[b] = (hist[b] ?? 0) + 1;
    chainMax = Math.max(chainMax, g.maxChain);
    for (const s of g.steps) if (s.chain) { chainSum += s.chain; chainN++; }
  }
  const order = ['0', '1', '2', '3', '4', '5', '6+', 'X'];
  console.log(
    `${name.padEnd(12)} ok ${ok}/${N} avgJ ${(jumps / ok).toFixed(2)}  ` +
      order.map((k) => `${k}:${hist[k] ?? 0}`).join(' ') +
      `  chain avg ${(chainSum / Math.max(1, chainN)).toFixed(1)} max ${chainMax}  ${(ms / N).toFixed(0)}ms`,
  );
}
