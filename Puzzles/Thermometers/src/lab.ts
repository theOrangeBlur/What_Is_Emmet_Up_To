import { dailyParams, todayString } from './core/daily';
import { clueCounts, type GenResult, type GenStats } from './core/generator';
import { logicSolve, type Grade } from './core/solver/logic';
import type { GenParams, Puzzle } from './core/types';
import { buildBatch } from './ui/batch';
import { Game, type Tool } from './ui/game';
import { GenClient } from './ui/gen-client';
import { buildPanel, escapeHtml } from './ui/panel';
import { loadSavedParams, paramsFromQuery, paramsToQuery, saveParams } from './ui/params';
import { addEntry, download, formatTime, loadLog, saveLog } from './ui/playlog';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const svg = document.querySelector<SVGSVGElement>('#board')!;
const client = new GenClient();

let game: Game | null = null;
let stats: GenStats | null = null;
let tool: Tool = 'red';
let isDaily = false;

// ---- messages / meta --------------------------------------------------------

function message(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
  const m = $('#message');
  m.textContent = text;
  m.className = `message ${kind}`;
}

function updateMeta() {
  if (!game) return;
  const p = game.puzzle;
  const g = game.grade;
  $('#meta').innerHTML = `${isDaily ? `<b>Daily · ${escapeHtml(p.seed.replace('daily-', ''))}</b> · ` : ''}${p.size}×${p.size} · seed <code>${escapeHtml(p.seed)}</code>${
    g ? ` · <span class="lbl lbl-${g.label.replace(/\s/g, '')}">${g.label}</span>` : ''
  }`;
}

// ---- loading ---------------------------------------------------------------

function load(puzzle: Puzzle, grade: Grade | null, st: GenStats | null) {
  stats = st;
  game = new Game(svg, puzzle, grade, {
    onMessage: message,
    onSolved: openWin,
    onChange: () => {},
  });
  game.tool = tool;
  game.wholeMode = wholeMode;
  updateMeta();
  panel.showStats(st, grade, { thermos: puzzle.thermos.length, size: puzzle.size });
  message('');
}

async function generateWith(params: GenParams, daily = false) {
  if (!daily) {
    saveParams(params);
    history.replaceState(null, '', `?${paramsToQuery(params)}`);
  } else history.replaceState(null, '', `?daily=${params.seed.replace('daily-', '')}`);
  panel.write(params);
  panel.setBusy(true);
  $('#busy').hidden = false;
  client.cancelSingle();
  const r = await client.generate(params);
  $('#busy').hidden = true;
  panel.setBusy(false);
  isDaily = daily;
  applyResult(r);
}

function applyResult(r: GenResult) {
  if (!r.puzzle) {
    message(
      `Couldn't make a unique puzzle with these settings in ${r.stats.attempts} attempts (${Object.entries(r.stats.failures.reasons)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ')}). Try more attempts, longer thermometers or a different clue mix.`,
      'bad',
    );
    return;
  }
  load(r.puzzle, r.stats.grade, r.stats);
  if (!r.stats.targetMet) message('Difficulty target not met. Showing the closest unique puzzle found.', 'info');
}

// ---- panel -------------------------------------------------------------------

const panel = buildPanel($('#tab-gen'), {
  onGenerate: (p) => generateWith(p),
  onToday: () => generateWith(dailyParams(todayString()), true),
  onCopyLink: () => {
    const url = location.href;
    navigator.clipboard?.writeText(url).then(
      () => message('Link copied.', 'good'),
      () => message(url),
    );
  },
  onExport: () => (game ? JSON.stringify(game.puzzle) : ''),
  onImport: (json) => {
    try {
      const p = JSON.parse(json) as Puzzle;
      if (!p.size || !Array.isArray(p.thermos) || !Array.isArray(p.solution)) throw new Error('missing fields');
      const grade = logicSolve(p);
      isDaily = false;
      load(p, grade, {
        attempts: 0,
        ms: 0,
        targetMet: true,
        thermos: p.thermos.length,
        clueCounts: clueCounts(p),
        extremes: grade.extremes,
        failures: { nonUnique: 0, offTarget: 0, reasons: {} },
        grade,
      });
      message('Imported puzzle.', 'good');
    } catch (e) {
      message(`Import failed: ${(e as Error).message}`, 'bad');
    }
  },
  onStep: (s) => {
    game?.showStep(s);
    message(s.note, 'info');
  },
});

buildBatch($('#tab-batch'), {
  client,
  getParams: () => panel.read(),
  load: (r, params) => {
    isDaily = false;
    history.replaceState(null, '', `?${paramsToQuery(params)}`);
    panel.write(params);
    applyResult(r);
  },
});

// ---- tabs ----------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll<HTMLElement>('.tab-body').forEach((s) => (s.hidden = s.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'log') renderLog();
  }),
);

// ---- toolbar ---------------------------------------------------------------------

