let WORDS = [];
let VALID_GUESSES = new Set();
let ALL_WORDS = []; // WORDS ∪ VALID_GUESSES, deduped once words load — used by every generatePuzzle() call


const SCORE_DARK         = 0.1;
const SCORE_DARK_VOWEL   = 3;
const SCORE_GREEN        = 15;
const SCORE_YELLOW       = 5;
const SCORE_YELLOW_VOWEL = 8;
const SCORE_YELLOW_EXTRA = 3; // each yellow occurrence of a letter beyond its first
const SCORE_ALL_REVEALED = 50; // flat bonus once every letter in the answer is confirmed present (green or yellow)
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const MAX_PUZZLE_SCORE_DAILY = 35; // daily challenge: harder ceiling, one shot a day
const MAX_PUZZLE_SCORE_FREE = 60;  // free play: looser ceiling, higher throughput
const MAX_TRIES_PER_WORD = 1500; // guess-path attempts on one answer before giving up and moving to a new word

const FAMILY_CODE = 'COOPERSTUPOR';
const MIN_FAMILY_DAY_KEY = 20260711; // day the family leaderboard shipped — no is_family rows exist before this

const POINTS_TABLE = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3];
function pointsForPlace(place) { return place <= POINTS_TABLE.length ? POINTS_TABLE[place - 1] : 3; }

function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

function getDayKey() {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000); // UTC-5 (EST)
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function dayKeyToDate(dayKey) {
  const y = Math.floor(dayKey / 10000);
  const m = Math.floor((dayKey % 10000) / 100);
  const d = dayKey % 100;
  return new Date(Date.UTC(y, m - 1, d));
}

function dateToDayKey(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function addDays(dayKey, delta) {
  const date = dayKeyToDate(dayKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return dateToDayKey(date);
}

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function formatDayKeyDisplay(dayKey) {
  const d = dayKeyToDate(dayKey);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function getDaySeed() {
  // Multiply by a large prime so consecutive days produce seeds ~48271 apart,
  // preventing the fallback loop from landing on an adjacent day's starting seed.
  const n = getDayKey();
  let h = (n * 48271) % 2147483647;
  return h <= 0 ? h + 2147483646 : h;
}

function scoreGuess(guess, answer) {
  const res = Array(5).fill('dark');
  const pool = [...answer];
  const used = Array(5).fill(false);
  for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) { res[i] = 'green'; used[i] = true; }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'green') continue;
    for (let j = 0; j < 5; j++) {
      if (!used[j] && guess[i] === pool[j]) { res[i] = 'yellow'; used[j] = true; break; }
    }
  }
  return res;
}

function filterWords(words, guess, result) {
  return words.filter(w => scoreGuess(guess, w).every((c, i) => c === result[i]));
}

// candidates: the full remaining-answer set, used to score how well a guess splits them.
// guessPool: the words allowed to be picked AS the guess (excludes the true answer during
// generation, so a disambiguating clue guess can never spoil the board by being the answer).
function bestGuess(candidates, guessPool, rng) {
  if (guessPool.length === 0) guessPool = candidates;
  if (guessPool.length <= 2) return guessPool[0];
  const sample = guessPool.filter(() => rng() < 10 / guessPool.length);
  const pool = sample.length >= 2 ? sample : guessPool.slice(0, 2);
  let best = pool[0], bestScore = Infinity;
  for (const g of pool) {
    const buckets = {};
    for (const c of candidates) { const k = scoreGuess(g, c).join(''); buckets[k] = (buckets[k] || 0) + 1; }
    const s = Math.max(...Object.values(buckets));
    if (s < bestScore || (s === bestScore && guessPool.includes(g))) { bestScore = s; best = g; }
  }
  return best;
}

function generatePuzzle(seed, forcedAnswer) {
  const rng = seededRng(seed);
  // Always draw this, even when forcedAnswer overrides it: skipping it would shift
  // firstGuess into the position of a seed's near-frozen first draw (see seededRng),
  // collapsing sticky retries onto the same guess path instead of varying it.
  const drawnAnswer = WORDS[Math.floor(rng() * WORDS.length)];
  const answer = forcedAnswer || drawnAnswer;
  const starters = ['crane','slate','audio','raise','stare','stern','cloud','plant'];
  // Exclude the answer from the words that can be PICKED as a guess (starter or otherwise)
  // so a clue row can never literally spell out the answer before the player's typed a thing.
  const starterPool = starters.filter(w => w !== answer);
  const firstGuess = starterPool[Math.floor(rng() * starterPool.length)] || starters[0];
  // Solve against the full valid-guess pool, not just WORDS: narrowing only within WORDS
  // can land on a candidate that's unique among answers but still matched by some other
  // valid guess, which isn't actually a solvable one-answer puzzle.
  let remaining = [...ALL_WORDS];
  // Free-mode guessing, not hard-mode: guesses can be ANY valid word, not just ones
  // consistent with clues revealed so far. Hoisted since it's the same set on every
  // iteration (only the answer is excluded, and that's fixed for this call).
  const freeGuessPool = ALL_WORDS.filter(w => w !== answer);
  const guesses = [], results = [];
  let attempts = 0;
  while (remaining.length > 1) {
    const g = attempts === 0 ? firstGuess : bestGuess(remaining, freeGuessPool, rng);
    const r = scoreGuess(g, answer);
    guesses.push(g); results.push(r);
    remaining = filterWords(remaining, g, r);
    attempts++;
  }
  const uniqueAcrossAll = remaining.length === 1 && remaining[0] === answer;
  return { answer, guesses, results, uniqueAcrossAll };
}

// Scored per DISTINCT LETTER (like the keyboard's aggregated state), not per tile: a letter
// guessed gray five times across five rows still only counts once. Green beats yellow beats
// dark, same priority the keyboard highlighting uses. Yellow escalates with repeat occurrences
// (each extra yellow reveal of the same letter tells the player it repeats in the answer);
// green escalates too, but board-wide across CONFIRMED POSITIONS rather than per letter: the
// 1st confirmed position costs 15, the 2nd costs 30, the 3rd costs 45, and so on (triangular),
// so a double letter fully revealed (e.g. both L's in LEVEL — 2 positions) or any second green
// elsewhere on the board gets sharply more expensive than the first.
function scorePuzzle(guesses, results, answer) {
  const letterStatus = {};
  const yellowCounts = {};
  const greenColumns = {};
  for (let r = 0; r < guesses.length; r++) {
    for (let c = 0; c < 5; c++) {
      const l = guesses[r][c], s = results[r][c];
      if (s === 'yellow') yellowCounts[l] = (yellowCounts[l] || 0) + 1;
      if (s === 'green') (greenColumns[l] || (greenColumns[l] = new Set())).add(c);
      if (!letterStatus[l] || letterStatus[l] === 'dark' || (letterStatus[l] === 'yellow' && s === 'green')) {
        letterStatus[l] = s;
      }
    }
  }
  let total = 0;
  let revealedLetterCount = 0;
  const allGreenColumns = new Set();
  for (const l in letterStatus) {
    const isVowel = VOWELS.has(l);
    const status = letterStatus[l];
    if (status === 'green') {
      for (const c of greenColumns[l]) allGreenColumns.add(c);
      revealedLetterCount++;
    } else if (status === 'dark') {
      total += isVowel ? SCORE_DARK_VOWEL : SCORE_DARK;
    } else {
      const extra = (yellowCounts[l] || 1) - 1;
      total += (isVowel ? SCORE_YELLOW_VOWEL : SCORE_YELLOW) + extra * SCORE_YELLOW_EXTRA;
      revealedLetterCount++;
    }
  }
  const n = allGreenColumns.size;
  total += SCORE_GREEN * n * (n + 1) / 2; // 1st green=15, 2nd=+30 (45 total), 3rd=+45 (90 total), ...
  // Every letter in the answer confirmed present (green OR yellow) means the whole word is
  // pinned down to an anagram search, even with zero greens on the board — just as much a
  // giveaway as seeing every position directly, so it gets the same flat penalty.
  if (revealedLetterCount >= new Set(answer).size) total += SCORE_ALL_REVEALED;
  return total;
}

