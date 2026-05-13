// ─── Globe ──────────────────────────────────────────────────────────────────

const globeCanvas = document.getElementById('globe-canvas');
const globeLabel  = document.getElementById('globe-location-label');
const GLOBE_WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

let globeWorld        = null;   // topojson world
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

function initGlobe() {
  if (!globeCanvas || typeof d3 === 'undefined' || typeof topojson === 'undefined') return;

  const size = globeCanvas.width; // 260
  const radius = size / 2 - 2;

  globeProjection = d3.geoOrthographic()
    .scale(radius)
    .translate([size / 2, size / 2])
    .clipAngle(90)
    .precision(0.3);

  globePath      = d3.geoPath(globeProjection, globeCanvas.getContext('2d'));
  globeGraticule = d3.geoGraticule()();

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
}

function globeLoop() {
  // Auto-rotate when not animating to a target and video is paused/ended
  if (!globeLerpActive && (video.paused || video.ended)) {
    globeRotation[0] += 0.2;
    renderGlobe();
  } else if (globeLerpActive) {
    globeLerpFrame++;
    const t = Math.min(globeLerpFrame / 20, 1);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

    // Interpolate each rotation axis, handling wrap-around for longitude
    function lerpAngle(a, b, t) {
      let diff = b - a;
      while (diff > 180)  diff -= 360;
      while (diff < -180) diff += 360;
      return a + diff * t;
    }

    globeRotation[0] = lerpAngle(globeLerpFrom[0], globeTargetRot[0], ease);
    globeRotation[1] = lerpAngle(globeLerpFrom[1], globeTargetRot[1], ease);
    renderGlobe();

    if (t >= 1) {
      globeLerpActive = false;
      globeRotation   = [...globeTargetRot];
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

  // Outer sphere border
  ctx.beginPath();
  globePath({type: 'Sphere'});
  ctx.strokeStyle = 'rgba(100, 150, 255, 0.4)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Pin
  if (globePinLat !== null && globePinLng !== null) {
    const coords = globeProjection([globePinLng, globePinLat]);
    if (coords) {
      // Check the point is on the visible hemisphere (not clipped)
      const [px, py] = coords;
      const cx = size / 2, cy = size / 2;
      const radius = globeProjection.scale();
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist < radius - 1) {
        ctx.save();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur  = 10;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();
        ctx.shadowBlur  = 0;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function setGlobeLocation(lat, lng) {
  globePinLat   = lat;
  globePinLng   = lng;
  globeLerpFrom = [...globeRotation];
  globeTargetRot = [-lng, -lat, 0]; // D3 orthographic: rotate brings (lat,lng) to center
  globeLerpFrame = 0;
  globeLerpActive = true;

  // Update label
  if (globeLabel) {
    const latStr = Math.abs(lat).toFixed(1) + (lat >= 0 ? '°N' : '°S');
    const lngStr = Math.abs(lng).toFixed(1) + (lng >= 0 ? '°E' : '°W');
    globeLabel.textContent = `${latStr}, ${lngStr}`;
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

  // Drive globe location from current clip
  const clip = findCurrentClip(video.currentTime);
  if (clip) {
    // Only update if we've moved to a new clip index
    const idx = clipLocations.indexOf(clip);
    if (idx !== globeLastClipIdx) {
      globeLastClipIdx = idx;
      setGlobeLocation(clip.lat, clip.lng);
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

// Rebuild on resize (segments use percentages, but just in case)
window.addEventListener('resize', buildTimeline);

// Initialize
loadMetadata();
