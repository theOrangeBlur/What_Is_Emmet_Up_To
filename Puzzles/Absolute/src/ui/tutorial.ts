// The guided tutorial: a fixed 4x4 puzzle (core/tutorial-puzzle.ts) and a run of text boxes
// the player clicks through. The boxes explain the goal, the clues, the colors and the
// controls, then walk the player through two moves. The board stays playable throughout.
// For a move, a faded "ghost" plays it out cell by cell, on a loop, until the player makes
// it for real; each cell drops out of the ghost as soon as it's done, and the box moves on
// when the whole move is on the board.
// The text names this puzzle's rows and columns, so it changes with the puzzle.
import { cellStates } from '../core/model';
import { M_BLUE, M_EMPTY, M_RED } from '../core/solver/logic';
import { TUTORIAL_PUZZLE } from '../core/tutorial-puzzle';
import type { GhostCell } from './board';
import { MARK_X, type Game } from './game';

const ANY = M_RED | M_BLUE;
const n = TUTORIAL_PUZZLE.size;
const COL = (c: number) => n + c - 1;
const ROW = (r: number) => r - 1;
/** The long bent thermometer with its bulb at R1C3. */
const LONG_THERMO = TUTORIAL_PUZZLE.thermos[1].cells;
/** Ghost frame length, and how many frames the finished ghost holds before replaying. */
const FRAME_MS = 330;
const HOLD_FRAMES = 4;

interface Box {
  /** HTML: the text may color words with .t-red / .t-blue / .t-white. */
  html: string;
  lines?: number[];
  cells?: { cell: number; mask: number }[];
  /** Pulse the toolbar. */
  spot?: boolean;
  /** A move for the player to make, in the order the ghost draws it. */
  move?: GhostCell[];
}

const red = (s: string) => `<b class="t-red">${s}</b>`;
const blue = (s: string) => `<b class="t-blue">${s}</b>`;
const white = (s: string) => `<b class="t-white">${s}</b>`;

const BOXES: Box[] = [
  {
    html:
      `Welcome to Absolute <button type="button" class="tut-x" data-tip="(${n * n}, in this case!)">x</button>! ` +
      `Each tube on the board is a <b>thermometer</b>, and its round end is the <b>bulb</b>. ` +
      `The goal is to fill thermometers so each row and column constraint is satisfied.`,
  },
  {
    html: `Thermometers fill from the bulb outward with no gaps, like mercury rising. A thermometer can be full, partly filled or completely empty. Thermometers in this world are bendy, but that doesn't change how they work!`,
    cells: LONG_THERMO.map((cell) => ({ cell, mask: ANY })),
  },
  {
    html: `${white('White')} numbers count <b>every</b> filled cell in their row or column, red or blue. Row 1's ${white('1')} means exactly one cell in row 1 is filled. A row or column with no number can hold anything.`,
    lines: [ROW(1), ROW(3), ROW(4)],
  },
  {
    html: `Each thermometer is ${red('red')} or ${blue('blue')}, never both. A ${red('red')} number counts only red cells, and a ${blue('blue')} number counts only blue cells. Column 4 needs ${red('4 red')}, and column 3 needs ${blue('2 blue')}.`,
    lines: [COL(3), COL(4)],
  },
  {
    html: `<b>Controls.</b> Left-click a cell to fill red from the bulb up to that cell, and right-click to fill blue. Click the top filled cell again to empty back down. On a phone, pick ${red('Red')} or ${blue('Blue')} in the toolbar and tap.`,
    spot: true,
  },
  {
    html: `<b>✕</b> (or Shift-click) marks a cell you know is empty. <b>Either</b> fills gray when you know a cell is filled but not its color. <b>Undo</b> takes back a move, and <b>Hint</b> explains the next step if you get stuck.`,
    spot: true,
  },
  {
    html: `Let's begin. Column 4 needs ${red('4 red')}, and it only has 4 cells, so <b>every</b> cell in column 4 must be red. Left-click the top and bottom cells of column 4 to fill them, following the faded red.`,
    lines: [COL(4)],
    // Bulb first, the way the fills actually run: R2C3 -> R2C4 -> R1C4, then R3C4 -> R4C4.
    move: [6, 7, 3, 11, 15].map((cell) => ({ cell, kind: 'R' as const })),
  },
  {
    html: `See row 2, column 3? It turned red as well. The top cell of column 4 is the tip of a thermometer whose bulb is in row 2, column 3, and a thermometer can't fill its tip without filling everything back to the bulb.`,
    cells: [{ cell: 6, mask: M_RED }],
  },
  {
    html: `Now row 1. Its ${white('1')} is already met by the red cell in column 4, so every other cell in row 1 must be empty. Mark them ✕: pick the ✕ tool, or Shift-click. You can drag across all three.`,
    lines: [ROW(1)],
    move: [0, 1, 2].map((cell) => ({ cell, kind: 'X' as const })),
  },
  {
    html: `Row 1, column 3 was the <b>bulb</b> of the long thermometer. An empty bulb means nothing past it can fill, so that whole thermometer is empty too.`,
    cells: LONG_THERMO.map((cell) => ({ cell, mask: M_EMPTY })),
  },
  {
    html: `Your turn! Column 3 still needs ${blue('2 blue')}. Which two cells can still be blue? Fill them (right-click, or the ${blue('Blue')} tool) and finish the board. Every step left is just counting like this. Stuck? Press <b>Hint</b>.`,
    lines: [COL(3)],
  },
];

