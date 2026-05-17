// ─── Globe ──────────────────────────────────────────────────────────────────

const globeCanvas = document.getElementById('globe-canvas');
const globeLabel  = document.getElementById('globe-location-label');
const GLOBE_WORLD_URL    = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GLOBE_US_URL       = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const GLOBE_COUNTY_URL   = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';

let globeWorld        = null;   // topojson world
let globeUsStates     = null;   // topojson US states (for state lines when zoomed)
let globeUsCounties   = null;   // topojson US counties (for county lines at high zoom)
let clipLocations     = [];     // [{t, lat, lng}] sorted by t, from metadata
let globeProjection   = null;
let globePath         = null;
let globeGraticule    = null;
let globePinLat       = null;
let globePinLng       = null;
let globeRotation     = [0, -20, 0];   // current [λ, φ, γ]
let globeTargetRot    = [0, -20, 0];   // target after setGlobeLocation
let globeLerpActive   = false;
let globeLerpFrame    = 0;
let globeLerpFrom     = null;
let globeRafId        = null;
let globeLastClipIdx  = -1;
let globeLastMonthKey = null;
let globeCurrentScale = null;
let globeTargetScale  = null;
let globeScaleFrom    = null;
let GLOBE_BASE_SCALE  = null;
let GLOBE_ZOOM_SCALE  = null;
let globePrevPinLat   = null;
let globePrevPinLng   = null;
let globePinAlpha     = 1.0;
let globePrevPinAlpha = 0.0;
let globeTravelMode   = false;
let globeZoomOutScale = null;
let globeMidRot       = null;
let globeLerpDuration = 17;
let videoLastPausedAt  = -Infinity; // timestamp (ms) when video last stopped playing

// Drag / zoom interaction state
let globeDragging            = false;
let globeDragLastX           = 0;
let globeDragLastY           = 0;
let globeUserInteracting     = false;
let globeUserInteractTimeout = null;

function globeAngularDist(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLng  = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, a))); // radians
}

function markGlobeInteracting() {
  globeUserInteracting = true;
  clearTimeout(globeUserInteractTimeout);
  globeUserInteractTimeout = setTimeout(() => { globeUserInteracting = false; }, 2000);
}

function startGlobeDrag(x, y) {
  globeDragging    = true;
  globeDragLastX   = x;
  globeDragLastY   = y;
  globeLerpActive  = false;
  markGlobeInteracting();
}

function moveGlobeDrag(x, y) {
  if (!globeDragging) return;
  const dx = x - globeDragLastX;
  const dy = y - globeDragLastY;
  globeDragLastX = x;
  globeDragLastY = y;
  const sensitivity = 0.4;
  globeRotation[0] += dx * sensitivity;
  globeRotation[1]  = Math.max(-85, Math.min(85, globeRotation[1] - dy * sensitivity));
  renderGlobe();
  markGlobeInteracting();
}

function endGlobeDrag() {
  globeDragging = false;
}

function zoomGlobe(delta) {
  const factor   = delta > 0 ? 0.92 : 1.08;
  const minScale = GLOBE_BASE_SCALE * 0.9;
  const maxScale = GLOBE_BASE_SCALE * 15;
  globeCurrentScale = Math.max(minScale, Math.min(maxScale, globeCurrentScale * factor));
  globeTargetScale  = globeCurrentScale;
  globeProjection.scale(globeCurrentScale);
  renderGlobe();
  markGlobeInteracting();
}

