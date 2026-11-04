import type { GenStats } from '../core/generator';
import { TIER_NAMES, type Grade, type Step } from '../core/solver/logic';
import { PRESETS, presetOf, type PresetName } from '../core/presets';
import type { GenParams, Shape } from '../core/types';
import { clamp, randomSeed } from './params';

export interface PanelDeps {
  onGenerate: (p: GenParams) => void;
  onToday: () => void;
  onCopyLink: () => void;
  onExport: () => string;
  onImport: (json: string) => void;
  onStep: (s: Step) => void;
}

export interface Panel {
  read(): GenParams;
  write(p: GenParams): void;
  showStats(stats: GenStats | null, grade: Grade | null, extra?: { thermos: number; size: number }): void;
  setBusy(b: boolean): void;
}

export function buildPanel(root: HTMLElement, deps: PanelDeps): Panel {
  root.innerHTML = `
    <form class="gen-form" id="gen-form">
      <label>Difficulty preset
        <select name="preset">
          <option value="easy">Easy: counting only (0 jumps)</option>
          <option value="medium">Medium: 1–2 jumps, chains ≤ 2</option>
          <option value="hard">Hard: 1–4 jumps, chains 3–4</option>
          <option value="expert">Expert: 5+ jumps, chains ≤ 6</option>
          <option value="custom">Custom</option>
        </select></label>
      <label>Size <output id="o-size"></output>
        <input type="range" name="size" min="4" max="10" step="1" /></label>
      <label>Seed
        <span class="row"><input type="text" name="seed" spellcheck="false" />
        <button type="button" id="b-dice" title="Random seed">🎲</button></span></label>
      <label>Thermometer shape
        <select name="shape"><option value="mixed">Mixed</option><option value="straight">Straight</option><option value="bent">Bent</option></select></label>
      <div class="row2">
        <label>Min length <input type="number" name="minLen" min="1" max="10" /></label>
        <label>Max length <input type="number" name="maxLen" min="1" max="10" /></label>
      </div>
      <label>Fill density <output id="o-dens"></output>
        <input type="range" name="density" min="0.15" max="0.85" step="0.05" /></label>
      <label>Red share <output id="o-red"></output>
        <input type="range" name="pRed" min="0" max="1" step="0.05" /></label>
      <fieldset><legend>Clue mix (relative weights)</legend>
        <div class="row3">
          <label class="t-red">Red <input type="number" name="mixRed" min="0" max="10" /></label>
          <label class="t-blue">Blue <input type="number" name="mixBlue" min="0" max="10" /></label>
          <label>Black <input type="number" name="mixBlack" min="0" max="10" /></label>
        </div>
      </fieldset>
      <label class="check"><input type="checkbox" name="minimize" /> Minimize clues (blank out every clue that isn't needed)</label>
      <label>Extreme clues
        <select name="avoidExtremes">
          <option value="-1">Allow</option>
          <option value="0">Avoid 0 and full lines</option>
          <option value="1">Avoid within 1 of 0 or full</option>
          <option value="2">Avoid within 2 of 0 or full</option>
        </select></label>
      <div class="row2">
        <label>Min tier <select name="minTier">${[1, 2, 3, 4, 5].map((t) => `<option value="${t}">${t} ${TIER_NAMES[t]}</option>`).join('')}</select></label>
        <label>Max tier <select name="maxTier">${[1, 2, 3, 4, 5].map((t) => `<option value="${t}">${t} ${TIER_NAMES[t]}</option>`).join('')}<option value="6">Allow guessing</option></select></label>
      </div>
      <div class="row2">
        <label title="Logic jumps: steps beyond counting one line">Min jumps <input type="number" name="minJumps" min="0" max="99" /></label>
        <label>Max jumps <input type="number" name="maxJumps" min="0" max="99" /></label>
        <label title="Longest chain of any jump, in lines: 1 line combination, 2 crossing lines, 3+ contradiction">Min chain <input type="number" name="minChain" min="0" max="20" /></label>
        <label title="0 = no cap">Max chain <input type="number" name="maxChain" min="0" max="20" /></label>
      </div>
      <label>Max attempts <input type="number" name="maxAttempts" min="1" max="500" /></label>
      <div class="row">
        <button type="submit" class="primary" id="b-gen">Generate</button>
        <button type="button" id="b-today">Today's puzzle</button>
        <button type="button" id="b-link">Copy link</button>
      </div>
    </form>
    <div id="stats" class="stats"></div>
    <details class="steps-box" id="steps-box">
      <summary>Solve path</summary>
      <ol id="steps" class="steps"></ol>
    </details>
    <details>
      <summary>Import / export</summary>
      <textarea id="io" rows="6" spellcheck="false" placeholder="Puzzle JSON"></textarea>
      <div class="row">
        <button type="button" id="b-export">Export current</button>
        <button type="button" id="b-import">Import</button>
      </div>
    </details>`;

  const form = root.querySelector<HTMLFormElement>('#gen-form')!;
  const f = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const outs = () => {
    root.querySelector('#o-size')!.textContent = `${f('size').value}×${f('size').value}`;
    root.querySelector('#o-dens')!.textContent = Number(f('density').value).toFixed(2);
    root.querySelector('#o-red')!.textContent = Number(f('pRed').value).toFixed(2);
  };
  form.addEventListener('input', outs);
  form.addEventListener('change', (e) => {
    const name = (e.target as HTMLInputElement).name;
    if (name === 'preset') {
      const v = f('preset').value;
      if (v !== 'custom') {
        const pr = PRESETS[v as PresetName];
        for (const [k, val] of Object.entries(pr)) f(k).value = String(val);
      }
    } else if (['avoidExtremes', 'minTier', 'maxTier', 'minJumps', 'maxJumps', 'minChain', 'maxChain'].includes(name)) {
      f('preset').value = presetOf(read());
    }
  });

  const read = (): GenParams => {
    const minLen = clamp(Number(f('minLen').value) || 2, 1, 10);
    const maxLen = clamp(Number(f('maxLen').value) || 5, minLen, 10);
    const minTier = Number(f('minTier').value);
    const maxTier = Math.max(minTier, Number(f('maxTier').value));
    const minJumps = clamp(Number(f('minJumps').value) || 0, 0, 99);
    const maxJumps = clamp(Number(f('maxJumps').value) || 0, minJumps, 99);
    return {
      size: clamp(Number(f('size').value), 4, 10),
      seed: f('seed').value.trim() || randomSeed(),
      shape: f('shape').value as Shape,
      minLen,
      maxLen,
      density: Number(f('density').value),
      pRed: Number(f('pRed').value),
      mix: { red: Number(f('mixRed').value) || 0, blue: Number(f('mixBlue').value) || 0, black: Number(f('mixBlack').value) || 0 },
      minimize: f('minimize').checked,
      avoidExtremes: Number(f('avoidExtremes').value),
      minTier,
      maxTier,
      minJumps,
      maxJumps,
      minChain: clamp(Number(f('minChain').value) || 0, 0, 20),
      maxChain: clamp(Number(f('maxChain').value) || 0, 0, 20),
      maxAttempts: clamp(Number(f('maxAttempts').value) || 30, 1, 500),
    };
  };

  const write = (p: GenParams) => {
    f('size').value = String(p.size);
    f('seed').value = p.seed;
    f('shape').value = p.shape;
    f('minLen').value = String(p.minLen);
    f('maxLen').value = String(p.maxLen);
    f('density').value = String(p.density);
    f('pRed').value = String(p.pRed);
    f('mixRed').value = String(p.mix.red);
    f('mixBlue').value = String(p.mix.blue);
    f('mixBlack').value = String(p.mix.black);
    f('minimize').checked = p.minimize;
    f('avoidExtremes').value = String(p.avoidExtremes);
    f('preset').value = presetOf(p);
    f('minTier').value = String(p.minTier);
    f('maxTier').value = String(p.maxTier);
    f('minJumps').value = String(p.minJumps);
    f('maxJumps').value = String(p.maxJumps);
    f('minChain').value = String(p.minChain);
    f('maxChain').value = String(p.maxChain);
    f('maxAttempts').value = String(p.maxAttempts);
    outs();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    deps.onGenerate(read());
  });
  root.querySelector('#b-dice')!.addEventListener('click', () => {
    f('seed').value = randomSeed();
    deps.onGenerate(read());
  });
  root.querySelector('#b-today')!.addEventListener('click', deps.onToday);
  root.querySelector('#b-link')!.addEventListener('click', deps.onCopyLink);
  const io = root.querySelector<HTMLTextAreaElement>('#io')!;
  root.querySelector('#b-export')!.addEventListener('click', () => {
    io.value = deps.onExport();
    io.select();
    navigator.clipboard?.writeText(io.value).catch(() => {});
  });
  root.querySelector('#b-import')!.addEventListener('click', () => deps.onImport(io.value));

  const statsEl = root.querySelector<HTMLElement>('#stats')!;
  const stepsEl = root.querySelector<HTMLOListElement>('#steps')!;

  const showStats: Panel['showStats'] = (stats, grade, extra) => {
    const rows: [string, string][] = [];
    if (grade) {
      rows.push(['Difficulty', `<b class="lbl lbl-${grade.label.replace(/\s/g, '')}">${grade.label}</b> · score ${grade.score}`]);
      rows.push([
        'Techniques',
        grade.techCounts
          .map((c, t) => (t && c ? `${TIER_NAMES[t]} ×${c}` : ''))
          .filter(Boolean)
          .join(', ') || '—',
      ]);
      rows.push(['Logic steps', `${grade.steps.length} (${grade.ms.toFixed(0)} ms)`]);
      rows.push([
        'Counting / jumps',
        `${grade.counting} counting · <b>${grade.jumps} jump${grade.jumps === 1 ? '' : 's'}</b> (${(grade.jumpShare * 100).toFixed(0)}%)` +
          (grade.maxChain ? ` · longest chain ${grade.maxChain} line${grade.maxChain === 1 ? '' : 's'}` : ''),
      ]);
      rows.push(['Extreme clues', `${grade.extremes} <span class="muted">(within 1 of 0 or full)</span>`]);
    }
    if (stats) {
      const cc = stats.clueCounts;
      rows.push(['Clues', `<span class="t-red">${cc.red} red</span> · <span class="t-blue">${cc.blue} blue</span> · ${cc.black} black · ${cc.none} blank`]);
      rows.push(['Thermometers', String(stats.thermos)]);
      rows.push(['Generation', `${stats.ms.toFixed(0)} ms · ${stats.attempts} attempt${stats.attempts > 1 ? 's' : ''}`]);
      if (stats.failures.nonUnique || stats.failures.offTarget)
        rows.push(['Rejected', `${stats.failures.nonUnique} not unique, ${stats.failures.offTarget} off target`]);
      rows.push(['Unique', '✓ exactly one solution']);
      if (!stats.targetMet) rows.push(['Note', '<span class="warn">Difficulty target not met. Showing the last unique puzzle.</span>']);
    } else if (extra) {
      rows.push(['Thermometers', String(extra.thermos)]);
    }
    statsEl.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    stepsEl.replaceChildren();
    grade?.steps.forEach((s) => {
      const li = document.createElement('li');
      li.className = `step tier-${s.tier}`;
      li.innerHTML = `<span class="tier">T${s.tier}</span> ${escapeHtml(s.note)} <span class="muted">(${s.cells.length} cell${s.cells.length === 1 ? '' : 's'})</span>`;
      li.addEventListener('click', () => deps.onStep(s));
      stepsEl.append(li);
    });
    if (grade && !grade.solved) {
      const li = document.createElement('li');
      li.className = 'step stuck';
      li.textContent = 'Stuck: no tier 1–5 technique makes progress from here.';
      stepsEl.append(li);
    }
  };

  const setBusy = (b: boolean) => {
    root.querySelector<HTMLButtonElement>('#b-gen')!.disabled = b;
  };

  return { read, write, showStats, setBusy };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