export interface TutorialCtx {
  game: Game;
  box: HTMLElement;
  controls: HTMLElement;
  /** The last box was closed. */
  onHandOff(): void;
}

export interface TutorialRun {
  /** Call after every change to the board. */
  boardChanged(): void;
  stop(): void;
}

export function runTutorial(ctx: TutorialCtx): TutorialRun {
  const { game, box, controls } = ctx;
  let i = 0;
  let done = false;
  let timer: number | undefined;
  let frame = 0;

  const text = document.createElement('div');
  text.className = 'tut-text';
  const foot = document.createElement('div');
  foot.className = 'tut-foot';
  const back = Object.assign(document.createElement('button'), { className: 'tut-link', type: 'button', textContent: '◂ back' });
  const count = Object.assign(document.createElement('span'), { className: 'tut-count' });
  const skip = Object.assign(document.createElement('button'), { className: 'tut-link', type: 'button', textContent: 'skip' });
  const cue = Object.assign(document.createElement('span'), { className: 'tut-cue' });
  foot.append(back, count, skip, cue);
  box.replaceChildren(text, foot);
  box.tabIndex = 0;
  box.hidden = false;

  /** Whether one ghost cell is already on the board for real. */
  function cellDone(g: GhostCell, cells: Uint8Array): boolean {
    if (g.kind === 'X') return game.xs[g.cell] === MARK_X;
    return cells[g.cell] === (g.kind === 'R' ? 1 : 2);
  }

  function remaining(b: Box): GhostCell[] {
    if (!b.move) return [];
    const cells = cellStates(n, TUTORIAL_PUZZLE.thermos, game.states);
    return b.move.filter((g) => !cellDone(g, cells));
  }

  function stopGhost() {
    window.clearInterval(timer);
    timer = undefined;
  }

  /** One ghost frame: grow the faded move a cell at a time, hold it, then start over. */
  function tick() {
    const b = BOXES[i];
    const left = remaining(b);
    const k = frame % (left.length + HOLD_FRAMES);
    frame++;
    game.setOverlay({ lines: b.lines, ghost: left.slice(0, Math.min(k + 1, left.length)) });
  }

  function setCue(b: Box) {
    const last = i === BOXES.length - 1;
    const waiting = b.move && remaining(b).length > 0;
    cue.textContent = waiting ? 'your move ▸' : last ? 'click to start ▸' : 'click to continue ▸';
    box.classList.toggle('tut-waiting', !!waiting);
  }

  function show(k: number) {
    i = Math.max(0, Math.min(BOXES.length - 1, k));
    const b = BOXES[i];
    stopGhost();
    text.innerHTML = b.html;
    count.textContent = `${i + 1} / ${BOXES.length}`;
    back.hidden = i === 0;
    skip.hidden = i === BOXES.length - 1;
    controls.classList.toggle('tut-spot', !!b.spot);
    setCue(b);
    if (b.move && remaining(b).length) {
      frame = 0;
      tick();
      timer = window.setInterval(tick, FRAME_MS);
    } else if (b.lines || b.cells) game.setOverlay({ lines: b.lines, cells: b.cells });
    else game.setOverlay(null);
  }

  function next() {
    if (done) return;
    const b = BOXES[i];
    // A move box waits for the move.
    if (b.move && remaining(b).length) return;
    if (i === BOXES.length - 1) return finish();
    show(i + 1);
  }

  function close() {
    done = true;
    stopGhost();
    box.hidden = true;
    controls.classList.remove('tut-spot');
    window.removeEventListener('keydown', onKey, true);
  }

  function finish() {
    close();
    game.setOverlay(null);
    ctx.onHandOff();
  }

  function onKey(e: KeyboardEvent) {
    if (done || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') show(i - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  box.onclick = (e) => {
    const x = (e.target as HTMLElement).closest('.tut-x');
    if (x) return x.classList.toggle('open'); // the "x" tip opens on tap, without advancing
    next();
  };
  back.onclick = (e) => {
    e.stopPropagation();
    show(i - 1);
  };
  skip.onclick = (e) => {
    e.stopPropagation();
    show(BOXES.length - 1);
  };
  window.addEventListener('keydown', onKey, true);
  show(0);

  return {
    boardChanged() {
      if (done) return;
      const b = BOXES[i];
      if (!b.move) return;
      if (remaining(b).length) {
        setCue(b);
        return;
      }
      // Move made: give the player a beat to see it bold, then move on.
      stopGhost();
      game.setOverlay(null);
      setCue(b);
      const at = i;
      window.setTimeout(() => !done && i === at && remaining(BOXES[at]).length === 0 && show(at + 1), 500);
    },
    stop: close,
  };
}