function initGlobe() {
  if (!globeCanvas || typeof d3 === 'undefined' || typeof topojson === 'undefined') return;

  const size = globeCanvas.width; // 260
  const radius = size / 2 - 2;

  GLOBE_BASE_SCALE  = radius;
  GLOBE_ZOOM_SCALE  = radius * 15;
  globeCurrentScale = GLOBE_BASE_SCALE;
  globeTargetScale  = GLOBE_BASE_SCALE;
  globeScaleFrom    = GLOBE_BASE_SCALE;

  globeProjection = d3.geoOrthographic()
    .scale(radius)
    .translate([size / 2, size / 2])
    .clipAngle(90)
    .precision(0.3);

  globePath      = d3.geoPath(globeProjection, globeCanvas.getContext('2d'));
  globeGraticule = d3.geoGraticule()();

  // ── Mouse drag ──────────────────────────────────────────────────────────
  globeCanvas.addEventListener('mousedown', e => {
    e.preventDefault();
    startGlobeDrag(e.clientX, e.clientY);
  });
  globeCanvas.addEventListener('mousemove', e => moveGlobeDrag(e.clientX, e.clientY));
  globeCanvas.addEventListener('mouseup',    () => endGlobeDrag());
  globeCanvas.addEventListener('mouseleave', () => endGlobeDrag());

  // ── Touch drag + pinch-zoom ──────────────────────────────────────────────
  let touchPinchDist = null;
  globeCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      startGlobeDrag(e.touches[0].clientX, e.touches[0].clientY);
      touchPinchDist = null;
    } else if (e.touches.length === 2) {
      globeDragging  = false;
      touchPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: false });
  globeCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && touchPinchDist === null) {
      moveGlobeDrag(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && touchPinchDist !== null) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      zoomGlobe(touchPinchDist - d);
      touchPinchDist = d;
    }
  }, { passive: false });
  globeCanvas.addEventListener('touchend', () => {
    endGlobeDrag();
    touchPinchDist = null;
  });

  // ── Scroll / wheel zoom ─────────────────────────────────────────────────
  globeCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomGlobe(e.deltaY);
  }, { passive: false });

  fetch(GLOBE_WORLD_URL)
    .then(r => r.json())
    .then(world => {
      globeWorld = world;
      renderGlobe();
      globeRafId = requestAnimationFrame(globeLoop);
    })
    .catch(() => {
      // If data fails to load, just spin a blank sphere
      globeRafId = requestAnimationFrame(globeLoop);
    });

  fetch(GLOBE_US_URL)
    .then(r => r.json())
    .then(us => { globeUsStates = us; })
    .catch(() => {});

  fetch(GLOBE_COUNTY_URL)
    .then(r => r.json())
    .then(counties => { globeUsCounties = counties; })
    .catch(() => {});
}

function globeLoop() {
  // Auto-rotate when not animating and the user isn't touching the globe
  const videoIdleMs = (video.paused || video.ended) ? Date.now() - videoLastPausedAt : 0;
  if (!globeLerpActive && !globeUserInteracting && videoIdleMs >= 5000) {
    globeRotation[0] += 0.2;
    if (globeCurrentScale !== null && Math.abs(globeCurrentScale - GLOBE_BASE_SCALE) > 0.5) {
      globeCurrentScale += (GLOBE_BASE_SCALE - globeCurrentScale) * 0.04;
      globeProjection.scale(globeCurrentScale);
    }
    renderGlobe();
  } else if (globeLerpActive) {
    globeLerpFrame++;
    const t = Math.min(globeLerpFrame / globeLerpDuration, 1);

    function lerpAngle(a, b, e) {
      let diff = b - a;
      while (diff > 180)  diff -= 360;
      while (diff < -180) diff += 360;
      return a + diff * e;
    }

    let newScale = globeCurrentScale;

    if (globeTravelMode) {
      // Phase 1 (t 0→0.5): rotate to midpoint, zoom out, fade old pin out
      // Phase 2 (t 0.5→1): rotate to target, zoom in, fade new pin in
      if (t < 0.5) {
        const u    = t * 2;
        const ease = 1 - Math.pow(1 - u, 3);
        globeRotation[0] = lerpAngle(globeLerpFrom[0], globeMidRot[0], ease);
        globeRotation[1] = lerpAngle(globeLerpFrom[1], globeMidRot[1], ease);
        newScale          = globeScaleFrom + (globeZoomOutScale - globeScaleFrom) * (u * u);
        globePrevPinAlpha = 1 - u * u;
        globePinAlpha     = 0;
      } else {
        const u    = (t - 0.5) * 2;
        const ease = 1 - Math.pow(1 - u, 3);
        globeRotation[0] = lerpAngle(globeMidRot[0], globeTargetRot[0], ease);
        globeRotation[1] = lerpAngle(globeMidRot[1], globeTargetRot[1], ease);
        newScale          = globeZoomOutScale + (globeTargetScale - globeZoomOutScale) * (1 - Math.pow(1 - u, 2));
        globePrevPinAlpha = 0;
        globePinAlpha     = 1 - Math.pow(1 - u, 2);
      }
    } else {
      // Short hop or first location: just pan + zoom in, no zoom-out
      const ease = 1 - Math.pow(1 - t, 3);
      globeRotation[0] = lerpAngle(globeLerpFrom[0], globeTargetRot[0], ease);
      globeRotation[1] = lerpAngle(globeLerpFrom[1], globeTargetRot[1], ease);
      newScale          = globeScaleFrom + (globeTargetScale - globeScaleFrom) * (1 - Math.pow(1 - t, 2));
      globePinAlpha     = Math.min(1, t * 3);
    }

    globeCurrentScale = newScale;
    globeProjection.scale(globeCurrentScale);
    renderGlobe();

    if (t >= 1) {
      globeLerpActive   = false;
      globeRotation     = [...globeTargetRot];
      globeCurrentScale = globeTargetScale;
      globePrevPinAlpha = 0;
      globePinAlpha     = 1;
    }
  }
  globeRafId = requestAnimationFrame(globeLoop);
}

