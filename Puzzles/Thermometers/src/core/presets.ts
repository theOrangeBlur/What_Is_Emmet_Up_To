import type { GenParams } from './types';

export type PresetName = 'easy' | 'medium' | 'hard' | 'expert';

type PresetKeys = 'avoidExtremes' | 'minTier' | 'maxTier' | 'minJumps' | 'maxJumps' | 'minChain' | 'maxChain' | 'maxAttempts';

/**
 * Difficulty presets for 4x4-8x8 boards (6x6 is the main target). Difficulty is the number of logic
 * jumps (steps beyond counting one line) and the chain of the widest one: 1 line for a
 * line combination, 2 for crossing lines, 3+ for a contradiction.
 * Avoiding extreme clues and proving uniqueness strictly while minimizing both make jumps
 * more likely; the rest comes from retrying, which is cheap on these sizes.
 */
export const PRESETS: Record<PresetName, Pick<GenParams, PresetKeys>> = {
  easy: { avoidExtremes: -1, minTier: 1, maxTier: 5, minJumps: 0, maxJumps: 0, minChain: 0, maxChain: 0, maxAttempts: 30 },
  // No contradictions: one or two crossing-line (or line-combination) steps.
  medium: { avoidExtremes: 1, minTier: 1, maxTier: 5, minJumps: 1, maxJumps: 2, minChain: 0, maxChain: 2, maxAttempts: 150 },
  // At least one short contradiction (3-4 lines), so it can't be a Medium.
  hard: { avoidExtremes: 1, minTier: 1, maxTier: 5, minJumps: 1, maxJumps: 4, minChain: 3, maxChain: 4, maxAttempts: 200 },
  // Beyond Hard: more jumps or a longer chain, still capped so it stays followable.
  expert: { avoidExtremes: 1, minTier: 1, maxTier: 5, minJumps: 5, maxJumps: 99, minChain: 0, maxChain: 6, maxAttempts: 300 },
};

const KEYS: PresetKeys[] = ['avoidExtremes', 'minTier', 'maxTier', 'minJumps', 'maxJumps', 'minChain', 'maxChain'];

export function presetOf(p: GenParams): PresetName | 'custom' {
  for (const [name, v] of Object.entries(PRESETS) as [PresetName, (typeof PRESETS)[PresetName]][])
    if (KEYS.every((k) => v[k] === p[k])) return name;
  return 'custom';
}
