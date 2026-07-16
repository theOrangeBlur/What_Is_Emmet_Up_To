let WORDS = [];
let VALID_GUESSES = new Set();


const SCORE_DARK   = 1;
const SCORE_YELLOW = 5;
const SCORE_GREEN  = 15;
const MAX_PUZZLE_SCORE = 40;

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

function bestGuess(candidates, rng) {
  if (candidates.length <= 2) return candidates[0];
  const sample = candidates.filter(() => rng() < 10 / candidates.length);
  const pool = sample.length >= 2 ? sample : candidates.slice(0, 2);
  let best = candidates[0], bestScore = Infinity;
  for (const g of pool) {
    const buckets = {};
    for (const c of candidates) { const k = scoreGuess(g, c).join(''); buckets[k] = (buckets[k] || 0) + 1; }
    const s = Math.max(...Object.values(buckets));
    if (s < bestScore || (s === bestScore && candidates.includes(g))) { bestScore = s; best = g; }
  }
  return best;
}

function generatePuzzle(seed) {
  const rng = seededRng(seed);
  const answer = WORDS[Math.floor(rng() * WORDS.length)];
  const starters = ['crane','slate','audio','raise','stare','stern','cloud','plant'];
  const firstGuess = starters[Math.floor(rng() * starters.length)];
  let remaining = [...WORDS];
  const guesses = [], results = [];
  let attempts = 0;
  while (remaining.length > 1) {
    const g = attempts === 0 ? firstGuess : bestGuess(remaining, rng);
    const r = scoreGuess(g, answer);
    guesses.push(g); results.push(r);
    remaining = filterWords(remaining, g, r);
    attempts++;
    if (remaining.length === 1) break;
  }
  // Verify uniqueness across the full valid word set, not just WORDS
  const allWords = [...new Set([...WORDS, ...VALID_GUESSES])];
  let fullRemaining = allWords;
  for (let i = 0; i < guesses.length; i++) {
    fullRemaining = filterWords(fullRemaining, guesses[i], results[i]);
  }
  const uniqueAcrossAll = fullRemaining.length === 1 && fullRemaining[0] === answer;
  return { answer, guesses, results, uniqueAcrossAll };
}

function scorePuzzle(results) {
  return results.flat().reduce((sum, s) => {
    if (s === 'green')  return sum + SCORE_GREEN;
    if (s === 'yellow') return sum + SCORE_YELLOW;
    return sum + SCORE_DARK;
  }, 0);
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

async function fetchTodayScores() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return [];
  try {
    const date = String(getDayKey());
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_scores?date=eq.${date}&order=time_ms.asc&limit=20`;
    const res = await fetch(url, {
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`
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
        'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`
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
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` }
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
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` }
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
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` }
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
        'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`
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
        'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ date: String(getDayKey()), name: name.toUpperCase().slice(0, 6), time_ms: timeMs, guesses, device_id: getDeviceId(), is_family: isFamilyUnlocked() })
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
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` }
    });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function fetchDeviceFreeScore() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  try {
    const url = `${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores?device_id=eq.${getDeviceId()}&limit=1`;
    const res = await fetch(url, {
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` }
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
    if (existing) {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores?device_id=eq.${getDeviceId()}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': window.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ name: cleanName, score })
        }
      );
      if (!res.ok) console.error('updateFreeScore failed:', res.status, await res.text());
    } else {
      const res = await fetch(`${window.SUPABASE_URL}/rest/v1/wordle_freeplay_scores`, {
        method: 'POST',
        headers: {
          'apikey': window.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ device_id: getDeviceId(), name: cleanName, score })
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
    let seed = Math.floor(Math.random() * 2147483646) + 1;
    let puzzle;
    do {
      puzzle = generatePuzzle(seed);
      seed = (seed % 2147483646) + 1;
    } while (
      !puzzle.uniqueAcrossAll ||
      (puzzle.guesses.length > 0 && puzzle.guesses[puzzle.guesses.length - 1] === puzzle.answer) ||
      scorePuzzle(puzzle.results) > MAX_PUZZLE_SCORE
    );
    prefetchedPuzzle = puzzle;
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
        { headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` } }
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
      let seed = mode === 'daily' ? getDaySeed() : Math.floor(Math.random() * 2147483646) + 1;
      do {
        puzzle = generatePuzzle(seed);
        seed = (seed % 2147483646) + 1;
      } while (
        !puzzle.uniqueAcrossAll ||
        (puzzle.guesses.length > 0 && puzzle.guesses[puzzle.guesses.length - 1] === puzzle.answer) ||
        scorePuzzle(puzzle.results) > MAX_PUZZLE_SCORE
      );
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

  const yDate = new Date(Date.now() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000); // yesterday in EST
  const yKey = yDate.getUTCFullYear() * 10000 + (yDate.getUTCMonth() + 1) * 100 + yDate.getUTCDate();
  let word = null;
  if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(
        `${window.SUPABASE_URL}/rest/v1/daily_words?date=eq.${yKey}&select=word`,
        { headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}` } }
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
