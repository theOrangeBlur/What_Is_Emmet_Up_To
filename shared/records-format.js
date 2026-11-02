// Record definitions and number formatting shared by the Records tab
// (Awards/awards.js) and profile pages (Profile/profile.js).

function plural(word) {
  return n => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

// Same m:ss.t style as the Final Wordle timer.
function formatSolveTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + Math.floor((ms % 1000) / 100);
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Records carry three kinds of date: Wordle day keys (20261101), plain
// dates (2026-11-01) and timestamps. The first two are calendar days, so
// build them locally rather than letting Date read them as UTC midnight.
function formatRecordDate(s) {
  s = String(s);
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/) || s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const RECORD_GROUPS = [
  { title: 'Final Wordle', records: [
    { key: 'wordle_fastest', icon: '⏱️', title: 'Fastest daily solve',              fmt: formatSolveTime },
    { key: 'wordle_firsts',  icon: '🥇', title: 'Days finishing first',             fmt: plural('day') },
    { key: 'freeplay_best',  icon: '✒️', title: 'Most freeplay words in 5 minutes', fmt: plural('word') }
  ]},
  { title: 'Visits', records: [
    { key: 'visit_days',           icon: '🚪', title: 'Days dropped by',          fmt: plural('day') },
    { key: 'visit_streak_longest', icon: '📆', title: 'Longest visiting streak',  fmt: plural('day') },
    { key: 'visit_streak_current', icon: '🔥', title: 'Current visiting streak',  fmt: plural('day'), personalOnly: true },
    { key: 'member_since',         icon: '🗝️', title: 'Member since',             fmt: formatRecordDate }
  ]},
  { title: 'Grab-bag', records: [
    { key: 'movie_reads',       icon: '🎬', title: 'Movie reviews read',               fmt: plural('review') },
    { key: 'game_reads',        icon: '🎮', title: 'Game reviews read',                fmt: plural('review') },
    { key: 'snapshot_watch_ms', icon: '🎞️', title: "Time spent watching Emmet's life", fmt: formatDuration },
    { key: 'fish_nips',         icon: '🐟', title: 'Times nipped by a fish',           fmt: plural('nip') }
  ]}
];
