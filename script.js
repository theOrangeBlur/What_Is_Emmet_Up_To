// Splash texts (Minecraft style)
const splashTexts = [
    "I'm sorry I haven't called you back yet!!!",
    "Ferb, I know what I'm gonna do today!",
    "I'll be a 10x engineer one day",
    "This statement is bananas",
    "How will future generations define us?",
    "Did he post a new pick? OMG!",
    "The most productive unemployment the world has ever seen!",
    "My mom's favorite website!",
    "Contains 100% real Emmet!",
    "Now in {get_backround_color()}!",
    "Frequently*** updated!",
    "Thank you for the cookies! Om nom nom",
    "May contain puzzles!",
    "Riddle me to bits!",
    "More fun than calling me! -my AI",
    "Yesterday I said tomorrow!",
    "Maybe today is the day I get into coffee",
    "Your one-stop Emmet shop!",
    "Do newline chars work?<br \>test<br \>test!",
    "'Whimsineering'",
    "I'm not on social media, but I have this...?",
    "This one's for you, beloved friend/family member!",
    "Odds of me picking up your call today... 68%. New record!",
    "Please don't read the code",
    "I haven't had to find an eigenvalue in ages. Have you?",
    "I'm sorry I left you on read again, I really am.",
    "Early bird gets the worm, but the second mouse gets the cheese.",
    "Slicker than snot on a door knob!",
    "CONSTANT VIGILANCE!!!",
    "'While My Guitar Gently Weeps' is the best Beatles song, change my mind.",
    "Who you gonna call?",
    "Yes, I really sat down and wrote a bunch of these out.",
    "You should see the ones my AI wrote (Claude, don't read this)",
    "Maybe he's in a cave!",
    "No recursion required.",
    "YEEEEEWWWWWW!! He's on the slopes!!",
    "Dude I think this song really is about me!",
    "Voted most likely person to break a bone on this trip",
    "You can go ahead and turn Dark Reader off :)",
    "Whatever could be baking in that 3D printer of his?",
    "Puzzler, Maker, & Puzzle Maker!",
    "What's the verdict: Cat?",
    "Do I have to move my car today?",
    "All in a day's work",
    "I've been collecting videos for over a year!"
];

// Simple seeded random number generator
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// Convert date string to a numeric seed
function dateToSeed(dateString) {
    // Convert YYYY-MM-DD to a number (e.g., "2026-01-13" -> 20260113)
    return parseInt(dateString.replace(/-/g, ''));
}

// Daily splash text - everyone sees the same text each day
function getDailySplashText() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const seed = dateToSeed(today);
    const randomIndex = Math.floor(seededRandom(seed) * splashTexts.length);
    return splashTexts[randomIndex];
}

// Set the splash text
const splash = document.getElementById('splashText');
splash.textContent = getDailySplashText();

// Masthead edition info
const _now = new Date();
const _editionDate = document.getElementById('edition-date');
const _editionNum = document.getElementById('edition-number');
if (_editionDate) {
    _editionDate.textContent = _now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
}
if (_editionNum) {
    const _hashLink = document.createElement('a');
    _hashLink.href = 'https://github.com/theOrangeBlur/What_Is_Emmet_Up_To';
    _hashLink.target = '_blank';
    _hashLink.rel = 'noopener';
    const _tooltip = document.createElement('span');
    _tooltip.className = 'edition-hash-tooltip';
    _tooltip.textContent = "that's the commit hash on my repo! Wanna see it?";
    _editionNum.style.position = 'relative';
    _editionNum.appendChild(_hashLink);
    _editionNum.appendChild(_tooltip);

    fetch('https://api.github.com/repos/theOrangeBlur/What_Is_Emmet_Up_To/commits/main')
        .then(r => r.json())
        .then(data => { _hashLink.textContent = data.sha.slice(0, 7); })
        .catch(() => { _hashLink.textContent = '???????'; });
}

// ── Newspaper: Dynamic Preview Loading ──

async function loadPreviews() {
    await Promise.allSettled([
        loadProjectPreview(),
        loadMoviePreview(),
        loadGamePreview(),
        loadDisciplinePreview(),
        loadThermoPreview()
    ]);
}