function isPuzzleAccepted(puzzle, maxScore) {
  return puzzle.uniqueAcrossAll &&
    !(puzzle.guesses.length > 0 && puzzle.guesses[puzzle.guesses.length - 1] === puzzle.answer) &&
    scorePuzzle(puzzle.guesses, puzzle.results, puzzle.answer) <= maxScore;
}

// Keeps retrying the SAME answer word (new guess path each time, since seed+1 barely
// shifts the RNG's first draw but reshuffles everything after it) for up to
// MAX_TRIES_PER_WORD attempts before giving up and letting the next unforced draw
// pick a new word — by then the seed has advanced well past one answer-word's ~124-wide
// RNG bucket, so a new word is all but guaranteed.
function generateAcceptedPuzzle(seed, maxScore) {
  let puzzle = generatePuzzle(seed);
  let stickyAnswer = puzzle.answer;
  let triesOnWord = 1;
  while (!isPuzzleAccepted(puzzle, maxScore)) {
    seed = (seed % 2147483646) + 1;
    if (triesOnWord >= MAX_TRIES_PER_WORD) {
      puzzle = generatePuzzle(seed);
      stickyAnswer = puzzle.answer;
      triesOnWord = 1;
    } else {
      puzzle = generatePuzzle(seed, stickyAnswer);
      triesOnWord++;
    }
  }
  return puzzle;
}


function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + t;
}

function getDeviceId() {
  let id = localStorage.getItem('wordle_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('wordle_device_id', id);
  }
  return id;
}

function isFamilyUnlocked() {
  return localStorage.getItem('wordle_family') === '1';
}

async function authHeader() {
  if (window.Auth) {
    try { return await window.Auth.getAuthHeader(); } catch {}
  }
  return `Bearer ${window.SUPABASE_ANON_KEY}`;
}

async function getUserId() {
  if (!window.Auth) return null;
  try {
    const session = await window.Auth.getSession();
    return session ? session.user.id : null;
  } catch { return null; }
}

async function fetchTodayScores() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return [];
  try {
    const date = String(getDayKey());
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_scores?date=eq.${date}&order=time_ms.asc&limit=20`;
    const res = await fetch(url, {
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': await authHeader()
      }
    });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function fetchFamilyScores(dayKey, membersMap) {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return [];
  const deviceIds = [...membersMap.keys()];
  if (!deviceIds.length) return [];
  try {
    const date = String(dayKey);
    const idsParam = deviceIds.map(id => `"${id}"`).join(',');
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_scores?date=eq.${date}&device_id=in.(${idsParam})&order=time_ms.asc&limit=20`;
    const res = await fetch(url, {
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': await authHeader()
      }
    });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

let familyMembersCache = null; // Map<device_id, display_name>, fetched once per page load
let familyPointsCache = null;  // Map<display_name, total_points>, fetched once per page load

async function getFamilyMembers() {
  if (familyMembersCache) return familyMembersCache;
  familyMembersCache = new Map();
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return familyMembersCache;
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_family_members?select=device_id,display_name`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() }
    });
    if (res.ok) (await res.json()).forEach(r => familyMembersCache.set(r.device_id, r.display_name));
  } catch {}
  return familyMembersCache;
}

async function getFamilyPoints() {
  if (familyPointsCache) return familyPointsCache;
  familyPointsCache = new Map();
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return familyPointsCache;
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_family_points?select=display_name,total_points`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() }
    });
    if (res.ok) (await res.json()).forEach(r => familyPointsCache.set(r.display_name, r.total_points));
  } catch {}
  return familyPointsCache;
}

function computeFamilyPoints(scores, membersMap) {
  const recognized = scores
    .filter(s => membersMap.has(s.device_id))
    .slice()
    .sort((a, b) => a.time_ms - b.time_ms || new Date(a.created_at) - new Date(b.created_at));
  const byId = new Map(); // row id -> { points, firstBonus, lastBonus }
  recognized.forEach((s, i) => byId.set(s.id, { points: pointsForPlace(i + 1), firstBonus: false, lastBonus: false }));
  if (recognized.length) {
    const first = recognized.reduce((a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b);
    const last = recognized.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b);
    byId.get(first.id).firstBonus = true;
    byId.get(last.id).lastBonus = true;
  }
  return byId;
}

function computeTodayPointsByName(todayScores, membersMap) {
  const pointsById = computeFamilyPoints(todayScores, membersMap);
  const byName = new Map();
  todayScores.forEach(s => {
    const name = membersMap.get(s.device_id);
    const info = pointsById.get(s.id);
    if (!name || !info) return;
    const total = info.points + (info.firstBonus ? 3 : 0) + (info.lastBonus ? 1 : 0);
    byName.set(name, (byName.get(name) || 0) + total);
  });
  return byName;
}