function renderGlobe() {
  if (!globeCanvas) return;
  const ctx  = globeCanvas.getContext('2d');
  const size = globeCanvas.width;

  globeProjection.rotate(globeRotation);
  ctx.clearRect(0, 0, size, size);

  // Ocean fill
  ctx.beginPath();
  globePath({type: 'Sphere'});
  ctx.fillStyle = 'rgba(14, 30, 100, 0.85)';
  ctx.fill();

  // Graticule (subtle grid lines)
  if (globeGraticule) {
    ctx.beginPath();
    globePath(globeGraticule);
    ctx.strokeStyle = 'rgba(60, 100, 255, 0.18)';
    ctx.lineWidth   = 0.4;
    ctx.stroke();
  }

  // Country outlines
  if (globeWorld) {
    const countries = topojson.feature(globeWorld, globeWorld.objects.countries);
    ctx.beginPath();
    globePath(countries);
    ctx.strokeStyle = '#3a6fff';
    ctx.lineWidth   = 0.6;
    ctx.stroke();
    ctx.fillStyle   = 'rgba(40, 80, 200, 0.15)';
    ctx.fill();
  }

  // US state lines (fade in when zoomed)
  if (globeUsStates && globeCurrentScale > GLOBE_BASE_SCALE * 1.5) {
    const zoomFraction = Math.min(1, (globeCurrentScale - GLOBE_BASE_SCALE * 1.5) / (GLOBE_BASE_SCALE * 1.0));
    const stateMesh = topojson.mesh(globeUsStates, globeUsStates.objects.states, (a, b) => a !== b);
    ctx.beginPath();
    globePath(stateMesh);
    ctx.strokeStyle = `rgba(120, 200, 255, ${0.55 * zoomFraction})`;
    ctx.lineWidth   = 0.5;
    ctx.stroke();
  }

  // US county lines (fade in at higher zoom)
  if (globeUsCounties && globeCurrentScale > GLOBE_BASE_SCALE * 5) {
    const zoomFraction = Math.min(1, (globeCurrentScale - GLOBE_BASE_SCALE * 5) / (GLOBE_BASE_SCALE * 2));
    const countyMesh = topojson.mesh(globeUsCounties, globeUsCounties.objects.counties, (a, b) => a !== b);
    ctx.beginPath();
    globePath(countyMesh);
    ctx.strokeStyle = `rgba(100, 180, 255, ${0.38 * zoomFraction})`;
    ctx.lineWidth   = 0.3;
    ctx.stroke();
  }

  // Outer sphere border
  ctx.beginPath();
  globePath({type: 'Sphere'});
  ctx.strokeStyle = 'rgba(100, 150, 255, 0.4)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Helper: draw a pin at [lng, lat] with given alpha
  function drawPin(lat, lng, alpha) {
    if (alpha <= 0) return;
    const coords = globeProjection([lng, lat]);
    if (!coords) return;
    const [px, py] = coords;
    const cx = size / 2, cy = size / 2;
    const pr = globeProjection.scale();
    if (Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) >= pr - 1) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd700';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  if (globePrevPinLat !== null && globePrevPinLng !== null)
    drawPin(globePrevPinLat, globePrevPinLng, globePrevPinAlpha);
  if (globePinLat !== null && globePinLng !== null)
    drawPin(globePinLat, globePinLng, globePinAlpha);
}

