// The public page: Daily Challenge (5x5 Medium, timed, leaderboard) and Free Play (any size
// 5-10, Easy/Medium/Hard). The designer's lab is lab.html / lab.ts.
import { DEFAULT_PARAMS, type GenResult } from './core/generator';
import { dayKey, dayKeyToString, siteDailyParams } from './core/daily';
import { PRESETS } from './core/presets';
import { logicSolve } from './core/solver/logic';
import type { GenParams, Puzzle, ThermoState } from './core/types';
import { Game, type Tool } from './ui/game';
import { GenClient } from './ui/gen-client';
import {
  claimDeviceScores,
  fetchDaily,
  fetchMyScore,
  formatTime,
  insertScore,
  nextDailyCountdown,
  renderLeaderboard,
  shareButton,
  showNameModal,
} from './ui/leaderboard';

/** Each hint used on the daily adds this to the posted time. */
const HINT_PENALTY_MS = 30_000;
const SIZES = [5, 6, 7, 8, 9, 10];
type Diff = 'easy' | 'medium' | 'hard';
const DIFFS: Diff[] = ['easy', 'medium', 'hard'];
const DIFF_LABEL: Record<Diff, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const svg = document.querySelector<SVGSVGElement>('#board')!;
const client = new GenClient();

let mode: 'daily' | 'free' = 'daily';
let game: Game | null = null;
let tool: Tool = 'red';
let wholeMode = false;
/** Bumped on every mode switch / new puzzle so stale async work can tell it's stale. */
let epoch = 0;

// ---- storage ---------------------------------------------------------------

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

interface DailyLocal {
  start?: number;
  hints?: number;
  board?: { states: ThermoState[]; xs: number[] };
  done?: { timeMs: number; hints: number; name?: string };
  revealed?: boolean;
}
const dailyKey = (k: number) => `thermo_daily_${k}`;

// ---- small UI helpers --------------------------------------------------------

function message(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
  const m = $('#message');
  m.textContent = text;
  m.className = `message ${kind}`;
}

/** The game is named for its cell count: the 5x5 daily is Absolute 25, a 10x10 is Absolute 100. */
const gameName = (size: number) => `Absolute ${size * size}`;

function applyName(size: number) {
  $('#game-name').textContent = gameName(size);
  document.title = gameName(size);
}

function setMeta(text: string) {
  $('#meta').textContent = text;
}

function showControls(on: boolean) {
  $('#controls').hidden = !on;
}

function cover(content: HTMLElement | string | null) {
  const c = $('#cover');
  c.innerHTML = '';
  if (content === null) {
    c.hidden = true;
    return;
  }
  if (typeof content === 'string') c.appendChild(Object.assign(document.createElement('div'), { className: 'cover-text', textContent: content }));
  else c.appendChild(content);
  c.hidden = false;
}

function after(...nodes: Node[]) {
  const a = $('#after');
  a.innerHTML = '';
  a.append(...nodes);
}