async function fetchFamilySubmitCounts(membersMap) {
  const counts = new Map(); // device_id -> total plays since the family leaderboard shipped
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return counts;
  const deviceIds = [...membersMap.keys()];
  if (!deviceIds.length) return counts;
  try {
    const idsParam = deviceIds.map(id => `"${id}"`).join(',');
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_scores?select=device_id&device_id=in.(${idsParam})&date=gte.${MIN_FAMILY_DAY_KEY}`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() }
    });
    if (res.ok) (await res.json()).forEach(r => counts.set(r.device_id, (counts.get(r.device_id) || 0) + 1));
  } catch {}
  return counts;
}

async function fetchDeviceScore() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  try {
    const date = String(getDayKey());
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_scores?date=eq.${date}&device_id=eq.${getDeviceId()}&limit=1`;
    const res = await fetch(url, {
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': await authHeader()
      }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  } catch { return null; }
}

async function insertScore(name, timeMs, guesses) {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return false;
  try {
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/wordle_scores`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': await authHeader(),
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ date: String(getDayKey()), name: name.toUpperCase().slice(0, 6), time_ms: timeMs, guesses, device_id: getDeviceId(), is_family: isFamilyUnlocked(), user_id: await getUserId() })
    });
    if (!res.ok) { console.error('insertScore failed:', res.status, await res.text()); return false; }
    return true;
  } catch (e) { console.error('insertScore error:', e); return false; }
}

async function fetchFreeScores() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return [];
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores?order=score.desc&limit=10`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() }
    });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function fetchDeviceFreeScore() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores?device_id=eq.${getDeviceId()}&limit=1`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  } catch { return null; }
}

async function submitFreeScore(name, score) {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
  try {
    const existing = await fetchDeviceFreeScore();
    if (existing && existing.score >= score) return;
    const cleanName = (name || '---').toUpperCase().slice(0, 6);
    const userId = await getUserId();
    if (existing) {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores?device_id=eq.${getDeviceId()}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': window.SUPABASE_ANON_KEY,
            'Authorization': await authHeader(),
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ name: cleanName, score, user_id: userId })
        }
      );
      if (!res.ok) console.error('updateFreeScore failed:', res.status, await res.text());
    } else {
      const res = await fetch(`${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores`, {
        method: 'POST',
        headers: {
          'apikey': window.SUPABASE_ANON_KEY,
          'Authorization': await authHeader(),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ device_id: getDeviceId(), name: cleanName, score, user_id: userId })
      });
      if (!res.ok) console.error('insertFreeScore failed:', res.status, await res.text());
    }
  } catch (e) { console.error('submitFreeScore error:', e); }
}

async function renderFreeLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = '<div class="lb-loading">loading scores...</div>';
  const scores = await fetchFreeScores();
  el.innerHTML = '';
  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = 'all-time best'; el.appendChild(title);
  if (!scores.length) {
    const empty = document.createElement('div'); empty.className = 'lb-empty'; empty.textContent = 'no scores yet'; el.appendChild(empty); return;
  }
  const table = document.createElement('table'); table.className = 'lb-table';
  const header = document.createElement('tr'); header.className = 'lb-header';
  ['#', 'NAME', 'WORDS'].forEach(h => { const th = document.createElement('th'); th.textContent = h; header.appendChild(th); });
  table.appendChild(header);
  scores.forEach((s, i) => {
    const tr = document.createElement('tr'); tr.className = 'lb-row';
    [i + 1, s.name, s.score].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    table.appendChild(tr);
  });
  el.appendChild(table);
}

async function renderLeaderboard(solved = false) {
  const lb = document.getElementById('leaderboard');
  if (!lb) return;
  lb.innerHTML = '<div class="lb-loading">loading scores...</div>';
  const scores = await fetchTodayScores();
  if (!scores.length) {
    lb.innerHTML = '<div class="lb-empty">no scores yet today</div>';
    return;
  }
  const table = document.createElement('table'); table.className = 'lb-table';
  const header = document.createElement('tr'); header.className = 'lb-header';
  ['#', 'NAME', 'TIME'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; header.appendChild(th);
  });
  table.appendChild(header);
  scores.forEach((s, i) => {
    const tr = document.createElement('tr'); tr.className = 'lb-row';
    [i + 1, s.name, solved ? formatTime(s.time_ms) : '—'].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  lb.innerHTML = '';
  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = "today's scores";
  lb.appendChild(title);
  lb.appendChild(table);
}

let familyView = 'day'; // 'day' | 'standings'
let familySolvedToday = false; // whether this device has solved today's daily puzzle

function appendFamilyViewToggle(lb) {
  const toggle = document.createElement('div'); toggle.className = 'lb-view-toggle';
  const dayBtn = document.createElement('button');
  dayBtn.className = 'lb-view-btn' + (familyView === 'day' ? ' active' : ''); dayBtn.textContent = 'daily';
  const standingsBtn = document.createElement('button');
  standingsBtn.className = 'lb-view-btn' + (familyView === 'standings' ? ' active' : ''); standingsBtn.textContent = 'standings';
  dayBtn.addEventListener('click', () => { if (familyView !== 'day') { familyView = 'day'; renderFamilyLeaderboard(familySolvedToday); } });
  standingsBtn.addEventListener('click', () => { if (familyView !== 'standings') { familyView = 'standings'; renderFamilyStandings(); } });
  toggle.appendChild(dayBtn); toggle.appendChild(standingsBtn);
  lb.appendChild(toggle);
}

async function updateFamilyLeaderboard(solved = false) {
  if (familyView === 'standings') return renderFamilyStandings();
  return renderFamilyLeaderboard(solved);
}

async function renderFamilyStandings() {
  const lb = document.getElementById('family-leaderboard');
  if (!lb) return;
  lb.style.display = '';
  lb.innerHTML = '';
  appendFamilyViewToggle(lb);

  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = 'family standings';
  lb.appendChild(title);

  const body = document.createElement('div'); body.className = 'lb-body';
  body.innerHTML = '<div class="lb-loading">loading scores...</div>';
  lb.appendChild(body);

  const membersMap = await getFamilyMembers();
  const [todayScores, pointsMap, submitCounts] = await Promise.all([
    fetchFamilyScores(getDayKey(), membersMap), getFamilyPoints(), fetchFamilySubmitCounts(membersMap)
  ]);
  const todayPointsByName = computeTodayPointsByName(todayScores, membersMap);

  const submitsByName = new Map();
  for (const [deviceId, count] of submitCounts) {
    const name = membersMap.get(deviceId);
    if (!name) continue;
    submitsByName.set(name, (submitsByName.get(name) || 0) + count);
  }

  const names = [...new Set(membersMap.values())];
  body.innerHTML = '';
  if (!names.length) {
    const empty = document.createElement('div'); empty.className = 'lb-empty';
    empty.textContent = 'no family members yet';
    body.appendChild(empty); return;
  }

  const rows = names.map(name => ({
    name,
    today: todayPointsByName.get(name) || 0,
    submits: submitsByName.get(name) || 0,
    pts: pointsMap.get(name) || 0
  })).sort((a, b) => b.pts - a.pts);

  const table = document.createElement('table'); table.className = 'lb-table lb-table-standings';
  const header = document.createElement('tr'); header.className = 'lb-header';
  ['NAME', 'TODAY', 'SUBMITS', 'PTS'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; header.appendChild(th);
  });
  table.appendChild(header);
  rows.forEach(r => {
    const tr = document.createElement('tr'); tr.className = 'lb-row';
    [r.name, r.today, r.submits, r.pts].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  body.appendChild(table);
}

async function renderFamilyLeaderboard(solved = false, dayKey = getDayKey()) {
  const lb = document.getElementById('family-leaderboard');
  if (!lb) return;
  lb.style.display = '';
  lb.innerHTML = '';
  appendFamilyViewToggle(lb);

  const isToday = dayKey === getDayKey();

  const headerRow = document.createElement('div'); headerRow.className = 'lb-header-row';
  const prevBtn = document.createElement('button'); prevBtn.className = 'lb-nav-btn';
  prevBtn.innerHTML = '&#9664;'; prevBtn.setAttribute('aria-label', 'previous day');
  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = 'family scores';
  const nextBtn = document.createElement('button'); nextBtn.className = 'lb-nav-btn';
  nextBtn.innerHTML = '&#9654;'; nextBtn.setAttribute('aria-label', 'next day');
  prevBtn.disabled = dayKey <= MIN_FAMILY_DAY_KEY;
  nextBtn.disabled = isToday;
  prevBtn.addEventListener('click', () => renderFamilyLeaderboard(familySolvedToday, addDays(dayKey, -1)));
  nextBtn.addEventListener('click', () => renderFamilyLeaderboard(familySolvedToday, addDays(dayKey, 1)));
  headerRow.appendChild(prevBtn); headerRow.appendChild(title); headerRow.appendChild(nextBtn);
  lb.appendChild(headerRow);

  if (!isToday) {
    const dateEl = document.createElement('div'); dateEl.className = 'lb-date';
    dateEl.textContent = formatDayKeyDisplay(dayKey);
    lb.appendChild(dateEl);
  }

  const body = document.createElement('div'); body.className = 'lb-body';
  body.innerHTML = '<div class="lb-loading">loading scores...</div>';
  lb.appendChild(body);

  const membersMap = await getFamilyMembers();
  const [scores, pointsMap] = await Promise.all([
    fetchFamilyScores(dayKey, membersMap), getFamilyPoints()
  ]);
  const showTimes = !isToday || solved;
  const pointsById = computeFamilyPoints(scores, membersMap);

  body.innerHTML = '';
  if (!scores.length) {
    const empty = document.createElement('div'); empty.className = 'lb-empty';
    empty.textContent = isToday ? 'no scores yet today' : 'no scores that day';
    body.appendChild(empty); return;
  }
  const table = document.createElement('table'); table.className = 'lb-table';
  const header = document.createElement('tr'); header.className = 'lb-header';
  ['#', 'NAME', 'TIME', 'PTS', 'ALL-TIME', 'TOTAL'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; header.appendChild(th);
  });
  table.appendChild(header);
  scores.forEach((s, i) => {
    const tr = document.createElement('tr'); tr.className = 'lb-row';
    [i + 1, s.name, showTimes ? formatTime(s.time_ms) : '—'].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    const ptsTd = document.createElement('td'); ptsTd.className = 'lb-pts-cell';
    const info = pointsById.get(s.id);
    const numSpan = document.createElement('span'); numSpan.className = 'lb-pts-num';
    const bonusSpan = document.createElement('span'); bonusSpan.className = 'lb-pts-bonus';
    if (showTimes && info) {
      numSpan.textContent = String(info.points);
      let bonus = '';
      if (info.firstBonus) bonus += '+3!';
      if (info.lastBonus) bonus += '+1!';
      bonusSpan.textContent = bonus;
    } else {
      numSpan.textContent = '—';
    }
    ptsTd.appendChild(numSpan); ptsTd.appendChild(bonusSpan);
    tr.appendChild(ptsTd);
    const allTd = document.createElement('td');
    const displayName = membersMap.get(s.device_id);
    const allTimePts = (displayName && pointsMap.has(displayName)) ? pointsMap.get(displayName) : null;
    allTd.textContent = allTimePts !== null ? String(allTimePts) : '—';
    tr.appendChild(allTd);
    const totalTd = document.createElement('td'); totalTd.className = 'lb-sky';
    const todayPts = info ? info.points + (info.firstBonus ? 3 : 0) + (info.lastBonus ? 1 : 0) : 0;
    totalTd.textContent = (showTimes && info && allTimePts !== null) ? String(todayPts + allTimePts) : '—';
    tr.appendChild(totalTd);
    table.appendChild(tr);
  });
  body.appendChild(table);
}

async function applyFamilyUnlock() {
  const link = document.getElementById('family-link');
  if (link) link.style.display = 'none';
  if (currentMode !== 'daily') return;
  const deviceScore = await fetchDeviceScore();
  familySolvedToday = !!deviceScore;
  updateFamilyLeaderboard(familySolvedToday);
}

function showFamilyCodeModal() {
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const heading = document.createElement('div'); heading.className = 'arcade-heading'; heading.textContent = 'family code';
  const codeInp = document.createElement('input');
  codeInp.className = 'arcade-input'; codeInp.maxLength = 20; codeInp.placeholder = 'code';
  codeInp.autocomplete = 'off'; codeInp.spellcheck = false;
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const submitBtn = document.createElement('button'); submitBtn.className = 'arcade-btn arcade-btn-primary'; submitBtn.textContent = 'unlock';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'arcade-btn'; cancelBtn.textContent = 'cancel';
  function tryUnlock() {
    if (codeInp.value.trim().toUpperCase() === FAMILY_CODE.toUpperCase()) {
      localStorage.setItem('wordle_family', '1');
      overlay.remove();
      applyFamilyUnlock();
    } else {
      codeInp.classList.remove('invalid'); void codeInp.offsetWidth; codeInp.classList.add('invalid');
    }
  }
  submitBtn.addEventListener('click', tryUnlock);
  codeInp.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(submitBtn); btnRow.appendChild(cancelBtn);
  card.appendChild(heading); card.appendChild(codeInp); card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => codeInp.focus(), 50);
}

async function renderAuthLink() {
  const el = document.getElementById('auth-link');
  if (!el || !window.Auth) return;
  const session = await window.Auth.getSession();
  if (session) {
    el.textContent = session.user.email + ' · slip out the back';
    el.onclick = () => window.Auth.signOut();
  } else {
    el.textContent = 'knock knock';
    el.onclick = () => showAuthModal('login');
  }
}

function showAuthModal(initialMode) {
  let mode = initialMode || 'login';
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const peephole = document.createElement('div'); peephole.className = 'peephole-wrap';
  peephole.innerHTML = `<svg class="peephole-svg" viewBox="0 0 84 56" width="84" height="56" role="img" aria-label="a wary eye peers through the door slit">
    <defs>
      <clipPath id="peephole-eye-clip">
        <path d="M16,28 C16,18.5 28,12 42,12 C56,12 68,18.5 68,28 C68,37.5 56,44 42,44 C28,44 16,37.5 16,28 Z"/>
      </clipPath>
    </defs>
    <rect x="2" y="4" width="80" height="48" rx="6" fill="var(--surface)" stroke="var(--border2)" stroke-width="1.5"/>
    <path d="M16,28 C16,18.5 28,12 42,12 C56,12 68,18.5 68,28 C68,37.5 56,44 42,44 C28,44 16,37.5 16,28 Z" fill="var(--bg)" stroke="var(--text2)" stroke-width="1.25"/>
    <g clip-path="url(#peephole-eye-clip)">
      <g class="peephole-iris">
        <circle cx="42" cy="28" r="10" fill="var(--green-light)"/>
        <circle cx="42" cy="28" r="4.5" fill="var(--bg)"/>
        <circle cx="39.5" cy="25" r="1.4" fill="var(--text)"/>
      </g>
    </g>
    <rect x="6" y="4" width="4" height="48" fill="var(--border2)"/>
    <rect x="20" y="4" width="4" height="48" fill="var(--border2)"/>
    <rect x="60" y="4" width="4" height="48" fill="var(--border2)"/>
    <rect x="74" y="4" width="4" height="48" fill="var(--border2)"/>
  </svg>`;
  const heading = document.createElement('div'); heading.className = 'arcade-heading';
  const emailInp = document.createElement('input');
  emailInp.className = 'arcade-input arcade-input-text'; emailInp.type = 'email'; emailInp.placeholder = 'whatsit.tooya@yahoo.com';
  emailInp.autocomplete = 'email'; emailInp.spellcheck = false;
  const passInp = document.createElement('input');
  passInp.className = 'arcade-input arcade-input-text'; passInp.type = 'password'; passInp.placeholder = 'secret knock';
  passInp.spellcheck = false;
  const msg = document.createElement('div'); msg.className = 'arcade-error-text'; msg.style.display = 'none';
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const submitBtn = document.createElement('button'); submitBtn.className = 'arcade-btn arcade-btn-primary';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'arcade-btn'; cancelBtn.textContent = "i'll pass";
  const forgotLink = document.createElement('div'); forgotLink.className = 'auth-link-row'; forgotLink.textContent = 'i misplaced my info!';
  const toggleLink = document.createElement('div'); toggleLink.className = 'auth-link-row';

  function render() {
    heading.textContent = mode === 'login' ? 'who are you?' : 'state your business';
    submitBtn.textContent = mode === 'login' ? "let's boogy" : "i'm new here";
    passInp.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    toggleLink.textContent = mode === 'login' ? 'how do i join?' : 'already in? let me back';
    msg.style.display = 'none';
  }
  render();

  function showMsg(text) { msg.textContent = text; msg.style.display = 'block'; }

  async function doSubmit() {
    const email = emailInp.value.trim();
    const password = passInp.value;
    if (!email || !password) { showMsg("you'll need an email and a secret knock to get in"); return; }
    submitBtn.disabled = true;
    const { error } = mode === 'login'
      ? await window.Auth.signIn(email, password)
      : await window.Auth.signUp(email, password);
    submitBtn.disabled = false;
    if (error) { showMsg(error.message); return; }
    if (mode === 'signup') { showMsg("check your email — we slipped a note under the door to confirm it's you"); return; }
    overlay.remove();
    await renderAuthLink();
    await checkClaimableData();
  }

  submitBtn.addEventListener('click', doSubmit);
  passInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
  cancelBtn.addEventListener('click', () => overlay.remove());
  toggleLink.addEventListener('click', () => { mode = mode === 'login' ? 'signup' : 'login'; render(); });
  forgotLink.addEventListener('click', async () => {
    const email = emailInp.value.trim();
    if (!email) { showMsg('the doorman needs your email first'); return; }
    const { error } = await window.Auth.resetPasswordForEmail(email);
    showMsg(error ? error.message : 'new key slipped under the door — check your email');
  });

  btnRow.appendChild(submitBtn); btnRow.appendChild(cancelBtn);
  card.appendChild(peephole); card.appendChild(heading); card.appendChild(emailInp); card.appendChild(passInp);
  card.appendChild(msg); card.appendChild(btnRow);
  card.appendChild(forgotLink); card.appendChild(toggleLink);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => emailInp.focus(), 50);
}

// Once per session, right after sign-in: if this browser's device_id matches an
// unlinked family-member row, offer to attach the new account to it so future
// family-standings computation can eventually count this person's account.
async function checkClaimableData() {
  if (!window.Auth || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
  const session = await window.Auth.getSession();
  if (!session) return;
  const deviceId = getDeviceId();
  if (localStorage.getItem('wordle_claim_dismissed_' + deviceId)) return;
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_family_members?device_id=eq.${deviceId}&user_id=is.null&select=device_id,display_name`;
    const res = await fetch(url, { headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() } });
    if (!res.ok) return;
    const rows = await res.json();
    if (rows.length) showClaimModal(rows[0], session);
  } catch {}
}

