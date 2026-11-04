# Design notes

How the puzzle and the lab got to where they are: decisions, findings and their reasons. All of this happened in one long working session on 2026-11-03. The goal throughout was a fun two-color Thermometers puzzle that can be generated daily.

## Rules (decided by the designer)
- The starting point was the classic Thermometers puzzle (puzzle-thermometers.com) with **two fill colors, red and blue**.
- **One color per thermometer.** Mixed thermometers were considered and rejected.
- **One clue per row or column:**
  - red counts red cells
  - blue counts blue cells
  - black counts any filled cell
  - blank means no clue
- **Never a black 0.** An empty line gets a red 0, a blue 0 or no clue. If a line ends up empty while marked black, the generator swaps the clue to red or blue.
- **Unique solution required.** Every puzzle is graded by the logic needed to solve it.

## Player marks (requested while playtesting)
The designer asked for these one at a time:
1. A gray **Either** fill: filled, color not yet known.
2. **Whole-thermometer color marks.** A tint, with no cells filled.
3. **Red ✕ and blue ✕**, meaning "not red" and "not blue", in addition to plain ✕. That makes six cell tools plus two thermometer marks.
4. **A colored ✕ on a bulb** becomes a whole-thermometer mark of the *opposite* color, and the ✕ is removed.
5. **Filling a cell clears its ✕ marks.**
6. **Red ✕ + blue ✕** on the same cell becomes a gray ✕.

Hint, Check and mistake detection understand all of these. Hint turns the board into solver-style knowledge per cell (could be empty / red / blue) and compares it with the solver's steps.

## Generation findings
- **Random puzzles are almost never unique.** With one clue per line, random layouts and solutions basically never have a unique solution. That holds even for the one-color original: 0 of 20 random 10×10 boards were unique. Swapping clue kinds alone couldn't fix it.
  - That's why `generator.ts` uses a **repair search**. It mutates the hidden solution and the clue kinds to reduce how much line deduction leaves undecided.
  - Capping the solution count made a poor objective because it plateaued. "Remaining ambiguity after tier 1–3 deduction" works.
  - After repair, clue sets lean heavily on black clues.
- **Extreme clues** (within 1 of 0 or the line length) make puzzles easy, because they give cells away. The designer noticed this in play. The generator now has a polish step and an `avoidExtremes` setting, and the minimizer removes extreme clues first.
- **Large boards were slow, and not worth it.**
  - 15×15 Hard took about a minute per puzzle. The designer said to forget 15×15, then narrowed the range to **4×4–8×8**.
  - Speed fix: during minimizing, uniqueness uses a cheap check when line deduction finishes, and a capped exact count otherwise.
  - Presets that want jumps need the strict version (crossing-line deduction plus a full exact proof). Without it, Hard puzzles stopped coming out Hard.

## Hints: from vague to specific (designer feedback)
1. **"This hint doesn't make sense."** A contradiction hint said only "Suppose R1C1 were empty: counting then breaks a clue."
   - The logic was valid, but the solver took the first cell in scan order that led to a contradiction, and it didn't show the chain.
   - **Fix:** try every assumption on every open cell, including "isn't X". Keep the shortest chain of line counts, and spell the chain out:
     > Suppose R2C6 were blue. Row 1 makes R1C7 red; Column 6 makes R5C7 empty; then Column 7 can't be met.
2. **"Make the hints more specific."** Every hint now names its lines, numbers and thermometers, and ends with the cells it settles. Thermometers are named by their bulb cell.
   - Saturation: "can hold at most 4 red, so every cell that could be red must be."
   - Bounds: "the rest of the line can give at most 3, so the R4C6 thermometer must give at least 1."
3. **"The clue should explain *why* an action wouldn't work."**
   - For crossing-line and line-combination hints, each ruled-out option is tried. One line is held to its clue, and the hint says how the other line fails: "at most 3 blue, not 4", "at least 3 filled, more than 2", or "only 2 or 4, never 3". Options that fail the same way are merged into one sentence.
   - **Known gap:** the hint says the other line tops out at 3 but not *why*. The real reason is usually a budget: each blue in Column 3 costs Column 2 cells, and Column 2 only has 2. Explaining that means listing what each shared thermometer gives both lines. This was discussed but not built.

## Difficulty model: logic jumps
This is the designer's own framing:

