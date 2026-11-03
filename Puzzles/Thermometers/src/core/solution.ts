import type { Rng } from './rng';
import type { Thermo, ThermoState } from './types';

/**
 * Random hidden solution. Level is u^k scaled to 0..len, where k is chosen so the
 * mean fill fraction is roughly `density`.
 */
export function makeSolution(thermos: Thermo[], density: number, pRed: number, rng: Rng): ThermoState[] {
  const d = Math.min(0.95, Math.max(0.05, density));
  const k = (1 - d) / d;
  return thermos.map((t) => {
    const len = t.cells.length;
    const level = Math.min(len, Math.floor(Math.pow(rng.next(), k) * (len + 1)));
    return { color: rng.next() < pRed ? 'R' : 'B', level };
  });
}
