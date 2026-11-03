import type { Rng } from './rng';
import type { Shape, Thermo } from './types';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * Partition the grid into thermometers.
 * Each uncovered cell (in random order) grows a path toward a random target length.
 * Leftover single cells are merged into a neighbor's end when possible.
 */
export function makeLayout(
  n: number,
  shape: Shape,
  minLen: number,
  maxLen: number,
  rng: Rng,
): Thermo[] {
  const owner = new Int32Array(n * n).fill(-1);
  const paths: number[][] = [];
  const free = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && owner[r * n + c] < 0;

  const order = rng.shuffle([...Array(n * n).keys()]);
  for (const start of order) {
    if (owner[start] >= 0) continue;
    const target = rng.int(minLen, maxLen);
    const straight = shape === 'straight' || (shape === 'mixed' && rng.next() < 0.5);
    const path = straight ? growStraight(start, target) : growBent(start, target);
    const id = paths.length;
    for (const c of path) owner[c] = id;
    paths.push(path);
  }

  function growStraight(start: number, target: number): number[] {
    const r0 = Math.floor(start / n);
    const c0 = start % n;
    const axes = rng.shuffle([
      [0, 1],
      [1, 0],
    ]);
    let best: number[] = [start];
    for (const [dr, dc] of axes) {
      let fwd = 0;
      while (fwd < target - 1 && free(r0 + dr * (fwd + 1), c0 + dc * (fwd + 1))) fwd++;
      let back = 0;
      while (back < target - 1 && free(r0 - dr * (back + 1), c0 - dc * (back + 1))) back++;
      const len = Math.min(target, fwd + back + 1);
      if (len <= best.length) continue;
      // choose a random window of length len containing start
      const lo = Math.max(-back, -(len - 1));
      const hi = Math.min(0, fwd - (len - 1));
      const s = rng.int(lo, hi);
      const seg: number[] = [];
      for (let k = s; k < s + len; k++) seg.push((r0 + dr * k) * n + (c0 + dc * k));
      best = seg;
    }
    return best;
  }

  function growBent(start: number, target: number): number[] {
    const path = [start];
    const inPath = new Set(path);
    let lastDir = -1;
    let flipped = false;
    while (path.length < target) {
      const end = path[path.length - 1];
      const r = Math.floor(end / n);
      const c = end % n;
      const opts: number[] = [];
      for (let d = 0; d < 4; d++) {
        const rr = r + DIRS[d][0];
        const cc = c + DIRS[d][1];
        if (free(rr, cc) && !inPath.has(rr * n + cc)) opts.push(d);
      }
      if (!opts.length) {
        if (flipped) break;
        path.reverse(); // try growing from the other end
        flipped = true;
        lastDir = -1;
        continue;
      }
      const d = lastDir >= 0 && opts.includes(lastDir) && rng.next() < 0.45 ? lastDir : rng.pick(opts);
      const nxt = (r + DIRS[d][0]) * n + (c + DIRS[d][1]);
      path.push(nxt);
      inPath.add(nxt);
      lastDir = d;
    }
    return path;
  }

  // Merge single cells into a neighbor's end.
  const rc = (x: number) => [Math.floor(x / n), x % n] as const;
  const adjacent = (a: number, b: number) => {
    const [ra, ca] = rc(a);
    const [rb, cb] = rc(b);
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
  };
  for (let id = 0; id < paths.length; id++) {
    if (paths[id].length !== 1) continue;
    const s = paths[id][0];
    const cands: { q: number; atEnd: boolean }[] = [];
    for (let q = 0; q < paths.length; q++) {
      if (q === id || paths[q].length === 0 || paths[q].length > maxLen) continue;
      const qp = paths[q];
      for (const atEnd of [true, false]) {
        const tip = atEnd ? qp[qp.length - 1] : qp[0];
        if (!adjacent(tip, s)) continue;
        if (shape === 'straight' && qp.length >= 2) {
          const prev = atEnd ? qp[qp.length - 2] : qp[1];
          if (tip - prev !== s - tip) continue;
        }
        cands.push({ q, atEnd });
      }
    }
    if (!cands.length) continue;
    const { q, atEnd } = rng.pick(cands);
    if (atEnd) paths[q].push(s);
    else paths[q].unshift(s);
    paths[id] = [];
  }

  return paths
    .filter((p) => p.length > 0)
    .map((p) => ({ cells: rng.next() < 0.5 ? p : [...p].reverse() }));
}
