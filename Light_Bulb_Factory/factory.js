// The Lightbulb Factory: a ball-chain pull switch hanging from above the
// top of the screen. The chain is a Verlet rope. The cursor pushes it around
// (softly, so it pushes back), any bead can be grabbed and dragged, and
// pulling it down drags a spring-loaded anchor that clicks the light on/off.
(function () {
  'use strict';

  const canvas = document.getElementById('cord');
  const ctx = canvas.getContext('2d');
  const content = document.getElementById('content');
  const glow = document.getElementById('glow');
  const zone = document.getElementById('grab-zone');
  const btn = document.getElementById('switch');
  const key = document.getElementById('key');
  const keyWings = document.getElementById('key-wings');
  const keyScrew = document.getElementById('key-screw');
  const crankZone = document.getElementById('crank-zone');
  const flipBtn = document.getElementById('flip');
  const windBtn = document.getElementById('wind');
  const unwindBtn = document.getElementById('unwind');
  const root = document.documentElement;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── Tuning ────────────────────────────────────────────────────────────
  const STEP = 1 / 120;       // physics timestep (s)
  const GRAVITY = 2200;       // px/s²
  const SEG = 13;             // rest distance between beads (px)
  const BEAD_R = 4.5;
  const KNOB_R = 8;
  const ITERATIONS = 20;      // constraint passes per step
  // The mouse's reported point is the arrow's tip (its top-left corner), so
  // the push circle sits on the arrow's body instead, making contact look the
  // same from either side. Touch has no arrow, so it stays centered.
  const CURSOR_R = 9;         // mouse arrow's soft collision radius
  const CURSOR_OX = 5, CURSOR_OY = 8; // circle center, offset from the arrow tip
  const TOUCH_R = 14;         // fingertip's collision radius
  const PUSH = 0.3;           // fraction of overlap resolved per step (lower = more resistance)
  const DRAG_TRANSFER = 0.06; // how much cursor motion carries into the beads
  const ATTRACT_R = 45;       // the teardrop is drawn toward a cursor this close (px)
  const ATTRACT = 0.012;      // how strongly (per physics step, at its peak)
  const PULSE_PERIOD = 4;     // seconds per glow breath
  const GRAB_SPRING = 0.22;   // how hard a grabbed bead chases the pointer
  const GRAB_RADIUS = 26;     // around the teardrop
  const GLOW_REACH = 55;      // how far the teardrop's glow lights up the chain (px)
  const GLOW_SPILL = 0.55;    // how strongly the beads right next to it catch the glow
  const TRAVEL = 130;         // how far the spring-loaded anchor can be pulled down
  const FIRE_AT = 100;        // anchor drop that clicks the switch
  const REARM_AT = 30;        // anchor must come back above this to click again
  const PULL_GAIN = 0.85;     // anchor drop per px the pointer goes past the cord's reach
  const SILHOUETTE = '#e6dfcf'; // the cord's flat color in the dark
  // Far enough above the top edge that a full pull never brings the end into view.
  const ANCHOR_REST_Y = -(TRAVEL + 80);

  // ── State ─────────────────────────────────────────────────────────────
  let W = 0, H = 0, dpr = 1;
  let n = 0, x, y, px, py;
  let anchorX = 0, pull = 0, armed = true;
  let grab = -1, gx = 0, gy = 0;
  let cur = null, prevCur = null;   // pointer position (hovering mouse or active touch)
  let curR = CURSOR_R;
  let tugUntil = 0;

  let lit = false, level = 0, levelFrom = 0, lightT0 = 0;
  let lx = 0, ly = 0, lr = 1;       // light center and radius (on the text)
  let lrRoom = 1;                   // its radius on the room and the chain
  let darkApplied = false;

  // ── Layout ────────────────────────────────────────────────────────────
  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    anchorX = W < 700 ? W - 40 : Math.round(W * 0.68);
    const length = H * 0.75 - ANCHOR_REST_Y;
    n = Math.max(12, Math.min(140, Math.round(length / SEG))) + 1;
    x = new Float32Array(n); y = new Float32Array(n);
    px = new Float32Array(n); py = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = anchorX;
      y[i] = ANCHOR_REST_Y + i * SEG;
      // A small sideways nudge so it sways into view instead of hanging dead still.
      px[i] = x[i] - (i / n) * (motion.matches ? 0 : 0.25);
      py[i] = y[i];
    }
    grab = -1;
    pull = 0;
    darkApplied = false;
    sceneLayout();
  }

  // ── Physics ───────────────────────────────────────────────────────────
  function step(now, cx, cy, cvx, cvy) {
    const damp = motion.matches ? 0.982 : 0.992;
    const g = GRAVITY * STEP * STEP;

    // Integrate.
    for (let i = 1; i < n; i++) {
      const vx = (x[i] - px[i]) * damp;
      const vy = (y[i] - py[i]) * damp;
      px[i] = x[i]; py[i] = y[i];
      x[i] += vx;
      y[i] += vy + g;
    }

    // A grabbed bead chases the pointer on a spring, so it lags and resists.
    if (grab > 0) {
      x[grab] += (gx - x[grab]) * GRAB_SPRING;
      y[grab] += (gy - y[grab]) * GRAB_SPRING;
    } else if (cx !== null) {
      // The cursor is a soft ball: beads are only partly pushed out each step,
      // and pick up a little of its motion.
      for (let i = 1; i < n; i++) {
        const dx = x[i] - cx, dy = y[i] - cy;
        if (i === n - 1) {
          // The teardrop leans gently toward a nearby cursor, strongest at
          // mid-range and easing off as they meet, so it never sticks.
          const d = Math.hypot(dx, dy);
          if (d < ATTRACT_R && d > 1e-4) {
            const f = ATTRACT * (d / ATTRACT_R) * (1 - d / ATTRACT_R) * 4;
            x[i] -= dx * f; y[i] -= dy * f;
          }
          continue;
        }
        const min = curR + BEAD_R;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : 1, ny = d > 1e-4 ? dy / d : 0;
        const o = (min - d) * PUSH;
        x[i] += nx * o; y[i] += ny * o;
        px[i] -= cvx * DRAG_TRANSFER; py[i] -= cvy * DRAG_TRANSFER;
      }
    }

    // Spring-loaded anchor: it gives when the cord is pulled taut downward.
    let target = 0;
    if (grab > 0) {
      const dx = gx - anchorX, dy = gy - ANCHOR_REST_Y;
      const d = Math.hypot(dx, dy);
      const reach = grab * SEG;
      if (d > reach && dy / d > 0.6) target = Math.min(TRAVEL, (d - reach) * PULL_GAIN);
    }
    if (now < tugUntil) target = TRAVEL;
    pull += (target - pull) * (target > pull ? 0.35 : 0.12);
    x[0] = px[0] = anchorX;
    y[0] = py[0] = ANCHOR_REST_Y + pull;

    // Keep the beads at their spacing. The anchor never moves here, and a
    // grabbed bead gives half as much, so the pointer wins a little.
    for (let k = 0; k < ITERATIONS; k++) {
      for (let i = 0; i < n - 1; i++) {
        const a = i, b = i + 1;
        const wa = a === 0 ? 0 : (a === grab ? 0.5 : 1);
        const wb = b === grab ? 0.5 : 1;
        const dx = x[b] - x[a], dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        const diff = (d - SEG) / (d * (wa + wb));
        x[a] += dx * diff * wa; y[a] += dy * diff * wa;
        x[b] -= dx * diff * wb; y[b] -= dy * diff * wb;
      }
    }

    // The switch itself.
    if (armed && pull > FIRE_AT) {
      armed = false;
      playClick();
      toggle(now);
    } else if (!armed && pull < REARM_AT) {
      armed = true;
      playRelease();
    }
  }

  // Only the teardrop at the end can be grabbed.
  function hitTest(cx, cy) {
    const k = n - 1;
    return Math.hypot(x[k] - cx, y[k] - cy) < GRAB_RADIUS ? k : -1;
  }

  // ── The light ─────────────────────────────────────────────────────────
  function toggle(now) {
    lit = !lit;
    levelFrom = level;
    lightT0 = now;
    // The first time the room lights up, a little switch on the far wall
    // starts to faintly glow.
    if (lit && revealT0 === null) { revealT0 = now + 900; syncSceneButtons(); }
    root.classList.toggle('is-lit', lit);
    btn.setAttribute('aria-pressed', String(lit));
    btn.textContent = lit ? 'Pull the light cord (light is on)' : 'Pull the light cord';
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // How bright a bulb is, t seconds after being switched on or off from `from`.
  function warmUp(on, from, t, dur = 2.3) {
    if (on) {
      if (motion.matches) return from + (1 - from) * Math.min(1, t / 0.8);
      if (from < 0.05) {
        // A filament catching: a stutter, then a slow warm-up.
        return t < 0.06 ? 0.3 : t < 0.13 ? 0.04 : t < 0.2 ? 0.22
          : 0.22 + 0.78 * easeOut(Math.min(1, (t - 0.2) / dur));
      }
      return from + (1 - from) * easeOut(Math.min(1, t / 1.2));
    }
    return Math.max(0, from * (1 - t / (motion.matches ? 0.8 : 0.6)));
  }

  // The page content is in the room, in front of the glass. It is masked so
  // it shows only where light falls on it: the bulb's pool, and the
  // lighthouse beam when it sweeps across the window.
  const HIDDEN = 'linear-gradient(transparent, transparent)';
  const LIGHT_FULL = 0.55;    // fraction of the pool's radius that's fully readable
  const cta = content.querySelector('.cta');
  let lastMask = '';
  function setMask(m) {
    if (m === lastMask) return;
    lastMask = m;
    content.style.webkitMaskImage = content.style.maskImage = m;
  }

  function updateLight(now) {
    level = warmUp(lit, levelFrom, (now - lightT0) / 1000);
    const box = content.getBoundingClientRect();
    const ox = box.left, oy = box.top;
    const layers = [];

    // While the beam faces the house, the page lifts a little (noticeable
    // when the room light is off; with it on, the text is already lit).
    if (beamIn > 0.004) {
      const fa = `rgba(0,0,0,${Math.min(1, PAGE_BRIGHTEN * beamIn).toFixed(3)})`;
      layers.push(`linear-gradient(${fa}, ${fa})`);
    }

    // The wall lamp lights the text near the wall, so it reads fully there.
    if (lampLevel > 0.004 && G) {
      const a = lampLevel;
      layers.push(`radial-gradient(circle ${Math.round(Math.max(W * 0.9, 420))}px at ` +
        `${(G.bulb.x - ox).toFixed(1)}px ${(G.bulb.y - oy).toFixed(1)}px, ` +
        `rgba(0,0,0,${(0.97 * a).toFixed(3)}) 0%, rgba(0,0,0,${(0.9 * a).toFixed(3)}) 45%, transparent 100%)`);
    }

    if (level <= 0) {
      if (!darkApplied) { glow.style.opacity = '0'; darkApplied = true; }
      setMask(layers.length ? layers.join(', ') : HIDDEN);
      return;
    }
    darkApplied = false;

    // An unseen bulb hanging still just above the page. At full brightness its
    // pool reaches far enough that every word, down to the button, sits in
    // the strongly lit part (inside LIGHT_FULL of the radius).
    lx = W / 2;
    ly = -H * 0.2;
    const tb = (cta || content).getBoundingClientRect();
    const reach = Math.max(Math.hypot(box.left - lx, tb.bottom - ly),
      Math.hypot(box.right - lx, tb.bottom - ly));
    const grow = 0.55 + 0.45 * level;
    // The room itself (walls, chain, warm glow) is lit by the original, smaller
    // pool; only the text's mask uses the larger one.
    lrRoom = (H * 0.6 + W * 0.25) * grow;
    lr = Math.max(lrRoom, (reach / LIGHT_FULL) * grow);

    const a = level;
    layers.unshift(`radial-gradient(circle ${lr.toFixed(0)}px at ${(lx - ox).toFixed(1)}px ${(ly - oy).toFixed(1)}px, ` +
      `rgba(0,0,0,${(0.97 * a).toFixed(3)}) 0%, ` +
      `rgba(0,0,0,${(0.88 * a).toFixed(3)}) 50%, ` +
      `rgba(0,0,0,${(0.45 * a).toFixed(3)}) 82%, transparent 100%)`);
    setMask(layers.join(', '));
    glow.style.background = `radial-gradient(circle ${(lrRoom * 0.9).toFixed(0)}px at ${lx.toFixed(1)}px ${ly.toFixed(1)}px, ` +
      'rgba(255,196,120,.16) 0%, rgba(255,170,90,.06) 55%, transparent 100%)';
    glow.style.opacity = a.toFixed(3);
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function lightAt(bx, by) {
    if (level <= 0) return 0;
    const d = Math.hypot(bx - lx, by - ly);
    return level * Math.max(0, 1 - d / lrRoom);
  }

  function mix(a, b, t) { return Math.round(a + (b - a) * t); }

  function draw(now) {
    // A soft, slow breath in the glow (steady for reduced motion).
    const pulse = motion.matches ? 1
      : 0.78 + 0.22 * Math.sin((2 * Math.PI * now) / (PULSE_PERIOD * 1000));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // In the dark the cord is a flat, cartoonish silhouette: one light color,
    // a chunky string, no shading.
    const beadPath = (i) => {
      const r = i === n - 1 ? KNOB_R : BEAD_R;
      ctx.beginPath();
      if (i === n - 1) {
        // A teardrop pull, pointing along the chain.
        const ang = Math.atan2(y[i] - y[i - 1], x[i] - x[i - 1]) - Math.PI / 2;
        ctx.ellipse(x[i], y[i] + 2, r * 0.85, r * 1.35, ang, 0, Math.PI * 2);
      } else {
        ctx.arc(x[i], y[i], r, 0, Math.PI * 2);
      }
    };

    const k = n - 1;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    // Light on the teardrop (room bulb, lighthouse beam) drowns out its glow.
    const kLit = lightOnPull();

    // In the dark the chain is invisible except right by the teardrop, where
    // its green glow just catches the nearest beads.
    ctx.strokeStyle = ctx.fillStyle = 'rgb(150,225,140)';
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(x[i] - x[k], y[i] - y[k]);
      const g = GLOW_SPILL * pulse * Math.pow(Math.max(0, 1 - d / GLOW_REACH), 2) * (1 - kLit);
      if (g < 0.01) continue;
      ctx.globalAlpha = g;
      ctx.beginPath();
      ctx.moveTo(x[i - 1], y[i - 1]);
      ctx.lineTo(x[i], y[i]);
      ctx.stroke();
      if (i < k) { beadPath(i); ctx.fill(); }
    }

    // In the big light, the chain shows as flat cream string plus shaded brass beads.
    if (level > 0) {
      ctx.strokeStyle = SILHOUETTE;
      for (let i = 1; i < n; i++) {
        const l = lightAt(x[i], y[i]);
        if (l <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, l * 1.6);
        ctx.beginPath();
        ctx.moveTo(x[i - 1], y[i - 1]);
        ctx.lineTo(x[i], y[i]);
        ctx.stroke();
      }
    }
    for (let i = 1; i < k && level > 0; i++) {
      const r = BEAD_R;
      const l = lightAt(x[i], y[i]);
      if (l <= 0.01) continue;
      ctx.globalAlpha = Math.min(1, l * 1.6);
      // Dull pewter in the dark, warm brass in the light.
      const base = `rgb(${mix(84, 196, l)},${mix(80, 150, l)},${mix(74, 72, l)})`;
      const shade = `rgb(${mix(28, 92, l)},${mix(27, 62, l)},${mix(26, 24, l)})`;
      // Highlight leans toward the light (or straight up in the dark).
      let hx = 0, hy = -1;
      if (l > 0) {
        const dx = lx - x[i], dy = ly - y[i], d = Math.hypot(dx, dy) || 1;
        hx = dx / d; hy = dy / d;
      }
      const ox = x[i] + hx * r * 0.4, oy = y[i] + hy * r * 0.4;
      const grad = ctx.createRadialGradient(ox, oy, r * 0.1, x[i], y[i], r * 1.1);
      grad.addColorStop(0, `rgba(${mix(200, 255, l)},${mix(196, 238, l)},${mix(186, 196, l)},1)`);
      grad.addColorStop(0.35, base);
      grad.addColorStop(1, shade);
      ctx.fillStyle = grad;
      beadPath(i);
      ctx.fill();
    }

    // The teardrop: glow-in-the-dark plastic, like the star stickers. In the
    // dark it glows pale green with a soft halo; with any light on it, the
    // glow is lost and it's just pale, dim cream plastic.
    const halo = (1 - kLit) * pulse;
    ctx.globalAlpha = 1;
    ctx.save();
    if (halo > 0.01) {
      ctx.shadowColor = `rgba(120,255,110,${(0.85 * halo).toFixed(3)})`;
      ctx.shadowBlur = 18 * halo;
    }
    ctx.fillStyle = `rgb(${mix(200, 196, kLit)},${mix(255, 188, kLit)},${mix(175, 166, kLit)})`;
    beadPath(k);
    ctx.fill();
    if (halo > 0.01) {
      ctx.shadowBlur = 8 * halo; // a second, tighter pass for a brighter core
      ctx.fill();
    }
    ctx.restore();
    placeZone();
  }

  // How much light falls on the pull (0 to 1): the room bulb (which lights
  // the whole room) and the lighthouse beam while it faces the house. The
  // wall sconce is too dim to reach across the room, so it doesn't count.
  function lightOnPull() {
    return Math.min(1, 1.2 * level + 2 * beamIn);
  }

  // Keep the touch grab zone over the teardrop (the only grabbable part).
  function placeZone() {
    const s = (GRAB_RADIUS + 6) * 2;
    zone.style.transform =
      `translate(${(x[n - 1] - s / 2).toFixed(0)}px, ${(y[n - 1] - s / 2).toFixed(0)}px)`;
    zone.style.width = zone.style.height = s + 'px';
  }

  // ══ The view ═════════════════════════════════════════════════════════
  // We're in an old mansion, looking out through a glass wall over the sea
  // at night. The "T" in the name is a wind-up key that runs a wall sconce; the
  // sconce reveals an ornate crank; winding the crank sends lamps out along
  // a cliff path to a lighthouse. The art (scene-art.js) is drawn fully lit,
  // and here it's multiplied by light maps, so only what real light reaches
  // can be seen. Every switch works both ways.

  // ── View tuning ───────────────────────────────────────────────────────
  const Art = window.FactoryArt;
  const POSTS = Art.POSTS.length;
  const LS = 4;                // light maps are drawn at 1/LS resolution (soft and cheap)
  const TURNS = 3;             // crank turns from the first lamp to the lighthouse
  const FRONT_SPEED = 0.32;    // how fast the lights can run out (progress per second)
  const CRANK_GRAB = 1.2;      // grab radius, in wheel radii
  const BEAM_PERIOD = 32;      // s per lighthouse turn
  const KEY_MAX_WINDS = 10;    // clicks of the wind-up key before it's fully wound
  const KEY_FULL_AT = 4;       // winds stored before the lamp reaches its normal brightness
  const KEY_POSITIONS = 16;    // notches in one turn of the key
  const KEY_TURN_PER_WIND = 0.5; // turns of the key per click
  const KEY_TICKS_PER_SEC = 2; // how fast it ticks back, notch by notch, as it unwinds
  // Seconds of wall light each wind gives, so that running down ticks at exactly that rate.
  const KEY_WIND_TIME = (KEY_TURN_PER_WIND * KEY_POSITIONS) / KEY_TICKS_PER_SEC;
  const KEY_SURGE = 0.4;       // how much brighter the lamp jumps on each wind
  const KEY_SURGE_TIME = 0.7;  // s for that jump to settle
  const KEY_AXIS = 550;        // the key's spin axis (the stem's centre), in the T's SVG units
  const SCREW_TRAVEL = 100;    // how far the T-handle screws down when fully wound (SVG units: bar to nut)
  const SCREW_PITCH = SCREW_TRAVEL / (KEY_MAX_WINDS * KEY_TURN_PER_WIND); // drop per turn (the threads' spacing)
  const VIEW_F = 0.8;          // the view's perspective: focal length, as a fraction of width
  const VIEW_CX = 0.5;         // and where its centre is, as a fraction of width
  const CLOUD_EVERY = 150;     // s between passing clouds
  const CLOUD_CROSS = 85;      // s for one to cross the sky
  // While the beam faces the house (each turn, rising and falling smoothly):
  const BEAM_IN_W = 0.45;      // rad either side of dead-on that it has any effect
  const ROOM_BRIGHTEN = 0.3;   // how much lighter the room gets (0 to 1)
  const OUTSIDE_DIM = 0.5;     // how much the view outside darkens (0 to 1)
  const PAGE_BRIGHTEN = 0.3;   // how much the text lifts when the room light is off (0 to 1)
  const LAMP = [255, 196, 120];
  const WARM = [255, 214, 160];
  // Light the moon casts on the landscape. Black: the moon and stars are just
  // pinholes of light in the sky and light nothing else.
  const MOONLIGHT = [0, 0, 0];
  const BEAM = [255, 238, 200];
  const TOWER_SPILL = [205, 214, 232];  // the soft light around the lit tower
  const BACK_WALL_LIGHT = 0.2;          // how much of the room light reaches the far, glass wall
  const BEAM_ON_WATER = 1.7;            // how brightly the beam lights the sea beneath it (1 = original)
  const BEAM_SPILL = 0.12;              // faint light the beam throws on the land and sky around it
  const ROOM_LIGHT = 0.22;             // how strongly the room bulb lights the walls and ceiling (was 0.7)

  const world = document.getElementById('world');
  const wctx = world.getContext('2d');
  const mkCanvas = () => document.createElement('canvas');
  const extL = mkCanvas(), intL = mkCanvas(), tmp = mkCanvas();
  const elx = extL.getContext('2d'), ilx = intL.getContext('2d'), tctx = tmp.getContext('2d');

  // ── View state ────────────────────────────────────────────────────────
  let revealT0 = null, keyFound = false;
  // The wind-up key: its stored energy (in winds), the lamp's surge, and the key's angle.
  let energy = 0, surge = 0, keyAng = 0, keyTick = 0, keyShown = 1, keyDrop = 0;
  let bumpPos = 0, bumpVel = 0, stopPending = false; // the key hitting its stop
  let lampOn = false, lampLevel = 0;
  let crankAng = 0, crankTarget = 0, crankGrab = false, grabAng = 0, crankNotch = 0, atStop = false;
  let front = 0;                                 // how far out the lights have run (0 to 1)
  const postOn = new Array(POSTS).fill(false);
  const postT = new Array(POSTS).fill(null), postFrom = new Float32Array(POSTS);
  const pl = new Float32Array(POSTS);            // each post's brightness this frame
  let lhOn = false, lhT0 = null, lhFrom = 0, lhLevel = 0;
  const moon = 1;                                // the moon and stars are always out
  let beamAng = Math.PI / 2, beamSpeed = 0;
  let beamIn = 0;                                // how directly the beam faces the house (0 to 1)
  let extBack = null, extFront = null, intArt = null, crankArt = null, crankSize = 0, artGen = 0, artTimer = 0;
  let mistFar = null, mistNear = null, cloudDark = null, cloudLit = null, moonImg = null;
  let reflections = [];                          // star and moon glints on open water
  let worldBlank = false;

  // Geometry (rebuilt on resize).
  let ek = 1, eox = 0, eoy = 0, viewBox = null;  // exterior design space to screen
  let sk = 1;                                    // how far the sea is stretched (narrow screens)
  let G = null;                                  // interior geometry (screen space)
  let lanX = 0, lanY = 0;
  let moonX = 0, moonY = 0, moonR = 1, moonDX = 0; // the moon on screen (and its design x)
  const ex = (v) => eox + v * ek, ey = (v) => eoy + v * ek;
  // Screen y of a design y below the horizon, after the narrow-screen stretch.
  const wy = (v) => ey(Art.warp(v, sk));
  // A lamp post's ground point and lamp, on screen.
  const postGround = (p) => [ex(p.x), wy(p.y)];
  const postLamp = (p) => [ex(p.hx), wy(p.y) - 46 * p.s * ek];

  function sceneLayout() {
    world.width = tmp.width = canvas.width;
    world.height = tmp.height = canvas.height;
    extL.width = intL.width = Math.ceil(W / LS);
    extL.height = intL.height = Math.ceil(H / LS);
    // While there's a side wall, the words sit just to the right of it (as far
    // left as on a wide desktop, never over the wall), narrowing to fit. Once
    // there isn't room beside it, the view becomes the deeper room and the
    // words go back to the small-screen layout.
    const room = Art.useRoom(W, H);
    root.classList.toggle('room-view', room);
    if (room) {
      content.style.marginLeft = content.style.maxWidth = '';
    } else {
      const left = Math.max(Art.wallWidth(W, H) - 14, (W - 640) / 2 - W * 0.12);
      content.style.marginLeft = left.toFixed(0) + 'px';
      content.style.maxWidth = Math.min(640, W - left - 8).toFixed(0) + 'px';
    }
    // Where the words start and end (the eyebrow line and the button), so the
    // small-screen room can hang its spotlight above them and its dais below.
    const cta = content.querySelector('.cta'), first = content.firstElementChild;
    const textBottom = cta ? cta.getBoundingClientRect().bottom + window.scrollY : H * 0.75;
    const textTop = first ? first.getBoundingClientRect().top + window.scrollY : H * 0.24;
    G = Art.interiorGeo(W, H, textBottom, textTop);
    // Fit the view to the window by height: the start of the path sits just
    // above the floor and the lighthouse below the transom. Wider screens see
    // more of the coast to the left.
    const ekWide = Math.max((H * 0.75) / 980, W / 4600);
    // As the glass beside the wall narrows, zoom out so the headland and
    // lighthouse shrink, and look down from higher up so the open sea fills
    // most of the window (n: 0 on a wide desktop, 1 by about half a laptop).
    const win = G.win;
    const glassW = win.r - win.l;
    const n = Math.max(0, Math.min(1, (1700 - glassW / ekWide) / 700));
    ek = ekWide + (glassW / 2320 - ekWide) * n;
    const hzWide = win.b - 555 * ek;                  // where the horizon would sit unstretched
    // Where it should sit: low enough that the lighthouse clears the transom.
    const hzNarrow = Math.max(win.t + (win.b - win.t) * 0.3, G.transomY + (Art.HORIZON - Art.LH.top + 30) * ek);
    const hz = hzWide + (hzNarrow - hzWide) * n;
    sk = Math.max(1, ((win.b - hz) / ek - 185) / 370);
    eox = W - Art.EW * ek;
    eoy = win.b - Art.warp(985, sk) * ek;
    viewBox = [-eox / ek, -eoy / ek, W / ek, H / ek];
    lanX = ex(Art.LH.x);
    lanY = ey(Art.LH.lanY);
    // The moon, where it is in the scene, or (if that's off the edge of a
    // narrow view) high in the visible sky; never smaller than a few pixels.
    const [mx, my, mr] = Art.MOON;
    moonR = Math.max(mr * ek, 9);
    moonX = ex(mx);
    moonY = ey(my);
    if (moonX < win.l + moonR * 3) {
      moonX = win.l + (win.r - win.l) * 0.22;
      moonY = Math.max(win.t + moonR * 2.5, Math.min(moonY, ey(Art.HORIZON) - H * 0.12));
    }
    moonDX = (moonX - eox) / ek;
    worldBlank = false;
    // Re-render the art once resizing settles (stretching the old art meanwhile).
    clearTimeout(artTimer);
    if (!extBack) buildArt(); else artTimer = setTimeout(buildArt, 250);
  }

  function rasterize(svg, w, h) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = mkCanvas();
        c.width = w; c.height = h;
        // If the browser drops this canvas's contents (it can, under memory
        // pressure), it comes back blank: draw the art again.
        c.addEventListener('contextrestored', () => buildArt());
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('art failed to load')); };
      img.src = url;
    });
  }

  function buildArt() {
    const gen = ++artGen;
    const pw = world.width, ph = world.height;
    const cs = Math.ceil(G.crank.R * 2.4), cp = Math.ceil(cs * dpr);
    Promise.all([
      rasterize(Art.exterior(pw, ph, viewBox, 'back', sk), pw, ph),
      rasterize(Art.exterior(pw, ph, viewBox, 'front', sk), pw, ph),
      rasterize(Art.interior(G, pw, ph), pw, ph),
      rasterize(Art.crank(G.crank.R, cs, cp), cp, cp),
    ]).then(([a, f, b, c]) => {
      if (gen !== artGen) return;
      extBack = a; extFront = f; intArt = b; crankArt = c; crankSize = cs;
      reflections = findReflections(f);
      worldBlank = false;
    }).catch((err) => console.error(err));
    if (!mistFar) {
      mistFar = makeMist(1200, 140, 21, 70);
      mistNear = makeMist(1000, 160, 37, 40);
      cloudDark = makeCloud([5, 6, 9]);
      cloudLit = makeCloud([200, 208, 222]);
    }
    moonImg = makeMoon(Math.ceil(moonR * dpr) * 2 + 2);
  }

  // The moon: a little dim and faintly yellow, with darker seas and a
  // softened edge, drawn once.
  function makeMoon(px) {
    const c = mkCanvas();
    c.width = c.height = px;
    const m = c.getContext('2d');
    const R = px / 2 - 1;
    m.translate(px / 2, px / 2);
    m.fillStyle = 'rgba(236,226,190,.78)';
    m.beginPath();
    m.arc(0, 0, R, 0, Math.PI * 2);
    m.fill();
    m.globalCompositeOperation = 'destination-out';
    // Seas: soft darker patches, placed as on the real moon's face (roughly).
    for (const [x, y, r, a] of [[-0.3, -0.28, 0.3, 0.32], [0.05, -0.38, 0.22, 0.28], [0.28, -0.05, 0.26, 0.3],
      [-0.12, 0.08, 0.2, 0.22], [-0.42, 0.22, 0.18, 0.25], [0.15, 0.35, 0.16, 0.18], [0.45, 0.25, 0.12, 0.2]]) {
      const g = m.createRadialGradient(x * R, y * R, 0, x * R, y * R, r * R);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.7, `rgba(0,0,0,${a * 0.6})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g;
      m.fillRect(-R, -R, R * 2, R * 2);
    }
    // Small craters.
    for (const [x, y, r] of [[0.1, 0.6, 0.06], [-0.55, -0.1, 0.05], [0.6, -0.4, 0.05], [-0.2, 0.55, 0.04]]) {
      m.fillStyle = 'rgba(0,0,0,.25)';
      m.beginPath();
      m.arc(x * R, y * R, Math.max(0.6, r * R), 0, Math.PI * 2);
      m.fill();
    }
    // The edge darkens a little (limb darkening).
    const e = m.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
    e.addColorStop(0, 'rgba(0,0,0,0)');
    e.addColorStop(1, 'rgba(0,0,0,.35)');
    m.fillStyle = e;
    m.fillRect(-R, -R, R * 2, R * 2);
    return c;
  }

  // A long, lumpy cloud, flatter underneath, in one colour (it's drawn twice:
  // dark to blot out the stars, and lit where the beam passes through it).
  function makeCloud(col) {
    const w = 900, h = 230;
    const c = mkCanvas();
    c.width = w; c.height = h;
    const m = c.getContext('2d');
    let s = 91;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 60; i++) {
      const t = r();
      const bx = w * (0.1 + 0.8 * t);
      const hump = Math.sin(t * Math.PI);                   // fuller in the middle
      const br = h * (0.12 + 0.22 * hump * (0.6 + 0.4 * r()));
      const by = h * 0.62 - br * 0.55 * r();                 // bumpy top, flatter base
      const g = m.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},.55)`);
      g.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},.35)`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      m.fillStyle = g;
      m.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    return c;
  }

  // Where the passing cloud is now (null between clouds). It drifts left to
  // right high in the sky, above the lighthouse, and slowly changes shape.
  function cloudNow(t) {
    if (motion.matches) return null;
    const phase = (t + CLOUD_EVERY - 25) % CLOUD_EVERY;  // the first one comes along after ~25 s
    if (phase > CLOUD_CROSS) return null;
    const cw = Math.max(W * 0.45, 380), ch = cw * 0.25;
    const p = phase / CLOUD_CROSS;
    return {
      x: -cw + p * (W + cw), y: ey(-125) - ch / 2 + Math.sin(t * 0.07) * ch * 0.05,
      w: cw * (1 + 0.04 * Math.sin(t * 0.05)), h: ch,
    };
  }

  // The stars mirrored in the sea (squashed toward the horizon, as on calm
  // water seen from above), and a broken trail of glints below the moon.
  // Only those that land on open water are kept: the land layer's coverage
  // is checked once here, not every frame.
  function findReflections(front) {
    // Read from a small throwaway copy: reading pixels back from a canvas
    // makes the browser keep it off the GPU, which would slow every frame.
    const probe = mkCanvas();
    probe.width = Math.ceil(W / 2);
    probe.height = Math.ceil(H / 2);
    const pc = probe.getContext('2d', { willReadFrequently: true });
    pc.drawImage(front, 0, 0, probe.width, probe.height);
    const data = pc.getImageData(0, 0, probe.width, probe.height).data;
    const open = (X, Y) => {
      const px = Math.round(X / 2), py = Math.round(Y / 2);
      if (px < 0 || py < 0 || px >= probe.width || py >= probe.height) return false;
      return data[(py * probe.width + px) * 4 + 3] < 20;
    };
    const out = [];
    const hz = Art.HORIZON;
    for (const [sx, sy, sb, ph] of Art.STARS) {
      const ry = hz + 4 + (hz - sy) * 0.55;
      const X = ex(sx), Y = wy(ry);
      if (ry < 860 && open(X, Y)) out.push({ X, Y, b: sb * 0.5, ph, len: 0 });
    }
    const mx = moonDX;
    for (let i = 0; i < 46; i++) {
      const f = i / 45, ry = hz + 3 + Math.pow(f, 1.6) * 380;
      const X = ex(mx + Math.sin(i * 2.3) * (4 + 26 * f)), Y = wy(ry);
      if (open(X, Y)) out.push({ X, Y, b: 0.75 - 0.35 * f, ph: i * 1.7, len: (3 + 16 * f) * ek });
    }
    return out;
  }

  // A strip of soft, uneven fog that tiles side to side, to drift across the view.
  function makeMist(w, h, seed, blobs) {
    const c = mkCanvas();
    c.width = w; c.height = h;
    const m = c.getContext('2d');
    let s = seed;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < blobs; i++) {
      const bx = r() * w, by = h * (0.35 + r() * 0.35), br = h * (0.25 + r() * 0.45), a = 0.12 + r() * 0.22;
      for (const ox of [-w, 0, w]) { // drawn three times so the strip wraps seamlessly
        m.save();
        m.translate(bx + ox, by);
        m.scale(2.6, 0.5);
        const g = m.createRadialGradient(0, 0, 0, 0, 0, br);
        g.addColorStop(0, `rgba(214,224,236,${a})`);
        g.addColorStop(1, 'rgba(214,224,236,0)');
        m.fillStyle = g;
        m.fillRect(-br, -br, br * 2, br * 2);
        m.restore();
      }
    }
    return c;
  }

  // ── Moving water and fog ──────────────────────────────────────────────
  // Rolling swells: crest lines spaced evenly in the world, so they bunch up
  // toward the horizon, each travelling in toward the shore. Their broken
  // whitecaps come and go along their length.
  function drawWaves(c, t) {
    const A = Art.EH - Art.HORIZON, GAP = 2.4, Z_MAX = 44;
    const shift = (t * 0.55) % GAP;
    const levels = [0.25, 0.5, 0.75, 1];
    const lit = levels.map(() => new Path2D()), dark = levels.map(() => new Path2D());
    for (let z = Z_MAX - shift; z > 1.2; z -= GAP) {
      const yd = Art.HORIZON + A / z;
      if (yd > 860) continue;
      const id = Math.round((z + shift) / GAP);   // stays with the crest as it travels
      const near = 1 / z;
      const fade = Math.min(1, near * 9) * Math.min(1, (Z_MAX - z) / 6);
      const amp = (1 + 9 * near) * ek;
      const Y = wy(yd);
      const step = Math.max(10, 34 * near * ek + 6);
      const drop = amp * 0.9 + 1;
      // Consecutive points at the same brightness join into one stroke.
      let px = 0, py = 0, runL = -1;
      for (let X = -step; X <= W + step; X += step) {
        const xd = (X - eox) / ek;
        const n = 0.6 * Math.sin(xd * 0.011 + id * 1.7 + t * 0.21) + 0.4 * Math.sin(xd * 0.029 - id * 0.9 - t * 0.33);
        const a = Math.max(0, Math.min(1, (n - 0.05) * 1.8)) * fade;
        const yy = Y + amp * Math.sin(xd * 0.018 + id * 2.3 + t * 0.7);
        const L = Math.min(3, Math.floor(a * 4 - 0.01));
        if (L >= 0) {
          if (L !== runL) {
            lit[L].moveTo(px, py); dark[L].moveTo(px, py + drop);
          }
          lit[L].lineTo(X, yy); dark[L].lineTo(X, yy + drop);
        }
        runL = L;
        px = X; py = yy;
      }
    }
    c.lineCap = 'round';
    const w = Math.max(0.8, 3.2 * ek);
    for (let i = 0; i < levels.length; i++) {
      c.lineWidth = w * 1.6;
      c.strokeStyle = `rgba(8,22,34,${(0.32 * levels[i]).toFixed(3)})`;
      c.stroke(dark[i]);
      c.lineWidth = w;
      c.strokeStyle = `rgba(214,232,242,${(0.5 * levels[i]).toFixed(3)})`;
      c.stroke(lit[i]);
    }
  }

  // A fog strip drifting sideways across a band of the view.
  function drawMist(c, strip, t, speed, y0, y1, alpha) {
    const bandH = wy(y1) - wy(y0);
    const sw = (strip.width / strip.height) * bandH;
    const off = ((t * speed * ek) % sw + sw) % sw;
    c.globalAlpha = alpha;
    for (let X = -off; X < W; X += sw) c.drawImage(strip, X, wy(y0), sw, bandH);
    c.globalAlpha = 1;
  }

  // Surf breaking along the foot of the cliff, swelling and draining.
  function drawSurf(c, t) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const ph = t * 1.1 + k * 2.1;
      const a = 0.25 + 0.35 * Math.max(0, Math.sin(ph));
      const drop = (6 + k * 7 + 4 * Math.sin(ph)) * ek;
      c.strokeStyle = `rgba(240,246,248,${a.toFixed(3)})`;
      c.lineWidth = (5 - k * 1.3) * ek;
      c.beginPath();
      Art.SURF.forEach(([sx, sy], i) => {
        const X = ex(sx - k * 14), Y = wy(sy) + drop + Math.sin(i * 1.9 + ph) * 2 * ek;
        if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
      });
      c.stroke();
    }
  }

  // ── View update ───────────────────────────────────────────────────────
  // A post's brightness: flickering on, or dying away, from where it was.
  function postLevel(i, now) {
    if (postT[i] === null) return 0;
    const e = (now - postT[i]) / 1000, f = postFrom[i];
    if (!postOn[i]) return Math.max(0, f * (1 - e / (motion.matches ? 0.8 : 0.45)));
    if (motion.matches) return f + (1 - f) * Math.min(1, e);
    if (f > 0.05) return f + (1 - f) * Math.min(1, e * 3);
    return e < 0.05 ? 0.7 : e < 0.1 ? 0.12 : Math.min(1, 0.35 + (e - 0.1) * 2.6);
  }

  function updateScene(now, dt) {
    if (!keyFound && revealT0 !== null && now >= revealT0) {
      keyFound = true;
      key.classList.add('found');
    }
    updateKey(now, dt);
    if (crankGrab && lampLevel < 0.3) crankGrab = false;

    // The crank: a heavy wheel that trails the hand a little, held by a pawl
    // wherever it's left. Three turns run the lights all the way out.
    const max = TURNS * 2 * Math.PI;
    crankTarget = Math.max(0, Math.min(max, crankTarget));
    crankAng += (crankTarget - crankAng) * Math.min(1, dt * (motion.matches ? 30 : 9));
    const notch = Math.floor(crankAng / (Math.PI / 4));
    if (notch !== crankNotch) { playRatchet(); crankNotch = notch; }
    const P = crankAng / max;
    if (P > 0.999 && !atStop) { atStop = true; playClunk(true); } else if (P < 0.99) atStop = false;

    // The lights run out (or back) behind the crank, never faster than FRONT_SPEED.
    if (motion.matches) front = P;
    else front += Math.max(-FRONT_SPEED * 1.6 * dt, Math.min(FRONT_SPEED * dt, P - front));
    let ticked = false;
    for (let i = 0; i < POSTS; i++) {
      const want = front >= (i + 0.6) / (POSTS + 0.6);
      if (want !== postOn[i]) {
        postFrom[i] = postLevel(i, now);
        postOn[i] = want;
        postT[i] = now;
        if (!motion.matches || !ticked) playTick(Art.POSTS[i].d, want);
        ticked = true;
      }
      pl[i] = postLevel(i, now);
    }
    const lhWant = lhOn ? front > 0.985 : front > 0.995;
    if (lhWant !== lhOn) {
      lhFrom = lhLevel;
      lhOn = lhWant;
      lhT0 = now;
      // Starting up from dark and still, the beam begins just short of where
      // it starts lighting the water, so it sweeps out over the sea first.
      if (lhOn && lhLevel <= 0 && beamSpeed <= 0 && !motion.matches) beamAng = beamStartAngle();
      if (lhOn) playThoom(); else playWindDown();
    }

    // The lighthouse: it catches, swells and starts to turn; cut off, it
    // glows down and coasts to a stop.
    if (lhT0 !== null) {
      const e = (now - lhT0) / 1000;
      lhLevel = lhOn ? warmUp(true, lhFrom, e, 3.2)
        : Math.max(0, lhFrom * (1 - e / (motion.matches ? 0.8 : 2.5)));
    }
    beamIn = 0;
    if (motion.matches) {
      beamAng = -Math.PI / 2;
    } else if (lhLevel > 0 || beamSpeed > 0) {
      const full = 2 * Math.PI / BEAM_PERIOD;
      beamSpeed = lhOn ? Math.min(full, beamSpeed + full * dt / 4)
        : Math.max(0, beamSpeed - full * dt / 3);
      beamAng = (beamAng + beamSpeed * dt) % (2 * Math.PI);
      // For a while each turn it faces the house. The lighthouse stands off
      // to the right, so the beam points at us not when it points straight
      // out of the screen, but when it's angled back toward the middle (on
      // screen: the moment the beam points straight up from the lantern).
      const aHouse = Math.atan2(-(lanX - W * VIEW_CX) / (W * VIEW_F), 1);
      let a = beamAng - aHouse;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      // A smooth rise and fall as the beam turns past us.
      const u = Math.min(1, Math.abs(a) / BEAM_IN_W);
      beamIn = lhLevel * (0.5 + 0.5 * Math.cos(Math.PI * u));
    }
  }

  // ── Light helpers (drawn in CSS px; light maps carry a 1/LS transform) ──
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

  // A soft pool of light, optionally squashed (sy < 1) to lie on the ground.
  function glowAt(c, x, y, r, col, a, sy = 1) {
    if (a <= 0.003 || r <= 0.5) return;
    c.save();
    c.translate(x, y);
    if (sy !== 1) c.scale(1, sy);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(0.4, rgba(col, a * 0.5));
    g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g;
    c.fillRect(-r, -r, 2 * r, 2 * r);
    c.restore();
  }

  // A shaft of light from (x0, y0) widening to w1 at (x1, y1). It always
  // fades out over its last stretch, so its squared-off end never shows.
  function shaft(c, x0, y0, x1, y1, w0, w1, col, a0, a1) {
    if (Math.max(a0, a1) <= 0.003) return;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(col, a0));
    g.addColorStop(0.6, rgba(col, a0 + (a1 - a0) * 0.6));
    g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x0 + nx * w0, y0 + ny * w0);
    c.lineTo(x1 + nx * w1, y1 + ny * w1);
    c.lineTo(x1 - nx * w1, y1 - ny * w1);
    c.lineTo(x0 - nx * w0, y0 - ny * w0);
    c.closePath();
    c.fill();
  }

  // The lighthouse's one beam, level with the lantern, seen in perspective.
  // Side-on it runs straight across the sky; turned away, its far end
  // converges on the horizon, so it rakes over the far hills and out to sea;
  // turned toward us it passes overhead and out of the top of the view. It
  // never dips. Below it, the water carries its reflection.
  function beamGeometry() {
    const a = Math.atan2(Math.sin(beamAng), Math.cos(beamAng));
    const sx = Math.sin(a), ca = Math.cos(a);   // ca > 0: toward us
    const hy = ey(Art.HORIZON);
    const F = W * VIEW_F, cx = W * VIEW_CX;
    const Lx = (lanX - cx) / F, Ly = (hy - lanY) / F;  // the lantern at depth 1
    const at = (s) => {
      const dep = 1 - ca * s;
      return [cx + F * (Lx + sx * s) / dep, hy - F * Ly / dep, dep];
    };
    // Follow the beam out until it leaves the view (or nears its vanishing point).
    let s = 0.04;
    for (let i = 0; i < 48; i++) {
      const next = s * 1.25;
      if (1 - ca * next < 0.3) { s = 0.7 / ca; break; }
      s = next;
      const [x, y] = at(s);
      if (x < -W * 0.3 || x > W * 1.3 || y < -H * 0.3 || s > 90) break;
    }
    const [endX, endY, dep] = at(s);
    const w = Math.min(H * 0.6, (F * (0.012 + s * 0.06)) / dep);
    // Turned away inland, its far end sinks behind the clifftop: hide it.
    const edge = ex(1250);
    const behind = ca < 0 ? Math.max(0, Math.min(1, (endX - edge) / (W * 0.12))) * Math.min(1, -ca * 3) : 0;
    // Its reflection lies only on open water, out to the left of the point.
    const sea = Math.max(0, Math.min(1, (ex(1040) - endX) / (W * 0.15)));
    return {
      ca, facing: Math.max(0, ca), endX, endY, w,
      vis: 1 - behind,
      rX0: lanX, rY0: 2 * hy - lanY, rX1: endX, rY1: 2 * hy - endY,
      rA: (ca < 0.2 ? Math.min(1, (0.2 - ca) * 2) : 0) * sea,
    };
  }

  // The angle a little before the beam's reflection first shows on the water,
  // turning the way the beam turns (angle increasing). Found by stepping
  // round from side-on to the right, since it depends on the view's layout.
  const BEAM_LEAD = 0.12;      // rad short of the water where it starts (~0.6 s at full speed)
  function beamStartAngle() {
    const saved = beamAng;
    let start = Math.PI;       // fallback: pointing straight out to sea
    for (let a = Math.PI / 2; a < 1.5 * Math.PI; a += 0.01) {
      beamAng = a;
      if (beamGeometry().rA > 0.15) { start = a - BEAM_LEAD; break; }
    }
    beamAng = saved;
    return start;
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function renderWorld(now) {
    if (!extBack) {
      if (!worldBlank) {
        wctx.setTransform(1, 0, 0, 1, 0, 0);
        wctx.clearRect(0, 0, world.width, world.height);
        worldBlank = true;
      }
      placeCrankZone();
      return;
    }
    worldBlank = false;
    const B = beamGeometry();
    const lh = lhLevel;

    // Outside: moonlight, the lamps' pools, the lighthouse and its beam.
    elx.setTransform(1, 0, 0, 1, 0, 0);
    elx.globalCompositeOperation = 'source-over';
    elx.fillStyle = `rgb(${MOONLIGHT.join(',')})`;
    elx.fillRect(0, 0, extL.width, extL.height);
    elx.setTransform(1 / LS, 0, 0, 1 / LS, 0, 0);
    elx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < POSTS; i++) {
      if (pl[i] <= 0) continue;
      const p = Art.POSTS[i], s = p.s * ek;
      const [gx, gy] = postGround(p), [hx, hy] = postLamp(p);
      glowAt(elx, gx, gy, 120 * s, LAMP, 0.95 * pl[i], 0.5);
      glowAt(elx, hx, hy, 34 * s, LAMP, pl[i]);
    }
    if (lh > 0) {
      glowAt(elx, lanX, lanY + 60 * ek, 230 * ek, BEAM, 0.85 * lh);
      // A wider, cooler spill around the tower, so the cliff face and the
      // clifftop read against the dark sea while the light is on.
      glowAt(elx, ex(1250), ey(330), 430 * ek, TOWER_SPILL, 0.38 * lh);
      glowAt(elx, ex(Art.COTTAGE_WIN[0]), ey(Art.COTTAGE_WIN[1] + 14), 46 * ek, LAMP, 0.8 * lh, 0.6);
      // What the beam passes over (clouds, far hills) and, beneath it, the water.
      shaft(elx, lanX, lanY, B.endX, B.endY, 4 * ek, B.w * 1.6, BEAM, 0.9 * lh * B.vis, 0.45 * lh * B.vis);
      // A broad, faint spill either side of the beam, so the land and sky
      // around where it's passing lift a little too.
      shaft(elx, lanX, lanY, B.endX, B.endY, 10 * ek, B.w * 4, BEAM,
        BEAM_SPILL * lh * B.vis, BEAM_SPILL * 0.6 * lh * B.vis);
      if (B.rA > 0) {
        // Two soft passes, so the reflection reads as a glow on the water, not a hard wedge.
        const r = BEAM_ON_WATER * lh * B.rA;
        shaft(elx, B.rX0, B.rY0, B.rX1, B.rY1, 4 * ek, B.w * 1.6, BEAM, 0, 0.14 * r);
        shaft(elx, B.rX0, B.rY0, B.rX1, B.rY1, 4 * ek, B.w * 0.8, BEAM, 0, 0.18 * r);
        // And a wide, faint sheen on the sea around it.
        shaft(elx, B.rX0, B.rY0, B.rX1, B.rY1, 10 * ek, B.w * 4, BEAM, 0.04 * r, 0.1 * r);
      }
    }

    // Inside: the room bulb, the sconce, and the beam as it passes the glass.
    ilx.setTransform(1, 0, 0, 1, 0, 0);
    ilx.globalCompositeOperation = 'source-over';
    ilx.fillStyle = '#000';
    ilx.fillRect(0, 0, intL.width, intL.height);
    ilx.setTransform(1 / LS, 0, 0, 1 / LS, 0, 0);
    ilx.globalCompositeOperation = 'lighter';
    if (level > 0) {
      glowAt(ilx, lx, ly, lrRoom * 1.1, WARM, ROOM_LIGHT * level);
      // The room light is close to us; it only faintly reaches the far, glass
      // wall (darkened here before the other lights are added on top).
      const v = Math.round(255 * BACK_WALL_LIGHT);
      ilx.globalCompositeOperation = 'multiply';
      ilx.fillStyle = `rgb(${v},${v},${v})`;
      ilx.fillRect(G.win.l, G.win.t, G.win.r - G.win.l, G.win.b - G.win.t);
      ilx.globalCompositeOperation = 'lighter';
    }
    if (lampLevel > 0 && G.room) {
      // In the deep room the wall lamp is a spotlight on the dais: it lights
      // a little of the wall round itself, lifts the back of the room a bit,
      // and pools on the dais and the floor around it.
      const a = lampLevel, D = G.dais;
      glowAt(ilx, G.bulb.x, G.bulb.y, 70 * G.sconceK, LAMP, 0.9 * a);
      glowAt(ilx, G.vx, G.vy, W * 0.75, LAMP, 0.16 * a);
      glowAt(ilx, D.x, (D.y + G.dial.y) / 2, (D.y - G.dial.y) * 0.85, LAMP, 1.05 * a);
      glowAt(ilx, D.x, D.y, 120 * D.s, LAMP, 0.75 * a, 0.3);
    } else if (lampLevel > 0) {
      glowAt(ilx, G.bulb.x, G.bulb.y, G.wallW * 1.9, LAMP, 1.1 * lampLevel);
      // A sconce throws its light up and down the wall in a tall fan.
      glowAt(ilx, G.bulb.x, G.bulb.y + H * 0.05, H * 0.5, LAMP, 0.55 * lampLevel);
    }
    // With the beam turned on the house, the room gets a little lighter,
    // most of all on the side nearest the lighthouse.
    if (beamIn > 0.004) {
      ilx.fillStyle = rgba(BEAM, ROOM_BRIGHTEN * 0.6 * beamIn);
      ilx.fillRect(0, 0, W, H);
      glowAt(ilx, lanX, lanY, W * 1.3, BEAM, ROOM_BRIGHTEN * 0.5 * beamIn);
    }

    // Compose the outside: the sea, its waves and the far mist, then the land
    // and cliff in front, the surf and the near mist; all of it times its light.
    const t = motion.matches ? 0 : now / 1000, still = motion.matches;
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.globalCompositeOperation = 'source-over';
    wctx.drawImage(extBack, 0, 0);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaves(wctx, t);
    drawMist(wctx, mistFar, t, 9, Art.HORIZON - 40, Art.HORIZON + 120, 0.75);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.drawImage(extFront, 0, 0);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSurf(wctx, t);
    drawMist(wctx, mistNear, t, -16, 690, 900, 0.5);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.globalCompositeOperation = 'multiply';
    wctx.drawImage(extL, 0, 0, world.width, world.height);

    // Things outside that glow by themselves (behind the room, so the wall
    // and floor hide them).
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.globalCompositeOperation = 'lighter';
    if (moon > 0) {
      const MX = moonX, MY = moonY, MR = moonR;
      if (moonImg) wctx.drawImage(moonImg, MX - MR - 1 / dpr, MY - MR - 1 / dpr, MR * 2 + 2 / dpr, MR * 2 + 2 / dpr);
      for (const [sx, sy, sb, ph] of Art.STARS) {
        const tw = still ? 0.8 : 0.6 + 0.4 * Math.sin(t * 1.3 + ph * 3);
        wctx.fillStyle = rgba([220, 228, 255], moon * sb * tw);
        const z = Math.max(0.8, sb * 1.4 * ek);
        wctx.fillRect(ex(sx) - z / 2, ey(sy) - z / 2, z, z);
      }
      // A cloud passing: it blots out the stars and moon behind it, and
      // catches the beam where the beam passes through it.
      const cl = cloudNow(now / 1000);
      let moonCover = 0;
      if (cl && cloudDark) {
        wctx.globalCompositeOperation = 'source-over';
        wctx.globalAlpha = 0.97;
        wctx.drawImage(cloudDark, cl.x, cl.y, cl.w, cl.h);
        wctx.drawImage(cloudDark, cl.x + cl.w * 0.04, cl.y - cl.h * 0.04, cl.w * 0.96, cl.h);
        wctx.globalAlpha = 1;
        wctx.globalCompositeOperation = 'lighter';
        if (lh > 0 && B.vis > 0) {
          wctx.save();
          wctx.beginPath();
          const dx = B.endX - lanX, dy = B.endY - lanY, d = Math.hypot(dx, dy) || 1;
          const nx = -dy / d, ny = dx / d, w1 = B.w * 1.4;
          wctx.moveTo(lanX + nx * 4 * ek, lanY + ny * 4 * ek);
          wctx.lineTo(B.endX + nx * w1, B.endY + ny * w1);
          wctx.lineTo(B.endX - nx * w1, B.endY - ny * w1);
          wctx.lineTo(lanX - nx * 4 * ek, lanY - ny * 4 * ek);
          wctx.clip();
          wctx.globalAlpha = Math.min(1, 0.45 * lh * B.vis);
          wctx.drawImage(cloudLit, cl.x, cl.y, cl.w, cl.h);
          wctx.globalAlpha = 1;
          wctx.restore();
        }
        const cx = (MX - (cl.x + cl.w / 2)) / (cl.w * 0.42), cy = (MY - (cl.y + cl.h * 0.6)) / (cl.h * 0.45);
        moonCover = Math.max(0, Math.min(1, 1.4 - Math.hypot(cx, cy)));
      }
      // Their reflections: wavering, flickering streaks on the water. The
      // moon's trail fades while the cloud hides the moon.
      for (const r of reflections) {
        const tw = still ? 0.6 : 0.5 + 0.5 * Math.sin(t * 2.6 + r.ph * 7);
        const a = r.b * tw * moon * (r.len ? 1 - moonCover : 1);
        if (a < 0.02) continue;
        const wob = still ? 0 : Math.sin(t * 1.4 + r.ph * 3) * 1.5 * ek;
        wctx.fillStyle = rgba([214, 224, 250], a);
        if (r.len) {
          wctx.fillRect(r.X - r.len / 2 + wob, r.Y, r.len, Math.max(1, 1.1 * ek));
        } else {
          const z = Math.max(0.8, 1.2 * ek);
          wctx.fillRect(r.X - z / 2 + wob, r.Y - z, z, z * 3);
        }
      }
    }
    // Glints on the waves where the beam falls.
    if (lh > 0) {
      // Lit where the beam's reflection lies on the water.
      const ang0 = Math.atan2(B.rY1 - B.rY0, B.rX1 - B.rX0);
      wctx.lineCap = 'round';
      for (const [gx, gy, gl, ph] of Art.GLINTS) {
        const X = ex(gx), Y = wy(gy);
        const d = Math.hypot(X - B.rX0, Y - B.rY0) || 1;
        let da = Math.abs(Math.atan2(Y - B.rY0, X - B.rX0) - ang0);
        if (da > Math.PI) da = 2 * Math.PI - da;
        const hit = lh * B.rA * Math.max(0, 1 - da / Math.atan2(B.w * 1.2, d));
        const tw = still ? 0.7 : Math.max(0, Math.sin(t * 2.1 + ph * 5));
        const a = 0.9 * hit * tw;
        if (a < 0.02) continue;
        wctx.strokeStyle = rgba([225, 238, 255], a);
        wctx.lineWidth = Math.max(0.6, ek * (0.6 + (gy - Art.HORIZON) * 0.006));
        const o = still ? 0 : Math.sin(t * 0.7 + ph) * 3 * ek;
        wctx.beginPath();
        wctx.moveTo(X - gl * ek / 2 + o, Y);
        wctx.lineTo(X + gl * ek / 2 + o, Y);
        wctx.stroke();
      }
    }
    for (let i = 0; i < POSTS; i++) {
      if (pl[i] <= 0) continue;
      const p = Art.POSTS[i], s = p.s * ek, fade = 1 - 0.4 * p.d;
      const [hx, hy] = postLamp(p);
      glowAt(wctx, hx, hy, 18 * s, LAMP, 0.6 * pl[i] * fade);
      wctx.fillStyle = rgba([255, 246, 220], pl[i] * fade);
      wctx.beginPath();
      wctx.arc(hx, hy, Math.max(0.8, 2.6 * s), 0, Math.PI * 2);
      wctx.fill();
    }
    // With the beam turned on the house, our eyes adjust: everything outside
    // dims a little (except the lantern itself, drawn after).
    if (beamIn > 0.004) {
      wctx.globalCompositeOperation = 'source-over';
      wctx.fillStyle = `rgba(0,0,0,${(OUTSIDE_DIM * beamIn).toFixed(3)})`;
      wctx.fillRect(0, 0, W, H);
      wctx.globalCompositeOperation = 'lighter';
    }
    if (lh > 0) {
      const k = (B.ca < 0 ? 0.45 : 1) * B.vis;
      shaft(wctx, lanX, lanY, B.endX, B.endY, 3 * ek, B.w, BEAM, 0.3 * lh * k, 0.03 * lh * k);
      glowAt(wctx, ex(Art.COTTAGE_WIN[0]), ey(Art.COTTAGE_WIN[1]), 10 * ek, LAMP, 0.7 * lh);
      const r = 30 * ek * (1 + 5 * Math.pow(B.facing, 8));
      glowAt(wctx, lanX, lanY, r, [255, 246, 220], (0.6 + 0.4 * Math.pow(B.facing, 4)) * lh);
    }

    // The room on top: its art (with the crank turned to where it is) times its light.
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(intArt, 0, 0);
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.save();
    tctx.translate(G.crank.x, G.crank.y);
    tctx.rotate(crankAng);
    tctx.drawImage(crankArt, -crankSize / 2, -crankSize / 2, crankSize, crankSize);
    tctx.restore();
    // The dial needle shows how far the crank has wound.
    const na = (-120 + 240 * (crankAng / (TURNS * 2 * Math.PI))) * Math.PI / 180;
    tctx.strokeStyle = '#7a1e12';
    tctx.lineWidth = Math.max(1, 1.6 * G.ki);
    tctx.lineCap = 'round';
    tctx.beginPath();
    tctx.moveTo(G.dial.x, G.dial.y);
    tctx.lineTo(G.dial.x + Math.sin(na) * G.dial.r * 0.82, G.dial.y - Math.cos(na) * G.dial.r * 0.82);
    tctx.stroke();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'multiply';
    tctx.drawImage(intL, 0, 0, tmp.width, tmp.height);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(intArt, 0, 0);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.globalCompositeOperation = 'source-over';
    wctx.drawImage(tmp, 0, 0);

    // The sconce's bulb glows by itself.
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.globalCompositeOperation = 'lighter';
    if (lampLevel > 0) glowAt(wctx, G.bulb.x, G.bulb.y, 26 * G.sconceK, [255, 224, 170], 0.75 * lampLevel);
    wctx.globalCompositeOperation = 'source-over';
    placeCrankZone();
  }

  // ── View input ────────────────────────────────────────────────────────
  // The crank's grab radius: a little beyond the wheel, and never smaller
  // than a fingertip, however small the wheel is drawn.
  const crankGrabR = () => Math.max(G.crank.R * CRANK_GRAB, 26);

  function hitCrank(cx, cy) {
    if (!G || !crankArt || lampLevel < 0.3) return false;
    return Math.hypot(cx - G.crank.x, cy - G.crank.y) < crankGrabR();
  }

  // Winding: follow the pointer's angle round the hub, unwrapped, so circles
  // add up. Clockwise winds the lights out; anticlockwise brings them back.
  function aimCrank(cx, cy) {
    const dx = cx - G.crank.x, dy = cy - G.crank.y;
    if (Math.hypot(dx, dy) < G.crank.R * 0.12) return; // too near the hub to tell
    const a = Math.atan2(dy, dx);
    let d = a - grabAng;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    grabAng = a;
    crankTarget = Math.max(0, Math.min(TURNS * 2 * Math.PI, crankTarget + d));
  }

  function sceneDown(e) {
    const cx = e.clientX, cy = e.clientY;
    if (!hitCrank(cx, cy)) return;
    crankGrab = true;
    grabAng = Math.atan2(cy - G.crank.y, cx - G.crank.x);
    root.style.cursor = 'grabbing';
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  }

  // The "T" is a wind-up key that runs the wall lamp. Each click winds it a
  // notch (half a turn) and stores one wind of energy, up to KEY_MAX_WINDS.
  // Each wind makes the lamp jump brighter, then settle to its normal
  // brightness as the key slowly turns back, spending the energy; on the
  // last wind the lamp gradually dims out.
  function windKey() {
    if (!keyFound) return;
    if (energy > KEY_MAX_WINDS - 1) {
      // Fully wound: it won't turn any further.
      hitStop();
      return;
    }
    energy = Math.min(KEY_MAX_WINDS, energy + 1);
    surge = KEY_SURGE;
    // The wind that fills it spins round and then hits the stop.
    if (energy > KEY_MAX_WINDS - 1) stopPending = true;
    syncSceneButtons();
  }

  // The key hits its stop: a shove forward that judders back, a shudder
  // through the T, and a heavy thunk with a ring of metal.
  function hitStop() {
    bumpVel += 7;
    playStop();
    if (!motion.matches) {
      key.classList.remove('stopped');
      void key.offsetWidth; // restart the shudder
      key.classList.add('stopped');
    }
  }

  // Each frame: spend the stored energy, set the lamp's brightness, and turn the key.
  function updateKey(now, dt) {
    energy = Math.max(0, energy - dt / KEY_WIND_TIME);
    surge *= Math.exp(-dt / KEY_SURGE_TIME);
    const wasOn = lampOn;
    lampOn = energy > 0;
    if (wasOn !== lampOn) syncSceneButtons();
    // Brightness builds with the stored energy: too dim for the first few
    // winds, normal from KEY_FULL_AT winds up; as it runs down it fades the
    // same way. Each new wind adds a surge on top.
    const target = lampOn ? Math.pow(Math.min(1, energy / KEY_FULL_AT), 2) + surge : 0;
    lampLevel += (target - lampLevel) * Math.min(1, dt * (target > lampLevel ? 18 : 5));
    if (lampLevel < 0.002 && !lampOn) lampLevel = 0;

    // The key sits in one of KEY_POSITIONS notches per turn, following its
    // stored energy. Wound, it spins quickly round to its new notch; running
    // down, it ticks back one notch at a time (KEY_TICKS_PER_SEC), snapping
    // into each.
    const STEP = 2 * Math.PI / KEY_POSITIONS;
    const goal = Math.ceil(energy * KEY_TURN_PER_WIND * KEY_POSITIONS - 1e-6) * STEP;
    const winding = goal > keyAng;
    keyAng += (goal - keyAng) * Math.min(1, dt * (winding ? 10 : 40));
    if (Math.abs(goal - keyAng) < 1e-3) keyAng = goal;
    if (stopPending && Math.abs(goal - keyAng) < STEP * 0.5) { stopPending = false; hitStop(); }
    // The stop's bump: a stiff, quickly damped spring.
    for (let i = 0, n = Math.max(1, Math.ceil(dt * 240)); i < n; i++) {
      const h = dt / n;
      bumpVel += (-900 * bumpPos - 26 * bumpVel) * h;
      bumpPos += bumpVel * h;
    }
    // A click for every notch it passes: crisp when winding, soft running down.
    const tick = Math.round(keyAng / STEP);
    if (tick !== keyTick) {
      if (!motion.matches) playRatchet(winding ? 0.6 : 0.22);
      keyTick = tick;
    }
    // It's a screw: each turn threads the T-handle down into the nut by one
    // pitch, so its height shows how wound it is, and fully wound it sits on
    // the nut. This is state, not decoration, so it shows even with reduced motion.
    const a = keyAng + bumpPos;
    const drop = Math.max(0, Math.min(SCREW_TRAVEL, a / (2 * Math.PI) * SCREW_PITCH));
    if (keyScrew && Math.abs(drop - keyDrop) > 0.05) {
      keyDrop = drop;
      keyScrew.setAttribute('transform', `translate(0 ${drop.toFixed(2)})`);
    }
    // Turning about the T's upright stem, seen face-on, the crossbar squashes
    // horizontally by cos; its back (cos < 0) is a little darker.
    if (!keyWings || motion.matches) return;
    const c = Math.cos(a);
    const sx = Math.sign(c || 1) * Math.max(0.03, Math.abs(c));
    if (Math.abs(sx - keyShown) < 0.002) return;
    keyShown = sx;
    keyWings.setAttribute('transform', `translate(${KEY_AXIS} 0) scale(${sx.toFixed(3)} 1) translate(${-KEY_AXIS} 0)`);
    keyWings.style.filter = `brightness(${((0.72 + 0.28 * Math.abs(c)) * (c < 0 ? 0.8 : 1)).toFixed(3)})`;
  }

  function syncSceneButtons() {
    flipBtn.hidden = revealT0 === null;
    flipBtn.setAttribute('aria-pressed', String(lampOn));
    windBtn.hidden = unwindBtn.hidden = !lampOn;
  }

  // A touch zone over the crank while it can be turned, so winding it on a
  // phone doesn't scroll the page.
  function placeCrankZone() {
    const ok = G !== null && hitCrank(G.crank.x, G.crank.y);
    crankZone.style.display = ok ? 'block' : 'none';
    if (!ok) return;
    const s = crankGrabR() * 2;
    crankZone.style.width = crankZone.style.height = s.toFixed(0) + 'px';
    crankZone.style.transform = `translate(${(G.crank.x - s / 2).toFixed(0)}px, ${(G.crank.y - s / 2).toFixed(0)}px)`;
  }

  // ── Sound ─────────────────────────────────────────────────────────────
  let ac = null;
  function ensureAudio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function burst(t, freq, gain, dur) {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2.5;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  function playClick() {
    if (!ac) return;
    const t = ac.currentTime;
    burst(t, 1900, 0.9, 0.03);
    burst(t + 0.008, 520, 0.5, 0.05);
  }

  function playRelease() {
    if (!ac) return;
    burst(ac.currentTime, 3200, 0.25, 0.022);
  }

  function tone(t, freq, gain, dur) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function playSwitch() {
    if (!ac) return;
    const t = ac.currentTime;
    burst(t, 2600, 0.6, 0.02);
    burst(t + 0.006, 900, 0.35, 0.04);
  }

  // A dull clunk: the key is fully wound and won't turn.
  // The key hitting its stop: a heavy thunk, a rattle, and a ring of metal.
  function playStop() {
    if (!ac) return;
    const t = ac.currentTime;
    burst(t, 160, 1.0, 0.14);
    burst(t + 0.005, 520, 0.5, 0.06);
    burst(t + 0.05, 1300, 0.18, 0.03);
    tone(t, 1760, 0.07, 0.45);
  }

  function playRatchet(soft = 1) {
    if (!ac) return;
    burst(ac.currentTime, 1500, 0.2 * soft, 0.015);
  }

  // The breaker snapping across: heavy going on, a little drier going off.
  function playClunk(on) {
    if (!ac) return;
    const t = ac.currentTime;
    burst(t, on ? 180 : 240, 1.0, on ? 0.25 : 0.18);
    burst(t + 0.01, 420, 0.6, 0.12);
    burst(t + 0.03, 2200, 0.2, 0.03);
    tone(t, on ? 70 : 90, 0.35, 0.35);
  }

  // Each post's click, more muffled and quieter the farther off it is.
  // Going out, a lower, softer tunk.
  function playTick(s, on) {
    if (!ac) return;
    const g = 0.2 * Math.pow(1 - s, 1.5) + 0.015;
    burst(ac.currentTime, (2600 - 1700 * s) * (on ? 1 : 0.45), on ? g : g * 0.6, 0.03 + 0.04 * s);
  }

  // The lighthouse losing power: a long, falling hum.
  function playWindDown() {
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 2.6);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 2.7);
  }

  // The lighthouse catching: a deep, distant boom.
  function playThoom() {
    if (!ac) return;
    const t = ac.currentTime;
    tone(t, 55, 0.5, 2.4);
    burst(t, 120, 0.7, 1.6);
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function setCursor(e) {
    const mouse = e.pointerType === 'mouse';
    curR = mouse ? CURSOR_R : TOUCH_R;
    cur = mouse
      ? { x: e.clientX + CURSOR_OX, y: e.clientY + CURSOR_OY }
      : { x: e.clientX, y: e.clientY };
    if (!prevCur) prevCur = { x: cur.x, y: cur.y };
  }

  window.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setCursor(e);
    const hit = hitTest(e.clientX, e.clientY);
    if (hit < 0) { sceneDown(e); return; }
    grab = hit;
    gx = e.clientX; gy = e.clientY;
    root.style.cursor = 'grabbing';
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  }, { passive: false });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && grab < 0 && !crankGrab) return;
    if (crankGrab) {
      aimCrank(e.clientX, e.clientY);
      return;
    }
    setCursor(e);
    if (grab > 0) {
      gx = e.clientX; gy = e.clientY;
    } else {
      root.style.cursor = hoverCursor(e.clientX, e.clientY);
    }
  });

  function hoverCursor(cx, cy) {
    if (hitTest(cx, cy) > 0) return 'grab';
    if (hitCrank(cx, cy)) return 'grab';
    return '';
  }

  function release(e) {
    if (grab > 0 || crankGrab) {
      grab = -1;
      crankGrab = false;
      root.style.cursor = e.pointerType === 'mouse' ? hoverCursor(e.clientX, e.clientY) : '';
    }
    if (e.pointerType !== 'mouse') cur = prevCur = null;
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  document.addEventListener('pointerleave', () => { if (grab < 0) cur = prevCur = null; });
  window.addEventListener('blur', () => {
    grab = -1; crankGrab = false; cur = prevCur = null; root.style.cursor = '';
  });

  // Keyboard: a scripted tug, so the same switch fires.
  btn.addEventListener('click', () => {
    ensureAudio();
    tugUntil = performance.now() + 220;
    if (n) py[n - 1] -= 5;
  });
  flipBtn.addEventListener('click', () => { ensureAudio(); windKey(); });
  key.addEventListener('click', () => { ensureAudio(); windKey(); });
  // Rapid clicks would otherwise count as double/triple clicks and select the
  // title; stop the key's presses from starting a selection (clicks still work).
  key.addEventListener('mousedown', (e) => e.preventDefault());
  windBtn.addEventListener('click', () => { ensureAudio(); if (lampLevel >= 0.3) crankTarget += 2 * Math.PI; });
  unwindBtn.addEventListener('click', () => { ensureAudio(); if (lampLevel >= 0.3) crankTarget -= 2 * Math.PI; });

  window.addEventListener('resize', layout);

  // ── Loop ──────────────────────────────────────────────────────────────
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = Math.floor(acc / STEP);
    acc -= steps * STEP;
    steps = Math.min(steps, 8);

    if (steps > 0) {
      // Sweep the cursor across this frame's steps so a fast swipe still
      // catches the beads it passes through.
      const from = prevCur || cur;
      const cvx = cur ? (cur.x - from.x) / steps : 0;
      const cvy = cur ? (cur.y - from.y) / steps : 0;
      for (let s = 1; s <= steps; s++) {
        const cx = cur ? from.x + cvx * s : null;
        const cy = cur ? from.y + cvy * s : null;
        step(now, cx, cy, cvx, cvy);
      }
      prevCur = cur ? { x: cur.x, y: cur.y } : null;
    }

    updateScene(now, dt);
    updateLight(now);
    draw(now);
    renderWorld(now);
    requestAnimationFrame(frame);
  }

  layout();
  // If the browser drops the view's canvas contents, redraw the art when it's back.
  world.addEventListener('contextrestored', () => buildArt());
  // The web fonts can change where the words end; lay the room out again once they're in.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sceneLayout);
  requestAnimationFrame(frame);
})();
