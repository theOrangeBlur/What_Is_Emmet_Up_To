import type { GenResult } from '../core/generator';
import type { GenParams } from '../core/types';
import type { WorkerRequest, WorkerResponse } from '../worker';

/** Wraps two workers: one for single puzzles, one for batches (so batches never block play). */
export class GenClient {
  private single = this.spawn();
  private batchWorker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (r: GenResult) => void>();

  private spawn(): Worker {
    const w = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'generated') {
        this.pending.get(m.id)?.(m.result);
        this.pending.delete(m.id);
      }
    };
    return w;
  }

  generate(params: GenParams): Promise<GenResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.single.postMessage({ type: 'generate', id, params } satisfies WorkerRequest);
    });
  }

  /** Cancel an in-flight single generation by replacing the worker. */
  cancelSingle(): void {
    this.single.terminate();
    this.pending.clear();
    this.single = this.spawn();
  }

  runBatch(
    params: GenParams,
    count: number,
    onItem: (index: number, seed: string, r: GenResult) => void,
    onDone: () => void,
  ): void {
    this.stopBatch();
    const w = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    const id = this.nextId++;
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'batchItem') onItem(m.index, m.seed, m.result);
      else if (m.type === 'batchDone') {
        onDone();
        this.stopBatch();
      }
    };
    w.postMessage({ type: 'batch', id, params, count } satisfies WorkerRequest);
    this.batchWorker = w;
  }

  stopBatch(): void {
    this.batchWorker?.terminate();
    this.batchWorker = null;
  }
}