function showClaimModal(row, session) {
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const heading = document.createElement('div'); heading.className = 'arcade-heading'; heading.textContent = 'link your scores?';
  const msg = document.createElement('div'); msg.className = 'arcade-inscribe-text';
  msg.textContent = `we found existing scores for ${row.display_name} on this device — link them to your account?`;
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'arcade-btn arcade-btn-primary'; confirmBtn.textContent = 'link';
  const skipBtn = document.createElement('button'); skipBtn.className = 'arcade-btn'; skipBtn.textContent = 'skip';
  function dismiss() {
    localStorage.setItem('wordle_claim_dismissed_' + row.device_id, '1');
    overlay.remove();
  }
  confirmBtn.addEventListener('click', async () => {
    try {
      await fetch(`${window.SUPABASE_URL}/rest/v1/wordle_family_members?device_id=eq.${row.device_id}&user_id=is.null`, {
        method: 'PATCH',
        headers: {
          'apikey': window.SUPABASE_ANON_KEY,
          'Authorization': await authHeader(),
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ user_id: session.user.id })
      });
    } catch {}
    dismiss();
  });
  skipBtn.addEventListener('click', dismiss);
  btnRow.appendChild(confirmBtn); btnRow.appendChild(skipBtn);
  card.appendChild(heading); card.appendChild(msg); card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function showNameModal(timeMs, totalGuesses, dayKey, setNameTarget) {
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const heading = document.createElement('div'); heading.className = 'arcade-heading'; heading.textContent = 'enter your name';
  const timeDisplay = document.createElement('div'); timeDisplay.className = 'arcade-time';
  timeDisplay.textContent = formatTime(timeMs);
  const nameInp = document.createElement('input');
  nameInp.className = 'arcade-input'; nameInp.maxLength = 6; nameInp.placeholder = '______';
  nameInp.autocomplete = 'off'; nameInp.spellcheck = false;
  nameInp.addEventListener('input', () => { nameInp.value = nameInp.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6); });
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const submitBtn = document.createElement('button'); submitBtn.className = 'arcade-btn arcade-btn-primary'; submitBtn.textContent = 'submit';
  const skipBtn = document.createElement('button'); skipBtn.className = 'arcade-btn'; skipBtn.textContent = 'skip';
  let submitting = false;
  function showInscribingState() {
    card.innerHTML = '';
    const h = document.createElement('div'); h.className = 'arcade-heading'; h.textContent = 'submitting';
    const spinner = document.createElement('div'); spinner.className = 'arcade-spinner';
    const text = document.createElement('div'); text.className = 'arcade-inscribe-text';
    text.textContent = 'Your score is being inscribed into the annuls of fwordle history...';
    card.appendChild(h); card.appendChild(spinner); card.appendChild(text);
  }
  function showRetryState(name) {
    card.innerHTML = '';
    const h = document.createElement('div'); h.className = 'arcade-heading'; h.textContent = 'submission failed';
    const msg = document.createElement('div'); msg.className = 'arcade-error-text';
    msg.textContent = "couldn't save your score — check your connection";
    const row = document.createElement('div'); row.className = 'arcade-btns';
    const retryBtn = document.createElement('button'); retryBtn.className = 'arcade-btn arcade-btn-primary'; retryBtn.textContent = 'retry';
    const giveUpBtn = document.createElement('button'); giveUpBtn.className = 'arcade-btn'; giveUpBtn.textContent = 'skip';
    retryBtn.addEventListener('click', () => attemptSubmit(name));
    giveUpBtn.addEventListener('click', doSkip);
    row.appendChild(retryBtn); row.appendChild(giveUpBtn);
    card.appendChild(h); card.appendChild(msg); card.appendChild(row);
  }
  async function finish() {
    overlay.remove();
    familySolvedToday = true;
    await renderLeaderboard(true);
    if (isFamilyUnlocked()) await updateFamilyLeaderboard(true);
    document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function attemptSubmit(name) {
    showInscribingState();
    const ok = await insertScore(name, timeMs, totalGuesses);
    if (!ok) { showRetryState(name); return; }
    localStorage.setItem(dayKey, JSON.stringify({ timeMs, guesses: totalGuesses, name }));
    await finish();
  }
  async function doSubmit() {
    if (submitting) return;
    submitting = true;
    if (setNameTarget) setNameTarget(null);
    const name = nameInp.value || 'AAA';
    await attemptSubmit(name);
  }
  async function doSkip() {
    if (setNameTarget) setNameTarget(null);
    localStorage.setItem(dayKey, JSON.stringify({ timeMs, guesses: totalGuesses }));
    await finish();
  }
  submitBtn.addEventListener('click', doSubmit);
  nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
  skipBtn.addEventListener('click', doSkip);
  btnRow.appendChild(submitBtn); btnRow.appendChild(skipBtn);
  card.appendChild(heading); card.appendChild(timeDisplay); card.appendChild(nameInp); card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  if (setNameTarget) setNameTarget(nameInp);
  setTimeout(() => nameInp.focus(), 50);
}

