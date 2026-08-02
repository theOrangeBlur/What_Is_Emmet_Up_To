// Analysis tool: simulates the daily answer-selection/retry loop from final-wordle.js
// (sticky-word-with-cap: retry the SAME answer up to MAX_TRIES_PER_WORD times before
// moving to a new word) over many simulated days, to see how much of WORDS actually
// gets used as an answer and why candidates get rejected. Not part of the game itself —
// run with:
//   node analyze-word-pool.js [numDays]
//
// Note: with MAX_TRIES_PER_WORD=1500 this is much more expensive per day than the old
// unbounded-drift version (each stuck word now costs up to 1500 full solves instead of
// the ~62-124 the RNG's natural drift used to allow), so the default day count here is
// deliberately modest.

const fs = require('fs');
const path = require('path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^﻿/, ''));
}

const WORDS = readJson('words.json');
const VALID_GUESSES = new Set(readJson('valid-guesses.json'));

const SCORE_DARK = 1;
const SCORE_YELLOW = 5;
const SCORE_GREEN = 15;
const MAX_PUZZLE_SCORE = 40;
const MAX_TRIES_PER_WORD = 1500;

// --- copied verbatim (logic-wise) from final-wordle.js ---
// scoreGuess/filterWords below avoid the string-spread + fresh-array-per-call overhead
// of the original so this simulation (which calls them far more times than a real game
// session ever would) finishes in reasonable time; output is identical either way.

function seededRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}

function getDaySeed(dayKey) {
  let h = (dayKey * 48271) % 2147483647;
  return h <= 0 ? h + 2147483646 : h;
}

function scoreGuess(guess, answer) {
  const res = ['dark', 'dark', 'dark', 'dark', 'dark'];
  const used = [false, false, false, false, false];
  for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) { res[i] = 'green'; used[i] = true; }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'green') continue;
    for (let j = 0; j < 5; j++) {
      if (!used[j] && guess[i] === answer[j]) { res[i] = 'yellow'; used[j] = true; break; }
    }
  }
  return res;
}

function filterWords(words, guess, result) {
  return words.filter(w => scoreGuess(guess, w).every((c, i) => c === result[i]));
}

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

// hoisted out of generatePuzzle: identical every call, so recomputing it per-attempt
// (as final-wordle.js used to) would dominate runtime once we're doing thousands of
// attempts per word.
const ALL_WORDS = [...new Set([...WORDS, ...VALID_GUESSES])];

function generatePuzzle(seed, forcedAnswer) {
  const rng = seededRng(seed);
  // Always draw this, even when forcedAnswer overrides it: skipping it would shift
  // firstGuess into the position of a seed's near-frozen first draw, collapsing sticky
  // retries onto the same guess path instead of varying it.
  const drawnAnswer = WORDS[Math.floor(rng() * WORDS.length)];
  const answer = forcedAnswer || drawnAnswer;
  const starters = ['crane', 'slate', 'audio', 'raise', 'stare', 'stern', 'cloud', 'plant'];
  const starterPool = starters.filter(w => w !== answer);
  const firstGuess = starterPool[Math.floor(rng() * starterPool.length)] || starters[0];
  // Solve against the full valid-guess pool so uniqueness is guaranteed by construction,
  // not just among WORDS.
  let remaining = ALL_WORDS;
  const guesses = [], results = [];
  let attempts = 0;
  while (remaining.length > 1) {
    const guessPool = remaining.filter(w => w !== answer);
    const g = attempts === 0 ? firstGuess : bestGuess(remaining, guessPool, rng);
    const r = scoreGuess(g, answer);
    guesses.push(g); results.push(r);
    remaining = filterWords(remaining, g, r);
    attempts++;
  }
  const uniqueAcrossAll = remaining.length === 1 && remaining[0] === answer;
  return { answer, guesses, results, uniqueAcrossAll };
}