function setTool(t: Tool) {
  tool = t;
  if (game) game.tool = t;
  document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
let wholeMode = false;
function setWhole(on: boolean) {
  wholeMode = on;
  if (game) game.wholeMode = on;
  const b = $('#btn-whole');
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
}
$('#btn-whole').addEventListener('click', () => setWhole(!wholeMode));
$('#btn-undo').addEventListener('click', () => game?.undo());
$('#btn-redo').addEventListener('click', () => game?.redo());
$('#btn-reset').addEventListener('click', () => game?.reset());
$('#btn-check').addEventListener('click', () => game?.check());
$('#btn-hint').addEventListener('click', () => game?.hint());
$('#btn-reveal').addEventListener('click', () => {
  if (game && !game.solved && confirm('Reveal the solution?')) game.reveal();
});

svg.addEventListener('pointerdown', (e) => game?.pointerDown(e));
svg.addEventListener('pointermove', (e) => game?.pointerMove(e));
svg.addEventListener('pointerup', () => game?.pointerUp());
svg.addEventListener('pointercancel', () => game?.pointerUp());
svg.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) game?.redo();
    else game?.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    game?.redo();
  } else if (e.key === '1') setTool('red');
  else if (e.key === '2') setTool('blue');
  else if (e.key === '3') setTool('any');
  else if (e.key === '4') setTool('x');
  else if (e.key === '5') setTool('xr');
  else if (e.key === '6') setTool('xb');
  else if (e.key.toLowerCase() === 'w') setWhole(!wholeMode);
  else if (e.key.toLowerCase() === 'h') game?.hint();
});

setInterval(() => {
  if (game) $('#timer').textContent = formatTime(game.elapsedMs / 1000);
}, 500);

// ---- win dialog + playlog ------------------------------------------------------------

const win = $<HTMLDialogElement>('#win');
function openWin(g: Game) {
  $('#win-summary').textContent = `Time ${formatTime(g.elapsedMs / 1000)} · ${g.hints} hint${g.hints === 1 ? '' : 's'} · ${g.checks} check${g.checks === 1 ? '' : 's'}${g.grade ? ` · rated ${g.grade.label} (score ${g.grade.score})` : ''}`;
  $<HTMLFormElement>('#win-form').reset();
  win.showModal();
}
win.addEventListener('close', () => {
  if (win.returnValue !== 'save' || !game) return;
  const fd = new FormData($<HTMLFormElement>('#win-form'));
  const g = game;
  addEntry({
    at: new Date().toISOString(),
    seed: g.puzzle.seed,
    size: g.puzzle.size,
    params: g.puzzle.params,
    label: g.grade?.label ?? '',
    maxTier: g.grade?.maxTier ?? 0,
    score: g.grade?.score ?? 0,
    clues: stats?.clueCounts ?? clueCounts(g.puzzle),
    timeSec: Math.round(g.elapsedMs / 1000),
    hints: g.hints,
    checks: g.checks,
    rating: Number(fd.get('rating') ?? 3),
    feel: (fd.get('feel') as 'too easy' | 'just right' | 'too hard') ?? '',
    notes: String(fd.get('notes') ?? ''),
  });
  message('Saved to playlog.', 'good');
});

function renderLog() {
  const root = $('#tab-log');
  const log = loadLog();
  root.innerHTML = `
    <div class="row">
      <button id="lexp" ${log.length ? '' : 'disabled'}>Export JSON</button>
      <button id="lclr" ${log.length ? '' : 'disabled'}>Clear</button>
    </div>
    ${
      log.length
        ? `<div class="table-wrap"><table class="btable"><thead><tr><th>When</th><th>Size</th><th>Diff.</th><th>Time</th><th>Hints</th><th>Fun</th><th>Felt</th></tr></thead><tbody>
      ${log
        .map(
          (e, i) => `<tr class="clickable" data-i="${i}" title="${escapeHtml(e.notes)}"><td>${new Date(e.at).toLocaleDateString()}</td><td>${e.size}</td>
        <td><span class="lbl lbl-${e.label.replace(/\s/g, '')}">${e.label}</span></td><td>${formatTime(e.timeSec)}</td><td>${e.hints}</td><td>${'★'.repeat(e.rating)}</td><td>${e.feel}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="muted">Click a row to replay it. Hover to see your notes.</p>`
        : '<p class="muted">Solve a puzzle and save your rating to start a playlog. It\'s stored in this browser.</p>'
    }`;
  root.querySelector('#lexp')?.addEventListener('click', () => download('thermo-playlog.json', JSON.stringify(loadLog(), null, 2)));
  root.querySelector('#lclr')?.addEventListener('click', () => {
    if (confirm('Clear the whole playlog?')) {
      saveLog([]);
      renderLog();
    }
  });
  root.querySelectorAll<HTMLTableRowElement>('tr[data-i]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const e = log[Number(tr.dataset.i)];
      if (e.params) generateWith({ ...e.params, seed: e.seed }, e.seed.startsWith('daily-'));
    }),
  );
}

// ---- startup ------------------------------------------------------------------------

const q = new URLSearchParams(location.search);
const fromUrl = paramsFromQuery(location.search);
if (q.has('daily')) generateWith(dailyParams(q.get('daily')!), true);
else if (fromUrl) generateWith(fromUrl);
else {
  panel.write(loadSavedParams());
  generateWith(dailyParams(todayString()), true).then(() => panel.write(loadSavedParams()));
}