function showFreeNameModal(score) {
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const heading = document.createElement('div'); heading.className = 'arcade-heading'; heading.textContent = 'new best!';
  const scoreDisplay = document.createElement('div'); scoreDisplay.className = 'arcade-time';
  scoreDisplay.textContent = score + ' word' + (score === 1 ? '' : 's') + ' in 5 minutes';
  const nameInp = document.createElement('input');
  nameInp.className = 'arcade-input'; nameInp.maxLength = 6; nameInp.placeholder = '______';
  nameInp.autocomplete = 'off'; nameInp.spellcheck = false;
  nameInp.addEventListener('input', () => { nameInp.value = nameInp.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6); });
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const submitBtn = document.createElement('button'); submitBtn.className = 'arcade-btn arcade-btn-primary'; submitBtn.textContent = 'submit';
  const skipBtn = document.createElement('button'); skipBtn.className = 'arcade-btn'; skipBtn.textContent = 'skip';
  async function doSave(name) {
    overlay.remove();
    await submitFreeScore(name, score);
    await renderFreeLeaderboard();
    const lb = document.getElementById('leaderboard');
    if (lb) lb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  submitBtn.addEventListener('click', () => doSave(nameInp.value));
  nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(nameInp.value); });
  skipBtn.addEventListener('click', () => doSave(''));
  btnRow.appendChild(submitBtn); btnRow.appendChild(skipBtn);
  card.appendChild(heading); card.appendChild(scoreDisplay); card.appendChild(nameInp); card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  setTimeout(() => nameInp.focus(), 50);
}