function setGlobeLocation(lat, lng, name) {
  const TRAVEL_THRESHOLD_RAD = 5 * Math.PI / 180; // ~555 km

  function midAngle(a, b) {
    let diff = b - a;
    while (diff > 180)  diff -= 360;
    while (diff < -180) diff += 360;
    return a + diff * 0.5;
  }

  const prevLat = globePinLat;
  const prevLng = globePinLng;

  if (prevLat !== null && prevLng !== null) {
    const angDist = globeAngularDist(prevLat, prevLng, lat, lng);
    globeTravelMode = angDist >= TRAVEL_THRESHOLD_RAD;

    if (globeTravelMode) {
      globePrevPinLat   = prevLat;
      globePrevPinLng   = prevLng;
      globePrevPinAlpha = 1.0;
      globePinAlpha     = 0.0;

      // Midpoint rotation between old and new target rotations
      globeMidRot = [midAngle(-prevLng, -lng), midAngle(-prevLat, -lat), 0];

      // Zoom out just enough to show both locations (capped at base scale)
      const halfAngle      = angDist / 2;
      const canvasRadius   = globeCanvas.width / 2;
      const idealZoomOut   = canvasRadius * 0.75 / Math.sin(halfAngle);
      globeZoomOutScale    = Math.max(GLOBE_BASE_SCALE, Math.min(GLOBE_ZOOM_SCALE * 0.5, idealZoomOut));

      globeLerpDuration = 35;
    } else {
      globePrevPinLat   = null;
      globePrevPinLng   = null;
      globePrevPinAlpha = 0.0;
      globePinAlpha     = 1.0;
      globeLerpDuration = 12;
    }
  } else {
    // First location: zoom straight in
    globeTravelMode   = false;
    globePrevPinLat   = null;
    globePrevPinLng   = null;
    globePrevPinAlpha = 0.0;
    globePinAlpha     = 0.0;
    globeLerpDuration = 17;
  }

  globePinLat      = lat;
  globePinLng      = lng;
  globeScaleFrom   = globeCurrentScale ?? GLOBE_BASE_SCALE;
  globeTargetScale = GLOBE_ZOOM_SCALE;
  globeLerpFrom    = [...globeRotation];
  globeTargetRot   = [-lng, -lat, 0];
  globeLerpFrame   = 0;
  globeLerpActive  = true;

  if (globeLabel) {
    if (name) {
      globeLabel.textContent = name;
    } else {
      const latStr = Math.abs(lat).toFixed(1) + (lat >= 0 ? '°N' : '°S');
      const lngStr = Math.abs(lng).toFixed(1) + (lng >= 0 ? '°E' : '°W');
      globeLabel.textContent = `${latStr}, ${lngStr}`;
    }
  }
}

