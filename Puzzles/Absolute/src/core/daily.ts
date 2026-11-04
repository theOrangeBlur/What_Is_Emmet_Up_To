import { DEFAULT_PARAMS } from './generator';
import { PRESETS } from './presets';
import type { GenParams } from './types';

/**
 * Fixed settings for the daily puzzle: 5x5 Medium (chosen after playtesting).
 * The puzzle for a date depends on these settings and the generator code, so changing either
 * changes every daily, including past ones. The website reads dailies pre-generated into
 * Supabase (scripts/publish-daily.ts), so published dailies stay fixed; local generation
 * is only the fallback.
 */
export const DAILY_PRESET: Omit<GenParams, 'seed'> = {
  ...DEFAULT_PARAMS,
  ...PRESETS.medium,
  size: 5,
  shape: 'mixed',
};

export function todayString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The site-wide day, as YYYYMMDD. It rolls over at midnight EST (UTC-5), the same as
 * Final Wordle's getDayKey(), so everyone on a leaderboard shares one puzzle.
 */
export function dayKey(now = Date.now()): number {
  const d = new Date(now - 5 * 60 * 60 * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** 20261103 -> '2026-11-03' */
export function dayKeyToString(key: number): string {
  const s = String(key);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function addDays(key: number, delta: number): number {
  const s = dayKeyToString(key);
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Milliseconds until the next EST midnight. */
export function msUntilNextDay(now = Date.now()): number {
  const next = new Date(`${dayKeyToString(addDays(dayKey(now), 1))}T05:00:00Z`).getTime();
  return next - now;
}

export function dailyParams(date = todayString()): GenParams {
  return { ...DAILY_PRESET, seed: `daily-${date}` };
}

/** Today's daily on the website (EST day). */
export function siteDailyParams(key = dayKey()): GenParams {
  return dailyParams(dayKeyToString(key));
}