function showDailyRecap(saved, root) {
  const msg = document.createElement('div'); msg.className = 'daily-recap';
  const line1 = document.createElement('div'); line1.className = 'recap-solved'; line1.textContent = 'already solved today';
  const line2 = document.createElement('div'); line2.className = 'recap-stats';
  const timeMs = saved.time_ms !== undefined ? saved.time_ms : saved.timeMs;
  line2.textContent = (saved.name ? saved.name + ' — ' : '') + formatTime(timeMs);
  msg.appendChild(line1); msg.appendChild(line2);
  root.appendChild(msg);
}

function startFreeSession() {
  freeSession.active = true;
  freeSession.startTime = Date.now();
  freeSession.wordsSolved = 0;
  freeSession.sessionDone = false;
  const timerEl = document.getElementById('fp-timer');
  const scoreEl = document.getElementById('fp-score');
  if (scoreEl) scoreEl.textContent = '0 solved';
  clearInterval(freeSession.timerInterval);
  freeSession.timerInterval = setInterval(() => {
    const remaining = Math.max(0, FREE_SESSION_MS - (Date.now() - freeSession.startTime));
    const s = Math.ceil(remaining / 1000);
    if (timerEl) {
      timerEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      timerEl.classList.toggle('fp-timer-warn', remaining <= 60000 && remaining > 0);
    }
    if (remaining <= 0) {
      clearInterval(freeSession.timerInterval);
      freeSession.active = false;
      freeSession.sessionDone = true;
      endFreeSession();
    }
  }, 100);
}

function endFreeSession() {
  const timerEl = document.getElementById('fp-timer');
  if (timerEl) { timerEl.textContent = '0:00'; timerEl.classList.remove('fp-timer-warn'); timerEl.classList.add('fp-timer-done'); }
  const inp = document.querySelector('.ginput');
  const gbtn = document.querySelector('.gbtn');
  const revBtn = document.querySelector('.reveal-btn');
  if (inp) inp.disabled = true;
  if (gbtn) gbtn.disabled = true;
  if (revBtn) revBtn.style.display = 'none';
  const score = freeSession.wordsSolved;
  setTimeout(async () => {
    const [lb, deviceScore] = await Promise.all([fetchFreeScores(), fetchDeviceFreeScore()]);
    const qualifiesForBoard = score > 0 && (lb.length < 10 || score > lb[lb.length - 1].score);
    const beatPersonalBest = score > 0 && (!deviceScore || score > deviceScore.score);
    if (qualifiesForBoard || beatPersonalBest) {
      showFreeNameModal(score);
    } else {
      renderFreeLeaderboard();
    }
  }, 800);
}

function prefetchNextFreePuzzle() {
  if (prefetchInProgress || prefetchedPuzzle) return;
  prefetchInProgress = true;
  setTimeout(() => {
    const seed = Math.floor(Math.random() * 2147483646) + 1;
    prefetchedPuzzle = generateAcceptedPuzzle(seed, MAX_PUZZLE_SCORE_FREE);
    prefetchInProgress = false;
  }, 0);
}

