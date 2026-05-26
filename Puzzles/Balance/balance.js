// ── STATE ───────────────────────────────────────────────────────────────────

let state = {
    oddCoin:    null,   // 1–12
    oddType:    null,   // 'heavier' | 'lighter'
    coins:      null,   // Map<id, 'table'|'left'|'right'|'org1'…'org4'>
    coinColors: null,   // Map<id, string|null>  e.g. 'red', 'blue', null
    weighings:  0,
    scaleState: 'idle', // 'idle' | 'left-heavy' | 'right-heavy' | 'balanced'
    gameOver:   false,
    accusedCoin: null,
    selected:   new Set(),
    accusing:   false,
};

// ── INIT ────────────────────────────────────────────────────────────────────

function initGame() {
    state.oddCoin    = Math.floor(Math.random() * 12) + 1;
    state.oddType    = Math.random() < 0.5 ? 'heavier' : 'lighter';
    state.coins      = new Map();
    state.coinColors = new Map();
    for (let i = 1; i <= 12; i++) {
        state.coins.set(i, 'org1');
        state.coinColors.set(i, null);
    }
    state.weighings  = 0;
    state.scaleState = 'idle';
    state.gameOver   = false;
    state.accusedCoin = null;
    state.selected   = new Set();
    state.accusing   = false;
    render();
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function weight(coinId) {
    if (coinId === state.oddCoin) {
        return state.oddType === 'heavier' ? 1.5 : 0.5;
    }
    return 1;
}

function coinsInZone(zone) {
    return [...state.coins.entries()]
        .filter(([, z]) => z === zone)
        .map(([id]) => id);
}

// ── WEIGH ───────────────────────────────────────────────────────────────────

function weigh() {
    if (state.gameOver) return;

    const left  = coinsInZone('left');
    const right = coinsInZone('right');
    if (left.length === 0 && right.length === 0) return;

    const leftW  = left.reduce((s, id)  => s + weight(id), 0);
    const rightW = right.reduce((s, id) => s + weight(id), 0);

    if      (leftW > rightW)  state.scaleState = 'left-heavy';
    else if (rightW > leftW)  state.scaleState = 'right-heavy';
    else                      state.scaleState = 'balanced';

    state.weighings++;
    render();
}

// ── SELECTION ────────────────────────────────────────────────────────────────

function toggleSelection(coinId) {
    if (state.gameOver || state.accusing) return;
    if (state.selected.has(coinId)) {
        state.selected.delete(coinId);
    } else {
        state.selected.add(coinId);
    }
    render();
}

function moveSelectedTo(zone) {
    if (state.gameOver || state.accusing || state.selected.size === 0) return;
    for (const id of state.selected) {
        state.coins.set(id, zone);
    }
    state.selected.clear();
    render();
}

// ── ACCUSATION ──────────────────────────────────────────────────────────────

function enterAccuseMode() {
    if (state.gameOver) return;
    state.accusing   = true;
    state.selected.clear();
    render();
}

function exitAccuseMode() {
    state.accusing   = false;
    state.accusedCoin = null;
    render();
}

function handleCoinAccuse(coinId) {
    if (!state.accusing || state.gameOver) return;
    state.accusedCoin = coinId;
    document.getElementById('accused-coin-num').textContent = coinId;
    document.getElementById('accusation-modal').classList.remove('hidden');
}

function resolveAccusation(type) {
    document.getElementById('accusation-modal').classList.add('hidden');
    const correct = state.accusedCoin === state.oddCoin && type === state.oddType;
    state.accusing  = false;
    state.gameOver  = true;

    if (correct) {
        const w = state.weighings;
        const msg = w <= 3
            ? `You nailed it in ${w} weighing${w === 1 ? '' : 's'}! Perfect!`
            : `Correct! But it took ${w} weighings — try for 3 next time.`;
        document.getElementById('win-weighings').textContent = msg;
        document.getElementById('overlay-win').classList.remove('hidden');
    } else {
        document.getElementById('loss-info').textContent =
            `The odd coin was #${state.oddCoin} (${state.oddType}).`;
        document.getElementById('overlay-loss').classList.remove('hidden');
    }
}

// ── RENDER ──────────────────────────────────────────────────────────────────

function render() {
    const leftPan  = document.getElementById('left-pan');
    const rightPan = document.getElementById('right-pan');

    leftPan.innerHTML  = '';
    rightPan.innerHTML = '';
    for (let i = 1; i <= 4; i++) document.getElementById(`org${i}`).innerHTML = '';

    for (const [id, zone] of state.coins.entries()) {
        const coin = makeCoin(id);
        if      (zone === 'left')  leftPan.appendChild(coin);
        else if (zone === 'right') rightPan.appendChild(coin);
        else if (zone.startsWith('org')) document.getElementById(zone).appendChild(coin);
    }

    // Scale tilt
    const wrapper = document.getElementById('scale-wrapper');
    wrapper.classList.remove('tilt-left', 'tilt-right', 'balanced');
    if      (state.scaleState === 'left-heavy')  wrapper.classList.add('tilt-left');
    else if (state.scaleState === 'right-heavy') wrapper.classList.add('tilt-right');
    else if (state.scaleState === 'balanced')    wrapper.classList.add('balanced');

    // Weighings display
    const disp = document.getElementById('weighings-display');
    disp.textContent = `Weighings: ${state.weighings} / 3`;
    disp.classList.toggle('at-limit', state.weighings >= 3);

    // Scene mode classes (drive zone hover styles via CSS)
    const scene = document.getElementById('scene');
    scene.classList.toggle('has-selection', state.selected.size > 0 && !state.accusing);
    scene.classList.toggle('accuse-mode',   state.accusing);

    // Accuse button label
    const accuseBtn = document.getElementById('accuse-btn');
    accuseBtn.textContent = state.accusing ? 'Cancel' : 'Accuse a Coin';
    accuseBtn.classList.toggle('active', state.accusing);
}

// ── COIN ELEMENT ────────────────────────────────────────────────────────────

function makeCoin(id) {
    const div = document.createElement('div');
    div.className      = 'coin';
    div.dataset.coinId = id;

    const color = state.coinColors.get(id);
    if (color) div.classList.add(`dyed-${color}`);

    if (state.accusing) {
        div.classList.add('accuse-target');
        div.addEventListener('click', e => { e.stopPropagation(); handleCoinAccuse(id); });
    } else {
        if (state.selected.has(id)) div.classList.add('selected');
        div.addEventListener('click', e => { e.stopPropagation(); toggleSelection(id); });
    }

    return div;
}

// ── DYE ─────────────────────────────────────────────────────────────────────

function applyColor(colorName) {
    if (state.gameOver || state.selected.size === 0) return;
    const color = colorName === 'gold' ? null : colorName;
    for (const id of state.selected) {
        state.coinColors.set(id, color);
    }
    render();
}

function setupPalette() {
    document.querySelectorAll('.swatch').forEach(swatch => {
        swatch.addEventListener('click', () => applyColor(swatch.dataset.color));
    });
}

// ── ZONE CLICKS ──────────────────────────────────────────────────────────────

function setupZoneClicks() {
    const zones = [
        ['left-pan',  'left'],
        ['right-pan', 'right'],
        ['org1', 'org1'], ['org2', 'org2'], ['org3', 'org3'],
        ['org4', 'org4'],
    ];
    zones.forEach(([id, zone]) => {
        document.getElementById(id).addEventListener('click', () => moveSelectedTo(zone));
    });
}

// ── RESTART ─────────────────────────────────────────────────────────────────

function restart() {
    document.getElementById('overlay-win').classList.add('hidden');
    document.getElementById('overlay-loss').classList.add('hidden');
    document.getElementById('accusation-modal').classList.add('hidden');
    initGame();
}

// ── WIRE UP ─────────────────────────────────────────────────────────────────

document.getElementById('weigh-btn').addEventListener('click', weigh);
document.getElementById('restart-btn').addEventListener('click', restart);
document.getElementById('accuse-btn').addEventListener('click', () => {
    state.accusing ? exitAccuseMode() : enterAccuseMode();
});

document.querySelectorAll('.overlay-restart').forEach(btn => btn.addEventListener('click', restart));

document.getElementById('accuse-heavier').addEventListener('click', () => resolveAccusation('heavier'));
document.getElementById('accuse-lighter').addEventListener('click', () => resolveAccusation('lighter'));
document.getElementById('accuse-cancel').addEventListener('click', () => {
    document.getElementById('accusation-modal').classList.add('hidden');
    exitAccuseMode();
});

setupZoneClicks();
setupPalette();
initGame();
