import type { Puzzle } from './types';

/**
 * The tutorial's fixed 4x4 puzzle. It was generated once from seed `tutorial-382` (Easy, size 4,
 * maxLen 4; see scripts/tutorial-pick.ts) and copied here, so generator changes can't alter it.
 * Every step is plain counting (tier 1, no jumps). The tutorial text in src/ui/tutorial.ts
 * refers to these exact rows, columns and thermometers, so update it if this changes.
 *
 * Cells show thermometer id; * = bulb, r/b = red/blue in the solution, . = empty.
 * Clues: k = black (drawn white on the page), - = none.
 *
 *          -    -    b2   r4
 *   k1    1.   1.   1*.  2r
 *    -    1.   1.   2*r  2r
 *   k2    3*.  3.   4*b  0*r
 *   k2    5*.  5.   4b   0r
 *
 * Thermometer 1 runs R1C3 -> R1C2 -> R2C2 -> R2C1 -> R1C1; 2 runs R2C3 -> R2C4 -> R1C4.
 */
export const TUTORIAL_PUZZLE: Puzzle = {
  size: 4,
  seed: 'tutorial-382',
  thermos: [
    { cells: [11, 15] },
    { cells: [2, 1, 5, 4, 0] },
    { cells: [6, 7, 3] },
    { cells: [8, 9] },
    { cells: [10, 14] },
    { cells: [12, 13] },
  ],
  rowClues: [
    { kind: 'black', value: 1 },
    { kind: 'none', value: 0 },
    { kind: 'black', value: 2 },
    { kind: 'black', value: 2 },
  ],
  colClues: [
    { kind: 'none', value: 0 },
    { kind: 'none', value: 0 },
    { kind: 'blue', value: 2 },
    { kind: 'red', value: 4 },
  ],
  solution: [
    { color: 'R', level: 2 },
    { color: 'R', level: 0 },
    { color: 'R', level: 3 },
    { color: 'B', level: 0 },
    { color: 'B', level: 2 },
    { color: 'R', level: 0 },
  ],
};