async function buildGame(mode) {
  const root = document.getElementById('root');
  root.innerHTML = '<div style="color:var(--text2);font-size:11px;letter-spacing:.2em;padding:80px 0">loading...</div>';
  const lb = document.getElementById('leaderboard');

  if (mode === 'daily') {
    lb.style.display = '';
    const deviceScore = await fetchDeviceScore();
    familySolvedToday = !!deviceScore;
    if (deviceScore) {
      root.innerHTML = '';
      showDailyRecap(deviceScore, root);
      renderLeaderboard(true);
      if (isFamilyUnlocked()) updateFamilyLeaderboard(true);
      return;
    }
    root.innerHTML = '';
    renderLeaderboard(false);
    if (isFamilyUnlocked()) updateFamilyLeaderboard(false);
  } else {
    renderFreeLeaderboard();  // async, fire-and-forget here
    document.getElementById('free-play-bar').style.display = '';
    if (!freeSession.active && !freeSession.sessionDone) startFreeSession();
  }

  let puzzle = null;
  if (mode === 'daily' && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/daily_words?date=eq.${getDayKey()}&select=word,guesses,results`,
        { headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() } }
      );
      const data = await res.json();
      if (data?.[0]?.guesses) {
        puzzle = { answer: data[0].word, guesses: data[0].guesses, results: data[0].results, uniqueAcrossAll: true };
      }
    } catch (e) {}
  }
  if (!puzzle) {
    if (mode === 'free' && prefetchedPuzzle) {
      puzzle = prefetchedPuzzle;
      prefetchedPuzzle = null;
    } else {
      const seed = mode === 'daily' ? getDaySeed() : Math.floor(Math.random() * 2147483646) + 1;
      const maxScore = mode === 'daily' ? MAX_PUZZLE_SCORE_DAILY : MAX_PUZZLE_SCORE_FREE;
      puzzle = generateAcceptedPuzzle(seed, maxScore);
    }
  }
  const { answer, guesses, results } = puzzle;
  let nameTarget = null;

  const board = document.createElement('div'); board.className = 'board';
  for (let r = 0; r < guesses.length; r++) {
    const row = document.createElement('div'); row.className = 'row';
    for (let c = 0; c < 5; c++) {
      const t = document.createElement('div');
      t.className = 'tile ' + results[r][c];
      t.textContent = guesses[r][c].toUpperCase();
      row.appendChild(t);
    }
    board.appendChild(row);
  }
  const inputRowEl = document.createElement('div'); inputRowEl.className = 'row';
  const inputTiles = [];
  for (let c = 0; c < 5; c++) {
    const t = document.createElement('div'); t.className = 'tile empty'; t.id = 'it' + c;
    inputTiles.push(t); inputRowEl.appendChild(t);
  }
  board.appendChild(inputRowEl);
  root.appendChild(board);

  const winMsg = document.createElement('div'); winMsg.className = 'win-msg'; winMsg.textContent = 'correct!'; root.appendChild(winMsg);
  const fb = document.createElement('div'); fb.className = 'fb'; root.appendChild(fb);
  const ct = document.createElement('div'); ct.className = 'ct'; ct.textContent = 'what is the word?'; root.appendChild(ct);

  const gw = document.createElement('div'); gw.className = 'guess-wrap';
  const gl = document.createElement('div'); gl.className = 'glabel'; gl.textContent = 'your guess';
  const gr = document.createElement('div'); gr.className = 'ginput-row';
  const inp = document.createElement('input');
  inp.className = 'ginput'; inp.maxLength = 5; inp.placeholder = '?????';
  inp.autocomplete = 'off'; inp.spellcheck = false; inp.inputMode = 'none';
  const gbtn = document.createElement('button'); gbtn.className = 'gbtn'; gbtn.textContent = 'guess';
  gr.appendChild(inp); gr.appendChild(gbtn); gw.appendChild(gl); gw.appendChild(gr); root.appendChild(gw);

  const revBtn = document.createElement('button'); revBtn.className = 'reveal-btn'; revBtn.textContent = mode === 'free' ? 'skip this word' : 'reveal the answer'; root.appendChild(revBtn);
  const revWord = document.createElement('div'); revWord.className = 'revealed'; revWord.textContent = answer.toUpperCase(); root.appendChild(revWord);

  const kb = document.createElement('div'); kb.className = 'kb';
  const kbLayout = [['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['z','x','c','v','b','n','m']];
  const kbMap = {};
  kbLayout.forEach((row, rowIdx) => {
    const div = document.createElement('div'); div.className = 'kb-row';
    row.forEach(k => {
      const btn = document.createElement('button'); btn.className = 'kk'; btn.textContent = k.toUpperCase(); btn.dataset.k = k;
      btn.addEventListener('click', () => { if (nameTarget) { if (nameTarget.value.length < 6) nameTarget.value += k.toUpperCase(); return; } if (inp.value.length < 5 && !gbtn.disabled) { inp.value += k; updateTiles(inp.value); } });
      kbMap[k] = btn; div.appendChild(btn);
    });
    if (rowIdx === 2) {
      const bksp = document.createElement('button'); bksp.className = 'kk kk-bksp'; bksp.textContent = '⌫';
      bksp.addEventListener('click', () => { if (nameTarget) { nameTarget.value = nameTarget.value.slice(0, -1); return; } if (!gbtn.disabled && inp.value.length > 0) { inp.value = inp.value.slice(0, -1); updateTiles(inp.value); } });
      div.appendChild(bksp);
    }
    kb.appendChild(div);
  });
  root.appendChild(kb);

  if (mode === 'daily' && dailyStartTime === null) {
    board.style.display = 'none';
    ct.style.display = 'none';
    gw.style.display = 'none';
    revBtn.style.display = 'none';
    kb.style.display = 'none';
    const startContainer = document.createElement('div');
    startContainer.className = 'start-container';
    const startBtn = document.createElement('button');
    startBtn.className = 'start-btn';
    startBtn.textContent = 'BEGIN';
    startBtn.addEventListener('click', () => {
      const now = Date.now();
      dailyStartTime = now;
      startTime = now;
      localStorage.setItem('wordle_start_' + getDayKey(), now);
      startContainer.remove();
      board.style.display = '';
      ct.style.display = '';
      gw.style.display = '';
      revBtn.style.display = '';
      kb.style.display = '';
      if (!('ontouchstart' in window)) inp.focus();
    });
    startContainer.appendChild(startBtn);
    root.appendChild(startContainer);
  } else if (!('ontouchstart' in window)) {
    inp.focus();
  }
  if (mode === 'free') prefetchNextFreePuzzle();

  if (mode === 'free' && freeSession.sessionDone) {
    gbtn.disabled = true; inp.disabled = true;
  }

  const usedLetters = {};
  for (let r = 0; r < guesses.length; r++) {
    for (let c = 0; c < 5; c++) {
      const l = guesses[r][c], s = results[r][c];
      if (!usedLetters[l] || usedLetters[l] === 'dark' || (usedLetters[l] === 'yellow' && s === 'green')) usedLetters[l] = s;
    }
  }
  Object.entries(usedLetters).forEach(([l, s]) => {
    if (kbMap[l]) kbMap[l].className = 'kk ' + (s === 'green' ? 'green' : s === 'yellow' ? 'yellow' : 'used');
  });

  let guessCount = 0, won = false, startTime = mode === 'daily' ? dailyStartTime : null;

  function updateTiles(val) {
    for (let c = 0; c < 5; c++) {
      const t = inputTiles[c];
      t.textContent = val[c] ? val[c].toUpperCase() : '';
      t.className = 'tile ' + (val[c] ? 'active-input' : 'empty');
    }
  }

  function shake() { inputTiles.forEach(t => { t.classList.add('shake'); setTimeout(() => t.classList.remove('shake'), 350); }); }
  function setFb(msg, cls) { fb.textContent = msg; fb.className = 'fb ' + (cls || ''); }
  function playThud() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.22);
    } catch(e) {}
  }

  function submit() {
    if (won || gbtn.disabled) return;
    const val = inp.value.toLowerCase().trim();
    if (val.length !== 5) { setFb('need 5 letters', 'warn'); return; }
    if (!VALID_GUESSES.has(val) && !WORDS.includes(val)) { setFb('not in word list', 'warn'); shake(); return; }
    const fitsClues = guesses.every((g, i) => filterWords([val], g, results[i]).length === 1);
    if (!fitsClues) { setFb('contradicts the clues', 'warn'); shake(); return; }
    guessCount++;
    if (val === answer) {
      won = true;
      inputTiles.forEach((t, i) => {
        t.textContent = val[i].toUpperCase();
        t.className = 'tile green';
        setTimeout(() => t.classList.add('win-bounce'), i * 80);
      });
      winMsg.style.display = 'block';
      setFb('', '');
      ct.textContent = '';
      gbtn.disabled = true; inp.disabled = true; revBtn.style.display = 'none';
      if (mode === 'daily') {
        const timeMs = startTime ? Date.now() - startTime : 0;
        const dayKey = 'wordle_' + getDayKey();
        setTimeout(() => showNameModal(timeMs, guessCount, dayKey, t => { nameTarget = t; }), 800);
      } else if (mode === 'free') {
        freeSession.wordsSolved++;
        const scoreEl = document.getElementById('fp-score');
        if (scoreEl) scoreEl.textContent = freeSession.wordsSolved + ' solved';
        if (!freeSession.sessionDone) {
          setTimeout(() => { if (!freeSession.sessionDone) buildGame('free'); }, 1000);
        }
      }
    } else {
      setFb('not the word', 'err'); shake();
      ct.textContent = 'keep going';
      if (guessCount >= 3) revBtn.style.display = 'block';
    }
    if (!won) { inp.value = ''; updateTiles(''); inp.focus(); }
  }

  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 5);
    updateTiles(inp.value);
    setFb('', '');
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { submit(); return; }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const isNonLetter = !/[a-zA-Z]/.test(e.key);
    const isDarkLetter = /[a-zA-Z]/.test(e.key) && usedLetters[e.key.toLowerCase()] === 'dark';
    if (isNonLetter || isDarkLetter) {
      e.preventDefault();
      const idx = inp.value.length;
      if (idx < 5) {
        const t = inputTiles[idx];
        t.textContent = e.key.toUpperCase();
        t.classList.remove('invalid'); void t.offsetWidth;
        t.className = 'tile invalid';
        playThud();
        setTimeout(() => { t.textContent = ''; t.className = 'tile empty'; }, 500);
      } else {
        playThud();
      }
    }
  });
  gbtn.addEventListener('click', submit);
  revBtn.addEventListener('click', () => {
    revWord.style.display = 'block'; revBtn.style.display = 'none';
    inp.disabled = true; gbtn.disabled = true;
    if (mode === 'free' && !freeSession.sessionDone) {
      ct.textContent = 'skipped';
      setFb('', '');
      setTimeout(() => { if (!freeSession.sessionDone) buildGame('free'); }, 1200);
    } else {
      ct.textContent = 'better luck tomorrow';
      setFb('', '');
    }
  });
  if (mode === 'free') {
    setTimeout(() => { if (!won && !freeSession.sessionDone) revBtn.style.display = 'block'; }, 30000);
  }
}

let currentMode = 'daily';
let dailyStartTime = null;
let wordsReady = false;
let prefetchedPuzzle = null;
let prefetchInProgress = false;

const FREE_SESSION_MS = 5 * 60 * 1000;
let freeSession = { active: false, startTime: null, wordsSolved: 0, timerInterval: null, sessionDone: false };

(async function init() {
  const [wordsRes, guessesRes] = await Promise.all([
    fetch('words.json'),
    fetch('valid-guesses.json')
  ]);
  WORDS = await wordsRes.json();
  VALID_GUESSES = new Set(await guessesRes.json());
  ALL_WORDS = [...new Set([...WORDS, ...VALID_GUESSES])];
  wordsReady = true;

  const todayStartKey = 'wordle_start_' + getDayKey();
  const savedStart = localStorage.getItem(todayStartKey);
  dailyStartTime = savedStart ? parseInt(savedStart, 10) : null;
  buildGame('daily');

  const familyLink = document.getElementById('family-link');
  if (familyLink) {
    familyLink.style.display = isFamilyUnlocked() ? 'none' : '';
    familyLink.addEventListener('click', showFamilyCodeModal);
  }

  renderAuthLink();
  checkClaimableData();
  if (window.Auth) {
    window.Auth.onAuthStateChange(() => { renderAuthLink(); checkClaimableData(); });
  }

  const yDate = new Date(Date.now() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000); // yesterday in EST
  const yKey = yDate.getUTCFullYear() * 10000 + (yDate.getUTCMonth() + 1) * 100 + yDate.getUTCDate();
  let word = null;
  if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/daily_words?date=eq.${yKey}&select=word`,
        { headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': await authHeader() } }
      );
      const data = await res.json();
      if (data && data[0]) word = data[0].word;
    } catch (e) {}
  }
  if (!word) {
    let seed = (yKey * 48271) % 2147483647;
    if (seed <= 0) seed += 2147483646;
    const rng = seededRng(seed);
    word = WORDS[Math.floor(rng() * WORDS.length)];
  }
  const el = document.getElementById('yesterday');
  if (el) el.innerHTML = 'yesterday<span class="yw">' + word.toUpperCase() + '</span>';
})();