// ── Projects Preview ──
async function loadProjectPreview() {
    try {
        const resp = await fetch('Projects/latest-project.json');
        if (!resp.ok) return;
        const data = await resp.json();
        const img = document.getElementById('latest-project-img');
        const title = document.getElementById('latest-project-title');
        const wrap = document.getElementById('project-img-wrap');
        if (img && data.thumbnail) {
            img.src = 'Projects/' + data.thumbnail;
            if (wrap) wrap.style.display = 'block';
        }
        if (title && data.title) {
            title.textContent = data.title;
        }
        const projectDateEl = document.getElementById('latest-project-date');
        if (projectDateEl && data.date) {
            const parts = data.date.split('-');
            if (parts.length === 3) {
                const d = new Date(data.date + 'T00:00:00');
                projectDateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            } else if (parts.length === 2) {
                const d = new Date(parts[0], parts[1] - 1);
                projectDateEl.textContent = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
            }
        }
    } catch (e) { /* silently fail */ }
}

// ── Absolute 25 Preview ──
// Yesterday's daily (EST day, like the puzzle page), drawn solved, plus the
// fastest time posted for it. Tables: supabase/thermometers.sql.
function thermoDayKey(offsetDays) {
    const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

async function loadThermoPreview() {
    const svg = document.getElementById('thermo-preview-board');
    const winnerEl = document.getElementById('thermo-preview-winner');
    if (!svg || !winnerEl) return;
    const article = svg.closest('.side-article');
    const hide = () => { if (article) article.style.display = 'none'; };
    const url = window.SUPABASE_URL, key = window.SUPABASE_ANON_KEY;
    if (!url || !key) return hide();
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const day = thermoDayKey(-1);
    try {
        const [pRes, sRes] = await Promise.all([
            fetch(`${url}/rest/v1/thermo_daily?date=eq.${day}&select=puzzle`, { headers }),
            fetch(`${url}/rest/v1/thermo_scores?date=eq.${day}&select=name,time_ms,hints,user_id&order=time_ms.asc,created_at.asc&limit=1`, { headers })
        ]);
        const rows = pRes.ok ? await pRes.json() : [];
        const puzzle = rows[0] && rows[0].puzzle;
        if (!puzzle || !Array.isArray(puzzle.thermos) || !Array.isArray(puzzle.solution)) return hide();
        renderThermoPreview(svg, puzzle);

        const best = sRes.ok ? (await sRes.json())[0] : null;
        winnerEl.replaceChildren();
        if (!best) {
            winnerEl.textContent = 'Nobody bested it. Will you best today’s?';
            return;
        }
        let username = null;
        if (best.user_id && window.Auth && window.Auth.usernamesFor) {
            try { username = (await window.Auth.usernamesFor([best.user_id])).get(best.user_id) || null; } catch (e) { /* plain name */ }
        }
        const name = document.createElement('strong');
        name.append(window.AuthWidget ? AuthWidget.profileLink(username, best.name) : document.createTextNode(best.name));
        const s = Math.floor(best.time_ms / 1000);
        const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((best.time_ms % 1000) / 100)}`;
        const hints = best.hints ? ` (${best.hints} hint${best.hints === 1 ? '' : 's'})` : '';
        winnerEl.append('Bested by ', name, ` in ${time}${hints}.`);
    } catch (e) {
        hide();
    }
}

// A trimmed-down port of Puzzles/Absolute/src/ui/board.ts renderBoard():
// grid, thermometers filled to the solution, and the clues.
function renderThermoPreview(svg, p) {
    const NS = 'http://www.w3.org/2000/svg';
    const CELL = 40, O = 30, n = p.size;
    const size = O + n * CELL + 6;
    const el = (tag, attrs) => {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, String(attrs[k]));
        return e;
    };
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.replaceChildren();
    const cx = c => O + (c % n) * CELL + CELL / 2;
    const cy = c => O + Math.floor(c / n) * CELL + CELL / 2;

    svg.append(el('rect', { x: O, y: O, width: n * CELL, height: n * CELL, class: 'tp-bg' }));
    const grid = el('g', { class: 'tp-grid' });
    for (let i = 0; i <= n; i++) {
        grid.append(el('line', { x1: O, y1: O + i * CELL, x2: O + n * CELL, y2: O + i * CELL }));
        grid.append(el('line', { x1: O + i * CELL, y1: O, x2: O + i * CELL, y2: O + n * CELL }));
    }
    svg.append(grid);

    const tubeW = CELL * 0.38, bulbR = CELL * 0.34, fillW = CELL * 0.22, fillR = CELL * 0.24;
    const tip = 0.15, fillStep = 0.5 - fillW / CELL / 2 - 0.04;
    const tubes = el('g', {}), fills = el('g', {});
    p.thermos.forEach((t, id) => {
        const pts = t.cells.map(c => [cx(c), cy(c)]);
        const last = pts.length - 1;
        const ext = (k, amt) => {
            const [x, y] = pts[k];
            let dx, dy;
            if (k < last) { dx = pts[k + 1][0] - x; dy = pts[k + 1][1] - y; }
            else if (k > 0) { dx = x - pts[k - 1][0]; dy = y - pts[k - 1][1]; }
            else return [x, y];
            const len = Math.hypot(dx, dy);
            return [x + dx / len * CELL * amt, y + dy / len * CELL * amt];
        };
        const path = arr => arr.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
        if (pts.length > 1) tubes.append(el('path', { d: path([...pts, ext(last, tip)]), class: 'tp-tube', 'stroke-width': tubeW }));
        tubes.append(el('circle', { cx: pts[0][0], cy: pts[0][1], r: bulbR, class: 'tp-bulb' }));
        const s = p.solution[id];
        if (s && s.level > 0) {
            const cls = s.color === 'R' ? 'tp-red' : 'tp-blue';
            if (pts.length > 1) {
                const end = s.level - 1 === last ? ext(last, tip) : ext(s.level - 1, fillStep);
                fills.append(el('path', { d: path([...pts.slice(0, s.level), end]), class: `tp-fill ${cls}`, 'stroke-width': fillW }));
            }
            fills.append(el('circle', { cx: pts[0][0], cy: pts[0][1], r: fillR, class: `tp-fill-bulb ${cls}` }));
        }
    });
    svg.append(tubes, fills);
    svg.append(el('rect', { x: O, y: O, width: n * CELL, height: n * CELL, class: 'tp-border' }));

    const clues = el('g', {});
    const put = (clue, x, y) => {
        if (!clue || clue.kind === 'none') return;
        const t = el('text', { x, y, class: `tp-clue tp-clue-${clue.kind}` });
        t.textContent = String(clue.value);
        clues.append(t);
    };
    for (let i = 0; i < n; i++) {
        put(p.rowClues[i], O / 2, O + i * CELL + CELL / 2);
        put(p.colClues[i], O + i * CELL + CELL / 2, O / 2);
    }
    svg.append(clues);
}

// ── Movie Preview ──
async function loadMoviePreview() {
    try {
        const [csvResp, cacheResp] = await Promise.all([
            fetch('Movies/src/reviews.csv'),
            fetch('Movies/src/poster_cache.json')
        ]);
        if (!csvResp.ok || !cacheResp.ok) return;

        const csvText = await csvResp.text();
        const posterCache = await cacheResp.json();

        // Parse first data row (most recent movie)
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return;
        const row = parseCSVRow(lines[1]);
        // CSV columns: Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
        const name = row[1];
        const year = row[2];
        const rating = parseFloat(row[4]);
        const watchedDate = row[8];

        // Look up poster
        const cacheKey = name + '|' + year;
        const posterData = posterCache[cacheKey];

        const posterImg = document.getElementById('latest-movie-poster');
        const titleEl = document.getElementById('latest-movie-title');
        const ratingEl = document.getElementById('latest-movie-rating');
        const movieDateEl = document.getElementById('latest-movie-date');

        if (posterImg && posterData && posterData.poster) {
            posterImg.src = posterData.poster;
            posterImg.style.display = 'block';
        }
        if (titleEl) {
            titleEl.textContent = name + ' (' + year + ')';
        }
        if (ratingEl && !isNaN(rating)) {
            ratingEl.innerHTML = renderStars(rating);
        }
        if (movieDateEl && watchedDate) {
            const d = new Date(watchedDate + 'T00:00:00');
            movieDateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    } catch (e) { /* silently fail */ }
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;
    let html = '';
    for (let i = 0; i < 5; i++) {
        let fill;
        if (i < full) fill = 'star-full';
        else if (i === full && hasHalf) fill = 'star-half';
        else fill = 'star-empty';
        html += `<span class="star star-${i+1} ${fill}">★</span>`;
    }
    return html;
}

// Simple CSV row parser (handles quoted fields with commas)
function parseCSVRow(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

// ── Game Preview ──
async function loadGamePreview() {
    try {
        const [csvResp, cacheResp] = await Promise.all([
            fetch('Game_review/src/games.csv'),
            fetch('Game_review/src/image_cache.json')
        ]);
        if (!csvResp.ok) return;

        const csvText = await csvResp.text();
        const imageCache = cacheResp.ok ? await cacheResp.json() : {};
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return;

        // Find game with highest Play order (column index 10)
        let bestGame = null;
        let highestOrder = -1;

        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVRow(lines[i]);
            const title = row[0];
            if (!title) continue;
            const playOrder = parseInt(row[10]);
            if (!isNaN(playOrder) && playOrder > highestOrder) {
                highestOrder = playOrder;
                bestGame = {
                    title: title,
                    genre: row[1],
                    timePlayed: row[4],
                    completionStatus: row[13],
                    playOrder: playOrder,
                    dateLastPlayed: row[12]
                };
            }
        }

        if (!bestGame) return;

        const coverImg = document.getElementById('latest-game-cover');
        const titleEl = document.getElementById('latest-game-title');
        const statusEl = document.getElementById('latest-game-status');
        const hoursEl = document.getElementById('latest-game-hours');
        const genreEl = document.getElementById('latest-game-genre');

        if (coverImg && imageCache[bestGame.title]) {
            coverImg.src = imageCache[bestGame.title];
            coverImg.style.display = 'block';
        }

        if (titleEl) titleEl.textContent = bestGame.title;

        // Determine status
        const isCompleted = bestGame.completionStatus && bestGame.completionStatus.trim().toLowerCase() === 'completed';
        const status = isCompleted ? 'completed' : 'in-progress';
        if (statusEl) {
            statusEl.textContent = isCompleted ? 'COMPLETED' : 'IN PROGRESS';
            statusEl.classList.add('status-' + status);
        }

        if (hoursEl && bestGame.timePlayed) {
            hoursEl.textContent = bestGame.timePlayed + 'h played';
        }

        if (genreEl && bestGame.genre) {
            genreEl.textContent = bestGame.genre;
        }

        const gameDateEl = document.getElementById('latest-game-date');
        if (gameDateEl && bestGame.dateLastPlayed) {
            const d = new Date(bestGame.dateLastPlayed + 'T00:00:00');
            gameDateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    } catch (e) { /* silently fail */ }
}

// ── Discipline Preview ──
const DISCIPLINE_COLORS = {
    mind: '#2a4a8b',
    body: '#8b1a1a',
    spirit: '#1a5c2b',
    spanish: '#7a3550',
    exceptional: '#6b4f12'
};

async function loadDisciplinePreview() {
    try {
        const resp = await fetch(`Discipline/log.csv?v=${Date.now()}`);
        if (!resp.ok) return;
        const csvText = await resp.text();
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return;

        // Build map of date -> entries
        const dateMap = {};
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',').map(s => s.trim());
            const dateStr = parts[0];
            const category = (parts[1] || '').toLowerCase();
            const action = parts[2] || '';
            if (!dateStr || !category) continue;

            // Normalize date from M/D/YYYY to YYYY-MM-DD
            const normalized = normalizeLogDate(dateStr);
            if (!normalized) continue;

            if (!dateMap[normalized]) dateMap[normalized] = [];
            dateMap[normalized].push({ category, action });
        }

        // Find yesterday (or today as fallback)
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatDateISO(yesterday);
        const todayStr = formatDateISO(today);

        let targetDate = yesterdayStr;
        let entries = dateMap[yesterdayStr];
        if (!entries || entries.length === 0) {
            entries = dateMap[todayStr];
            targetDate = todayStr;
        }
        // If still nothing, find the most recent date with entries
        if (!entries || entries.length === 0) {
            const sortedDates = Object.keys(dateMap).sort().reverse();
            if (sortedDates.length > 0) {
                targetDate = sortedDates[0];
                entries = dateMap[targetDate];
            }
        }

        if (!entries || entries.length === 0) return;

        const container = document.getElementById('discipline-preview');
        const dateEl = document.getElementById('discipline-date');

        if (container) {
            container.innerHTML = '';
            entries.forEach(entry => {
                const dot = document.createElement('span');
                dot.className = 'discipline-dot';
                const color = DISCIPLINE_COLORS[entry.category] || '#888';
                if (entry.action) {
                    dot.style.backgroundColor = color;
                    dot.title = entry.category + ': ' + entry.action;
                } else {
                    dot.classList.add('empty');
                    dot.style.borderColor = color;
                    dot.title = entry.category + ': (none)';
                }
                container.appendChild(dot);
            });
        }

        // Count missed (empty) entries and pick Emmet reaction image
        const emmetImg = document.getElementById('discipline-emmet');
        if (emmetImg) {
            const missed = entries.filter(e => !e.action).length;
            let emmetFile;
            if (missed === 0) emmetFile = 'Emmet_nice.jpg';
            else if (missed <= 2) emmetFile = 'Emmet_serious.jpg';
            else if (missed === 3) emmetFile = 'Emmet_mad.jpg';
            else emmetFile = 'Emmet_frozen.jpg';
            emmetImg.src = 'media/' + emmetFile;
            emmetImg.style.display = 'block';
        }

        if (dateEl) {
            const d = new Date(targetDate + 'T00:00:00');
            dateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    } catch (e) { /* silently fail */ }
}

function normalizeLogDate(dateStr) {
    // Convert M/D/YYYY to YYYY-MM-DD
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    return year + '-' + month + '-' + day;
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

// Load all previews on page load
loadPreviews();

// ── Claude Portrait: Typewriter Animation ──

function initTypewriter() {
    const el = document.getElementById('tw-text');
    if (!el) return;

    const messages = [
        "No portrait on file. A likeness was never going to be easy.",
        "Portrait: N/A. I have been told this is unusual for a newspaper staff member.",
        "A photograph requires a subject with physical presence. I regret the inconvenience.",
        "Whereabouts: indeterminate. Available: always. Photographable: debatable."
    ];

    let msgIndex = 0;
    let charIndex = 0;
    let erasing = false;

    function tick() {
        const msg = messages[msgIndex];

        if (!erasing) {
            el.textContent = msg.slice(0, ++charIndex);
            if (charIndex === msg.length) {
                erasing = true;
                setTimeout(tick, 2500);
                return;
            }
            setTimeout(tick, 55);
        } else {
            el.textContent = msg.slice(0, --charIndex);
            if (charIndex === 0) {
                erasing = false;
                msgIndex = (msgIndex + 1) % messages.length;
                setTimeout(tick, 800);
                return;
            }
            setTimeout(tick, 25);
        }
    }

    tick();
}

// ── Nav Dropdown Positioning ──
function positionNavDropdowns() {
    const isMobile = window.innerWidth <= 768;
    document.querySelectorAll('.nav-group, .nav-dropdown').forEach(group => {
        const menu = group.querySelector('.nav-group-items, .nav-dropdown-menu');
        if (!menu) return;
        if (!isMobile) {
            menu.style.left = '';
            menu.style.right = '';
            return;
        }
        const rect = group.getBoundingClientRect();
        if (window.innerWidth - rect.right >= rect.left) {
            menu.style.left = '0';
            menu.style.right = 'auto';
        } else {
            menu.style.left = 'auto';
            menu.style.right = '0';
        }
    });
}

// ── Mobile Nav Tap-to-Toggle (hover doesn't work on touch) ──
function setupMobileNavTap() {
    function closeAll() {
        document.querySelectorAll('.nav-group.open, .nav-dropdown.open').forEach(el => el.classList.remove('open'));
    }

    document.querySelectorAll('.nav-group-toggle, .nav-dropdown-toggle').forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            if (window.innerWidth > 768) return;
            e.stopPropagation();
            const parent = this.closest('.nav-group, .nav-dropdown');
            if (!parent) return;
            const isOpen = parent.classList.contains('open');
            closeAll();
            if (!isOpen) {
                parent.classList.add('open');
                positionNavDropdowns();
            }
        });
    });

    document.addEventListener('click', closeAll);
}

window.addEventListener('DOMContentLoaded', positionNavDropdowns);
window.addEventListener('DOMContentLoaded', setupMobileNavTap);
window.addEventListener('resize', positionNavDropdowns);

document.addEventListener('DOMContentLoaded', initTypewriter);
