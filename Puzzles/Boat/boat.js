// ── CONSTANTS ──────────────────────────────────────────────────────────────

const TRAVELERS = 3;
const CANNIBALS = 3;

const HUMANOID_SVG = `<svg viewBox="0 0 24 36" width="26" height="38" fill="white" aria-hidden="true">
  <circle cx="12" cy="8" r="6"/>
  <path d="M4,19 Q12,13 20,19 L18,34 H14 L12,28 L10,34 H6 Z"/>
</svg>`;

// ── STATE ───────────────────────────────────────────────────────────────────

let state = {
    left:  { travelers: TRAVELERS, cannibals: CANNIBALS },
    right: { travelers: 0,         cannibals: 0 },
    boat:  { travelers: 0,         cannibals: 0, side: 'left' },
    animating: false,
    gameOver:  false,
};

let dragData = null; // { type: 'traveler'|'cannibal', fromZone: 'left'|'right'|'boat' }

// ── HELPERS ─────────────────────────────────────────────────────────────────

function zoneIdToSide(id) {
    if (id === 'left-people')  return 'left';
    if (id === 'right-people') return 'right';
    return 'boat';
}

function typePlural(type) {
    return type + 's'; // 'traveler' → 'travelers', 'cannibal' → 'cannibals'
}

// ── RENDER ──────────────────────────────────────────────────────────────────

function render() {
    renderZone('left-people',  state.left.travelers,  state.left.cannibals,  'left');
    renderZone('right-people', state.right.travelers, state.right.cannibals, 'right');
    renderZone('boat-people',  state.boat.travelers,  state.boat.cannibals,  'boat');
    updateBoatStyle();
    updateDropZoneAvailability();
}

function renderZone(id, travelers, cannibals, zone) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    for (let i = 0; i < travelers; i++) el.appendChild(makeToken('traveler', zone));
    for (let i = 0; i < cannibals; i++) el.appendChild(makeToken('cannibal', zone));
}

function makeToken(type, zone) {
    const div = document.createElement('div');
    div.className = `person ${type}`;
    div.setAttribute('draggable', 'true');
    div.dataset.type = type;
    div.dataset.zone = zone;
    div.innerHTML = HUMANOID_SVG;
    div.addEventListener('click', e => {
        e.stopPropagation();
        handlePersonClick(type, zone);
    });
    return div;
}

function handlePersonClick(type, zone) {
    if (state.animating || state.gameOver) return;
    const plural = typePlural(type);

    if (zone === 'boat') {
        // tap person in boat → send back to current bank
        state.boat[plural]--;
        state[state.boat.side][plural]++;
        render();
    } else {
        // tap person on bank → load into boat if valid
        if (zone !== state.boat.side) return;
        if (state.boat.travelers + state.boat.cannibals >= 2) return;
        state[zone][plural]--;
        state.boat[plural]++;
        render();
    }
}

function updateBoatStyle() {
    const boatEl  = document.getElementById('boat');
    const hintEl  = boatEl.querySelector('.boat-hint');
    const boatTotal = state.boat.travelers + state.boat.cannibals;
    const canRow = boatTotal > 0 && !state.animating && !state.gameOver;

    boatEl.classList.toggle('rowable', canRow);
    hintEl.classList.toggle('hidden', !canRow);
}

function updateDropZoneAvailability() {
    const side = state.boat.side;
    const locked = state.animating || state.gameOver;

    document.getElementById('left-bank').classList.toggle(
        'bank-inactive', locked || side !== 'left'
    );
    document.getElementById('right-bank').classList.toggle(
        'bank-inactive', locked || side !== 'right'
    );
}

// ── DROP VALIDATION ─────────────────────────────────────────────────────────

function isValidDrop(targetId, drag) {
    if (!drag) return false;
    if (state.animating || state.gameOver) return false;

    const toZone   = zoneIdToSide(targetId);
    const fromZone = drag.fromZone;

    if (toZone === fromZone) return false;

    if (toZone === 'boat') {
        if (fromZone !== state.boat.side) return false;
        if (state.boat.travelers + state.boat.cannibals >= 2) return false;
    }

    if (fromZone === 'boat') {
        if (toZone !== state.boat.side) return false;
    }

    // no direct bank-to-bank
    if (fromZone !== 'boat' && toZone !== 'boat') return false;

    return true;
}

// ── HANDLE DROP ─────────────────────────────────────────────────────────────

function handleDrop(targetId, drag) {
    const toZone   = zoneIdToSide(targetId);
    const fromZone = drag.fromZone;
    const plural   = typePlural(drag.type);

    state[fromZone][plural]--;
    state[toZone][plural]++;

    render();
}

// ── DRAG EVENTS (delegation on #scene) ─────────────────────────────────────

document.getElementById('scene').addEventListener('dragstart', e => {
    const token = e.target.closest('.person');
    if (!token || state.animating || state.gameOver) { e.preventDefault(); return; }

    dragData = { type: token.dataset.type, fromZone: token.dataset.zone };
    token.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', token.dataset.type); // required in Firefox
});

