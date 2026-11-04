// Preview upcoming daily puzzles.  npm run dailies -- [days] [start YYYY-MM-DD]
import { generate } from '../src/core/generator';
import { dailyParams, todayString } from '../src/core/daily';
const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const days = Number(argv[2]) || 30;
const start = new Date(`${argv[3] || todayString()}T12:00:00`);
let met = 0, maxMs = 0;
const jumps: Record<number, number> = {};
for (let i = 0; i < days; i++) {
  const d = new Date(start);
  d.setDate(d.getDate() + i);
  const r = generate(dailyParams(todayString(d)));
  const g = r.stats.grade!;
  if (r.stats.targetMet) met++;
  maxMs = Math.max(maxMs, r.stats.ms);
  jumps[g.jumps] = (jumps[g.jumps] ?? 0) + 1;
  console.log(`${todayString(d)}  ${g.label.padEnd(7)} ${g.jumps} jump${g.jumps === 1 ? ' ' : 's'}  ${g.counting} counting  ${r.stats.ms.toFixed(0)} ms`);
}
console.log(`\n${met}/${days} on target · jumps ${JSON.stringify(jumps)} · slowest ${maxMs.toFixed(0)} ms`);
