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
