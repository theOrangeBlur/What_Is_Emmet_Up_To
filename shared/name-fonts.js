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

  const TEXT_DEFAULT = 'mono';
  const TEXT_FONTS = {
    mono:       { label: 'Space Mono',            family: "'Space Mono', monospace",             gf: 'Space+Mono:wght@400;700' },
    courier:    { label: 'Courier Prime',         family: "'Courier Prime', monospace",          gf: 'Courier+Prime:ital,wght@0,400;0,700;1,400' },
    lora:       { label: 'Lora',                  family: "'Lora', serif",                       gf: 'Lora:ital,wght@0,400;0,700;1,400' },
    literata:   { label: 'Literata',              family: "'Literata', serif",                   gf: 'Literata:ital,wght@0,400;0,700;1,400' },
    atkinson:   { label: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible', sans-serif", gf: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400' },
    comic:      { label: 'Comic Neue',            family: "'Comic Neue', cursive",               gf: 'Comic+Neue:ital,wght@0,400;0,700;1,400' },
    typewriter: { label: 'Special Elite',         family: "'Special Elite', monospace",          gf: 'Special+Elite' },
    caveat:     { label: 'Caveat',                family: "'Caveat', cursive",                   gf: 'Caveat:wght@400;700', scale: 1.35 },
    pixel:      { label: 'VT323',                 family: "'VT323', monospace",                  gf: 'VT323', scale: 1.4 },
  };

  const loaded = new Set();

  // Tell the loader a page's own <link> already carries these (FONTS[*].gf values).
  function markLoaded(...gfs) {
    gfs.forEach((g) => loaded.add(g));
  }

  function load(key) {
    const f = FONTS[key] || TEXT_FONTS[key];
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

  // A known text font key, or the text default.
  function textKeyOf(key) {
    return TEXT_FONTS[key] ? key : TEXT_DEFAULT;
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

  return { DEFAULT, FONTS, TEXT_DEFAULT, TEXT_FONTS, markLoaded, load, keyOf, textKeyOf, applyTo };
})();
