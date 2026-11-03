// Supabase calls and leaderboard / name-entry UI for the public page.
// Ported from Puzzles/Final_Wordle/final-wordle.js (same tables shape, same arcade look).
// Everything degrades quietly: with no network or no shared scripts, the page still plays.
import { dayKey, msUntilNextDay } from '../core/daily';
import type { PuzzleCore, ThermoState } from '../core/types';

interface SiteAuth {
  getAuthHeader(): Promise<string>;
  getSession(): Promise<{ user: { id: string } } | null>;
  getUsername?(): Promise<string | null>;
  usernamesFor?(ids: (string | null)[]): Promise<Map<string, string>>;
}
declare global {
  interface Window {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    Auth?: SiteAuth;
    AuthWidget?: { profileLink(username: string | null | undefined, name: string): Node };
    Awards?: {
      unlock(key: string): void;
      progress(key: string, n: number, target: number): void;
      tally(key: string, delta: number): void;
    };
    Comments?: { mount(container: HTMLElement, page: string, item: string): void };
    Unlocks?: { has(key: string): Promise<boolean> };
  }
}

export interface ScoreRow {
  name: string;
  time_ms: number;
  hints: number;
  user_id: string | null;
  device_id: string;
}

/** A published daily, as stored in thermo_daily.puzzle. */
export interface DailyPuzzle extends PuzzleCore {
  solution: ThermoState[];
  seed: string;
}

const configured = () => !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);

