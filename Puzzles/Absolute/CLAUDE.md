# Thermometers Lab (red & blue)

A two-color Thermometers logic puzzle, plus a lab for generating, playing and grading puzzles. It's built with Vite + TypeScript, vanilla DOM and SVG, and tested with Vitest. Generation runs in a Web Worker. There's no framework and no runtime dependencies.

- `README.md`: rules, commands, file layout, how generation and difficulty work.
- `DESIGN.md`: the history. What the designer asked for, what the data showed, and why things are the way they are. **Read it before changing rules, difficulty, generation or hints.**

## Working with the designer
The user is the puzzle's designer. They playtest and decide by feel, then ask for changes. Several of their preferences are settled:

- **Rules are theirs to decide.** Don't change them without asking:
  - one color per thermometer
  - one clue per line: red, blue, black or blank
  - never a black 0
  - a unique solution
- **Difficulty is measured in logic jumps,** not in the highest tier used. A jump is any step beyond counting one line (tiers 3–5). Its *chain* is how many lines it holds at once.
  - The designer set the bands: Medium 1–2 jumps with chains ≤ 2; Hard ≤ 4 jumps with chains ≤ 4.
  - Report difficulty in these terms, with data (`npm run presets`, `npm run jumps`).
- **Board sizes are 4×4–10×10, with 6×6 the main target.** The designer first dropped boards above 8×8, then brought 9×9 and 10×10 back for Free Play (2026-11-03). The presets hit their bands there unchanged; the cost is generation time (see the README table).
- **The daily puzzle is 5×5 Medium.** The designer chose it and liked it.
- **Hints must explain *why*.** They name the lines, numbers and thermometers, say what would go wrong otherwise, and end with the cells settled. A hint that's true but only states a conclusion counts as a bug.
- When they share a screenshot of a confusing hint, walk through the logic on that board first, then fix the generator of the explanation.

## Things that are easy to break
- **Determinism.** Puzzles come from the seed through `rng.ts`. Any change to the generator, layout, solution sampling or presets changes the puzzle a given seed produces, and that includes every daily (`daily-YYYY-MM-DD`). Say so when a change does this.
- **Hint matching.** `game.ts` `nextStep()` compares the player's marks, turned into per-cell masks (1 empty, 2 red, 4 blue), with the solver's step masks. New marks or tools must feed `playerMasks()`.
- **Black 0.** The generator must never produce one. A test covers it.
- **Strict uniqueness in minimize** (`isUnique(..., hard)`) is what creates jumps. It's on when `minJumps > 0` or `minTier >= 4`. Turning it off makes Medium and Hard come out Easy.
- **Small boards** get extra attempts (3× at 4×4, 2× at 5×5) inside `generate()`. Thermometer length is capped at the board width.

## Checking work
- Run `npm run typecheck` and `npm test` after every change. Tests take about 10 s.
- For difficulty or generation changes, rerun `npm run presets -- 6 40`, plus 5×5 if the daily could be affected. Then compare with the tables in `README.md`, and update those tables if the numbers move.
- For hint text, use `npm run path -- medium <seed>` or `npm run path -- daily <date>` to read whole solve paths.
- For UI changes, run the app and look at it. The previous session drove it with playwright-core and the system Chrome. playwright-core isn't a dependency of this project, so install it somewhere temporary if you need it.

## On the website
- Two pages, both Vite entries:
  - `thermometers.html` + `src/site.ts`: the public page, with Daily Challenge and Free Play.
  - `lab.html` + `src/lab.ts`: the designer's lab.
- **Deploy:** `.github/workflows/build-thermometers.yml` builds on every push to `main` and commits `dist/` to `play/`. The site links to `Puzzles/Thermometers/play/thermometers.html`. Don't edit `play/` by hand. `base` is `'./'`.
- The public page loads the site-wide scripts (`/shared/auth.js`, `awards.js`, `comments.js`, ...) from the site root with `vite-ignore`. They only exist when the **repo root** is served, so test with `python -m http.server` at the repo root and open `/Puzzles/Thermometers/play/thermometers.html`. On localhost, `window.__thermo()` returns the current `Game` for test scripts.
- **The daily:**
  - The day is the EST day key (`dayKey()` in `daily.ts`), the same as Final Wordle's. The seed is still `daily-YYYY-MM-DD`.
  - `.github/workflows/generate-daily-thermo.yml` runs `npm run publish-daily` each night. It stores today's and tomorrow's puzzles in Supabase `thermo_daily` and never overwrites a stored day, so **a generator change no longer changes published dailies**. The page generates locally only if a day is missing.
  - Scores go to `thermo_scores`. A hint adds 30 s, Check is free, and Reveal ends the run with no score. Schema: `/supabase/thermometers.sql`.
- Free Play keeps personal bests per size and difficulty in localStorage (clean solves only), and builds the next puzzle in the background.
- Keep `worker: { format: 'es' }`. The generator worker is an ES module.
- Saved settings and the playlog live in localStorage per origin, so the lab on the website starts fresh. The designer can export the playlog from the Playlog tab.
