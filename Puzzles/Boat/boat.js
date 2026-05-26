// ── CONSTANTS ──────────────────────────────────────────────────────────────

const TRAVELERS = 3;
const CANNIBALS = 3;

const HUMANOID_SVG = `<svg viewBox="0 0 24 36" fill="white" aria-hidden="true">
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

        render();
        checkConstraints();
        checkWin();
    });
});

// ── GAME LOGIC ──────────────────────────────────────────────────────────────

function isSafe(bank) {
    return bank.travelers === 0 || bank.travelers >= bank.cannibals;
}

function checkConstraints() {
    if (!isSafe(state.left)) {
        playAttackAnimation('left');
    } else if (!isSafe(state.right)) {
        playAttackAnimation('right');
    }
}

function showLossOverlay() {
    state.gameOver = true;
    document.getElementById('overlay-loss').classList.remove('hidden');
}

function playAttackAnimation(bankSide) {
    state.animating = true;
    render(); // lock banks before animation starts

    const bankEl     = document.getElementById(bankSide + '-bank');
    const peopleArea = document.getElementById(bankSide + '-people');
    const bankRect   = bankEl.getBoundingClientRect();

    const travelerEls = Array.from(peopleArea.querySelectorAll('.traveler'));
    const cannibalEls = Array.from(peopleArea.querySelectorAll('.cannibal'));

    if (travelerEls.length === 0 || cannibalEls.length === 0) {
        showLossOverlay();
        return;
    }

    const layer = document.createElement('div');
    layer.id = 'attack-layer';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1500;';
    document.body.appendChild(layer);

    function makeActor(el, type) {
        const rect = el.getBoundingClientRect();
        const r    = rect.width / 2;
        const cx   = rect.left + r;
        const cy   = rect.top  + r;
        const div  = document.createElement('div');
        div.className = `person ${type}`;
        div.innerHTML = el.innerHTML;
        div.style.cssText = `position:fixed;width:${rect.width}px;height:${rect.height}px;` +
            `left:${cx - r}px;top:${cy - r}px;pointer-events:none;margin:0;transform-origin:center;`;
        layer.appendChild(div);
        el.style.visibility = 'hidden';
        return { el: div, x: cx, y: cy, r, vx: 0, vy: 0 };
    }

    const travelers = travelerEls.map(el => makeActor(el, 'traveler'));
    const cannibals = cannibalEls.map(el => makeActor(el, 'cannibal'));
    travelers.forEach(t => { t.consumed = false; t.ramHits = 0; });
    cannibals.forEach(c => { c.ramCooldown = 0; });

    const CANNIBAL_SPEED = 2.8;
    const TRAVELER_SPEED = 2.0;
    const TOUCH_DIST     = 52;  // 26px radius × 2
    const RAM_COOLDOWN   = 38;  // frames between registered hits
    const HITS_TO_KILL   = 3;
    const PAD            = 14;  // boundary padding inside bank

    let phase = 'panic', startTime = null;

    function setPos(a) {
        a.el.style.left = (a.x - a.r) + 'px';
        a.el.style.top  = (a.y - a.r) + 'px';
    }

    function frame(now) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;

        // ── PANIC PHASE: travelers shake, cannibals pulse ─────────────────
        if (phase === 'panic') {
            travelers.forEach((t, i) => {
                const s = Math.sin(now * 0.025 + i * 1.3) * 5;
                t.el.style.transform = `translateX(${s}px) rotate(${s * 1.5}deg)`;
            });
            cannibals.forEach((c, i) => {
                const p = 1 + Math.sin(now * 0.04 + i) * 0.12;
                c.el.style.transform = `scale(${p})`;
            });
            if (elapsed >= 700) {
                phase = 'chase';
                travelers.forEach(t => { t.el.style.transform = ''; });
                cannibals.forEach(c => { c.el.style.transform = ''; });
            }
            requestAnimationFrame(frame);
            return;
        }

        // ── CHASE PHASE ───────────────────────────────────────────────────
        const liveT = travelers.filter(t => !t.consumed);

        if (liveT.length === 0) {
            setTimeout(() => { layer.remove(); showLossOverlay(); }, 600);
            return;
        }

        // Travelers flee from the nearest cannibal
        liveT.forEach(t => {
            let fx = 0, fy = 0;
            cannibals.forEach(c => {
                const dx = t.x - c.x, dy = t.y - c.y;
                const d  = Math.sqrt(dx * dx + dy * dy) || 1;
                fx += dx / d;
                fy += dy / d;
            });
            const fm = Math.sqrt(fx * fx + fy * fy) || 1;
            t.vx += (fx / fm) * 0.9;
            t.vy += (fy / fm) * 0.9;
            const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
            if (sp > TRAVELER_SPEED) { t.vx = t.vx / sp * TRAVELER_SPEED; t.vy = t.vy / sp * TRAVELER_SPEED; }
            t.x += t.vx;
            t.y += t.vy;
            // Bounce within bank bounds
            if (t.x < bankRect.left   + t.r + PAD) { t.x = bankRect.left   + t.r + PAD; t.vx =  Math.abs(t.vx); }
            if (t.x > bankRect.right  - t.r - PAD) { t.x = bankRect.right  - t.r - PAD; t.vx = -Math.abs(t.vx); }
            if (t.y < bankRect.top    + t.r + PAD) { t.y = bankRect.top    + t.r + PAD; t.vy =  Math.abs(t.vy); }
            if (t.y > bankRect.bottom - t.r - PAD) { t.y = bankRect.bottom - t.r - PAD; t.vy = -Math.abs(t.vy); }
            t.vx *= 0.88;
            t.vy *= 0.88;
            setPos(t);
        });

        // Cannibals chase and ram their nearest live traveler
        cannibals.forEach(c => {
            let nearest = null, nearestD = Infinity;
            liveT.forEach(t => {
                const dx = t.x - c.x, dy = t.y - c.y;
                const d  = Math.sqrt(dx * dx + dy * dy);
                if (d < nearestD) { nearestD = d; nearest = t; }
            });
            if (!nearest) return;
            if (c.ramCooldown > 0) c.ramCooldown--;

            const dx = nearest.x - c.x, dy = nearest.y - c.y;

            if (nearestD <= TOUCH_DIST && c.ramCooldown === 0 && !nearest.consumed) {
                // ── RAM ──
                nearest.ramHits++;
                c.ramCooldown = RAM_COOLDOWN;
                // Knock the traveler away
                nearest.vx += (dx / nearestD) * 8;
                nearest.vy += (dy / nearestD) * 8;
                // Cannibal recoil
                c.vx -= (dx / nearestD) * 5;
                c.vy -= (dy / nearestD) * 5;
                // Flash effects
                const victim = nearest;
                victim.el.style.filter  = 'brightness(3) saturate(0)';
                c.el.style.transform = 'scale(1.35)';
                setTimeout(() => {
                    if (!victim.consumed) victim.el.style.filter = '';
                    c.el.style.transform = '';
                }, 130);
                // Consume after enough hits
                if (nearest.ramHits >= HITS_TO_KILL) {
                    nearest.consumed = true;
                    nearest.el.style.transition = 'transform 0.5s ease-in, opacity 0.5s ease-in';
                    nearest.el.style.transform  = 'scale(0) rotate(720deg)';
                    nearest.el.style.opacity    = '0';
                }
            } else if (nearestD > TOUCH_DIST) {
                // ── CHASE ──
                c.vx += (dx / nearestD) * 1.2;
                c.vy += (dy / nearestD) * 1.2;
                const sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
                if (sp > CANNIBAL_SPEED) { c.vx = c.vx / sp * CANNIBAL_SPEED; c.vy = c.vy / sp * CANNIBAL_SPEED; }
            }

            c.x += c.vx;
            c.y += c.vy;
            // Keep cannibals within bank too
            if (c.x < bankRect.left   + c.r + PAD) { c.x = bankRect.left   + c.r + PAD; c.vx =  Math.abs(c.vx); }
            if (c.x > bankRect.right  - c.r - PAD) { c.x = bankRect.right  - c.r - PAD; c.vx = -Math.abs(c.vx); }
            if (c.y < bankRect.top    + c.r + PAD) { c.y = bankRect.top    + c.r + PAD; c.vy =  Math.abs(c.vy); }
            if (c.y > bankRect.bottom - c.r - PAD) { c.y = bankRect.bottom - c.r - PAD; c.vy = -Math.abs(c.vy); }
            c.vx *= 0.9;
            c.vy *= 0.9;
            setPos(c);
        });

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
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
    const attackLayer = document.getElementById('attack-layer');
    if (attackLayer) attackLayer.remove();

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
