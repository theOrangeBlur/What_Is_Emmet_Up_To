import { DEFAULT_PARAMS } from '../core/generator';
import { PRESETS } from '../core/presets';
import type { GenParams, Shape } from '../core/types';

const KEY = 'thermo.params.v2';

/** Short URL keys for each parameter. */
export function paramsToQuery(p: GenParams): string {
  const q = new URLSearchParams({
    seed: p.seed,
    size: String(p.size),
    shape: p.shape,
    len: `${p.minLen}-${p.maxLen}`,
    dens: String(p.density),
    red: String(p.pRed),
    mix: `${p.mix.red}-${p.mix.blue}-${p.mix.black}`,
    min: p.minimize ? '1' : '0',
    ext: String(p.avoidExtremes),
    tier: `${p.minTier}-${p.maxTier}`,
    jumps: `${p.minJumps}-${p.maxJumps}`,
    chain: `${p.minChain}-${p.maxChain}`,
    att: String(p.maxAttempts),
  });
  return q.toString();
}

export function paramsFromQuery(search: string): GenParams | null {
  const q = new URLSearchParams(search);
  if (!q.has('seed')) return null;
  const p: GenParams = structuredClone(DEFAULT_PARAMS);
  const num = (k: string, d: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? v : d;
  };
  const pair = (k: string, d: [number, number]): [number, number] => {
    const parts = (q.get(k) ?? '').split('-').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : d;
  };
  p.seed = q.get('seed')!;
  p.size = clamp(num('size', p.size), 4, 10);
  const shape = q.get('shape');
  if (shape === 'straight' || shape === 'bent' || shape === 'mixed') p.shape = shape as Shape;
  [p.minLen, p.maxLen] = pair('len', [p.minLen, p.maxLen]);
  p.density = num('dens', p.density);
  p.pRed = num('red', p.pRed);
  const mix = (q.get('mix') ?? '').split('-').map(Number);
  if (mix.length === 3 && mix.every(Number.isFinite)) p.mix = { red: mix[0], blue: mix[1], black: mix[2] };
  p.minimize = q.get('min') !== '0';
  p.avoidExtremes = clamp(num('ext', p.avoidExtremes), -1, 3);
  [p.minTier, p.maxTier] = pair('tier', [p.minTier, p.maxTier]);
  [p.minJumps, p.maxJumps] = pair('jumps', [p.minJumps, p.maxJumps]);
  [p.minChain, p.maxChain] = pair('chain', [p.minChain, p.maxChain]);
  p.maxAttempts = num('att', p.maxAttempts);
  return p;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function loadSavedParams(): GenParams {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...startParams(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return startParams();
}

/** First-visit settings: the Medium preset. */
function startParams(): GenParams {
  return { ...structuredClone(DEFAULT_PARAMS), ...PRESETS.medium };
}

export function saveParams(p: GenParams): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function randomSeed(): string {
  const words = ['amber', 'birch', 'cobalt', 'dune', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'jade', 'kelp', 'lumen', 'maple', 'nectar', 'onyx', 'pine', 'quartz', 'rust', 'slate', 'tidal', 'umber', 'violet', 'willow', 'zinc'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
}
