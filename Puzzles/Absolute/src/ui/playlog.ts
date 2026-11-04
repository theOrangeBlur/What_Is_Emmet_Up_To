import type { GenParams } from '../core/types';

export interface PlayEntry {
  at: string;
  seed: string;
  size: number;
  params?: GenParams;
  label: string;
  maxTier: number;
  score: number;
  clues: Record<string, number>;
  timeSec: number;
  hints: number;
  checks: number;
  rating: number;
  feel: 'too easy' | 'just right' | 'too hard' | '';
  notes: string;
}

const KEY = 'thermo.playlog.v1';

export function loadLog(): PlayEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveLog(entries: PlayEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

export function addEntry(e: PlayEntry): void {
  const all = loadLog();
  all.unshift(e);
  saveLog(all);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function download(name: string, text: string, type = 'application/json'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