function scorePuzzle(results) {
  return results.flat().reduce((sum, s) => {
    if (s === 'green') return sum + SCORE_GREEN;
    if (s === 'yellow') return sum + SCORE_YELLOW;
    return sum + SCORE_DARK;
  }, 0);
}

function isPuzzleAccepted(puzzle) {
  return puzzle.uniqueAcrossAll &&
    !(puzzle.guesses.length > 0 && puzzle.guesses[puzzle.guesses.length - 1] === puzzle.answer) &&
    scorePuzzle(puzzle.results) <= MAX_PUZZLE_SCORE;
}

// classify why a generated puzzle would be rejected, matching the || short-circuit
// order in isPuzzleAccepted / final-wordle.js
function classify(puzzle) {
  if (!puzzle.uniqueAcrossAll) return 'not_unique';
  const last = puzzle.guesses.length > 0 && puzzle.guesses[puzzle.guesses.length - 1] === puzzle.answer;
  if (last) return 'last_guess_is_answer';
  if (scorePuzzle(puzzle.results) > MAX_PUZZLE_SCORE) return 'too_easy';
  return 'accepted';
}

// --- simulate the sticky-word-with-cap daily flow over many simulated days ---

const numDays = parseInt(process.argv[2], 10) || 50;

const attemptCounts = new Map(); // word -> times attempted as a candidate answer
const acceptCounts = new Map();  // word -> times accepted as the day's answer
const exhaustedCounts = new Map(); // word -> times it burned through all 1500 tries and was abandoned
const rejectReasonCounts = { not_unique: 0, last_guess_is_answer: 0, too_easy: 0 };
let totalAttempts = 0;
let totalRetries = 0;
let maxRetries = 0;
const retriesPerDay = [];
const distinctAnswersPerDay = [];
const acceptedScores = []; // score/row-count of the puzzle actually accepted each day —
const acceptedRows = [];   // no gate applied to these anymore, this is just for inspection

const START_DAY_KEY = 20260101; // arbitrary but stable; getDaySeed() is applied per absolute day-key
const t0 = Date.now();

for (let d = 0; d < numDays; d++) {
  let seed = getDaySeed(START_DAY_KEY + d);
  let puzzle = generatePuzzle(seed);
  let stickyAnswer = puzzle.answer;
  let triesOnWord = 1;
  let retries = 0;
  const seenAnswersToday = new Set([stickyAnswer]);

  const record = (p) => {
    totalAttempts++;
    attemptCounts.set(p.answer, (attemptCounts.get(p.answer) || 0) + 1);
    const verdict = classify(p);
    if (verdict !== 'accepted') rejectReasonCounts[verdict]++;
    return verdict;
  };

  let verdict = record(puzzle);
  while (verdict !== 'accepted') {
    seed = (seed % 2147483646) + 1;
    retries++;
    if (triesOnWord >= MAX_TRIES_PER_WORD) {
      exhaustedCounts.set(stickyAnswer, (exhaustedCounts.get(stickyAnswer) || 0) + 1);
      puzzle = generatePuzzle(seed);
      stickyAnswer = puzzle.answer;
      triesOnWord = 1;
      seenAnswersToday.add(stickyAnswer);
    } else {
      puzzle = generatePuzzle(seed, stickyAnswer);
      triesOnWord++;
    }
    verdict = record(puzzle);
  }
  acceptCounts.set(puzzle.answer, (acceptCounts.get(puzzle.answer) || 0) + 1);
  acceptedScores.push(scorePuzzle(puzzle.results));
  acceptedRows.push(puzzle.guesses.length);

  totalRetries += retries;
  if (retries > maxRetries) maxRetries = retries;
  retriesPerDay.push(retries);
  distinctAnswersPerDay.push(seenAnswersToday.size);
  process.stderr.write(`  ...day ${d + 1}/${numDays}: ${puzzle.answer} (${retries} retries, ${seenAnswersToday.size} word(s) tried, ${((Date.now() - t0) / 1000).toFixed(1)}s elapsed)\n`);
}

