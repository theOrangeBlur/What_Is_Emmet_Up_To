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
    "Whatever could be baking in that 3D printer of his?"
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

// Custom cursor
const cursor = document.querySelector('.custom-cursor');
const trails = [];
const maxTrails = 5;

for (let i = 0; i < maxTrails; i++) {
    const trail = document.createElement('div');
    trail.className = 'cursor-trail';
    document.body.appendChild(trail);
    trails.push({
        element: trail,
        x: 0,
        y: 0
    });
}

let mouseX = 0, mouseY = 0;
let cursorX = 0, cursorY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

function animateCursor() {
    cursorX += (mouseX - cursorX) * 0.2;
    cursorY += (mouseY - cursorY) * 0.2;

    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';

    trails.forEach((trail, index) => {
        const delay = (index + 1) * 0.05;
        trail.x += (mouseX - trail.x) * (0.2 - delay);
        trail.y += (mouseY - trail.y) * (0.2 - delay);
        trail.element.style.left = trail.x + 'px';
        trail.element.style.top = trail.y + 'px';
        trail.element.style.opacity = 1 - (index / maxTrails);
    });

    requestAnimationFrame(animateCursor);
}

animateCursor();

// Floating particles
function createParticle() {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * window.innerWidth + 'px';
    particle.style.top = Math.random() * window.innerHeight + 'px';
    particle.style.animationDelay = Math.random() * 3 + 's';
    particle.style.animationDuration = (Math.random() * 3 + 2) + 's';
    document.body.appendChild(particle);

    setTimeout(() => particle.remove(), 6000);
}

setInterval(createParticle, 500);
for (let i = 0; i < 15; i++) createParticle();

// ── Cosmic Newspaper: Dynamic Preview Loading ──

async function loadPreviews() {
    await Promise.allSettled([
        loadProjectPreview(),
        loadMoviePreview(),
        loadGamePreview(),
        loadDisciplinePreview()
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
        if (img && data.thumbnail) {
            img.src = 'Projects/' + data.thumbnail;
            img.style.display = 'block';
        }
        if (title && data.title) {
            title.textContent = 'Latest: ' + data.title;
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
            ratingEl.textContent = renderStars(rating);
        }
        if (movieDateEl && watchedDate) {
            const d = new Date(watchedDate + 'T00:00:00');
            movieDateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    } catch (e) { /* silently fail */ }
}

function renderStars(rating) {
    let stars = '';
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    for (let i = 0; i < full; i++) stars += '\u2605';
    if (half) stars += '\u00BD';
    const empty = 5 - full - (half ? 1 : 0);
    for (let i = 0; i < empty; i++) stars += '\u2606';
    return stars;
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
                    actualBeat: row[3],
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
        const isCompleted = bestGame.actualBeat && bestGame.actualBeat.trim() !== '';
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
    mind: '#c4b5fd',
    body: '#7dd3fc',
    spirit: '#5eead4',
    spanish: '#f472b6',
    exceptional: '#ffd700'
};

async function loadDisciplinePreview() {
    try {
        const resp = await fetch('Discipline/log.csv');
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

// Dropdown nav toggle
document.querySelectorAll('.dropdown-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const dropdown = btn.closest('.dropdown');
        const isOpen = dropdown.classList.contains('open');
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
        if (!isOpen) dropdown.classList.add('open');
    });
});
document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});
