// Bulbworks scene art. Data only: SVG builders for the view out of the
// mansion's glass wall (a night seaside) and for the room's side wall, plus
// the geometry the lighting engine in factory.js needs. Every layer is drawn
// as if fully lit; factory.js multiplies it by real light, so anything no
// light reaches stays dark. Any layer could later be swapped for a painting
// with the same size and coordinates.
(function () {
  'use strict';

  // Small seeded random generator, so the textures are the same on every load.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const pts = (list) => list.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ');

  // ── Exterior (design space 1600 × 1000, right-anchored) ─────────────────
  const EW = 1600, EH = 1000;
  const HORIZON = 430;
  const NEAR_Y = 975, FAR_Y = 222;          // path's nearest and farthest ground
  const depthAt = (y) => Math.max(0, Math.min(1, (NEAR_Y - y) / (NEAR_Y - FAR_Y)));
  const scaleAt = (y) => 1 - 0.78 * depthAt(y);

  // Seeing more sea on narrow screens: as if from higher up, everything below
  // the horizon is pushed further down. The open water (down to y 800) is
  // stretched by k; the garden and terrace below it just move down, unstretched.
  // Small things (rocks, tufts, posts) keep their shape; only where they sit moves.
  const SHORE = 800;
  function warp(y, k) {
    if (k === 1 || y <= HORIZON) return y;
    if (y <= SHORE) return HORIZON + (y - HORIZON) * k;
    return HORIZON + (SHORE - HORIZON) * k + (y - SHORE);
  }

  // The headland: a garden below the house, then a grassy slope climbing
  // behind a sheer rock face to the clifftop.
  const LAND = [[-4000, 1000], [-4000, 806], [-2600, 796], [-1700, 818], [-900, 800], [-300, 816], [0, 812], [180, 800], [420, 818], [640, 806], [860, 792], [1040, 772],
    [1140, 738], [1205, 690], [1250, 640], [1262, 560], [1256, 470], [1264, 380], [1258, 300],
    [1262, 232], [1300, 214], [1420, 210], [1520, 206], [1600, 204], [1600, 1000]];
  const ROCK = [[1262, 232], [1236, 236], [1214, 262], [1196, 300], [1182, 346], [1164, 392],
    [1150, 440], [1128, 492], [1112, 540], [1094, 590], [1080, 640], [1064, 690], [1100, 704],
    [1160, 712], [1215, 700], [1258, 650]];

  // The path, switchbacking up the slope (legs shorten as they recede).
  const PATH = [[560, 975], [900, 955], [1240, 925], [1560, 880], [1300, 815], [1545, 745],
    [1320, 680], [1520, 615], [1350, 560], [1490, 505], [1375, 455], [1470, 410], [1392, 370],
    [1455, 332], [1400, 297], [1440, 266], [1385, 242], [1352, 224]];

  // Each bend is rounded off: the path leaves a leg ROUND of the way before
  // the corner and curves through it, so the switchbacks turn gently rather
  // than in sharp hairpins. PIECES are the straight and curved stretches, to
  // draw (each at the width for its distance).
  const ROUND = 0.34;
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const BENDS = PATH.map((v, i) => {
    if (i === 0 || i === PATH.length - 1) return { a: v, b: v, mid: v };
    const a = lerp2(v, PATH[i - 1], ROUND), b = lerp2(v, PATH[i + 1], ROUND);
    // The middle of the curve (a quadratic through the corner).
    return { a, b, c: v, mid: [0.25 * a[0] + 0.5 * v[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * v[1] + 0.25 * b[1]] };
  });
  const PIECES = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const from = BENDS[i].b, to = BENDS[i + 1].a;
    PIECES.push({ p: [from, to], y: (from[1] + to[1]) / 2 });
    const n = BENDS[i + 1];
    if (n.c) PIECES.push({ p: [n.a, n.c, n.b], y: n.mid[1] });
  }

  // Lamp posts at each bend (on its curve), and halfway along the long near legs.
  const POSTS = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, ay] = PATH[i], [bx, by] = PATH[i + 1];
    POSTS.push({ x: BENDS[i].mid[0], y: BENDS[i].mid[1] });
    if (Math.hypot(bx - ax, by - ay) > 220) POSTS.push({ x: (ax + bx) / 2, y: (ay + by) / 2 });
  }
  for (const p of POSTS) { p.d = depthAt(p.y); p.s = scaleAt(p.y); p.hx = p.x + 10 * p.s; p.hy = p.y - 46 * p.s; }

  const LH = { x: 1345, base: 218, lanY: 52, top: 10 };
  const COTTAGE_WIN = [1424, 201];
  const MOON = [-140, -80, 22];

  // Stars and sea glints, for the engine to draw as light sources.
  const STARS = [], GLINTS = [];
  {
    const r = rng(11);
    while (STARS.length < 320) {
      const sx = -3000 + r() * 4600, sy = -450 + r() * 850;
      if (sx > 1230 && sy > 190) continue;                   // behind the cliff
      if (sx < 560 && sy > 325) continue;                    // behind the far headland
      if (Math.abs(sx - LH.x) < 30 && sy > 0) continue;      // behind the lighthouse
      STARS.push([sx, sy, 0.3 + r() * 0.9, r() * 6.28]);
    }
    while (GLINTS.length < 320) {
      const gx = -3000 + r() * 4060, gy = HORIZON + 6 + Math.pow(r(), 1.4) * 340;
      if (gy > 790) continue;
      GLINTS.push([gx, gy, 2 + (gy - HORIZON) * 0.05 * (0.5 + r()), r() * 6.28]);
    }
  }

  // vb: the [x, y, w, h] of design space that the screen shows. The scene is
  // composed in 0..1600, and the sea, sky and coast carry on to the left for
  // wide screens.
  function exterior(pw, ph, vb, part, k = 1) {
    const r = rng(7);
    const wy = (y) => warp(y, k);
    const wpts = (list) => pts(list.map(([x, y]) => [x, wy(y)]));
    const o = [];
    const X0 = Math.min(-10, vb[0] - 10), Y0 = vb[1] - 10, XW = EW - X0;
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="${vb.map(f1).join(' ')}" preserveAspectRatio="none">`);
    o.push(`<defs>
      <linearGradient id="sky" x1="0" y1="-400" x2="0" y2="${HORIZON}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#1a2350"/><stop offset=".55" stop-color="#2e4470"/><stop offset="1" stop-color="#6a8aa0"/></linearGradient>
      <linearGradient id="sea" x1="0" y1="${HORIZON}" x2="0" y2="${f1(wy(1000))}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#5a7d96"/><stop offset=".25" stop-color="#36586f"/><stop offset="1" stop-color="#1b3446"/></linearGradient>
      <linearGradient id="grass" x1="0" y1="200" x2="0" y2="${f1(wy(1000))}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#6f8a5a"/><stop offset=".5" stop-color="#5d7d45"/><stop offset="1" stop-color="#4a6a34"/></linearGradient>
      <linearGradient id="rock" x1="1060" y1="0" x2="1262" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#6e655c"/><stop offset=".6" stop-color="#8a8076"/><stop offset="1" stop-color="#5a524b"/></linearGradient>
      <linearGradient id="tower" x1="1320" y1="0" x2="1370" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#f6f1e6"/><stop offset=".55" stop-color="#e8e1d2"/><stop offset="1" stop-color="#b9b1a2"/></linearGradient>
      <filter id="blur12" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="12"/></filter>
      <filter id="blur3"><feGaussianBlur stdDeviation="3"/></filter>
    </defs>`);
    const headEnd = o.length;

    // Sky and clouds.
    o.push(`<rect x="${f1(X0)}" y="${f1(Y0)}" width="${f1(XW)}" height="${f1(HORIZON + 2 - Y0)}" fill="url(#sky)"/>`);
    o.push('<g filter="url(#blur12)" fill="#a9b8cc" opacity=".55">');
    for (const [cx, cy, rx, ry] of [[220, 210, 210, 26], [520, 120, 260, 22], [880, 250, 300, 30],
      [1180, 140, 220, 20], [700, 330, 240, 16], [1420, 300, 180, 18], [80, 90, 160, 18], [1300, -60, 260, 20], [700, -150, 300, 24]]) {
      o.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`);
    }
    for (let x = -200; x > X0 - 300; x -= 280 + r() * 200) {
      o.push(`<ellipse cx="${f1(x)}" cy="${f1(-300 + r() * 620)}" rx="${f1(150 + r() * 180)}" ry="${f1(14 + r() * 14)}"/>`);
    }
    o.push('</g>');

    // Far headlands, paler and bluer with distance.
    o.push(`<polygon fill="#53697f" points="${pts([[600, 432], [660, 420], [740, 412], [830, 418], [900, 432]])}"/>`);
    o.push(`<polygon fill="#455b70" points="${pts([[X0, 432], [X0, 362], [-1900, 352], [-1300, 366], [-700, 340], [-300, 356], [0, 342], [90, 326], [200, 340], [330, 382], [460, 410], [570, 428], [570, 432]])}"/>`);

    // Sea, with a texture of wave strokes that grow as they come closer.
    o.push(`<rect x="${f1(X0)}" y="${HORIZON}" width="${f1(XW)}" height="${f1(wy(EH) - HORIZON)}" fill="url(#sea)"/>`);
    let lightW = '', darkW = '';
    // More rows where the water is stretched, so its texture stays as dense.
    for (let y = HORIZON + 3; y < 1000; y += (2 + (y - HORIZON) * 0.03) / (y < SHORE ? k : 1)) {
      const t = (y - HORIZON) / 570;
      const count = Math.round((18 + 10 * t) * XW / EW);
      for (let i = 0; i < count; i++) {
        const x = X0 + r() * XW, L = (4 + 60 * t) * (0.5 + r()), h = 0.6 + 4 * t * r();
        const seg = `M${f1(x)} ${f1(wy(y))}q${f1(L / 2)} ${f1(-h)} ${f1(L)} 0`;
        if (r() < 0.55) lightW += seg; else darkW += seg;
      }
    }
    o.push(`<path d="${lightW}" fill="none" stroke="#a6c2d4" stroke-opacity=".45" stroke-width="1.1" stroke-linecap="round"/>`);
    o.push(`<path d="${darkW}" fill="none" stroke="#0f2130" stroke-opacity=".55" stroke-width="1.3" stroke-linecap="round"/>`);
    // (The engine draws rolling waves and sea mist here, between the layers.)
    const backEnd = o.length;

    // Rocks off the point, with foam.
    for (const [rx, ry, s] of [[960, 650, 1], [1015, 676, 0.7], [890, 700, 0.55], [1110, 600, 0.6]]) {
      o.push(`<path d="M${rx - 30 * s} ${f1(wy(ry))}q${8 * s} ${-26 * s} ${26 * s} ${-30 * s}q${22 * s} ${2 * s} ${34 * s} ${30 * s}z" fill="#57524d"/>`);
      o.push(`<path d="M${rx - 34 * s} ${f1(wy(ry) + 2)}q${34 * s} ${-7 * s} ${68 * s} 0" stroke="#e8f0f2" stroke-width="${3 * s}" fill="none" stroke-linecap="round" opacity=".85"/>`);
    }

    // The cliff face, with strata and a lit edge.
    o.push(`<polygon fill="url(#rock)" points="${wpts(ROCK)}"/>`);
    let strata = '';
    for (let i = 0; i < 26; i++) {
      const y0 = 250 + i * 17 + r() * 8;
      const x0 = 1080 + (700 - y0) * 0.38 + r() * 20;
      strata += `M${f1(x0)} ${f1(wy(y0))}l${f1(40 + r() * 90)} ${f1(-6 - r() * 10)}`;
    }
    o.push(`<path d="${strata}" stroke="#3f3933" stroke-width="2" fill="none" opacity=".7"/>`);
    o.push(`<polyline points="${wpts(ROCK.slice(0, 11))}" fill="none" stroke="#b5aa9b" stroke-width="2.5" opacity=".6"/>`);
    // Surf where the cliff meets the sea.
    o.push('<g filter="url(#blur3)">');
    o.push(`<path d="M1040 ${f1(wy(702))}q40 -14 80 -4t90 -6" stroke="#f2f6f6" stroke-width="7" fill="none" opacity=".9"/>`);
    o.push(`<path d="M1000 ${f1(wy(716))}q60 -8 120 0t110 -4" stroke="#dfe9ec" stroke-width="4" fill="none" opacity=".7"/>`);
    o.push('</g>');

    // The land.
    o.push(`<polygon fill="url(#grass)" points="${wpts(LAND)}"/>`);
    // Grass tufts, smaller with distance.
    let tufA = '', tufB = '';
    const gardenW = 1262 - X0;
    for (let i = 0, nt = 1430 + Math.round(1170 * gardenW / 1262); i < nt; i++) {
      let x, y;
      if (r() < 1430 / nt) { x = 1262 + r() * 338; y = 212 + Math.pow(r(), 0.8) * 788; } else { x = X0 + r() * gardenW; y = 800 + r() * 200; }
      if (x < 1262 && y < 760 + (x / 1262) * 20) continue;
      const s = scaleAt(Math.max(y, FAR_Y)), h = (5 + r() * 7) * s;
      const Y = wy(y);
      const seg = `M${f1(x)} ${f1(Y)}l${f1(-2 * s)} ${f1(-h)}M${f1(x)} ${f1(Y)}l${f1(0.4 * s)} ${f1(-h * 1.25)}M${f1(x)} ${f1(Y)}l${f1(2.2 * s)} ${f1(-h * 0.9)}`;
      if (r() < 0.5) tufA += seg; else tufB += seg;
    }
    o.push(`<path d="${tufA}" stroke="#2f4a22" stroke-width="1.1" fill="none" opacity=".8"/>`);
    o.push(`<path d="${tufB}" stroke="#9db27a" stroke-width="1" fill="none" opacity=".55"/>`);
    // Scattered stones.
    for (let i = 0; i < 40; i++) {
      const x = 1270 + r() * 320, y = 230 + r() * 760, s = scaleAt(y);
      o.push(`<ellipse cx="${f1(x)}" cy="${f1(wy(y))}" rx="${f1(6 * s)}" ry="${f1(3 * s)}" fill="#8b8579"/>`);
    }

    // The gravel path.
    for (let pass = 0; pass < 2; pass++) {
      for (const p of PIECES) {
        const w = 16 * scaleAt(p.y) + (pass ? 0 : 4);
        const q = p.p.map(([x, y]) => f1(x) + ' ' + f1(wy(y)));
        const d = q.length === 2 ? `M${q[0]}L${q[1]}` : `M${q[0]}Q${q[1]} ${q[2]}`;
        o.push(`<path d="${d}" fill="none" stroke="${pass ? '#cfc2a2' : '#7a6f57'}" stroke-width="${f1(w)}" stroke-linecap="round"/>`);
      }
    }

    // Lamp posts.
    for (const p of POSTS) {
      const s = p.s, x = p.hx, gy = wy(p.y), hy = gy - 46 * s;
      o.push(`<line x1="${f1(x)}" y1="${f1(gy)}" x2="${f1(x)}" y2="${f1(hy + 5 * s)}" stroke="#24211e" stroke-width="${f1(2.6 * s)}"/>`);
      o.push(`<rect x="${f1(x - 4 * s)}" y="${f1(hy - 5 * s)}" width="${f1(8 * s)}" height="${f1(10 * s)}" fill="#e9d7a6" stroke="#24211e" stroke-width="${f1(1.4 * s)}"/>`);
      o.push(`<path d="M${f1(x - 6 * s)} ${f1(hy - 5 * s)}l${f1(6 * s)} ${f1(-5 * s)}l${f1(6 * s)} ${f1(5 * s)}z" fill="#24211e"/>`);
    }

    // The lighthouse, red-banded, with gallery, lantern and dome.
    const tw = (y) => 25 - (218 - y) * (8 / 146);
    const band = (y0, y1) => pts([[LH.x - tw(y0), y0], [LH.x - tw(y1), y1], [LH.x + tw(y1), y1], [LH.x + tw(y0), y0]]);
    o.push(`<polygon fill="url(#tower)" points="${band(218, 72)}"/>`);
    o.push(`<polygon fill="#a63a30" points="${band(196, 176)}"/>`);
    o.push(`<polygon fill="#a63a30" points="${band(140, 120)}"/>`);
    o.push(`<path d="M${LH.x - 5} 218v-14a5 5 0 0 1 10 0v14z" fill="#3b2a22"/>`);
    o.push(`<rect x="${LH.x - 3}" y="100" width="6" height="9" fill="#2e3742"/>`);
    o.push(`<rect x="${LH.x - 24}" y="66" width="48" height="6" fill="#2b2b2b"/>`);
    o.push(`<path d="M${LH.x - 24} 66v-6M${LH.x - 12} 66v-6M${LH.x} 66v-6M${LH.x + 12} 66v-6M${LH.x + 24} 66v-6M${LH.x - 24} 60h48" stroke="#2b2b2b" stroke-width="1.4"/>`);
    o.push(`<rect x="${LH.x - 14}" y="38" width="28" height="22" fill="#fff1c8" stroke="#2b2b2b" stroke-width="1.6"/>`);
    o.push(`<path d="M${LH.x - 5} 38v22M${LH.x + 5} 38v22" stroke="#2b2b2b" stroke-width="1.2"/>`);
    o.push(`<path d="M${LH.x - 17} 38q17 -26 34 0z" fill="#7d2b24"/><path d="M${LH.x} 18v-8" stroke="#2b2b2b" stroke-width="2"/>`);
    // Keeper's cottage.
    o.push(`<rect x="1395" y="186" width="80" height="32" fill="#e2d9c6"/>`);
    o.push(`<polygon fill="#5e3d33" points="1388,189 1435,160 1482,189"/><rect x="1452" y="160" width="9" height="18" fill="#6b5a50"/>`);
    o.push(`<rect x="1418" y="195" width="12" height="11" fill="#f2d79a" stroke="#4a3a30" stroke-width="1.4"/><rect x="1446" y="200" width="10" height="18" fill="#5e3d33"/>`);

    // Just outside the glass: the terrace balustrade and its gate post.
    o.push(`<rect x="${f1(X0)}" y="${f1(wy(930))}" width="${f1(530 - X0)}" height="11" fill="#b5ad9c"/><rect x="${f1(X0)}" y="${f1(wy(988))}" width="${f1(530 - X0)}" height="12" fill="#a39b8a"/>`);
    for (let x = 8 - 26 * Math.ceil((8 - X0) / 26); x < 520; x += 26) {
      o.push(`<path d="M${x} ${f1(wy(941))}h14c0 8 -5 10 -5 18c0 8 5 12 5 20v9h-14v-9c0 -8 5 -12 5 -20c0 -8 -5 -10 -5 -18z" fill="#a8a090"/>`);
    }
    o.push(`<rect x="522" y="${f1(wy(904))}" width="26" height="96" fill="#9d9584"/><rect x="518" y="${f1(wy(898))}" width="34" height="9" fill="#bdb5a3"/>`);

    // 'back' is the sky and open sea; 'front' is everything standing in it.
    const body = part === 'back' ? o.slice(headEnd, backEnd) : o.slice(backEnd);
    return o.slice(0, headEnd).join('') + body.join('') + '</svg>';
  }


  // ── Interior pieces shared by the wide wall and the small-screen room ──
  function interiorDefs(k) {
    return `<defs>
      <pattern id="damask" width="40" height="56" patternUnits="userSpaceOnUse" patternTransform="scale(${f1(Math.max(k, 0.4))})">
        <rect width="40" height="56" fill="#2f4d3d"/>
        <g fill="none" stroke="#b39556" stroke-width="1.3" opacity=".85">
          <path d="M20 8c6 6 8 12 0 20c-8 -8 -6 -14 0 -20z"/>
          <path d="M20 28c7 4 11 10 6 18c-3 -4 -6 -6 -6 -10c0 4 -3 6 -6 10c-5 -8 -1 -14 6 -18z"/>
          <path d="M8 24c4 2 6 5 4 8M32 24c-4 2 -6 5 -4 8"/>
        </g>
        <g fill="#b39556" opacity=".8"><circle cx="0" cy="0" r="1.8"/><circle cx="40" cy="0" r="1.8"/><circle cx="0" cy="56" r="1.8"/><circle cx="40" cy="56" r="1.8"/><circle cx="20" cy="28" r="1.4"/></g>
      </pattern>
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4d2a"/><stop offset="1" stop-color="#4f2f18"/></linearGradient>
      <linearGradient id="frame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4527"/><stop offset=".5" stop-color="#4e301a"/><stop offset="1" stop-color="#3a2312"/></linearGradient>
      <radialGradient id="brass" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#f3d99a"/><stop offset=".5" stop-color="#c49a4c"/><stop offset="1" stop-color="#7e5e28"/></radialGradient>
      <radialGradient id="shade" cx=".5" cy=".8" r=".9"><stop offset="0" stop-color="#fff6dc"/><stop offset="1" stop-color="#e2c58c"/></radialGradient>
    </defs>`;
  }

  // The sconce: brass backplate, curved arm, a tulip glass shade.
  function drawSconce(o, S, k) {
    o.push(`<ellipse cx="${f1(S.x)}" cy="${f1(S.y + 26 * k)}" rx="${f1(9 * k)}" ry="${f1(16 * k)}" fill="url(#brass)"/>`);
    o.push(`<path d="M${f1(S.x)} ${f1(S.y + 34 * k)}c${f1(22 * k)} 0 ${f1(26 * k)} ${f1(-14 * k)} ${f1(22 * k)} ${f1(-30 * k)}" stroke="#b08a44" stroke-width="${f1(3.4 * k)}" fill="none"/>`);
    const sx = S.x + 22 * k, sy = S.y + 4 * k;
    o.push(`<path d="M${f1(sx - 4 * k)} ${f1(sy)}h${f1(8 * k)}l${f1(1 * k)} ${f1(-5 * k)}h${f1(-10 * k)}z" fill="#b08a44"/>`);
    o.push(`<path d="M${f1(sx - 5 * k)} ${f1(sy - 5 * k)}c${f1(-9 * k)} ${f1(-4 * k)} ${f1(-13 * k)} ${f1(-16 * k)} ${f1(-10 * k)} ${f1(-26 * k)}c${f1(5 * k)} ${f1(4 * k)} ${f1(9 * k)} ${f1(2 * k)} ${f1(15 * k)} ${f1(-2 * k)}c${f1(6 * k)} ${f1(4 * k)} ${f1(10 * k)} ${f1(6 * k)} ${f1(15 * k)} ${f1(2 * k)}c${f1(3 * k)} ${f1(10 * k)} ${f1(-1 * k)} ${f1(22 * k)} ${f1(-10 * k)} ${f1(26 * k)}z" fill="url(#shade)" stroke="#c9a96a" stroke-width="${f1(1 * k)}"/>`);
  }

  // The crank's brass dial (its needle is drawn live by the engine).
  function drawDial(o, D, k) {
    o.push(`<circle cx="${f1(D.x)}" cy="${f1(D.y)}" r="${f1(D.r + 3 * k)}" fill="url(#brass)"/>`);
    o.push(`<circle cx="${f1(D.x)}" cy="${f1(D.y)}" r="${f1(D.r)}" fill="#efe4c8"/>`);
    let ticks = '';
    for (let i = 0; i <= 12; i++) {
      const a = (-120 + i * 20) * Math.PI / 180, r0 = D.r * (i % 4 === 0 ? 0.62 : 0.76);
      ticks += `M${f1(D.x + Math.sin(a) * r0)} ${f1(D.y - Math.cos(a) * r0)}L${f1(D.x + Math.sin(a) * D.r * 0.9)} ${f1(D.y - Math.cos(a) * D.r * 0.9)}`;
    }
    o.push(`<path d="${ticks}" stroke="#3a2c1a" stroke-width="${f1(Math.max(0.8, 1.1 * k))}"/>`);
  }

  // ── Interior (screen coordinates: the room's left wall + the glass frame) ──
  // textTop / textBottom: where the page's words start and end on screen (the
  // small-screen room hangs its spotlight above them and stands its dais below).
  // The side wall's width, when there is one.
  const wallKi = (W, H) => Math.min(H / 1000, (0.3 * W) / 260);
  const wallWidth = (W, H) => 260 * wallKi(W, H);
  // Once the words beside the wall would be narrower than this, the wall is
  // taking too much of the view: switch to the deeper room with the dais.
  const ROOM_BELOW = 560;
  const useRoom = (W, H) => W - wallWidth(W, H) - 32 < ROOM_BELOW;

  function interiorGeo(W, H, textBottom = H * 0.75, textTop = H * 0.24) {
    if (useRoom(W, H)) return roomGeo(W, H, textBottom, textTop);
    const ki = wallKi(W, H);
    const wallW = 260 * ki;
    const R = 62 * ki;
    const sconceY = H * 0.27;
    const crank = { x: wallW * 0.5, y: H * 0.53, R };
    const panes = Math.max(2, Math.round((W - wallW) / 420));
    const mullions = [];
    for (let j = 1; j < panes; j++) mullions.push(wallW + ((W - wallW) * j) / panes);
    return {
      room: false, W, H, ki, sconceK: ki, wallW, cy: H / 2,
      ceilY: H * 0.05, floorY: H * 0.93, transomY: H * 0.17, dadoY: H * 0.66,
      win: { l: wallW, t: H * 0.05, r: W, b: H * 0.93 },   // where the glass is
      sconce: { x: wallW * 0.56, y: sconceY },
      bulb: { x: wallW * 0.56 + 22 * ki, y: sconceY - 12 * ki },
      crank,
      dial: { x: crank.x, y: crank.y - R * 1.5, r: R * 0.34 },
      mullions,
    };
  }

  // The deeper room for small screens, in one-point perspective: the glass
  // wall is the far end of the room, the papered wall runs back along the
  // left, and the crank stands on a dais in the middle of the floor, below
  // the page's words.
  function roomGeo(W, H, textBottom, textTop) {
    const u = Math.min(H / 1000, W / 560);            // the size of things at the back wall
    const win = { l: W * 0.2, t: H * 0.17, r: W, b: H * 0.64 };
    const vx = W * 0.56, vy = H * 0.42;               // the vanishing point
    // The dais, centred, standing just below the page's button: its dial
    // clears the words by a little (dial top to base is about 148 s, plus
    // 22 s for the base's front edge). It shrinks if the screen is too short.
    const s = Math.max(u * 0.6, Math.min(u * 1.25, (H - 10 - (textBottom + 14)) / 171));
    const dX = W * 0.5, dY = Math.min(H - 10 - 26 * s, textBottom + 14 + 148 * s);
    const top = dY - 16 * s;
    const R = 30 * s;
    const crank = { x: dX, y: top - 70 * s, R };
    // The spotlight, high on the left wall above the words (and below the
    // ceiling line), angled down at the dais.
    const scX = win.l * 0.45;
    const scDepth = (vx - scX) / (vx - win.l);
    const scK = u * scDepth * 0.75;
    const wallTop = vy + (win.t - vy) * scDepth;      // where the wall meets the ceiling, here
    const scY = Math.max(wallTop + 14 * scK, Math.min(vy + (win.t + (win.b - win.t) * 0.3 - vy) * scDepth, textTop - 30 * scK - 10));
    const pivot = { x: scX + 12 * scK, y: scY };
    const aim = Math.atan2((top + crank.y) / 2 - pivot.y, dX - pivot.x);
    const panes = Math.max(2, Math.round((win.r - win.l) / 200));
    const mullions = [];
    for (let j = 1; j < panes; j++) mullions.push(win.l + ((win.r - win.l) * j) / panes);
    return {
      room: true, W, H, u, ki: s, sconceK: scK, vx, vy, win,
      wallW: win.l, ceilY: win.t, floorY: win.b, transomY: win.t + (win.b - win.t) * 0.22,
      sconce: { x: scX, y: scY },
      spot: { x: pivot.x, y: pivot.y, aim },
      // The light comes from the spotlight's lens.
      bulb: { x: pivot.x + Math.cos(aim) * 18 * scK, y: pivot.y + Math.sin(aim) * 18 * scK },
      dais: { x: dX, y: dY, s, top },
      crank,
      dial: { x: dX, y: crank.y - R * 1.6, r: R * 0.36 },
      mullions,
    };
  }

  function interiorRoom(G, pw, ph) {
    const { W, H, win, vx, vy, u } = G;
    // y on the line from the vanishing point through (x1, y1), at screen x;
    // and x on that line at screen y.
    const at = (x1, y1, x) => vy + (y1 - vy) * (x - vx) / (x1 - vx);
    const atY = (x1, y1, y) => vx + (x1 - vx) * (y - vy) / (y1 - vy);
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${W} ${H}">`);
    o.push(interiorDefs(G.sconceK));
    const tl = at(win.l, win.t, 0), bl = at(win.l, win.b, 0);

    // Ceiling, with beams running back to the glass.
    o.push(`<polygon fill="#3a2819" points="${pts([[0, 0], [W, 0], [W, win.t], [win.l, win.t], [0, tl]])}"/>`);
    for (let i = 0; i <= 5; i++) {
      const xb = win.l + ((win.r - win.l) * (i + 0.5)) / 6;
      o.push(`<line x1="${f1(xb)}" y1="${f1(win.t)}" x2="${f1(atY(xb, win.t, 0))}" y2="0" stroke="#24170d" stroke-width="${f1(5 * u)}"/>`);
    }
    // Floor, with boards running back toward the glass.
    o.push(`<clipPath id="floor"><polygon points="${pts([[0, bl], [win.l, win.b], [W, win.b], [W, H], [0, H]])}"/></clipPath>`);
    o.push(`<polygon fill="#4a3020" points="${pts([[0, bl], [win.l, win.b], [W, win.b], [W, H], [0, H]])}"/>`);
    let boards = '';
    for (let i = -10; i <= 16; i++) {
      const xb = win.l + (i * (win.r - win.l)) / 10;
      boards += `M${f1(xb)} ${f1(win.b)}L${f1(atY(xb, win.b, H))} ${f1(H)}`;
    }
    o.push(`<path d="${boards}" stroke="#2c1b10" stroke-width="1.2" clip-path="url(#floor)"/>`);

    // The left wall: cornice, damask paper, dado rail, wainscot, skirting.
    const band = (y0, y1) => pts([[0, at(win.l, y0, 0)], [win.l, y0], [win.l, y1], [0, at(win.l, y1, 0)]]);
    const dado = win.t + (win.b - win.t) * 0.62;
    o.push(`<polygon fill="url(#damask)" points="${band(win.t, dado)}"/>`);
    o.push(`<polygon fill="#d7c294" points="${band(win.t, win.t + H * 0.012)}"/>`);
    o.push(`<polygon fill="url(#wood)" points="${band(dado, win.b)}"/>`);
    o.push(`<polygon fill="#8a5a33" points="${band(dado, dado + H * 0.008)}"/>`);
    o.push(`<polygon fill="#2e1b0e" points="${band(win.b - H * 0.012, win.b)}"/>`);

    // The glass wall at the far end: corner post, head, transom with small
    // panes, mullions, sill.
    const mw = Math.max(3, 6 * u);
    o.push(`<rect x="${f1(win.l - mw * 0.6)}" y="${f1(win.t)}" width="${f1(mw * 1.4)}" height="${f1(win.b - win.t)}" fill="url(#frame)"/>`);
    o.push(`<rect x="${f1(win.l)}" y="${f1(win.t)}" width="${f1(win.r - win.l)}" height="${f1(mw * 1.3)}" fill="#4e301a"/>`);
    o.push(`<rect x="${f1(win.l)}" y="${f1(G.transomY)}" width="${f1(win.r - win.l)}" height="${f1(mw)}" fill="#4e301a"/>`);
    o.push(`<rect x="${f1(win.l)}" y="${f1(win.b - mw)}" width="${f1(win.r - win.l)}" height="${f1(mw * 1.4)}" fill="#5a3820"/>`);
    for (let x = win.l + 40 * u; x < win.r - 10 * u; x += 40 * u) {
      o.push(`<rect x="${f1(x)}" y="${f1(win.t)}" width="${f1(Math.max(1.5, 2.5 * u))}" height="${f1(G.transomY - win.t)}" fill="#4e301a"/>`);
    }
    for (const mx of G.mullions) {
      o.push(`<rect x="${f1(mx - mw / 2)}" y="${f1(win.t)}" width="${f1(mw)}" height="${f1(win.b - win.t)}" fill="url(#frame)"/>`);
    }

    // The spotlight on the left wall: a brass plate and arm, and a tapered
    // lamp housing on a yoke, angled at the dais, with its lens glowing.
    {
      const S = G.sconce, P = G.spot, k = G.sconceK;
      o.push(`<rect x="${f1(S.x - 4 * k)}" y="${f1(S.y - 7 * k)}" width="${f1(8 * k)}" height="${f1(14 * k)}" rx="${f1(2 * k)}" fill="url(#brass)"/>`);
      o.push(`<line x1="${f1(S.x)}" y1="${f1(S.y)}" x2="${f1(P.x)}" y2="${f1(P.y)}" stroke="#b08a44" stroke-width="${f1(2.6 * k)}"/>`);
      o.push(`<g transform="translate(${f1(P.x)} ${f1(P.y)}) rotate(${f1(P.aim * 180 / Math.PI)})">`);
      o.push(`<path d="M0 ${f1(-7 * k)}a${f1(7 * k)} ${f1(7 * k)} 0 0 0 0 ${f1(14 * k)}" stroke="#8a6a32" stroke-width="${f1(1.6 * k)}" fill="none"/>`);
      o.push(`<polygon points="${pts([[-7 * k, -5 * k], [18 * k, -9 * k], [18 * k, 9 * k], [-7 * k, 5 * k]])}" fill="#3a2a1a" stroke="#b08a44" stroke-width="${f1(1.2 * k)}"/>`);
      o.push(`<rect x="${f1(-9 * k)}" y="${f1(-4 * k)}" width="${f1(3 * k)}" height="${f1(8 * k)}" fill="#8a6a32"/>`);
      o.push(`<ellipse cx="${f1(18 * k)}" cy="0" rx="${f1(2.6 * k)}" ry="${f1(9 * k)}" fill="#fff3d4" stroke="#c9a96a" stroke-width="${f1(1.2 * k)}"/>`);
      o.push('</g>');
    }

    // The dais: two round wooden steps with brass trim, a carved pedestal,
    // and the crank's round mount with its dial above.
    const D = G.dais, s = D.s, C = G.crank, R = C.R;
    o.push(`<ellipse cx="${f1(D.x)}" cy="${f1(D.y + 3 * s)}" rx="${f1(96 * s)}" ry="${f1(19 * s)}" fill="#0b0705" opacity=".45"/>`);
    const step = (y, rx, ry, h) => {
      o.push(`<path d="M${f1(D.x - rx)} ${f1(y - h)}V${f1(y)}A${f1(rx)} ${f1(ry)} 0 0 0 ${f1(D.x + rx)} ${f1(y)}V${f1(y - h)}z" fill="#4a2d17"/>`);
      o.push(`<ellipse cx="${f1(D.x)}" cy="${f1(y - h)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="url(#wood)" stroke="#b08a44" stroke-width="${f1(Math.max(0.8, 1.4 * s))}"/>`);
    };
    step(D.y, 82 * s, 15 * s, 9 * s);
    step(D.y - 9 * s, 56 * s, 10.5 * s, 7 * s);
    // Pedestal: a tapered, ringed column up to the mount.
    const pb = D.top, pt = C.y + R * 0.4;
    o.push(`<polygon fill="url(#wood)" points="${pts([[D.x - 13 * s, pb], [D.x - 8 * s, pt], [D.x + 8 * s, pt], [D.x + 13 * s, pb]])}"/>`);
    for (const f of [0.15, 0.55]) {
      const y = pb + (pt - pb) * f, w = 13 - 5 * f;
      o.push(`<ellipse cx="${f1(D.x)}" cy="${f1(y)}" rx="${f1(w * s + 2 * s)}" ry="${f1(2.5 * s)}" fill="#8a5a33" stroke="#b08a44" stroke-width="${f1(Math.max(0.6, s))}"/>`);
    }
    // The mount behind the wheel, and a neck up to the dial.
    o.push(`<rect x="${f1(D.x - 3 * s)}" y="${f1(G.dial.y)}" width="${f1(6 * s)}" height="${f1(C.y - G.dial.y)}" fill="#6a4426"/>`);
    o.push(`<circle cx="${f1(C.x)}" cy="${f1(C.y)}" r="${f1(R * 1.14)}" fill="url(#wood)" stroke="#a87444" stroke-width="${f1(Math.max(0.8, 1.6 * s))}"/>`);
    o.push(`<circle cx="${f1(C.x)}" cy="${f1(C.y)}" r="${f1(R * 1.0)}" fill="#3b2412" opacity=".55"/>`);
    drawDial(o, G.dial, s);
    o.push(`<path d="M${f1(C.x + R * 0.95)} ${f1(C.y - R * 0.55)}l${f1(R * 0.25)} ${f1(-R * 0.1)}l${f1(-R * 0.05)} ${f1(R * 0.22)}z" fill="#c49a4c"/>`);
    o.push('</svg>');
    return o.join('');
  }

  function interior(G, pw, ph) {
    if (G.room) return interiorRoom(G, pw, ph);
    const { W, H, ki, wallW, cy } = G;
    // Points on the far wall edge are pulled toward the eye level as the
    // wall recedes: the near edge (x = 0) stands taller.
    const Y = (yFar, x) => cy + (yFar - cy) * (1 + 0.14 * (1 - x / wallW));
    const quad = (y0, y1, x0 = 0, x1 = wallW) => pts([[x0, Y(y0, x0)], [x1, Y(y0, x1)], [x1, Y(y1, x1)], [x0, Y(y1, x0)]]);
    const k = ki;
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${W} ${H}">`);
    o.push(interiorDefs(k));

    // Ceiling and floor of the room (beyond the wall, above/below the glass).
    o.push(`<polygon fill="#3a2819" points="${pts([[0, 0], [W, 0], [W, G.ceilY], [wallW, G.ceilY], [0, Y(G.ceilY, 0)]])}"/>`);
    for (let i = 1; i < 6; i++) {
      const x = wallW + ((W - wallW) * i) / 6;
      o.push(`<line x1="${f1(x)}" y1="0" x2="${f1(x)}" y2="${f1(G.ceilY)}" stroke="#24170d" stroke-width="${f1(6 * k)}"/>`);
    }
    o.push(`<polygon fill="#4a3020" points="${pts([[0, Y(G.floorY, 0)], [wallW, G.floorY], [W, G.floorY], [W, H], [0, H]])}"/>`);
    for (let i = 1; i < 7; i++) {
      const y = G.floorY + (H - G.floorY) * Math.pow(i / 7, 1.4);
      o.push(`<line x1="0" y1="${f1(y)}" x2="${W}" y2="${f1(y)}" stroke="#2c1b10" stroke-width="1.2"/>`);
    }

    // The wall: cornice, damask paper, dado rail, panelled wainscot, skirting.
    o.push(`<polygon fill="url(#damask)" points="${quad(G.ceilY, G.dadoY)}"/>`);
    o.push(`<polygon fill="#d7c294" points="${quad(G.ceilY, G.ceilY + H * 0.03)}"/>`);
    o.push(`<polygon fill="#a68c5e" points="${quad(G.ceilY + H * 0.03, G.ceilY + H * 0.04)}"/>`);
    o.push(`<polygon fill="url(#wood)" points="${quad(G.dadoY, G.floorY)}"/>`);
    o.push(`<polygon fill="#8a5a33" points="${quad(G.dadoY, G.dadoY + H * 0.016)}"/>`);
    o.push(`<polygon fill="#2e1b0e" points="${quad(G.floorY - H * 0.03, G.floorY)}"/>`);
    for (const [a, b] of [[0.07, 0.46], [0.54, 0.93]]) {
      const x0 = wallW * a, x1 = wallW * b, y0 = G.dadoY + H * 0.045, y1 = G.floorY - H * 0.06;
      o.push(`<polygon fill="#5d3a1f" stroke="#9a6a3c" stroke-width="${f1(1.5 * k)}" points="${quad(y0, y1, x0, x1)}"/>`);
      o.push(`<polygon fill="none" stroke="#2c180a" stroke-width="${f1(1.2 * k)}" points="${quad(y0 + H * 0.012, y1 - H * 0.012, x0 + 6 * k, x1 - 6 * k)}"/>`);
    }

    drawSconce(o, G.sconce, k);

    // The crank's backplate: a carved shield, a brass dial, a pawl.
    const C = G.crank, R = C.R, D = G.dial;
    o.push(`<path d="M${f1(C.x)} ${f1(D.y - D.r - 18 * k)}c${f1(R * 1.0)} 0 ${f1(R * 1.3)} ${f1(R * 0.6)} ${f1(R * 1.3)} ${f1(R * 1.4)}c0 ${f1(R * 1.2)} ${f1(-R * 0.5)} ${f1(R * 1.9)} ${f1(-R * 1.3)} ${f1(R * 2.3)}c${f1(-R * 0.8)} ${f1(-R * 0.4)} ${f1(-R * 1.3)} ${f1(-R * 1.1)} ${f1(-R * 1.3)} ${f1(-R * 2.3)}c0 ${f1(-R * 0.8)} ${f1(R * 0.3)} ${f1(-R * 1.4)} ${f1(R * 1.3)} ${f1(-R * 1.4)}z" fill="url(#wood)" stroke="#a87444" stroke-width="${f1(2 * k)}"/>`);
    o.push(`<circle cx="${f1(C.x)}" cy="${f1(C.y)}" r="${f1(R * 1.02)}" fill="#3b2412" opacity=".55"/>`);
    drawDial(o, D, k);
    o.push(`<path d="M${f1(C.x + R * 0.95)} ${f1(C.y - R * 0.55)}l${f1(R * 0.25)} ${f1(-R * 0.1)}l${f1(-R * 0.05)} ${f1(R * 0.22)}z" fill="#c49a4c"/>`);

    // The glass wall's frame: corner post, head, transom with small panes,
    // mullions and sill, all in dark walnut.
    const mw = Math.max(5, 10 * k);
    o.push(`<rect x="${f1(wallW - 3 * k)}" y="${f1(G.ceilY)}" width="${f1(mw * 1.6)}" height="${f1(G.floorY - G.ceilY)}" fill="url(#frame)"/>`);
    o.push(`<rect x="${f1(wallW)}" y="${f1(G.ceilY)}" width="${f1(W - wallW)}" height="${f1(mw * 1.4)}" fill="#4e301a"/>`);
    o.push(`<rect x="${f1(wallW)}" y="${f1(G.transomY)}" width="${f1(W - wallW)}" height="${f1(mw)}" fill="#4e301a"/>`);
    o.push(`<rect x="${f1(wallW)}" y="${f1(G.floorY - mw * 1.2)}" width="${f1(W - wallW)}" height="${f1(mw * 1.6)}" fill="#5a3820"/>`);
    for (let x = wallW + 70 * k; x < W - 20 * k; x += 70 * k) {
      o.push(`<rect x="${f1(x)}" y="${f1(G.ceilY)}" width="${f1(Math.max(2, 4 * k))}" height="${f1(G.transomY - G.ceilY)}" fill="#4e301a"/>`);
    }
    for (const mx of G.mullions) {
      o.push(`<rect x="${f1(mx - mw / 2)}" y="${f1(G.ceilY)}" width="${f1(mw)}" height="${f1(G.floorY - G.ceilY)}" fill="url(#frame)"/>`);
    }
    o.push('</svg>');
    return o.join('');
  }

  // The crank wheel itself, drawn centred so it can be rotated: a carved
  // wooden rim with beads, turned spokes, a brass hub, and a handle.
  function crank(R, size, px) {
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${f1(-size / 2)} ${f1(-size / 2)} ${f1(size)} ${f1(size)}">`);
    o.push(`<defs><radialGradient id="hub" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#f6dc9c"/><stop offset=".5" stop-color="#c9a35a"/><stop offset="1" stop-color="#7d6230"/></radialGradient>
      <radialGradient id="knob" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#b8875a"/><stop offset=".6" stop-color="#6a3f1f"/><stop offset="1" stop-color="#3a2210"/></radialGradient></defs>`);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const p = (r, w) => [c * r - s * w, s * r + c * w];
      const q = [p(R * 0.16, R * 0.06), p(R * 0.78, R * 0.035), p(R * 0.78, -R * 0.035), p(R * 0.16, -R * 0.06)];
      o.push(`<polygon fill="#8b5a2f" stroke="#5a341a" stroke-width="${f1(R * 0.012)}" points="${pts(q)}"/>`);
      o.push(`<circle cx="${f1(c * R * 0.47)}" cy="${f1(s * R * 0.47)}" r="${f1(R * 0.055)}" fill="#9c6a3b" stroke="#5a341a" stroke-width="${f1(R * 0.01)}"/>`);
    }
    o.push(`<circle r="${f1(R * 0.84)}" fill="none" stroke="#7b4b27" stroke-width="${f1(R * 0.16)}"/>`);
    o.push(`<circle r="${f1(R * 0.76)}" fill="none" stroke="#4a2a14" stroke-width="${f1(R * 0.025)}"/>`);
    o.push(`<circle r="${f1(R * 0.92)}" fill="none" stroke="#a7744a" stroke-width="${f1(R * 0.02)}"/>`);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      o.push(`<circle cx="${f1(Math.cos(a) * R * 0.84)}" cy="${f1(Math.sin(a) * R * 0.84)}" r="${f1(R * 0.03)}" fill="#c08a55"/>`);
    }
    o.push(`<circle r="${f1(R * 0.2)}" fill="url(#hub)" stroke="#6d5426" stroke-width="${f1(R * 0.02)}"/>`);
    o.push(`<circle r="${f1(R * 0.07)}" fill="#3a2a14"/>`);
    // Handle on the rim (pointing up at zero rotation).
    o.push(`<circle cx="0" cy="${f1(-R * 0.84)}" r="${f1(R * 0.12)}" fill="#b8924a"/>`);
    o.push(`<circle cx="0" cy="${f1(-R * 0.84)}" r="${f1(R * 0.15)}" fill="url(#knob)" stroke="#2a180a" stroke-width="${f1(R * 0.015)}"/>`);
    o.push('</svg>');
    return o.join('');
  }

  // Where the surf breaks along the foot of the cliff (the engine animates it).
  const SURF = [[1000, 716], [1060, 704], [1120, 700], [1180, 696], [1232, 690]];

  window.BulbworksArt = {
    EW, EH, HORIZON, warp, POSTS, LH, COTTAGE_WIN, MOON, STARS, GLINTS, SURF,
    exterior, interiorGeo, interior, crank, useRoom, wallWidth,
  };
})();