export function getDeviceId(): string {
  // Shared with Final Wordle so one browser is one player across the site's puzzles.
  try {
    let id = localStorage.getItem('wordle_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('wordle_device_id', id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

async function authHeader(): Promise<string> {
  if (window.Auth) {
    try {
      return await window.Auth.getAuthHeader();
    } catch {
      /* fall through */
    }
  }
  return `Bearer ${window.SUPABASE_ANON_KEY}`;
}

async function headers(): Promise<Record<string, string>> {
  return { apikey: window.SUPABASE_ANON_KEY!, Authorization: await authHeader() };
}

export async function getUserId(): Promise<string | null> {
  if (!window.Auth) return null;
  try {
    const s = await window.Auth.getSession();
    return s ? s.user.id : null;
  } catch {
    return null;
  }
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${t}`;
}

/** Today's published daily, or null (not published yet, or offline). */
export async function fetchDaily(key = dayKey()): Promise<DailyPuzzle | null> {
  if (!configured()) return null;
  try {
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/thermo_daily?date=eq.${key}&select=puzzle`, { headers: await headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as { puzzle: DailyPuzzle }[];
    const p = rows[0]?.puzzle;
    return p && Array.isArray(p.thermos) && Array.isArray(p.solution) ? p : null;
  } catch {
    return null;
  }
}

export async function fetchTodayScores(key = dayKey()): Promise<ScoreRow[]> {
  if (!configured()) return [];
  try {
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/thermo_scores?date=eq.${key}&order=time_ms.asc&limit=20`, { headers: await headers() });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/** This device's (or signed-in account's) score for the day, if it has one. */
export async function fetchMyScore(key = dayKey()): Promise<ScoreRow | null> {
  if (!configured()) return null;
  try {
    const uid = await getUserId();
    const filter = uid ? `or=(device_id.eq.${getDeviceId()},user_id.eq.${uid})` : `device_id=eq.${getDeviceId()}`;
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/thermo_scores?date=eq.${key}&${filter}&limit=1`, { headers: await headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as ScoreRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function insertScore(name: string, timeMs: number, hints: number, key = dayKey()): Promise<boolean> {
  if (!configured()) return false;
  try {
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/thermo_scores`, {
      method: 'POST',
      keepalive: true,
      headers: { ...(await headers()), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        date: key,
        name: name.toUpperCase().slice(0, 6),
        time_ms: Math.round(timeMs),
        hints,
        device_id: getDeviceId(),
        user_id: await getUserId(),
      }),
    });
    if (!res.ok) {
      console.error('insertScore failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('insertScore error:', e);
    return false;
  }
}

// ---- UI -------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

async function profileNames(rows: ScoreRow[]): Promise<Map<string, string>> {
  if (!window.Auth?.usernamesFor) return new Map();
  try {
    return await window.Auth.usernamesFor(rows.map((r) => r.user_id));
  } catch {
    return new Map();
  }
}

/** Today's board. Times stay hidden until you've finished, so they can't be chased. */
export async function renderLeaderboard(root: HTMLElement, showTimes: boolean): Promise<void> {
  root.innerHTML = '<div class="lb-loading">loading scores...</div>';
  if (!configured()) {
    root.innerHTML = '';
    return;
  }
  const scores = await fetchTodayScores();
  const names = await profileNames(scores);
  root.innerHTML = '';
  root.appendChild(el('div', 'lb-title', "today's scores"));
  if (!scores.length) {
    root.appendChild(el('div', 'lb-empty', 'no scores yet today'));
    return;
  }
  const me = getDeviceId();
  const table = el('table', 'lb-table');
  const head = el('tr', 'lb-header');
  for (const h of ['#', 'NAME', 'HINTS', 'TIME']) head.appendChild(el('th', '', h));
  table.appendChild(head);
  scores.forEach((s, i) => {
    const tr = el('tr', `lb-row${s.device_id === me ? ' mine' : ''}`);
    tr.appendChild(el('td', '', String(i + 1)));
    const nameTd = el('td');
    const username = s.user_id ? names.get(s.user_id) : null;
    nameTd.appendChild(window.AuthWidget ? window.AuthWidget.profileLink(username, s.name) : document.createTextNode(s.name));
    tr.appendChild(nameTd);
    tr.appendChild(el('td', '', showTimes ? String(s.hints) : '—'));
    tr.appendChild(el('td', '', showTimes ? formatTime(s.time_ms) : '—'));
    table.appendChild(tr);
  });
  root.appendChild(table);
}

/** Start the name box at the account's username, squeezed to arcade form (letters, 6 max). */
async function prefillName(inp: HTMLInputElement) {
  if (!window.Auth?.getUsername) return;
  try {
    const u = await window.Auth.getUsername();
    const arcade = (u || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6);
    if (arcade && !inp.value) inp.value = arcade;
  } catch {
    /* ignore */
  }
}

/**
 * Arcade-style name entry. Resolves with the name submitted, or null if skipped.
 * `submit` does the insert; on failure the modal offers a retry.
 */
export function showNameModal(timeMs: number, detail: string, submit: (name: string) => Promise<boolean>): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = el('div', 'arcade-overlay');
    const card = el('div', 'arcade-card');
    overlay.appendChild(card);
    const done = (name: string | null) => {
      overlay.remove();
      resolve(name);
    };
    const form = () => {
      card.innerHTML = '';
      const inp = el('input', 'arcade-input');
      inp.maxLength = 6;
      inp.placeholder = '______';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.addEventListener('input', () => (inp.value = inp.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6)));
      prefillName(inp);
      const row = el('div', 'arcade-btns');
      const ok = el('button', 'arcade-btn arcade-btn-primary', 'submit');
      const skip = el('button', 'arcade-btn', 'skip');
      const go = () => attempt(inp.value || 'AAA');
      ok.addEventListener('click', go);
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      skip.addEventListener('click', () => done(null));
      row.append(ok, skip);
      card.append(el('div', 'arcade-heading', 'enter your name'), el('div', 'arcade-time', formatTime(timeMs)), el('div', 'arcade-time', detail), inp, row);
      setTimeout(() => inp.focus(), 50);
    };
    const attempt = async (name: string) => {
      card.innerHTML = '';
      card.append(el('div', 'arcade-heading', 'submitting'), el('div', 'arcade-spinner'), el('div', 'arcade-inscribe-text', 'Your time is being recorded for posterity...'));
      if (await submit(name)) return done(name);
      card.innerHTML = '';
      const row = el('div', 'arcade-btns');
      const retry = el('button', 'arcade-btn arcade-btn-primary', 'retry');
      const skip = el('button', 'arcade-btn', 'skip');
      retry.addEventListener('click', () => attempt(name));
      skip.addEventListener('click', () => done(null));
      row.append(retry, skip);
      card.append(el('div', 'arcade-heading', 'submission failed'), el('div', 'arcade-error-text', "couldn't save your score — check your connection"), row);
    };
    form();
    document.body.appendChild(overlay);
  });
}

/** "incoming puzzle: 3:04:12", ticking. */
export function nextDailyCountdown(): HTMLElement {
  const e = el('div', 'next-word-timer');
  const tick = () => {
    const ms = msUntilNextDay();
    if (ms <= 0) {
      e.textContent = 'new puzzle available — refresh this page!';
      clearInterval(id);
      return;
    }
    const s = Math.floor(ms / 1000);
    e.textContent = `next puzzle in ${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const id = setInterval(tick, 1000);
  tick();
  return e;
}

export function shareButton(getText: () => string): HTMLButtonElement {
  const b = el('button', 'share-btn', 'copy score');
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      b.textContent = 'copied!';
      b.classList.add('copied');
      setTimeout(() => {
        b.textContent = 'copy score';
        b.classList.remove('copied');
      }, 2000);
    } catch {
      const ta = el('textarea', 'share-fallback');
      ta.value = getText();
      ta.readOnly = true;
      b.insertAdjacentElement('afterend', ta);
      ta.select();
    }
  });
  return b;
}
