// The typefaces a person can set their name in (profiles.name_font). Shared by
// the profile page and anywhere else a name shows in its owner's font, such as
// the monthly champion card. Keys are what profiles.name_font stores, so keep
// them. Everyone gets the default; the rest unlock after ten games
// (perk:name_fonts in supabase/unlocks.sql). Fonts are fetched from Google
// Fonts the first time they're needed.
window.NameFonts = (function () {
  const DEFAULT = 'bricolage';
  const FONTS = {
    bricolage:         { label: 'Bricolage Grotesque',     family: "'Bricolage Grotesque', sans-serif", weight: 800, gf: 'Bricolage+Grotesque:opsz,wght@12..96,800' },
    syne:              { label: 'Syne',                    family: "'Syne', sans-serif",                weight: 800, gf: 'Syne:wght@800' },
    fraunces:          { label: 'Fraunces',                family: "'Fraunces', serif",                 weight: 800, gf: 'Fraunces:opsz,wght@9..144,800' },
    instrument:        { label: 'Instrument Serif',        family: "'Instrument Serif', serif",         weight: 400, gf: 'Instrument+Serif:ital@0;1' },
    instrument_italic: { label: 'Instrument Serif Italic', family: "'Instrument Serif', serif",         weight: 400, gf: 'Instrument+Serif:ital@0;1', italic: true },
    dm_serif:          { label: 'DM Serif Display',        family: "'DM Serif Display', serif",         weight: 400, gf: 'DM+Serif+Display' },
    young_serif:       { label: 'Young Serif',             family: "'Young Serif', serif",              weight: 400, gf: 'Young+Serif' },
    archivo:           { label: 'Archivo Black',           family: "'Archivo Black', sans-serif",       weight: 400, gf: 'Archivo+Black' },
    space_mono:        { label: 'Space Mono',              family: "'Space Mono', monospace",           weight: 700, gf: 'Space+Mono:wght@700' },
    fraktur:           { label: 'Blackletter',             family: "'UnifrakturMaguntia', serif",       weight: 400, gf: 'UnifrakturMaguntia' },
  };

  const loaded = new Set();

  // Tell the loader a page's own <link> already carries these (FONTS[*].gf values).
  function markLoaded(...gfs) {
    gfs.forEach((g) => loaded.add(g));
  }

  function load(key) {
    const f = FONTS[key];
    if (!f || loaded.has(f.gf)) return;
    loaded.add(f.gf);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + f.gf + '&display=swap';
    document.head.appendChild(link);
  }

  // A known key, or the default.
  function keyOf(key) {
    return FONTS[key] ? key : DEFAULT;
  }

  // Set element el in the font for key (loading it), or leave it alone for an unknown key.
  function applyTo(el, key) {
    const f = FONTS[key];
    if (!f) return false;
    load(key);
    el.style.fontFamily = f.family;
    el.style.fontWeight = String(f.weight);
    el.style.fontStyle = f.italic ? 'italic' : 'normal';
    return true;
  }

  return { DEFAULT, FONTS, markLoaded, load, keyOf, applyTo };
})();
