let WORDS = [];
let VALID_GUESSES = new Set();


const SCORE_DARK   = 1;
const SCORE_YELLOW = 5;
const SCORE_GREEN  = 15;
const MAX_PUZZLE_SCORE = 40;

function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

function getDayKey() {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000); // UTC-5 (EST)
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
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
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return;
  try {
    const res = await fetch(`${window.SUPABASE_URL}/rest/v1/wordle_scores`, {
      method: 'POST',
      headers: {
        'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ date: String(getDayKey()), name: name.toUpperCase().slice(0, 6), time_ms: timeMs, guesses, device_id: getDeviceId() })
    });
    if (!res.ok) console.error('insertScore failed:', res.status, await res.text());
  } catch (e) { console.error('insertScore error:', e); }
}

function getFreeLeaderboard() {
  try { return JSON.parse(localStorage.getItem('wordle_freeplay_lb') || '[]'); } catch { return []; }
}

function saveFreeScore(name, score) {
  const lb = getFreeLeaderboard();
  lb.push({ name: (name || '---').toUpperCase().slice(0, 6), score, date: String(getDayKey()) });
  lb.sort((a, b) => b.score - a.score);
  lb.splice(5);
  localStorage.setItem('wordle_freeplay_lb', JSON.stringify(lb));
  return lb;
}

function renderFreeLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  el.style.display = '';
  const scores = getFreeLeaderboard();
  el.innerHTML = '';
  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = 'best sessions'; el.appendChild(title);
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
  ['#', 'NAME', 'TIME', 'GUESSES'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; header.appendChild(th);
  });
  table.appendChild(header);
  scores.forEach((s, i) => {
    const tr = document.createElement('tr'); tr.className = 'lb-row';
    [i + 1, s.name, solved ? formatTime(s.time_ms) : '—', s.guesses].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  lb.innerHTML = '';
  const title = document.createElement('div'); title.className = 'lb-title'; title.textContent = "today's scores";
  lb.appendChild(title);
  lb.appendChild(table);
}

function showNameModal(timeMs, totalGuesses, dayKey, setNameTarget) {
  const overlay = document.createElement('div'); overlay.className = 'arcade-overlay';
  const card = document.createElement('div'); card.className = 'arcade-card';
  const heading = document.createElement('div'); heading.className = 'arcade-heading'; heading.textContent = 'enter your name';
  const timeDisplay = document.createElement('div'); timeDisplay.className = 'arcade-time';
  timeDisplay.textContent = formatTime(timeMs) + ' — ' + totalGuesses + ' guess' + (totalGuesses === 1 ? '' : 'es');
  const nameInp = document.createElement('input');
  nameInp.className = 'arcade-input'; nameInp.maxLength = 6; nameInp.placeholder = '______';
  nameInp.autocomplete = 'off'; nameInp.spellcheck = false;
  nameInp.addEventListener('input', () => { nameInp.value = nameInp.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6); });
  const btnRow = document.createElement('div'); btnRow.className = 'arcade-btns';
  const submitBtn = document.createElement('button'); submitBtn.className = 'arcade-btn arcade-btn-primary'; submitBtn.textContent = 'submit';
  const skipBtn = document.createElement('button'); skipBtn.className = 'arcade-btn'; skipBtn.textContent = 'skip';
  async function doSubmit() {
    if (setNameTarget) setNameTarget(null);
    const name = nameInp.value || 'AAA';
    overlay.remove();
    localStorage.setItem(dayKey, JSON.stringify({ timeMs, guesses: totalGuesses, name }));
    await insertScore(name, timeMs, totalGuesses);
    await renderLeaderboard(true);
    document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function doSkip() {
    if (setNameTarget) setNameTarget(null);
    overlay.remove();
    localStorage.setItem(dayKey, JSON.stringify({ timeMs, guesses: totalGuesses }));
    await renderLeaderboard(true);
    document.getElementById('leaderboard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  function doSave(name) {
    overlay.remove();
    saveFreeScore(name, score);
    renderFreeLeaderboard();
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
  line2.textContent = (saved.name ? saved.name + ' — ' : '') + formatTime(timeMs) + ' — ' + saved.guesses + ' guess' + (saved.guesses === 1 ? '' : 'es');
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
  setTimeout(() => {
    const lb = getFreeLeaderboard();
    if (score > 0 && (lb.length < 5 || score > lb[lb.length - 1].score)) {
      showFreeNameModal(score);
    } else {
      renderFreeLeaderboard();
    }
  }, 800);
}

async function buildGame(mode) {
  const root = document.getElementById('root');
  root.innerHTML = '<div style="color:var(--text2);font-size:11px;letter-spacing:.2em;padding:80px 0">loading...</div>';
  const lb = document.getElementById('leaderboard');

  if (mode === 'daily') {
    lb.style.display = '';
    const deviceScore = await fetchDeviceScore();
    if (deviceScore) {
      root.innerHTML = '';
      showDailyRecap(deviceScore, root);
      renderLeaderboard(true);
      return;
    }
    root.innerHTML = '';
    renderLeaderboard(false);
  } else {
    renderFreeLeaderboard();
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

  if (!('ontouchstart' in window)) inp.focus();

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
      const totalGuesses = guesses.length + guessCount;
      ct.textContent = 'solved in ' + totalGuesses + ' total guess' + (totalGuesses === 1 ? '' : 'es');
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
      ct.textContent = guessCount + ' guess' + (guessCount === 1 ? '' : 'es') + ' — keep going';
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

  dailyStartTime = Date.now();
  buildGame('daily');

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
  document.getElementById('free-play-bar').style.display = 'none';
  document.getElementById('mode-daily').classList.add('active');
  document.getElementById('mode-free').classList.remove('active');
  buildGame('daily');
});
document.getElementById('fp-restart').addEventListener('click', () => {
  if (!wordsReady || currentMode !== 'free') return;
  clearInterval(freeSession.timerInterval);
  freeSession = { active: false, startTime: null, wordsSolved: 0, timerInterval: null, sessionDone: false };
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
  document.getElementById('mode-free').classList.add('active');
  document.getElementById('mode-daily').classList.remove('active');
  buildGame('free');
});
