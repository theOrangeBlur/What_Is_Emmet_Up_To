# Absolute 25 lab: red & blue Thermometers

Published on the site as Absolute N (N = cells on the board); formerly Thermometers.

A two-color variant of the Thermometers logic puzzle, with a lab for generating, playing and grading puzzles. Daily puzzles come from the same generator.

## Rules
- Thermometers fill from the bulb with no gaps. A thermometer can be partly filled or empty.
- Each thermometer is **red or blue, never both**.
- Each row and column has at most one clue:
  - **red** counts red cells
  - **blue** counts blue cells
  - **black** counts all filled cells, and is never 0
  - a blank line has no constraint
- Every generated puzzle has exactly one solution.

## Commands
```
npm install
npm run dev        # Vite dev server: /absolute.html (public page), /lab.html (lab)
npm test           # exact solver vs brute force, generator uniqueness, presets hit their targets
npm run typecheck
npm run build      # static site in dist/
```

Analysis scripts (Node, via vite-node):

| Command | What it shows |
|---|---|
| `npm run presets -- [size] [count]` | each preset's on-target rate, time, jumps and chains |
| `npm run jumps -- [size] [count]` | counting vs. jump steps per preset, chain histogram, sample hints |
| `npm run knobs` | which generator settings move the jump count (6×6) |
| `npm run path -- <preset\|daily> <seed\|date> [size]` | one puzzle's clues and full solve path, as hint text |
| `npm run dailies -- [days] [start date]` | upcoming daily puzzles and their difficulty |
| `npm run bench -- [sizes…]` | raw generation timing with default settings |
| `npm run publish-daily -- [days ahead] [--dry]` | store upcoming dailies in Supabase (needs `SUPABASE_SERVICE_ROLE_KEY`) |

## Layout
- `src/core/`: pure TypeScript with no DOM, so it also runs in Node.
  - `types.ts`: puzzle, clue and parameter types
  - `rng.ts`: seeded PRNG, so the same seed gives the same puzzle
  - `layout.ts`: random thermometer partition of the grid
  - `solution.ts`: random hidden fill
  - `model.ts`: shared helpers
  - `solver/csp.ts`: option model (each thermometer is empty, red to level k, or blue to level k) and bounds propagation
  - `solver/exact.ts`: solution counter used for uniqueness
  - `solver/logic.ts`: human-style tiered solver. It produces the grade, the hints (text explanations) and the solve path.
  - `generator.ts`: repair search, polish, minimize, grade, retry
  - `presets.ts`: difficulty presets
  - `daily.ts`: date → seed → fixed settings
- `src/ui/`:
  - `board.ts`: SVG board
  - `game.ts`: play state, input, hints, mistakes, undo
  - `panel.ts`: Generate tab
  - `batch.ts`: Batch tab
  - `playlog.ts`: playtest notes in localStorage
  - `params.ts`: URL and saved settings
- `src/worker.ts`: runs generation off the main thread
- `src/lab.ts`: lab wiring (`lab.html`)
- `src/site.ts`: the public Daily / Free Play page (`absolute.html`)
- `src/ui/leaderboard.ts`: Supabase daily scores, name entry, countdown
- `src/ui/board.css`: board styles shared by both pages
- `tests/core.test.ts`: the test suite
- `scripts/`: the analysis scripts above
- `DESIGN.md`: the design history, findings and the reasons behind the current settings. Read it before changing difficulty or generation.

## Playing
| Input | Effect |
|---|---|
| Left-click | Fills red up to the cell |
| Right-click | Fills blue up to the cell |
| Alt-click / **Either** tool | Fills gray: filled, color not yet known. Gray counts toward black clues only. |
| Shift-click / **✕** tool | Marks a cell empty |
| Red ✕ / blue ✕ tools | Mark "not red" / "not blue". Both together become a gray ✕. A colored ✕ on a bulb marks the whole thermometer the other color instead. |
| Ctrl-click / **Mark thermo** | Tints a whole thermometer red or blue without filling it |
| Click the top filled cell again | Empties back down to that cell |

Filling a cell clears its ✕ marks.

Keys: 1–6 pick the tools, W toggles Mark thermo, H gives a hint, Ctrl+Z undoes and Ctrl+Y redoes.

Hint shows the next solver step the board doesn't reflect yet. It highlights the lines involved and explains why the step follows.

## How generation works
Random layouts with random solutions are almost never unique with one clue per line, so the generator repairs instead of sampling:

1. Make a layout and a hidden solution, and give every line a random clue kind.
2. **Repair:** measure how much stays undecided after line-by-line deduction. Re-roll the fill of an undecided thermometer, or the clue kind of a line it touches, and keep moves that don't make things worse.
3. **Polish:** reduce *extreme* clues (near 0 or the line length), which give cells away.
4. **Minimize:** blank each clue that isn't needed, or downgrade red/blue to black. Extreme clues go first.
5. **Grade** with the logic solver, and retry until the result matches the target.

## Difficulty
The logic solver always uses the simplest technique that makes progress:

| Tier | Technique | Kind |
|---|---|---|
| 1 | Saturation: a clue equals the most or least its line can hold | counting |
| 2 | Line bounds: what the rest of the line can still give | counting |
| 3 | Line combinations: only some exact combinations add up | jump, chain 1 |
| 4 | Crossing lines: two lines that share thermometers, worked out together | jump, chain 2 |
| 5 | Contradiction: assume something about a cell, follow the counts, and hit a broken clue | jump, chain 3+ |

Difficulty is measured in **jumps**: how often counting along one line isn't enough. A jump's **chain** is how many lines you have to hold at once. For a contradiction, the solver tries every assumption and keeps the one with the shortest chain.

| Label | Jumps | Longest chain |
|---|---|---|
| Easy | 0 | – |
| Medium | 1–2 | ≤ 2 (no contradictions) |
| Hard | ≤ 4 | ≤ 4 |
| Expert | anything beyond Hard | preset caps it at 6 |

The Hard preset also requires a chain of at least 3, so it always contains a contradiction. Medium and up avoid extreme clues and prove uniqueness strictly while minimizing, which are the two settings that create jumps.

**Board sizes are 4×4 to 10×10**, with 6×6 as the main design target. Free Play on the website offers 5×5–10×10. The daily puzzle is **5×5 Medium**.

Presets at each size, 30 seeds (on-target count and average generation time):

| Preset | 4×4 | 5×5 | 6×6 | 7×7 | 8×8 | 9×9 | 10×10 |
|---|---|---|---|---|---|---|---|
| Easy | 30/30, 2 ms | 30/30, 3 ms | 40/40, 4 ms | 30/30, 10 ms | 30/30, 23 ms | 30/30, 45 ms | 30/30, 96 ms |
| Medium | 30/30, 160 ms | 30/30, 85 ms | 40/40, 190 ms | 30/30, 420 ms | 30/30, 1.2 s | 30/30, 1.5 s (max 9 s) | 30/30, 4.6 s (max 12 s) |
| Hard | 30/30, 70 ms | 30/30, 120 ms | 40/40, 265 ms | 30/30, 500 ms | 30/30, 1.9 s | 30/30, 4.0 s (max 12 s) | 30/30, 8.3 s (max 37 s) |
| Expert | 28/30, 850 ms | 30/30, 500 ms | 40/40, 400 ms | 30/30, 440 ms | 30/30, 0.9 s | 30/30, 2.1 s (max 16 s) | 30/30, 3.9 s (max 38 s) |

The 6×6 column used 40 seeds. The 9×9 and 10×10 columns were added on 2026-11-03 with the presets unchanged; chains stay inside their bands there too.