function findCurrentClip(currentTime) {
  if (!clipLocations.length) return null;
  let lo = 0, hi = clipLocations.length - 1, result = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clipLocations[mid].t <= currentTime) {
      result = clipLocations[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────

const video = document.getElementById('compilation-video');
const videoSource = document.getElementById('video-source');
const monthSelector = document.getElementById('month-selector');
const monthStartSelect = document.getElementById('month-start');
const monthEndSelect = document.getElementById('month-end');
const jumpBtn = document.getElementById('jump-btn');
const statsDiv = document.getElementById('compilation-stats');
const timelineBar = document.getElementById('timeline-bar');

let compilationMetadata = null;

// Environment detection - use local files on localhost, GCS in production
const isLocal = window.location.hostname === 'localhost'
             || window.location.hostname === '127.0.0.1'
             || window.location.protocol === 'file:';

const config = {
  videoUrl: isLocal
    ? './output/compilation.mp4'
    : 'https://storage.googleapis.com/emmet-daily-snapshots/compilation.mp4',
  metadataUrl: isLocal
    ? './output/compilation-metadata.json'
    : './compilation-metadata.json',  // committed to repo, served same-origin (no CORS needed)
  fallbackVideoUrl: './output/compilation.mp4',
  fallbackMetadataUrl: 'https://storage.googleapis.com/emmet-daily-snapshots/compilation-metadata.json'
};

console.log('Environment:', isLocal ? 'LOCAL' : 'PRODUCTION');

// Format month string (2025-01 -> January 2025)
function formatMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  const date = new Date(year, parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Populate month dropdowns
function populateMonthSelects(months) {
  monthStartSelect.innerHTML = '';
  monthEndSelect.innerHTML = '';

  months.forEach((m, idx) => {
    const color = getMonthColor(m.month);

    const optStart = document.createElement('option');
    optStart.value = idx;
    optStart.textContent = formatMonth(m.month);
    optStart.style.backgroundColor = color;
    monthStartSelect.appendChild(optStart);

    const optEnd = document.createElement('option');
    optEnd.value = idx;
    optEnd.textContent = formatMonth(m.month);
    optEnd.style.backgroundColor = color;
    monthEndSelect.appendChild(optEnd);
  });

  // Default: select first and last month
  monthStartSelect.value = 0;
  monthEndSelect.value = months.length - 1;

  monthStartSelect.disabled = false;
  monthEndSelect.disabled = false;
  jumpBtn.disabled = false;
  syncSelectColors();
  buildTimeline();
  buildCustomDropdowns();
}

// Sync each select's own background to the currently selected option's color
function syncSelectColors() {
  [monthStartSelect, monthEndSelect].forEach(sel => {
    const opt = sel.options[sel.selectedIndex];
    sel.style.backgroundColor = opt ? opt.style.backgroundColor : '';
    if (sel._customUpdate) sel._customUpdate();
  });
}

// Build custom dropdown replacements for native selects (full hover styling)
function buildCustomDropdowns() {
  document.querySelectorAll('.custom-select').forEach(el => el.remove());

  [monthStartSelect, monthEndSelect].forEach(nativeSelect => {
    nativeSelect.classList.add('has-custom');

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';

    const panel = document.createElement('div');
    panel.className = 'custom-select-options';

    function updateTrigger() {
      const opt = nativeSelect.options[nativeSelect.selectedIndex];
      if (opt) {
        trigger.textContent = opt.textContent;
        trigger.style.backgroundColor = opt.style.backgroundColor;
      }
      panel.querySelectorAll('.custom-select-option').forEach(div => {
        div.classList.toggle('selected', div.dataset.value === nativeSelect.value);
      });
    }

    Array.from(nativeSelect.options).forEach(opt => {
      const div = document.createElement('div');
      div.className = 'custom-select-option';
      div.textContent = opt.textContent;
      div.dataset.value = opt.value;
      div.style.backgroundColor = opt.style.backgroundColor;

      div.addEventListener('click', e => {
        e.stopPropagation();
        nativeSelect.value = opt.value;
        nativeSelect.dispatchEvent(new Event('change'));
        wrapper.classList.remove('open');
      });

      panel.appendChild(div);
    });

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach(s => {
        if (s !== wrapper) s.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    updateTrigger();
    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);
    nativeSelect.parentElement.appendChild(wrapper);

    nativeSelect._customUpdate = updateTrigger;
  });
}

// Close custom dropdowns on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
});

// Jiggle the "Away we go!" button
function triggerJiggle() {
  jumpBtn.classList.remove('jiggle');
  void jumpBtn.offsetWidth; // force reflow to restart animation
  jumpBtn.classList.add('jiggle');
}
jumpBtn.addEventListener('animationend', () => jumpBtn.classList.remove('jiggle'));

// Spawn magical particles from an element
function spawnParticles(element) {
  const rect = element.getBoundingClientRect();
  const colors = Object.values(MONTH_COLORS);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let i = 0; i < 18; i++) {
    const particle = document.createElement('div');
    particle.className = 'magic-particle';

    const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.8;
    const distance = 30 + Math.random() * 70;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 4 + Math.random() * 6;

    particle.style.left = cx + 'px';
    particle.style.top = cy + 'px';
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.background = color;
    particle.style.boxShadow = `0 0 ${size}px ${color}`;
    particle.style.setProperty('--dx', dx + 'px');
    particle.style.setProperty('--dy', dy + 'px');

    document.body.appendChild(particle);
    particle.addEventListener('animationend', () => particle.remove());
  }
}

// Season color map by month number (1-12)
const MONTH_COLORS = {
  1:  '#5B9BD5',  // Jan - winter blue
  2:  '#7EC8E3',  // Feb - frost
  3:  '#77DD77',  // Mar - spring green
  4:  '#FFB7CE',  // Apr - cherry blossom
  5:  '#4CAF50',  // May - leaf green
  6:  '#FFD700',  // Jun - golden sun
  7:  '#FFA500',  // Jul - warm orange
  8:  '#FF8C00',  // Aug - deep orange
  9:  '#DAA520',  // Sep - goldenrod
  10: '#CC5500',  // Oct - burnt orange
  11: '#8B4513',  // Nov - saddle brown
  12: '#4169E1',  // Dec - royal blue
};

function getMonthColor(monthStr) {
  const num = parseInt(monthStr.split('-')[1]);
  return MONTH_COLORS[num] || '#888';
}

// Build timeline segments from metadata (called once both metadata + duration are ready)
function buildTimeline() {
  if (!compilationMetadata || !video.duration) return;
  timelineBar.innerHTML = '';

  compilationMetadata.months.forEach((m, idx) => {
    const seg = document.createElement('div');
    seg.className = 'timeline-segment';
    seg.dataset.idx = idx;
    seg.style.background = getMonthColor(m.month);
    seg.style.left = `${(m.start / video.duration) * 100}%`;
    seg.style.width = `${((m.end - m.start) / video.duration) * 100}%`;
    timelineBar.appendChild(seg);
  });

  timelineBar.style.display = 'block';
  updateTimelineSelection();
}

// Flag to prevent re-pausing if user manually seeks past the end
let hasPausedAtEnd = false;

// Update opacity of segments based on From/To selection
function updateTimelineSelection() {
  hasPausedAtEnd = false;
  const startIdx = parseInt(monthStartSelect.value);
  const endIdx = parseInt(monthEndSelect.value);
  const segments = timelineBar.querySelectorAll('.timeline-segment');
  segments.forEach(seg => {
    const idx = parseInt(seg.dataset.idx);
    seg.style.opacity = (idx >= startIdx && idx <= endIdx) ? '1' : '0.15';
  });
}

// Jump video to selected month range
function jumpToSelection() {
  hasPausedAtEnd = false;
  if (!compilationMetadata) {
    console.log('No metadata loaded');
    return;
  }

  const startIdx = parseInt(monthStartSelect.value);
  const startMonth = compilationMetadata.months[startIdx];
  const targetTime = startMonth?.start || 0;

  console.log('Jump requested:', {
    startIdx,
    startMonth,
    targetTime,
    videoDuration: video.duration,
    videoReadyState: video.readyState,
    seekable: video.seekable.length > 0 ?
      `${video.seekable.start(0)} - ${video.seekable.end(0)}` : 'none'
  });

  if (startMonth && typeof startMonth.start === 'number') {
    // Check if video is ready for seeking
    if (video.readyState >= 1) {
      console.log('Seeking to:', targetTime);
      video.currentTime = targetTime;

      // Verify the seek worked
      setTimeout(() => {
        console.log('After seek, currentTime:', video.currentTime);
      }, 100);

      video.play().catch(e => console.log('Play failed:', e));
    } else {
      // Video not ready, wait for loadedmetadata
      console.log('Video not ready, waiting...');
      video.addEventListener('loadedmetadata', function seekWhenReady() {
        console.log('Video ready, now seeking to:', targetTime);
        video.currentTime = targetTime;
        video.play().catch(e => console.log('Play failed:', e));
        video.removeEventListener('loadedmetadata', seekWhenReady);
      });
      video.load();
    }
  }
}

// Fetch metadata and initialize controls
async function loadMetadata() {
  try {
    let response;
    // Try primary URL based on environment
    try {
      response = await fetch(config.metadataUrl);
    } catch (e) {
      console.log('Primary metadata fetch failed, trying fallback...');
      response = null;
    }

    if (!response || !response.ok) {
      // Try fallback
      console.log('Trying fallback metadata:', config.fallbackMetadataUrl);
      response = await fetch(config.fallbackMetadataUrl);
    }
    if (!response.ok) throw new Error('Metadata not found');

    compilationMetadata = await response.json();

    // Cache-bust video URL using metadata generation timestamp
    const version = compilationMetadata.generated_at
      ? '?v=' + encodeURIComponent(compilationMetadata.generated_at)
      : '';
    videoSource.src = config.videoUrl + version;
    console.log('Video URL:', videoSource.src);
    video.load();

    // Extract per-clip GPS locations for the globe
    clipLocations = (compilationMetadata.clips || []).filter(c => c.lat != null && c.lng != null);
    initGlobe();

    if (compilationMetadata.months && compilationMetadata.months.length > 0) {
      populateMonthSelects(compilationMetadata.months);

      // Update stats
      const totalDuration = formatDuration(compilationMetadata.total_duration || 0);
      const clipCount = compilationMetadata.clip_count || 0;
      const monthCount = compilationMetadata.months.length;
      statsDiv.textContent = `${clipCount} clips across ${monthCount} month${monthCount !== 1 ? 's' : ''} • Total: ${totalDuration}`;
    } else {
      statsDiv.textContent = 'No month data available';
    }

    monthSelector.classList.remove('loading');
  } catch (err) {
    console.error('Failed to load metadata:', err);
    statsDiv.innerHTML = '<span class="error">Could not load month data</span>';
    monthSelector.classList.remove('loading');
    // Load video without cache-busting as fallback
    videoSource.src = config.videoUrl;
    video.load();
  }
}

// Auto-pause at end of selected range + update globe
video.addEventListener('timeupdate', () => {
  if (hasPausedAtEnd || !compilationMetadata) return;
  const endIdx = parseInt(monthEndSelect.value);
  const endMonth = compilationMetadata.months[endIdx];
  if (endMonth && video.currentTime >= endMonth.end) {
    video.pause();
    video.currentTime = endMonth.end;
    hasPausedAtEnd = true;
  }

  // Drive globe: per-clip GPS first, then fall back to per-month location
  const clip = findCurrentClip(video.currentTime);
  if (clip) {
    const idx = clipLocations.indexOf(clip);
    if (idx !== globeLastClipIdx) {
      globeLastClipIdx = idx;
      setGlobeLocation(clip.lat, clip.lng);
    }
  } else {
    const month = compilationMetadata.months.findLast(m => video.currentTime >= m.start);
    if (month && month.location && month.location.lat != null) {
      const key = month.month;
      if (key !== globeLastMonthKey) {
        globeLastMonthKey = key;
        setGlobeLocation(month.location.lat, month.location.lng, month.location.name);
      }
    }
  }
});

// Event listeners
jumpBtn.addEventListener('click', () => {
  spawnParticles(jumpBtn);
  jumpToSelection();
});

// Validate month range (start <= end)
monthStartSelect.addEventListener('change', () => {
  const startIdx = parseInt(monthStartSelect.value);
  const endIdx = parseInt(monthEndSelect.value);
  if (startIdx > endIdx) {
    monthEndSelect.value = startIdx;
  }
  syncSelectColors();
  updateTimelineSelection();
  triggerJiggle();
});

monthEndSelect.addEventListener('change', () => {
  const startIdx = parseInt(monthStartSelect.value);
  const endIdx = parseInt(monthEndSelect.value);
  if (endIdx < startIdx) {
    monthStartSelect.value = endIdx;
  }
  syncSelectColors();
  updateTimelineSelection();
  triggerJiggle();
});

// Video error handling - try fallback URL
let triedFallback = false;
video.addEventListener('error', function(e) {
  console.error('Video error:', e);
  if (!triedFallback && config.videoUrl !== config.fallbackVideoUrl) {
    console.log('Primary video failed, trying fallback:', config.fallbackVideoUrl);
    triedFallback = true;
    videoSource.src = config.fallbackVideoUrl;
    video.load();
  } else if (!triedFallback) {
    // Same URL for primary and fallback (local dev) - try without cache-bust param
    console.log('Retrying without cache-bust param:', config.fallbackVideoUrl);
    triedFallback = true;
    videoSource.src = config.fallbackVideoUrl;
    video.load();
  } else {
    const container = document.querySelector('.video-container');
    container.innerHTML = '<div class="error-message">The compilation video is being generated. Please check back soon!</div>';
  }
});

// Build timeline when video duration becomes available
video.addEventListener('loadedmetadata', function() {
  console.log('Video duration:', Math.floor(video.duration), 'seconds');
  buildTimeline();
});

video.addEventListener('pause', () => { videoLastPausedAt = Date.now(); });
video.addEventListener('ended', () => { videoLastPausedAt = Date.now(); });
video.addEventListener('play',  () => { videoLastPausedAt = Infinity; });

// Rebuild on resize (segments use percentages, but just in case)
window.addEventListener('resize', buildTimeline);

// Initialize
loadMetadata();