document.getElementById('mode-daily').addEventListener('click', () => {
  if (currentMode === 'daily' || !wordsReady) return;
  currentMode = 'daily';
  clearInterval(freeSession.timerInterval);
  freeSession = { active: false, startTime: null, wordsSolved: 0, timerInterval: null, sessionDone: false };
  prefetchedPuzzle = null; prefetchInProgress = false;
  document.getElementById('free-play-bar').style.display = 'none';
  document.getElementById('mode-daily').classList.add('active');
  document.getElementById('mode-free').classList.remove('active');
  const familyLink = document.getElementById('family-link');
  if (familyLink) familyLink.style.display = isFamilyUnlocked() ? 'none' : '';
  buildGame('daily');
});
document.getElementById('fp-restart').addEventListener('click', () => {
  if (!wordsReady || currentMode !== 'free') return;
  clearInterval(freeSession.timerInterval);
  freeSession = { active: false, startTime: null, wordsSolved: 0, timerInterval: null, sessionDone: false };
  prefetchedPuzzle = null; prefetchInProgress = false;
  const timerEl = document.getElementById('fp-timer');
  if (timerEl) { timerEl.textContent = '5:00'; timerEl.classList.remove('fp-timer-warn', 'fp-timer-done'); }
  buildGame('free');
});
document.getElementById('mode-free').addEventListener('click', () => {
  if (!wordsReady) return;
  if (currentMode === 'free' && !freeSession.sessionDone) return;
  currentMode = 'free';
  clearInterval(freeSession.timerInterval);
  freeSession = { active: false, startTime: null, wordsSolved: 0, timerInterval: null, sessionDone: false };
  prefetchedPuzzle = null; prefetchInProgress = false;
  document.getElementById('mode-free').classList.add('active');
  document.getElementById('mode-daily').classList.remove('active');
  const familyBoard = document.getElementById('family-leaderboard');
  if (familyBoard) familyBoard.style.display = 'none';
  const familyLink = document.getElementById('family-link');
  if (familyLink) familyLink.style.display = 'none';
  buildGame('free');
});
