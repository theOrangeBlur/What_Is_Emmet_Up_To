// ============================================================
// TANK CONFIGURATION
//
// "photo" is optional — drop images into the Fish_Tanks/images/
// folder and reference them here. Leave as null for no photo.
// ============================================================

const SHEET_ID = '1sVb8HqV8Ttmv2EVFQmZtnDbubgd_OBp7';

const TANKS = [
    { name: "Office Tank",  gallons: 10, gid: "1907567120", photo: "images/10G.jpg", hasWaterParams: true },
    { name: "Wooded Tank",  gallons: 20, gid: "1561707960", photo: "images/20G.jpg" },
    { name: "55 Gallon",    gallons: 55, gid: "1334361544", photo: null },
];

// ============================================================
// CSV PARSING
//
// The sheet has two header rows:
//   Row 0: main headers (Type, Amount, Temperature (F), ...)
//   Row 1: sub-headers (Min, Max, Min, Max, ...)
// Data starts at row 2.
//
// We stop reading when we hit a "No longer in tank" sentinel row.
// We skip empty rows and summary rows (Range:, Measured:).
// ============================================================

function parseCSVRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

// Sentinel values in the "Type" column that mean "stop reading"
const STOP_SENTINELS = ['no longer in tank'];

// Values in the "Type" column to skip (summary/aggregate rows)
const SKIP_PREFIXES = ['range:', 'measured:', 'measured'];

// ============================================================
// WATER PARAMS FROM SHEET
//
// Sheets have "Range:" and "Measured:" summary rows that we
// skip during species parsing. This function reads those rows
// to get the last recorded water parameter values.
// ============================================================

function parseTankWaterParams(text) {
    // Row 0: main headers  (e.g. "Temperature (F)", "pH", "TDS")
    // Row 1: sub-headers   (e.g. "Min", "Max" under each param)
    // Measured row: value goes in the "Max" sub-column for each param;
    //               date goes in column B (index 1).
    const allLines = text.split('\n');
    if (allLines.length < 2) return null;

    const mainHeaders = parseCSVRow(allLines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const subHeaders  = parseCSVRow(allLines[1]).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());

    const HEADER_TO_KEY = {
        'temperature (f)': 'temperature_f',
        'temperature(f)':  'temperature_f',
        'temperature':     'temperature_f',
        'ph':              'ph',
        'tds':             'tds',
    };

    // For each param, find its main column and the offset to the "Max" sub-column.
    const paramInfo = {}; // key -> { minCol, maxCol }
    mainHeaders.forEach((h, i) => {
        const key = HEADER_TO_KEY[h.toLowerCase()];
        if (!key) return;

        let minCol = i, maxCol = i;
        for (let j = i; j < subHeaders.length; j++) {
            // Stop when we reach the next non-empty main header (next param group)
            if (j > i && mainHeaders[j]) break;
            if (subHeaders[j] === 'min') minCol = j;
            if (subHeaders[j] === 'max') maxCol = j;
        }
        paramInfo[key] = { minCol, maxCol };
    });

    if (Object.keys(paramInfo).length === 0) return null;

    let measuredRow  = null;
    let rangeRow     = null;
    let measuredDate = null;

    for (let i = 1; i < allLines.length; i++) {
        const line = allLines[i];
        if (!line.trim()) continue;
        const values   = parseCSVRow(line).map(v => v.replace(/^"|"$/g, '').trim());
        const typeName = ((values[0] || '').trim() || (values[1] || '').trim()).toLowerCase();

        if (typeName === 'measured' || typeName.startsWith('measured:')) {
            measuredRow  = values;
            measuredDate = values[1] || null; // date is in column B
        } else if (typeName === 'range' || typeName.startsWith('range:')) {
            rangeRow = values;
        }
    }

    if (!measuredRow) return null;

    const params = {};
    const ranges = {};

    for (const [key, { minCol, maxCol }] of Object.entries(paramInfo)) {
        const val = parseFloat(measuredRow[maxCol]); // reading under "Max" sub-header
        if (!isNaN(val)) params[key] = val;

        if (rangeRow) {
            const minVal = parseFloat(rangeRow[minCol]);
            const maxVal = parseFloat(rangeRow[maxCol]);
            if (!isNaN(minVal) && !isNaN(maxVal)) {
                ranges[key] = { min: minVal, max: maxVal };
            }
        }
    }

    if (Object.keys(params).length === 0) return null;

    return { params, ranges, updated: measuredDate || null, source: 'sheet' };
}