document.getElementById('scene').addEventListener('dragend', () => {
    document.querySelectorAll('.person.dragging').forEach(t => t.classList.remove('dragging'));
});

// ── DROP ZONE SETUP ─────────────────────────────────────────────────────────

function setupDropZone(id) {
    const el = document.getElementById(id);
    let enterCount = 0;

    el.addEventListener('dragover', e => {
        if (isValidDrop(id, dragData)) e.preventDefault();
    });

    el.addEventListener('dragenter', () => {
        enterCount++;
        if (isValidDrop(id, dragData)) el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
        enterCount--;
        if (enterCount <= 0) {
            enterCount = 0;
            el.classList.remove('drag-over');
        }
    });

    el.addEventListener('drop', e => {
        e.preventDefault();
        enterCount = 0;
        el.classList.remove('drag-over');
        if (!dragData || !isValidDrop(id, dragData)) return;
        handleDrop(id, dragData);
        dragData = null;
    });
}

setupDropZone('left-people');
setupDropZone('right-people');
setupDropZone('boat-people');

// ── BOAT CROSSING ───────────────────────────────────────────────────────────

const SHORE_OVERLAP = 28;

document.getElementById('boat').addEventListener('click', e => {
    if (e.target.closest('.person')) return; // person click = drag, not row
    if (state.animating || state.gameOver) return;
    const boatTotal = state.boat.travelers + state.boat.cannibals;
    if (boatTotal === 0) return;

    const destination = state.boat.side === 'left' ? 'right' : 'left';
    state.animating = true;
    render();

    const track  = document.getElementById('boat-track');
    const boatEl = document.getElementById('boat');
    const targetLeft = destination === 'right'
        ? (track.offsetWidth - boatEl.offsetWidth + SHORE_OVERLAP)
        : -SHORE_OVERLAP;

    boatEl.style.left = targetLeft + 'px';

    boatEl.addEventListener('transitionend', function onEnd() {
        boatEl.removeEventListener('transitionend', onEnd);

        state[destination].travelers += state.boat.travelers;
        state[destination].cannibals += state.boat.cannibals;
        state.boat.travelers = 0;
        state.boat.cannibals = 0;
        state.boat.side = destination;
        state.animating = false;

        // Flip boat to face back into the river from whichever shore it's on
        document.getElementById('boat-hull').classList.toggle('flipped', destination === 'right');

        checkConstraints();
        checkWin();
        render();
    });
});

// ── GAME LOGIC ──────────────────────────────────────────────────────────────

function isSafe(bank) {
    return bank.travelers === 0 || bank.travelers >= bank.cannibals;
}

function checkConstraints() {
    if (!isSafe(state.left) || !isSafe(state.right)) {
        state.gameOver = true;
        document.getElementById('overlay-loss').classList.remove('hidden');
    }
}

function checkWin() {
    if (state.gameOver) return;
    if (state.right.travelers === TRAVELERS && state.right.cannibals === CANNIBALS) {
        state.gameOver = true;
        document.getElementById('overlay-win').classList.remove('hidden');
    }
}

// ── RESTART ─────────────────────────────────────────────────────────────────

function restart() {
    document.getElementById('overlay-loss').classList.add('hidden');
    document.getElementById('overlay-win').classList.add('hidden');

    const boatEl = document.getElementById('boat');
    const hullEl = document.getElementById('boat-hull');

    // Snap both position and flip back instantly (no transition)
    boatEl.style.transition = 'none';
    hullEl.style.transition  = 'none';
    boatEl.style.left = `-${SHORE_OVERLAP}px`;
    hullEl.classList.remove('flipped');
    boatEl.getBoundingClientRect(); // force reflow
    boatEl.style.transition = '';
    hullEl.style.transition  = '';

    state = {
        left:  { travelers: TRAVELERS, cannibals: CANNIBALS },
        right: { travelers: 0, cannibals: 0 },
        boat:  { travelers: 0, cannibals: 0, side: 'left' },
        animating: false,
        gameOver:  false,
    };
    dragData = null;
    render();
}

document.getElementById('restart-btn').addEventListener('click', restart);
document.querySelectorAll('.overlay-restart').forEach(b => b.addEventListener('click', restart));

// ── RESIZE: keep right-docked boat aligned after window resize ──────────────

window.addEventListener('resize', () => {
    if (state.animating) return;
    const boatEl = document.getElementById('boat');
    const track  = document.getElementById('boat-track');
    boatEl.style.transition = 'none';
    boatEl.style.left = state.boat.side === 'right'
        ? (track.offsetWidth - boatEl.offsetWidth + SHORE_OVERLAP) + 'px'
        : `-${SHORE_OVERLAP}px`;
    boatEl.getBoundingClientRect();
    boatEl.style.transition = '';
});

// ── INIT ────────────────────────────────────────────────────────────────────

render();
