import type { GenResult } from '../core/generator';
import type { GenParams } from '../core/types';
import type { GenClient } from './gen-client';
import { download } from './playlog';

interface Row {
  seed: string;
  result: GenResult;
}

const LABELS = ['Easy', 'Medium', 'Hard', 'Expert', 'Needs guessing'];

export function buildBatch(
  root: HTMLElement,
  deps: { client: GenClient; getParams: () => GenParams; load: (r: GenResult, params: GenParams) => void },
): void {
  root.innerHTML = `
    <p class="muted">Runs the current <b>Generate</b> settings with seeds <code>&lt;seed&gt;-1 … -N</code>. Click a row to play that puzzle.</p>
    <div class="row">
      <label>Puzzles <input type="number" id="bn" value="25" min="1" max="1000" style="width:5em" /></label>
      <button class="primary" id="brun">Run batch</button>
      <button id="bstop" disabled>Stop</button>
      <button id="bcsv" disabled>CSV</button>
    </div>
    <p id="bprog" class="muted"></p>
    <div id="bsum"></div>
    <div class="table-wrap"><table class="btable"><thead><tr>
      <th>#</th><th>Diff.</th><th>Score</th><th>Steps</th><th title="Steps beyond counting one line (tiers 3-5)">Jumps</th><th title="Longest contradiction chain, in lines">Chain</th><th>Ext.</th><th>Clues r/b/k/–</th><th>ms</th><th>Att.</th>
    </tr></thead><tbody id="bbody"></tbody></table></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  let rows: Row[] = [];
  let params: GenParams;
  let total = 0;
  let t0 = 0;

  const summary = () => {
    const ok = rows.filter((r) => r.result.puzzle);
    const met = rows.filter((r) => r.result.puzzle && r.result.stats.targetMet);
    const counts = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<string, number>;
    for (const r of ok) counts[r.result.stats.grade!.label]++;
    const avg = (f: (r: Row) => number) => (ok.length ? ok.reduce((a, r) => a + f(r), 0) / ok.length : 0);
    const clueAvg = (k: 'red' | 'blue' | 'black' | 'none') => avg((r) => r.result.stats.clueCounts[k]).toFixed(1);
    const max = Math.max(1, ...Object.values(counts));
    $('bsum').innerHTML = `
      <dl class="stats">
        <dt>Generated</dt><dd>${ok.length}/${rows.length} unique · ${met.length} on target</dd>
        <dt>Avg time</dt><dd>${avg((r) => r.result.stats.ms).toFixed(0)} ms</dd>
        <dt>Avg jumps</dt><dd>${avg((r) => r.result.stats.grade!.jumps).toFixed(1)} per puzzle · ${(avg((r) => r.result.stats.grade!.jumpShare) * 100).toFixed(0)}% of steps · longest chain ${Math.max(0, ...ok.map((r) => r.result.stats.grade!.maxChain))}</dd>
        <dt>Avg score</dt><dd>${avg((r) => r.result.stats.grade!.score).toFixed(1)}</dd>
        <dt>Avg clues</dt><dd><span class="t-red">${clueAvg('red')}</span> / <span class="t-blue">${clueAvg('blue')}</span> / ${clueAvg('black')} / ${clueAvg('none')} blank</dd>
      </dl>
      <table class="dist">${LABELS.map(
        (l) => `<tr><td>${l}</td><td class="bar-cell"><span class="bar lbl-${l.replace(/\s/g, '')}" style="width:${(counts[l] / max) * 100}%"></span></td><td>${counts[l]}</td></tr>`,
      ).join('')}</table>`;
  };

  const addRow = (i: number, r: Row) => {
    const tr = document.createElement('tr');
    const s = r.result.stats;
    const g = s.grade;
    if (!r.result.puzzle) {
      tr.innerHTML = `<td>${i + 1}</td><td colspan="9" class="muted">failed (${Object.entries(s.failures.reasons).map(([k, v]) => `${k}×${v}`).join(', ')})</td>`;
    } else {
      const cc = s.clueCounts;
      tr.innerHTML = `<td>${i + 1}</td><td><span class="lbl lbl-${g!.label.replace(/\s/g, '')}">${g!.label}</span>${s.targetMet ? '' : ' <span class="warn" title="off target">*</span>'}</td>
        <td>${g!.score}</td><td>${g!.steps.length}</td><td>${g!.jumps}</td><td>${g!.maxChain || ''}</td><td>${g!.extremes}</td><td>${cc.red}/${cc.blue}/${cc.black}/${cc.none}</td><td>${s.ms.toFixed(0)}</td><td>${s.attempts}</td>`;
      tr.className = 'clickable';
      tr.addEventListener('click', () => {
        root.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel'));
        tr.classList.add('sel');
        deps.load(r.result, { ...params, seed: r.seed });
      });
    }
    $('bbody').append(tr);
  };

  const done = () => {
    $<HTMLButtonElement>('brun').disabled = false;
    $<HTMLButtonElement>('bstop').disabled = true;
    $<HTMLButtonElement>('bcsv').disabled = rows.length === 0;
    $('bprog').textContent = `Done: ${rows.length} puzzles in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  };

  $('brun').addEventListener('click', () => {
    params = deps.getParams();
    total = Math.max(1, Math.min(1000, Number($<HTMLInputElement>('bn').value) || 25));
    rows = [];
    t0 = performance.now();
    $('bbody').replaceChildren();
    $('bsum').replaceChildren();
    $<HTMLButtonElement>('brun').disabled = true;
    $<HTMLButtonElement>('bstop').disabled = false;
    $<HTMLButtonElement>('bcsv').disabled = true;
    $('bprog').textContent = `0 / ${total}…`;
    deps.client.runBatch(
      params,
      total,
      (i, seed, result) => {
        const r = { seed, result };
        rows.push(r);
        addRow(i, r);
        summary();
        $('bprog').textContent = `${rows.length} / ${total}…`;
      },
      done,
    );
  });
  $('bstop').addEventListener('click', () => {
    deps.client.stopBatch();
    done();
  });
  $('bcsv').addEventListener('click', () => {
    const head = 'seed,size,unique,targetMet,label,maxTier,score,steps,jumps,jumpShare,maxChain,extremes,red,blue,black,blank,thermos,ms,attempts';
    const lines = rows.map(({ seed, result: { puzzle, stats: s } }) =>
      [
        seed,
        params.size,
        puzzle ? 1 : 0,
        s.targetMet ? 1 : 0,
        s.grade?.label ?? '',
        s.grade?.maxTier ?? '',
        s.grade?.score ?? '',
        s.grade?.steps.length ?? '',
        s.grade?.jumps ?? '',
        s.grade ? s.grade.jumpShare.toFixed(3) : '',
        s.grade?.maxChain ?? '',
        s.grade?.extremes ?? '',
        s.clueCounts.red,
        s.clueCounts.blue,
        s.clueCounts.black,
        s.clueCounts.none,
        s.thermos,
        s.ms.toFixed(0),
        s.attempts,
      ].join(','),
    );
    download(`batch-${params.seed}-${params.size}.csv`, [head, ...lines].join('\n'), 'text/csv');
  });
}
