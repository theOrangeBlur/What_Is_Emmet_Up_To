/** Fill color of a thermometer. A thermometer holds only one color. */
export type Color = 'R' | 'B';

/** A player's fill can also be 'U': filled, color not decided yet. Solutions only use R/B. */
export type FillColor = Color | 'U';

/** Cell states: 0 = empty, 1 = red, 2 = blue, 3 = filled with unknown color (player only). */
export type CellState = 0 | 1 | 2 | 3;

/** red/blue count only that color, black counts any filled cell, none = no clue shown. */
export type ClueKind = 'red' | 'blue' | 'black' | 'none';

export interface Clue {
  kind: ClueKind;
  value: number;
}

/** A thermometer: cell indices (r * size + c), cells[0] is the bulb. */
export interface Thermo {
  cells: number[];
}

/** One thermometer's fill. level 0 means empty (color then irrelevant). */
export interface ThermoState {
  color: FillColor;
  level: number;
}

export type Shape = 'straight' | 'bent' | 'mixed';

/** Relative weights for the starting clue kind of each line (blanks come from minimizing). */
export interface ClueMix {
  red: number;
  blue: number;
  black: number;
}

export interface GenParams {
  size: number;
  seed: string;
  shape: Shape;
  minLen: number;
  maxLen: number;
  /** Average fraction of each thermometer that is filled (0..1). */
  density: number;
  /** Probability a thermometer is red. */
  pRed: number;
  mix: ClueMix;
  /** Remove / downgrade clues while the solution stays unique. */
  minimize: boolean;
  /**
   * Avoid clues near 0 or the line length (they give cells away). -1 = off; m >= 0 marks
   * values <= m or >= size - m as extreme and the generator works to remove them.
   */
  avoidExtremes: number;
  /** Accepted logic-tier range (1..5); maxTier 6 = allow puzzles that need guessing. */
  minTier: number;
  maxTier: number;
  /** Accepted range of logic jumps (steps beyond counting one line). */
  minJumps: number;
  maxJumps: number;
  /** Accepted range for the longest chain of any jump, in lines (maxChain 0 = no cap). */
  minChain: number;
  maxChain: number;
  maxAttempts: number;
}

/** The parts of a puzzle a solver needs. */
export interface PuzzleCore {
  size: number;
  thermos: Thermo[];
  rowClues: Clue[];
  colClues: Clue[];
}

export interface Puzzle extends PuzzleCore {
  solution: ThermoState[];
  seed: string;
  params?: GenParams;
}
