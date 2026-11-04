// Publish daily puzzles to Supabase (table thermo_daily), so a published daily never changes
// even when the generator does.  npm run publish-daily -- [days ahead, default 1] [--dry]
// Needs SUPABASE_SERVICE_ROLE_KEY. Days already published are left alone.
import { addDays, dayKey, siteDailyParams } from '../src/core/daily';
import { generate } from '../src/core/generator';

const proc = (globalThis as unknown as { process: { argv: string[]; env: Record<string, string | undefined>; exit(code: number): never } }).process;
const args = proc.argv.slice(2);
const dry = args.includes('--dry');
const ahead = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const URL = 'https://nsocmpzeccpoatrfddjf.supabase.co';
const key = (proc.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
if (!key && !dry) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
  proc.exit(1);
}

const today = dayKey();
for (let i = 0; i <= ahead; i++) {
  const date = addDays(today, i);
  const params = siteDailyParams(date);
  const r = generate(params);
  if (!r.puzzle || !r.stats.grade) throw new Error(`${date}: generation failed`);
  const { size, thermos, rowClues, colClues, solution, seed } = r.puzzle;
  const g = r.stats.grade;
  const row = {
    date,
    puzzle: { size, thermos, rowClues, colClues, solution, seed },
    grade: { label: g.label, jumps: g.jumps, maxChain: g.maxChain, score: g.score },
  };
  console.log(`${date} ${seed}: ${g.label}, ${g.jumps} jump(s), chain ${g.maxChain}`);
  if (dry) continue;
  // ignore-duplicates: an existing row (already played) is never replaced.
  const res = await fetch(`${URL}/rest/v1/thermo_daily`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error(`${date}: ${res.status} ${await res.text()}`);
    proc.exit(1);
  }
}