retriesPerDay.sort((a, b) => a - b);
const median = retriesPerDay[Math.floor(retriesPerDay.length / 2)];

const distinctAccepted = acceptCounts.size;
const neverAccepted = WORDS.filter(w => !acceptCounts.has(w));
const attemptedButNeverAccepted = neverAccepted.filter(w => attemptCounts.has(w));
const neverEvenAttempted = neverAccepted.filter(w => !attemptCounts.has(w));

console.log();
console.log(`Simulated ${numDays} days (day keys ${START_DAY_KEY}..${START_DAY_KEY + numDays - 1}) in ${((Date.now() - t0) / 1000).toFixed(1)}s, MAX_TRIES_PER_WORD=${MAX_TRIES_PER_WORD}`);
console.log(`WORDS pool size: ${WORDS.length}`);
console.log();
console.log(`=== Retry cost per day ===`);
console.log(`Avg retries/day: ${(totalRetries / numDays).toFixed(1)}, median: ${median}, max: ${maxRetries}`);
console.log(`Avg DISTINCT answer words tried per day: ${(distinctAnswersPerDay.reduce((a, b) => a + b, 0) / numDays).toFixed(2)}`);
console.log(`Words that exhausted all ${MAX_TRIES_PER_WORD} tries at least once: ${exhaustedCounts.size}`);
console.log();
console.log(`=== Answer-word coverage ===`);
console.log(`Distinct answers actually accepted: ${distinctAccepted} / ${WORDS.length} (${(100 * distinctAccepted / WORDS.length).toFixed(1)}%)`);
console.log(`Words never accepted in this run: ${neverAccepted.length}`);
console.log(`  - attempted at least once but always rejected: ${attemptedButNeverAccepted.length}`);
console.log(`  - never even attempted (rng never landed on it) in this run: ${neverEvenAttempted.length}`);
console.log();
console.log(`=== Rejection reasons ===`);
console.log(`Total candidate generations: ${totalAttempts}`);
for (const [reason, count] of Object.entries(rejectReasonCounts)) {
  console.log(`  - ${reason}: ${count} (${(100 * count / totalAttempts).toFixed(1)}%)`);
}
console.log(`  - accepted: ${totalAttempts - totalRetries} (${(100 * (totalAttempts - totalRetries) / totalAttempts).toFixed(1)}%)`);

if (attemptedButNeverAccepted.length) {
  console.log();
  console.log(`Words attempted but always rejected in this run (up to 20):`);
  console.log('  ' + attemptedButNeverAccepted.slice(0, 20).join(', '));
}

console.log();
console.log(`=== Accepted puzzle shape (score gate: MAX_PUZZLE_SCORE=${MAX_PUZZLE_SCORE}) ===`);
function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * p)]; }
console.log(`Score:  min ${Math.min(...acceptedScores)}, p25 ${pct(acceptedScores, .25)}, median ${pct(acceptedScores, .5)}, p75 ${pct(acceptedScores, .75)}, max ${Math.max(...acceptedScores)}`);
console.log(`Rows:   min ${Math.min(...acceptedRows)}, p25 ${pct(acceptedRows, .25)}, median ${pct(acceptedRows, .5)}, p75 ${pct(acceptedRows, .75)}, max ${Math.max(...acceptedRows)}`);

console.log();
console.log(`Per-word accept rate (words attempted >= 5 times), worst 15:`);
const rates = [...attemptCounts.entries()]
  .filter(([, n]) => n >= 5)
  .map(([w, n]) => ({ word: w, attempts: n, accepts: acceptCounts.get(w) || 0, rate: (acceptCounts.get(w) || 0) / n }))
  .sort((a, b) => a.rate - b.rate);
for (const r of rates.slice(0, 15)) {
  console.log(`  ${r.word}: ${r.accepts}/${r.attempts} accepted (${(100 * r.rate).toFixed(0)}%)`);
}
