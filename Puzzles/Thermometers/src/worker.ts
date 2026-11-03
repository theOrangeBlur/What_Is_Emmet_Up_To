/// <reference lib="webworker" />
import { generate, type GenResult } from './core/generator';
import type { GenParams } from './core/types';

export type WorkerRequest =
  | { type: 'generate'; id: number; params: GenParams }
  | { type: 'batch'; id: number; params: GenParams; count: number };

export type WorkerResponse =
  | { type: 'generated'; id: number; result: GenResult }
  | { type: 'batchItem'; id: number; index: number; seed: string; result: GenResult }
  | { type: 'batchDone'; id: number };

const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'generate') {
    post({ type: 'generated', id: m.id, result: generate(m.params) });
  } else if (m.type === 'batch') {
    for (let i = 0; i < m.count; i++) {
      const seed = `${m.params.seed}-${i + 1}`;
      post({ type: 'batchItem', id: m.id, index: i, seed, result: generate({ ...m.params, seed }) });
    }
    post({ type: 'batchDone', id: m.id });
  }
};
