import { aliveCount, fullDomain, optToState, propagate, type CSP, type Domain } from './csp';
import type { ThermoState } from '../types';

export interface CountResult {
  /** Solutions found, capped at `limit`. */
  count: number;
  /** Option index per thermo for each solution found. */
  solutions: Int32Array[];
  nodes: number;
  /** True when the node limit was hit before the search finished. */
  aborted: boolean;
}

/** Count solutions up to `limit`, using bounds propagation plus backtracking. */
export function countSolutions(csp: CSP, limit = 2, nodeLimit = 400_000, start?: Domain): CountResult {
  const res: CountResult = { count: 0, solutions: [], nodes: 0, aborted: false };
  const root = start ? start.slice() : fullDomain(csp);
  const free = csp.consOfT.map((c) => c.length === 0);

  const dfs = (dom: Domain, init?: number[]): void => {
    if (res.count >= limit || res.aborted) return;
    if (++res.nodes > nodeLimit) {
      res.aborted = true;
      return;
    }
    if (!propagate(csp, dom, init)) return;
    // Pick the variable: unconstrained thermos first, then smallest domain, then most constrained.
    let best = -1;
    let bestScore = Infinity;
    for (let t = 0; t < csp.nT; t++) {
      const k = aliveCount(csp, dom, t);
      if (k <= 1) continue;
      const score = free[t] ? -1 : k * 100 - csp.consOfT[t].length;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best < 0) {
      const sol = new Int32Array(csp.nT);
      for (let t = 0; t < csp.nT; t++) {
        const o0 = csp.off[t];
        const sz = 2 * csp.lens[t] + 1;
        for (let o = 0; o < sz; o++)
          if (dom[o0 + o]) {
            sol[t] = o;
            break;
          }
      }
      res.solutions.push(sol);
      res.count++;
      return;
    }
    const o0 = csp.off[best];
    const sz = 2 * csp.lens[best] + 1;
    for (let o = 0; o < sz; o++) {
      if (!dom[o0 + o]) continue;
      const d2 = dom.slice();
      d2.fill(0, o0, o0 + sz);
      d2[o0 + o] = 1;
      dfs(d2, csp.consOfT[best]);
      if (res.count >= limit || res.aborted) return;
    }
  };

  dfs(root);
  return res;
}

export function solutionToStates(csp: CSP, sol: Int32Array): ThermoState[] {
  return Array.from(sol, (o, t) => optToState(o, csp.lens[t]));
}