function parseTankCSV(text) {
    const allLines = text.split('\n');
    if (allLines.length < 3) return [];

    // Row 0 is the main header — "Type" and "Amount" are here
    const mainHeaders = parseCSVRow(allLines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const subHeaders  = parseCSVRow(allLines[1]).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
    const typeIdx   = mainHeaders.findIndex(h => h.toLowerCase() === 'type');
    const amountIdx = mainHeaders.findIndex(h => h.toLowerCase() === 'amount');

    // Build param column mapping (same logic as parseTankWaterParams)
    const HEADER_TO_KEY = {
        'temperature (f)': 'temperature_f', 'temperature(f)': 'temperature_f',
        'temperature': 'temperature_f', 'ph': 'ph', 'tds': 'tds',
    };
    const paramCols = {};
    mainHeaders.forEach((h, i) => {
        const key = HEADER_TO_KEY[h.toLowerCase()];
        if (!key) return;
        let minCol = i, maxCol = i;
        for (let j = i; j < subHeaders.length; j++) {
            if (j > i && mainHeaders[j]) break;
            if (subHeaders[j] === 'min') minCol = j;
            if (subHeaders[j] === 'max') maxCol = j;
        }
        paramCols[key] = { minCol, maxCol };
    });

    // Data starts at row 2.
    const inhabitants = [];

    for (let i = 2; i < allLines.length; i++) {
        const line = allLines[i];
        if (!line.trim()) continue;

        const values = parseCSVRow(line).map(v => v.replace(/^"|"$/g, '').trim());
        const typeName = typeIdx >= 0 ? (values[typeIdx] || '') : '';

        // Stop at "No longer in tank" section
        if (STOP_SENTINELS.some(s => typeName.toLowerCase().startsWith(s))) break;

        // Skip empty, summary, or aggregate rows
        if (!typeName) continue;
        if (SKIP_PREFIXES.some(p => typeName.toLowerCase().startsWith(p))) continue;

        const amount = amountIdx >= 0 ? (values[amountIdx] || '') : '';

        // Parse per-species parameter ranges from the sheet
        const ranges = {};
        for (const [key, { minCol, maxCol }] of Object.entries(paramCols)) {
            const minVal = parseFloat(values[minCol]);
            const maxVal = parseFloat(values[maxCol]);
            if (!isNaN(minVal) && !isNaN(maxVal)) {
                ranges[key] = { min: minVal, max: maxVal };
            }
        }

        inhabitants.push({ species: typeName, amount, ranges });
    }

    return inhabitants;
}

// ============================================================
// SPECIES IMAGES
//
// Local images live in images/species/. To swap one out, drop
// a replacement file in that folder and update the path here.
// ============================================================

const SPECIES_IMAGES = {
    "Ricefish":               "images/species/ricefish.jpg",
    "Fancy Guppy":            "images/species/Fancy_Guppy.jpg",
    "Guppies":                "images/species/guppies.jpg",
    "Guppy":                  "images/species/guppies.jpg",
    "Red Ramshorn Snail":     "images/species/red_ramshorn_snail.jpg",
    "Bladder Snail":          "images/species/bladder_snail.jpg",
    "Assassin Snail":         "images/species/assassin_snail.png",
    "water spangles":         "images/species/water_spangles.jpg",
    "Hornwort":               "images/species/hornwort.jpg",
    "Java Fern":              "images/species/java_fern.jpg",
    "Philodendron":           "images/species/philodendron.jpg",
    "Coleus":                 "images/species/coleus.jpg",
    "Cardinal Tetra":         "images/species/cardinal_tetra.jpg",
    "Mystery Snail":          "images/species/mystery_snail.jpg",
    "Nerite Snail":           "images/species/nerite_snail.png",
    "Anubias barteri":        "images/species/anubias_barteri.jpg",
    "Cryptocoryne spiralis":  "images/species/Cryptocoryne_Spiralis.jpg",
    "Moneywort":              "images/species/Moneywort.jpg",
};

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================
// FETCH + RENDER
// ============================================================

function buildSheetURL(gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

async function fetchTank(tank) {
    const response = await fetch(buildSheetURL(tank.gid));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function fetchWaterParams() {
    try {
        const res = await fetch('water-params.json');
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

const PARAM_META = {
    temperature_f: { label: 'Temperature', unit: '°F' },
    ph:            { label: 'pH',          unit: ''   },
    tds:           { label: 'TDS',         unit: ' ppm' },
};

// How far outside the range before escalating from yellow to red
const PARAM_THRESHOLDS = {
    temperature_f: 5,
    ph: 1.0,
};

const PARAM_GREEN_MESSAGES = {
    temperature_f: 'Everyone thinks the temperature feels great!',
    ph: 'Goldilocks would be proud!',
};

function paramStatus(value, range, key) {
    if (value >= range.min && value <= range.max) return 'good';
    const threshold = PARAM_THRESHOLDS[key];
    if (threshold !== undefined) {
        const overage = value > range.max ? value - range.max : range.min - value;
        return overage <= threshold ? 'warn' : 'danger';
    }
    return 'danger';
}

function speciesParamMessage(k, species, value, r) {
    if (value >= r.min && value <= r.max) return null;
    const threshold = PARAM_THRESHOLDS[k];
    if (k === 'temperature_f') {
        if (value > r.max) {
            const over = value - r.max;
            return over <= threshold
                ? { status: 'warn',   message: `${species} thinks it's a little warm!` }
                : { status: 'danger', message: `${species} thinks it's too hot!` };
        } else {
            const under = r.min - value;
            return under <= threshold
                ? { status: 'warn',   message: `${species} thinks it's a little cool!` }
                : { status: 'danger', message: `${species} thinks it's too cold!` };
        }
    }
    if (k === 'ph') {
        if (value > r.max) {
            const over = value - r.max;
            return over <= threshold
                ? { status: 'warn',   message: `${species} thinks it's a little basic in here!` }
                : { status: 'danger', message: `${species} thinks it's too alkaline!` };
        } else {
            const under = r.min - value;
            return under <= threshold
                ? { status: 'warn',   message: `${species} thinks it's a little acidic in here!` }
                : { status: 'danger', message: `${species} thinks it's too acidic!!` };
        }
    }
    return null;
}

function computeParamDisplay(k, value, tankRange, inhabitants) {
    const speciesWithRange = inhabitants.filter(i => i.ranges && i.ranges[k]);
    if (speciesWithRange.length > 0) {
        const complaints = speciesWithRange
            .map(({ species, ranges: r }) => speciesParamMessage(k, species, value, r[k]))
            .filter(Boolean);
        const status = complaints.some(c => c.status === 'danger') ? 'danger'
            : complaints.some(c => c.status === 'warn') ? 'warn' : 'good';
        const tooltip = complaints.length === 0
            ? (PARAM_GREEN_MESSAGES[k] || "Everyone's comfortable!")
            : complaints.map(c => c.message).join('\n');
        return { status, tooltip };
    }
    // Fallback: use tank-level range when no individual species ranges exist
    if (tankRange) {
        const status = paramStatus(value, tankRange, k);
        const tooltip = status === 'good'
            ? (PARAM_GREEN_MESSAGES[k] || "Everyone's comfortable!")
            : 'Out of range';
        return { status, tooltip };
    }
    return { status: 'good', tooltip: PARAM_GREEN_MESSAGES[k] || "Everyone's comfortable!" };
}

function renderWaterParams(waterData, inhabitants = []) {
    const params  = waterData.params  || {};
    const ranges  = waterData.ranges  || {};
    const updated = waterData.updated || null;

    const keys = Object.keys(PARAM_META).filter(k => k in params);

    if (keys.length === 0) {
        return `<div class="water-params">
            <h3 class="water-params-title">Water Parameters</h3>
            <p class="water-params-pending">Awaiting first sensor reading...</p>
        </div>`;
    }

    const cards = keys.map(k => {
        const { label, unit } = PARAM_META[k];
        const value  = params[k];
        const { status, tooltip } = computeParamDisplay(k, value, ranges[k], inhabitants);
        const titleAttr = ` title="${escapeHTML(tooltip)}"`;

        return `<div class="param-card"${titleAttr}>
            <span class="param-status param-status--${status}"></span>
            <span class="param-value">${value}${escapeHTML(unit)}</span>
            <span class="param-label">${label}</span>
        </div>`;
    }).join('');

    const updatedHTML = updated
        ? `<p class="param-updated">${
            waterData.source === 'sheet'
                ? `Last tested ${escapeHTML(updated)}`
                : `Updated ${new Date(updated).toLocaleString()}`
          }</p>`
        : '';

    return `<div class="water-params">
        <h3 class="water-params-title">Water Parameters</h3>
        <div class="param-grid">${cards}</div>
        ${updatedHTML}
    </div>`;
}

function renderTankCard(tank, csvText, waterData = null, sheetWaterParams = null) {
    const inhabitants = parseTankCSV(csvText);

    // Don't render cards for tanks with nothing in them yet
    if (inhabitants.length === 0) return null;

    const card = document.createElement('div');
    card.className = 'tank-card glass-card';

    let photoHTML = '';
    if (tank.photo) {
        photoHTML = `<img class="tank-photo" src="${tank.photo}" alt="${tank.name}" onerror="this.parentElement.style.display='none'">`;
    }

    const items = inhabitants.map(({ species, amount }) => {
        const safe = escapeHTML(species);
        const imgPath = SPECIES_IMAGES[species] || null;
        const imgHTML = imgPath
            ? `<img class="species-photo loaded" src="${imgPath}" alt="${safe}">`
            : '';
        return `<li>
            <div class="species-photo-slot">${imgHTML}</div>
            <span class="fish-count">${escapeHTML(amount || '?')}</span>
            ${safe}
        </li>`;
    }).join('');

    const effectiveWaterData = (tank.hasWaterParams && waterData) ? waterData : sheetWaterParams;
    const waterParamsHTML = effectiveWaterData ? renderWaterParams(effectiveWaterData, inhabitants) : '';

    card.innerHTML = `
        <h2 class="tank-name">${escapeHTML(tank.name)}</h2>
        <div class="tank-body">
            ${photoHTML ? `<div class="tank-photo-wrap">${photoHTML}${tank.gallons ? `<span class="tank-gallons">${tank.gallons} gal</span>` : ''}</div>` : ''}
            <div class="tank-info">
                <ul class="fish-list">${items}</ul>
            </div>
        </div>
        ${waterParamsHTML}
    `;

    return card;
}

function renderError(tank, message) {
    const card = document.createElement('div');
    card.className = 'tank-card glass-card tank-card--error';
    card.innerHTML = `
        <div class="tank-info">
            <h2>${tank.name}</h2>
            <p class="error-message">Couldn't load tank data. (${message})</p>
        </div>
    `;
    return card;
}

async function loadTanks() {
    const grid = document.getElementById('tanks-grid');
    grid.innerHTML = '';

    const [tankResults, waterData] = await Promise.all([
        Promise.allSettled(TANKS.map(fetchTank)),
        fetchWaterParams(),
    ]);

    tankResults.forEach((result, i) => {
        const tank = TANKS[i];
        let card;
        if (result.status === 'fulfilled') {
            try {
                const sheetWaterParams = parseTankWaterParams(result.value);
                card = renderTankCard(tank, result.value, waterData, sheetWaterParams);
            } catch (e) {
                card = renderError(tank, e.message);
            }
        } else {
            card = renderError(tank, result.reason?.message || 'fetch failed');
        }
        if (card) grid.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', loadTanks);

// Swimming critters
const SWIMMERS = ['🐟', '🐠', '🐡', '🦈', '🐙', '🦑', '🦐', '🦀', '🐬', '🐳', '🐢', '🦞', '🪸'];
const activeSwimmers = []; // track live swimmers for proximity detection

function createSwimmer() {
    const el = document.createElement('div');
    el.className = 'swimmer';
    const goingRight = Math.random() < 0.5;
    el.classList.add(goingRight ? 'going-right' : 'going-left');
    el.textContent = SWIMMERS[Math.floor(Math.random() * SWIMMERS.length)];
    const duration = Math.random() * 12 + 10; // 10–22s

    // Pixel-based Y so oscillation can adjust it
    const baseY = window.innerHeight * (Math.random() * 0.8 + 0.05);
    el.style.top = baseY + 'px';
    el.style.animationDuration = duration + 's';

    // Start off-screen on the correct side
    if (goingRight) el.style.left = '-120px';
    else el.style.left = 'calc(100vw + 120px)';

    // Oscillation proportional to speed (faster swimmer = bigger wobble)
    const speed = (window.innerWidth + 240) / duration; // px/s
    const amplitude = Math.min(speed * 0.35, 25);
    let oscT = Math.random() * Math.PI * 2;
    const oscInterval = setInterval(() => {
        oscT += 0.05;
        el.style.top = (baseY + Math.sin(oscT) * amplitude) + 'px';
    }, 16);

    const sw = { el, goingRight, oscInterval, fleeing: false, removeTimeout: null };
    activeSwimmers.push(sw);

    sw.removeTimeout = setTimeout(() => {
        clearInterval(oscInterval);
        const idx = activeSwimmers.indexOf(sw);
        if (idx !== -1) activeSwimmers.splice(idx, 1);
        el.remove();
    }, duration * 1000);

    document.body.appendChild(el);
}

function scheduleNextSwimmer() {
    const delay = Math.random() * 25000 + 15000; // 15–40s
    setTimeout(() => {
        createSwimmer();
        scheduleNextSwimmer();
    }, delay);
}

scheduleNextSwimmer();

// Bubbles
function createBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const size = Math.random() * 10 + 4; // 4–14px
    const duration = Math.random() * 6 + 6; // 6–12s
    const sway = (Math.random() - 0.5) * 60; // -30px to +30px horizontal drift
    bubble.style.width = size + 'px';
    bubble.style.height = size + 'px';
    bubble.style.left = Math.random() * 100 + 'vw';
    bubble.style.bottom = '-20px';
    bubble.style.setProperty('--sway', sway + 'px');
    bubble.style.animationDuration = duration + 's';
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), duration * 1000);
}

setInterval(createBubble, 600);
for (let i = 0; i < 12; i++) {
    setTimeout(createBubble, Math.random() * 4000);
}

// ============================================================
// COMPANION FISH
// ============================================================

const companionFish = document.createElement('div');
companionFish.className = 'companion-fish';
companionFish.textContent = '🐠';
document.body.appendChild(companionFish);

// Position & velocity
let fishX = window.innerWidth / 2;
let fishY = window.innerHeight / 2;
let fishVX = 0, fishVY = 0;
let fishFacing = 1;   // 1 = right, -1 = left
let nipScale = 1.0;
let idleT = 0;        // time counter driving idle oscillation
let targetX = fishX, targetY = fishY;

// Mouse tracking
let mouseX = 0, mouseY = 0, lastMoveTime = 0;
let prevMouseX = 0, prevMouseY = 0;
let cvx = 0, cvy = 0; // smoothed cursor velocity

// Jitter offset — random position around the cursor
let jitterX = 0, jitterY = 0;
function randomizeSideJitter() {
    const angle = Math.random() * Math.PI * 2;   // full 360°
    const radius = 80 + Math.random() * 100;     // 80–180px from cursor
    jitterX = Math.cos(angle) * radius;
    jitterY = Math.sin(angle) * radius;
}

// State machine  — states: 'idle' | 'curious' | 'nipping' | 'attacking'
const STATE = {
    current: 'idle',
    idleTimer: null,
    curiousTimeout: null,
    nipPhase: 'none',   // 'darting' | 'bouncing'
    nipDartTarget: { x: 0, y: 0 },
    nipBounceTarget: { x: 0, y: 0 },
};

// Attack state
const ATTACK = { target: null, nipsRemaining: 0 };

// Curious rotation — tracks smooth angle-toward-cursor when settled
let curiousRotation = 0;

const MARGIN = 60;

function clampX(x) { return Math.max(MARGIN, Math.min(window.innerWidth  - MARGIN, x)); }
function clampY(y) { return Math.max(MARGIN, Math.min(window.innerHeight - MARGIN, y)); }

function pickNewIdleTarget() {
    targetX = clampX(MARGIN + Math.random() * (window.innerWidth  - MARGIN * 2));
    targetY = clampY(MARGIN + Math.random() * (window.innerHeight - MARGIN * 2));
    STATE.idleTimer = setTimeout(pickNewIdleTarget, 3000 + Math.random() * 3000);
}

function enterIdle() {
    clearTimeout(STATE.idleTimer);
    clearTimeout(STATE.curiousTimeout);
    clearTimeout(STATE.orbitTimer);
    STATE.current = 'idle';
    STATE.nipPhase = 'none';
    pickNewIdleTarget();
}

function scheduleJitterReshuffle() {
    STATE.orbitTimer = setTimeout(function reshuffleJitter() {
        if (STATE.current === 'curious') {
            randomizeSideJitter();
            scheduleJitterReshuffle();
        }
    }, 1000 + Math.random() * 2000);
}

function enterCurious() {
    const wasAlreadyCurious = STATE.current === 'curious';
    clearTimeout(STATE.curiousTimeout);
    STATE.current = 'curious';
    STATE.nipPhase = 'none';
    STATE.curiousTimeout = setTimeout(enterIdle, 10000);
    // Only randomize jitter and start reshuffle timer on fresh entry
    if (!wasAlreadyCurious) {
        clearTimeout(STATE.idleTimer);
        randomizeSideJitter();
        scheduleJitterReshuffle();
    }
}

function enterNip(clickX, clickY) {
    clearTimeout(STATE.idleTimer);
    clearTimeout(STATE.curiousTimeout);
    clearTimeout(STATE.orbitTimer);
    STATE.current = 'nipping';
    STATE.nipPhase = 'darting';

    const dx = clickX - fishX;
    const dy = clickY - fishY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;

    // Dart to the click point itself, bounce 80px back along the approach vector
    STATE.nipDartTarget.x = clampX(clickX);
    STATE.nipDartTarget.y = clampY(clickY);
    STATE.nipBounceTarget.x = clampX(clickX - nx * 80);
    STATE.nipBounceTarget.y = clampY(clickY - ny * 80);

    targetX = STATE.nipDartTarget.x;
    targetY = STATE.nipDartTarget.y;
}

function endNip() {
    STATE.nipPhase = 'none';
    if (Date.now() - lastMoveTime < 2500) {
        enterCurious();
    } else {
        enterIdle();
    }
}

function updateFish() {
    // Determine lerp factor
    let lerp;
    if (STATE.current === 'nipping') {
        lerp = STATE.nipPhase === 'darting' ? 0.18 : 0.22;
    } else if (STATE.current === 'curious') {
        const speed = Math.hypot(cvx, cvy);
        if (speed > 0.5) {
            // Trail behind the cursor in its movement direction, with perpendicular jitter
            const nx = cvx / speed, ny = cvy / speed;
            const trailDist = 60 + Math.min(speed * 4, 60); // 60–120px behind
            // Project jitter onto perpendicular axis so fish varies its side while trailing
            const perp = (-ny) * jitterX + (nx) * jitterY;
            targetX = mouseX - nx * trailDist + (-ny) * perp;
            targetY = mouseY - ny * trailDist + ( nx) * perp;
        } else {
            // Cursor nearly still — roam freely around the cursor
            targetX = mouseX + jitterX;
            targetY = mouseY + jitterY;
        }
        lerp = 0.055;
    } else {
        // Vary speed between 0.005 and 0.00125 on a slow sine cycle
        lerp = 0.005 * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(idleT * 0.12)));
    }

    // Move fish
    const prevX = fishX, prevY = fishY;
    fishX += (targetX - fishX) * lerp;
    fishY += (targetY - fishY) * lerp;

    // Smooth velocity
    fishVX += ((fishX - prevX) - fishVX) * 0.2;
    fishVY += ((fishY - prevY) - fishVY) * 0.2;

    // Facing direction
    // 🐠 emoji naturally faces left, so flip logic: moving right = scaleX(-1)
    if (STATE.current === 'curious') {
        // Always face toward the cursor
        fishFacing = mouseX > fishX ? -1 : 1;
    } else {
        // Face direction of travel (only update when moving decisively)
        if      (fishVX >  0.3) fishFacing = -1;
        else if (fishVX < -0.3) fishFacing =  1;
    }

    // Tilt based on vertical speed
    const tilt = Math.max(-12, Math.min(12, fishVY * 8));

    // Nip scale pulse — lerp back to 1.0 each frame
    nipScale += (1.0 - nipScale) * 0.15;

    // Idle oscillation — sine wave perpendicular to direction of travel
    let renderX = fishX, renderY = fishY;
    if (STATE.current === 'idle') {
        idleT += 0.045;
        const spd = Math.hypot(fishVX, fishVY);
        if (spd > 0.05) {
            const px = -fishVY / spd;
            const py =  fishVX / spd;
            const wave = Math.sin(idleT) * spd * 30;
            renderX += px * wave;
            renderY += py * wave;
        }
    }

    // Apply
    companionFish.style.left = renderX + 'px';
    companionFish.style.top  = renderY + 'px';
    companionFish.style.transform =
        `scaleX(${fishFacing}) rotate(${tilt * fishFacing}deg) scale(${nipScale})`;

    // Nip phase transitions
    if (STATE.current === 'nipping') {
        const tx = STATE.nipPhase === 'darting' ? STATE.nipDartTarget.x : STATE.nipBounceTarget.x;
        const ty = STATE.nipPhase === 'darting' ? STATE.nipDartTarget.y : STATE.nipBounceTarget.y;
        const dist = Math.hypot(tx - fishX, ty - fishY);

        if (STATE.nipPhase === 'darting' && dist < 8) {
            STATE.nipPhase = 'bouncing';
            nipScale = 1.25;    // trigger pulse
            targetX = STATE.nipBounceTarget.x;
            targetY = STATE.nipBounceTarget.y;
        } else if (STATE.nipPhase === 'bouncing' && dist < 10) {
            endNip();
        }
    }

    requestAnimationFrame(updateFish);
}

// Event listeners
document.addEventListener('mousemove', e => {
    cvx += ((e.clientX - prevMouseX) - cvx) * 0.25;
    cvy += ((e.clientY - prevMouseY) - cvy) * 0.25;
    prevMouseX = mouseX = e.clientX;
    prevMouseY = mouseY = e.clientY;
    lastMoveTime = Date.now();
    if (STATE.current !== 'nipping') enterCurious();
});

document.addEventListener('mousedown', e => {
    lastMoveTime = Date.now();
    enterNip(e.clientX, e.clientY);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && STATE.current !== 'nipping') enterIdle();
});

// Start
enterIdle();
requestAnimationFrame(updateFish);
