// A small color picker for the profile edit form: a swatch button that opens
// a hue/saturation wheel with a lightness slider. Values are '#rrggbb', or
// '' when cleared.
//
//   const picker = ColorWheel.create('#3fa34d', hex => preview(hex));
//   form.appendChild(picker.el);  ...  picker.get()

window.ColorWheel = (function () {
  const SIZE = 180;

  function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return [h, s, l];
  }

  const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

  function parseHex(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  // [hue 0-360, saturation 0-1, lightness 0-1], or null if it isn't #rrggbb.
  function hexToHsl(hex) {
    const rgb = parseHex(hex);
    return rgb ? rgbToHsl(...rgb) : null;
  }

  function create(initial, onChange) {
    const rgb = parseHex(initial);
    let [h, s, l] = rgb ? rgbToHsl(...rgb) : [0, 1, 0.5];
    let value = rgb ? toHex(rgb) : '';

    const root = document.createElement('div');
    root.className = 'cw';

    const swatchBtn = document.createElement('button');
    swatchBtn.type = 'button';
    swatchBtn.className = 'cw-swatch-btn';
    const swatch = document.createElement('span');
    swatch.className = 'cw-swatch';
    const label = document.createElement('span');
    label.className = 'cw-label';
    swatchBtn.append(swatch, label);

    const panel = document.createElement('div');
    panel.className = 'cw-panel';
    panel.hidden = true;

    const wheelWrap = document.createElement('div');
    wheelWrap.className = 'cw-wheel';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const marker = document.createElement('span');
    marker.className = 'cw-marker';
    wheelWrap.append(canvas, marker);

    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = 100;
    slider.className = 'cw-light';
    slider.setAttribute('aria-label', 'lightness');

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'authw-btn cw-clear';
    clearBtn.textContent = 'clear';

    panel.append(wheelWrap, slider, clearBtn);
    root.append(swatchBtn, panel);

    const ctx = canvas.getContext('2d');
    function drawWheel() {
      const img = ctx.createImageData(SIZE, SIZE);
      const r = SIZE / 2;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const dx = x - r + 0.5, dy = y - r + 0.5;
          const dist = Math.hypot(dx, dy);
          if (dist > r) continue;
          const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const [cr, cg, cb] = hslToRgb(hue, dist / r, l);
          const i = (y * SIZE + x) * 4;
          img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb;
          img.data[i + 3] = dist > r - 1 ? Math.round((r - dist) * 255) : 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function sync() {
      swatch.style.background = value || 'transparent';
      swatch.classList.toggle('cw-swatch-none', !value);
      label.textContent = value || 'pick a color';
      const angle = h * Math.PI / 180;
      marker.style.left = (50 + Math.cos(angle) * s * 50) + '%';
      marker.style.top = (50 + Math.sin(angle) * s * 50) + '%';
      marker.style.background = value || toHex(hslToRgb(h, s, l));
      slider.value = Math.round(l * 100);
      slider.style.background = `linear-gradient(to right, #000, ${toHex(hslToRgb(h, s, 0.5))}, #fff)`;
    }

    function commit() {
      value = toHex(hslToRgb(h, s, l));
      sync();
      if (onChange) onChange(value);
    }

    function pick(e) {
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - rect.left) / rect.width * 2 - 1;
      const dy = (e.clientY - rect.top) / rect.height * 2 - 1;
      h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      s = Math.min(1, Math.hypot(dx, dy));
      commit();
    }

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener('pointermove', e => {
      if (canvas.hasPointerCapture(e.pointerId)) pick(e);
    });
    slider.addEventListener('input', () => {
      l = slider.value / 100;
      drawWheel();
      commit();
    });
    // Opening the wheel doesn't pick a color; touching it does.
    swatchBtn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
    clearBtn.addEventListener('click', () => {
      value = '';
      sync();
      if (onChange) onChange(value);
    });

    drawWheel();
    sync();
    return { el: root, get: () => value };
  }

  return { create, hexToHsl };
})();