> The real question with this game: how many of the logical jumps are made by complex, stepwise decisions, versus just counting off rows and columns. That is the real sense of difficulty.

- **Counting** = tiers 1–2. **Jump** = tiers 3–5.
- **Chain** = how many lines a jump holds at once: line combination 1, crossing lines 2, contradiction 3 or more.
  - A contradiction is never shorter than 3, because a 2-line contradiction is found first as a crossing-line step.
- The old labels (based on max tier) didn't match how puzzles felt, so labels now come from jumps and chains.

What the data showed:

| Board | Easy and old "Medium" | Hard |
|---|---|---|
| 10×10 | 0 jumps, pure counting | about 11 jumps, chains up to 12 lines: too long to follow |
| 6×6 | 0 jumps | about 3 jumps, chains 3–6 lines (mostly 3) |

- **6×6 became the target.** At that size jumps are few and every argument fits in your head.
- **Jumps don't arise on their own.** About 98% of default 6×6 puzzles have 0 jumps.
  - Jumps appear when the minimizer proves uniqueness strictly, so it can remove clues line deduction needs. Avoiding extreme clues helps next most.
  - Shape, density and clue mix barely matter (`npm run knobs`).
  - Even with the right settings, about 70% of attempts give 0 jumps, so the presets rely on retries. That's cheap at these sizes.
- **Bands, as set by the designer:**
  - Medium: 1–2 jumps, chains ≤ 2.
  - Hard: 1–4 jumps, chains ≤ 4. The preset also requires a chain ≥ 3 so a Hard puzzle can't just be a Medium.
  - Expert: beyond Hard. The preset asks for 5+ jumps with chains ≤ 6.
- **Small boards:**
  - Thermometer length is capped at the board width.
  - Boards under 6×6 get extra attempts (3× at 4×4, 2× at 5×5), because jumps are rarer there.
  - 4×4 barely has room for jumps: Expert hits about 28/30.

## Daily puzzle
- It started as 10×10, then moved to 6×6 Medium. The designer liked that one: "decently challenging."
- After trying smaller boards, they chose **5×5 Medium**. In a 30-day preview, every daily was Medium with 1–2 crossing-line jumps and no contradictions.
- The seed is `daily-YYYY-MM-DD`. The puzzle depends on the seed, the settings in `daily.ts` and the generator code. Changing the generator changes every daily, including past ones. Pre-generating or storing dailies would fix that, but it isn't built yet.

## On the website (2026-11-03)
The designer asked for the puzzle on the site, working like Final Wordle: a Daily Challenge plus Free Play with a size of 5×5–10×10 and a difficulty of Easy–Hard.
- **9×9 and 10×10 came back,** this time for Free Play only. With the current presets they hit the Medium and Hard bands at both sizes, so chains stay ≤ 2 and ≤ 4. The earlier problem, chains up to 12, came from settings with no caps. Nothing was retuned, so every seed still gives the same puzzle. The cost is time. 10×10 Medium averages 4.6 s and Hard 8.3 s, and the slowest Hard seed took 37 s. Free Play shows a counter and builds the next puzzle while you play.
- **The daily stays 5×5 Medium.** Its day now rolls over at midnight EST, like Final Wordle's, so one leaderboard shares one puzzle.
- **Dailies are pre-generated** into Supabase each night and never overwritten. A published day no longer changes when the generator does.
- **Daily scoring:** your time, plus 30 s per hint. Check is free. Reveal ends the run with no score.
- **Free Play** keeps personal bests per size and difficulty, counting only solves with no hints. There's no global board: with 18 combos it would be spread thin.

## Open threads
- **Budget explanations** for crossing-line hints (see Hints, item 3).
- **Expert range.** Expert is open-ended and some puzzles need 14–20 jumps. Consider capping it around 10 if those feel like nothing but contradictions.
- **The hint can disagree with the player's reasoning.** It follows the solver's own path. If the player deduced things in a different order, the hint can explain a step from knowledge the player hasn't shown on the board.
- **Slow big boards.** If the 9×9–10×10 wait bothers players, ship a small bank of pre-built puzzles for those combos, so the first one is instant.
- **The playlog** keeps fun and difficulty ratings in the browser's localStorage. Export it from the Playlog tab to keep it across origins or machines.