function div(cls: string, text = ''): HTMLDivElement {
  return Object.assign(document.createElement('div'), { className: cls, textContent: text });
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), { className: cls, textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

let commentsPage: 'thermo_daily' | 'thermo_free' | null = null;

/**
 * Mount a comment thread (or none, before the daily is finished). The note says how
 * posting unlocks, and shows until this player has the page's comment unlock.
 */
function showComments(page: 'thermo_daily' | 'thermo_free' | null, item = '') {
  const slot = $('#comments');
  const note = $('#comments-note');
  commentsPage = page;
  if (!window.Comments) {
    note.hidden = true;
    return;
  }
  slot.hidden = !page;
  if (page) window.Comments.mount(slot, page, item);
  updateCommentsNote();
}

async function updateCommentsNote() {
  const note = $('#comments-note');
  const page = commentsPage;
  if (!page) {
    // Daily, not finished yet: the thread stays hidden (spoilers), so the note stands in for it.
    note.hidden = mode !== 'daily';
    return;
  }
  note.hidden = true;
  let unlocked = false;
  try {
    unlocked = !!(await window.Unlocks?.has(`perk:comment_${page}`));
  } catch {
    /* treat as locked */
  }
  if (page === commentsPage) note.hidden = unlocked;
}
// Solving the daily grants the unlock; drop the note as soon as it lands.
document.addEventListener('unlocks:changed', () => updateCommentsNote());

function dayLabel(k: number) {
  const s = String(k);
  return `${MONTHS[Number(s.slice(4, 6)) - 1]} ${Number(s.slice(6, 8))}, ${s.slice(0, 4)}`;
}

/** Shown on the board, so a daily's time includes its hint penalty. */
function shownMs(g: Game) {
  return g.elapsedMs + (mode === 'daily' ? g.hints * HINT_PENALTY_MS : 0);
}

// ---- game wiring -------------------------------------------------------------

function startGame(puzzle: Puzzle, onSolved: (g: Game) => void, onChange?: (g: Game) => void): Game {
  const grade = logicSolve(puzzle);
  game = new Game(svg, puzzle, grade, {
    onMessage: message,
    onSolved,
    onChange: () => game && onChange?.(game),
  });
  game.tool = tool;
  game.wholeMode = wholeMode;
  // The clue margin is on the left (34 units) and a 6-unit pad on the right of a
  // 40n-unit grid. On wide screens, this shift centers the grid itself, not grid + clues.
  const total = 34 + 40 * puzzle.size + 6;
  svg.style.setProperty('--grid-shift', `${(-(34 - 6) / 2 / total) * 100}%`);
  message('');
  return game;
}

/** Show a finished board: the solution, no input. */
function showSolved(puzzle: Puzzle) {
  const g = startGame(puzzle, () => {});
  g.states = puzzle.solution.map((s) => ({ color: s.level ? s.color : 'U', level: s.level }));
  g.solved = true;
  g.finishedMs = 0;
  g.render();
}

// ---- daily -------------------------------------------------------------------

async function dailyPuzzle(k: number): Promise<Puzzle | null> {
  const published = await fetchDaily(k);
  if (published) return published;
  // Not published (or offline): build it here. Same seed and settings as the publisher.
  generating = true;
  const r = await client.generate(siteDailyParams(k));
  generating = false;
  return r.puzzle;
}

async function openDaily() {
  const my = ++epoch;
  const k = dayKey();
  const local = load<DailyLocal>(dailyKey(k), {});
  applyName(5);
  setMeta(`Daily · ${dayLabel(k)} · 5×5 Medium`);
  document.body.classList.add('is-daily');
  showControls(false);
  after();
  message('');
  cover('loading today’s puzzle...');
  showComments(null);
  const lb = $('#leaderboard');

  const [puzzle, posted] = await Promise.all([dailyPuzzle(k), fetchMyScore(k)]);
  if (my !== epoch) return;
  if (!puzzle) {
    cover('couldn’t load today’s puzzle. Try refreshing.');
    return;
  }

  // Already finished today, here or on another device signed into the same account.
  if (posted || local.done) {
    const timeMs = posted?.time_ms ?? local.done!.timeMs;
    const hints = posted?.hints ?? local.done!.hints;
    const name = posted?.name ?? local.done!.name;
    cover(null);
    showSolved(puzzle);
    dailyRecap(k, 'already solved today', timeMs, hints, name);
    renderLeaderboard(lb, true);
    showComments('thermo_daily', String(k));
    return;
  }
  if (local.revealed) {
    cover(null);
    showSolved(puzzle);
    after(div('recap-solved recap-revealed', 'solution revealed · no score today'), nextDailyCountdown());
    renderLeaderboard(lb, true);
    showComments('thermo_daily', String(k));
    return;
  }

  renderLeaderboard(lb, false);
  const begin = () => {
    const state = load<DailyLocal>(dailyKey(k), {});
    if (!state.start) save(dailyKey(k), { ...state, start: Date.now() });
    playDaily(k, puzzle);
  };
  if (local.start) begin();
  else {
    // The board stays covered until BEGIN so the clock is fair.
    const wrap = div('start-container');
    wrap.append(div('cover-text', '5×5 · Medium · timed'), button('start-btn', 'BEGIN', begin));
    cover(wrap);
  }
}

function playDaily(k: number, puzzle: Puzzle) {
  const local = load<DailyLocal>(dailyKey(k), {});
  const persist = (g: Game) => {
    const cur = load<DailyLocal>(dailyKey(k), {});
    save(dailyKey(k), { ...cur, hints: g.hints, board: { states: g.states, xs: Array.from(g.xs) } });
  };
  const g = startGame(puzzle, (g) => finishDaily(k, g), persist);
  // The clock runs from BEGIN, across refreshes.
  g.startedAt = performance.now() - (Date.now() - (local.start ?? Date.now()));
  g.hints = local.hints ?? 0;
  if (local.board && local.board.states.length === puzzle.thermos.length) {
    g.states = local.board.states;
    g.xs = Uint8Array.from(local.board.xs);
    g.render();
  }
  cover(null);
  showControls(true);
}

async function finishDaily(k: number, g: Game) {
  const timeMs = shownMs(g);
  const hints = g.hints;
  const cur = load<DailyLocal>(dailyKey(k), {});
  save(dailyKey(k), { ...cur, done: { timeMs, hints }, board: undefined });
  showControls(false);
  window.Awards?.unlock('thermo_daily');
  if (hints === 0) window.Awards?.unlock('thermo_nohint');

  const detail = hints ? `${hints} hint${hints === 1 ? '' : 's'} (+${(hints * HINT_PENALTY_MS) / 1000}s)` : 'no hints';
  const name = await showNameModal(timeMs, detail, (n) => insertScore(n, timeMs, hints, k));
  save(dailyKey(k), { ...load<DailyLocal>(dailyKey(k), {}), done: { timeMs, hints, name: name ?? undefined } });
  if (mode !== 'daily') return;
  dailyRecap(k, 'solved!', timeMs, hints, name ?? undefined);
  await renderLeaderboard($('#leaderboard'), true);
  showComments('thermo_daily', String(k));
}

function dailyRecap(k: number, title: string, timeMs: number, hints: number, name?: string) {
  const stats = `${name ? `${name} — ` : ''}${formatTime(timeMs)}${hints ? ` · ${hints} hint${hints === 1 ? '' : 's'}` : ''}`;
  const share = () => `${gameName(5)} daily ${dayKeyToString(k)}: ${formatTime(timeMs)}${hints ? ` (${hints} hint${hints === 1 ? '' : 's'})` : ' no hints'} · whatisemmetupto.com`;
  const box = div('daily-recap');
  box.append(div('recap-solved', title), div('recap-stats', stats), nextDailyCountdown(), shareButton(share));
  after(box);
  message('');
}

// ---- free play -----------------------------------------------------------------

interface FreeSettings {
  size: number;
  diff: Diff;
}
const FREE_KEY = 'thermo_free_settings';
const freeSettings = (): FreeSettings => {
  const s = load<FreeSettings>(FREE_KEY, { size: 6, diff: 'medium' });
  return { size: SIZES.includes(s.size) ? s.size : 6, diff: DIFFS.includes(s.diff) ? s.diff : 'medium' };
};
const bestKey = (s: FreeSettings) => `thermo_best_${s.size}_${s.diff}`;

function freeParams(s: FreeSettings): GenParams {
  const seed = `free-${Math.random().toString(36).slice(2, 10)}`;
  return { ...DEFAULT_PARAMS, ...PRESETS[s.diff], size: s.size, seed };
}

/** The next free puzzle, built in the background while the current one is played. */
let prefetch: { key: string; result: Promise<GenResult> } | null = null;
/** True while the worker is building a puzzle someone is waiting on. */
let generating = false;

/** Drop whatever the worker is doing (a stale request or prefetch), so the next request starts now. */
function stopGenerating() {
  if (generating || prefetch) client.cancelSingle();
  generating = false;
  prefetch = null;
}
const settingsKey = (s: FreeSettings) => `${s.size}-${s.diff}`;

function takePuzzle(s: FreeSettings): Promise<GenResult> {
  if (prefetch && prefetch.key === settingsKey(s)) {
    const r = prefetch.result;
    prefetch = null;
    return r;
  }
  // Settings changed (or nothing prefetched): start fresh rather than queue behind stale work.
  stopGenerating();
  return client.generate(freeParams(s));
}

function startPrefetch(s: FreeSettings) {
  prefetch = { key: settingsKey(s), result: client.generate(freeParams(s)) };
}

async function openFree() {
  const my = ++epoch;
  const s = freeSettings();
  document.body.classList.remove('is-daily');
  $<HTMLSelectElement>('#free-size').value = String(s.size);
  $<HTMLSelectElement>('#free-diff').value = s.diff;
  applyName(s.size);
  setMeta(`Free Play · ${s.size}×${s.size} ${DIFF_LABEL[s.diff]}`);
  showControls(false);
  after();
  message('');
  showComments('thermo_free', 'freeplay');
  renderBest(s);

  // 9x9 / 10x10 Medium and Hard average 1.5-8 s, with rare seeds over 30 s (10x10 Hard), so show a count.
  const slow = s.size >= 9 && s.diff !== 'easy';
  const wrap = div('start-container');
  const label = div('cover-text', slow ? 'building a big one...' : 'building a puzzle...');
  wrap.append(label);
  const t0 = Date.now();
  const ticker = setInterval(() => {
    if (my !== epoch || !wrap.isConnected) return clearInterval(ticker);
    const sec = Math.floor((Date.now() - t0) / 1000);
    if (sec >= 2) label.textContent = `${slow ? 'building a big one' : 'building a puzzle'}... ${sec}s`;
  }, 500);
  wrap.append(button('pill', 'cancel', () => {
    stopGenerating();
    epoch++;
    cover('cancelled. Pick a size and press New puzzle.');
  }));
  cover(wrap);

  const pending = takePuzzle(s);
  generating = true;
  let r = await pending;
  // A miss is rare; retry with fresh seeds rather than show an error.
  for (let i = 0; i < 3 && !r.puzzle && my === epoch; i++) r = await client.generate(freeParams(s));
  if (my !== epoch) return;
  generating = false;
  if (!r.puzzle) {
    cover('couldn’t build a puzzle with these settings. Try again.');
    return;
  }
  cover(null);
  showControls(true);
  startGame(r.puzzle, (g) => finishFree(s, g));
  startPrefetch(s);
}

function finishFree(s: FreeSettings, g: Game) {
  showControls(false);
  const timeMs = g.elapsedMs;
  const solves = load<number>('thermo_free_solves', 0) + 1;
  save('thermo_free_solves', solves);
  window.Awards?.progress('thermo_free10', solves, 10);
  window.Awards?.tally('thermo_free_solves', 1);

  // Personal bests only count clean solves, so a hinted run never beats a real one.
  const prev = load<number | null>(bestKey(s), null);
  const clean = g.hints === 0;
  const isBest = clean && (prev === null || timeMs < prev);
  if (isBest) save(bestKey(s), timeMs);
  renderBest(s);

  const stats = `${formatTime(timeMs)}${g.hints ? ` · ${g.hints} hint${g.hints === 1 ? '' : 's'}` : ''}${isBest ? ' · new best!' : ''}`;
  const box = div('daily-recap');
  box.append(div('recap-solved', 'solved!'), div('recap-stats', stats), button('start-btn', 'NEXT', () => openFree()));
  after(box);
  message('');
}

function renderBest(s: FreeSettings) {
  const lb = $('#leaderboard');
  lb.innerHTML = '';
  lb.appendChild(div('lb-title', 'your best times'));
  const table = document.createElement('table');
  table.className = 'lb-table lb-best';
  const head = document.createElement('tr');
  head.className = 'lb-header';
  for (const h of ['SIZE', ...DIFFS.map((d) => DIFF_LABEL[d].toUpperCase())]) head.appendChild(Object.assign(document.createElement('th'), { textContent: h }));
  table.appendChild(head);
  for (const size of SIZES) {
    const tr = document.createElement('tr');
    tr.className = 'lb-row';
    tr.appendChild(Object.assign(document.createElement('td'), { textContent: `${size}×${size}` }));
    for (const d of DIFFS) {
      const best = load<number | null>(bestKey({ size, diff: d }), null);
      const td = Object.assign(document.createElement('td'), { textContent: best === null ? '·' : formatTime(best) });
      if (size === s.size && d === s.diff) td.className = 'lb-current';
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  lb.appendChild(table);
  lb.appendChild(div('lb-note', 'solves without hints'));
}

// ---- mode toggle + free settings ------------------------------------------------

function setMode(m: 'daily' | 'free') {
  mode = m;
  $('#mode-daily').classList.toggle('active', m === 'daily');
  $('#mode-free').classList.toggle('active', m === 'free');
  $('#free-bar').hidden = m !== 'free';
  game = null;
  stopGenerating();
  history.replaceState(null, '', m === 'free' ? '?free' : location.pathname);
  if (m === 'daily') openDaily();
  else openFree();
}
$('#mode-daily').addEventListener('click', () => mode !== 'daily' && setMode('daily'));
$('#mode-free').addEventListener('click', () => mode !== 'free' && setMode('free'));

function readFreeBar() {
  save(FREE_KEY, { size: Number($<HTMLSelectElement>('#free-size').value), diff: $<HTMLSelectElement>('#free-diff').value });
}
$('#free-size').addEventListener('change', () => {
  readFreeBar();
  stopGenerating();
  openFree();
});
$('#free-diff').addEventListener('change', () => {
  readFreeBar();
  stopGenerating();
  openFree();
});
$('#free-new').addEventListener('click', () => {
  if (game && !game.solved && game.states.some((st) => st.level > 0) && !confirm('Start a new puzzle? This one will be lost.')) return;
  openFree();
});

// ---- toolbar -----------------------------------------------------------------------

function setTool(t: Tool) {
  tool = t;
  if (game) game.tool = t;
  document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
document.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
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
$('#btn-hint').addEventListener('click', () => hint());
$('#btn-reveal').addEventListener('click', () => reveal());

function hint() {
  if (!game || game.solved) return;
  game.hint();
  if (mode === 'daily') {
    // Save the count now: a hint doesn't change the board, so it wouldn't be saved otherwise.
    const k = dayKey();
    save(dailyKey(k), { ...load<DailyLocal>(dailyKey(k), {}), hints: game.hints });
    message(`${$('#message').textContent} (+30s)`, 'info');
  }
}

function reveal() {
  const g = game;
  if (!g || g.solved) return;
  if (mode === 'daily') {
    if (!confirm('Reveal the solution? Your daily run ends with no score.')) return;
    const k = dayKey();
    save(dailyKey(k), { ...load<DailyLocal>(dailyKey(k), {}), revealed: true, board: undefined });
    g.reveal();
    showControls(false);
    after(div('recap-solved recap-revealed', 'solution revealed · no score today'), nextDailyCountdown());
    renderLeaderboard($('#leaderboard'), true);
    showComments('thermo_daily', String(k));
  } else {
    if (!confirm('Reveal the solution?')) return;
    g.reveal();
    showControls(false);
    const box = div('daily-recap');
    box.append(div('recap-stats', 'revealed'), button('start-btn', 'NEXT', () => openFree()));
    after(box);
  }
}

svg.addEventListener('pointerdown', (e) => game?.pointerDown(e));
svg.addEventListener('pointermove', (e) => game?.pointerMove(e));
svg.addEventListener('pointerup', () => game?.pointerUp());
svg.addEventListener('pointercancel', () => game?.pointerUp());
svg.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select') || document.querySelector('.arcade-overlay')) return;
  if ($('#controls').hidden) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) game?.redo();
    else game?.undo();
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault();
    game?.redo();
  } else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (k === '1') setTool('red');
  else if (k === '2') setTool('blue');
  else if (k === '3') setTool('any');
  else if (k === '4') setTool('x');
  else if (k === '5') setTool('xr');
  else if (k === '6') setTool('xb');
  else if (k === 'w') setWhole(!wholeMode);
  else if (k === 'h') hint();
});

setInterval(() => {
  $('#timer').textContent = game && !$('#controls').hidden ? formatTime(shownMs(game)).replace(/\.\d$/, '') : '';
}, 250);

// ---- start -------------------------------------------------------------------------

setMode(new URLSearchParams(location.search).has('free') ? 'free' : 'daily');

// A daily solved signed out has no account on it. Once signed in, claim it so the
// name links to the profile, then redraw the board (times only if today is finished).
async function claimScores() {
  if (!(await claimDeviceScores()) || mode !== 'daily') return;
  const local = load<DailyLocal>(dailyKey(dayKey()), {});
  renderLeaderboard($('#leaderboard'), !!(local.done || local.revealed));
}
claimScores();
window.MonthBoard?.announce('thermo');
window.Auth?.onAuthStateChange?.((session) => {
  if (session) claimScores();
});

// Local testing only: lets a browser script read the current puzzle.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') (window as unknown as { __thermo: () => Game | null }).__thermo = () => game;
