import type { ExperimentResult } from '../../application/Experiment';
import type { Scenario } from '../../application/Scenario';
import type { SweepRequest, SweepResponse } from './protocol';

export interface SweepHandlers {
  readonly onProgress: (done: number, total: number) => void;
  readonly onDone: (result: ExperimentResult) => void;
  readonly onFailed: (message: string) => void;
}

/**
 * Runs a sweep off the main thread. Six algorithms across thirty seeds is a lot of simulated
 * mornings; on the main thread the page would sit frozen and look broken.
 *
 * One sweep at a time: starting another cancels the first, because its answer is already stale.
 */
export class SweepClient {
  private worker: Worker | null = null;

  constructor(private readonly spawn: () => Worker) {}

  run(scenario: Scenario, handlers: SweepHandlers): void {
    this.cancel();
    const worker = this.spawn();
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<SweepResponse>) => {
      const response = event.data;
      if (response.kind === 'progress') {
        handlers.onProgress(response.done, response.total);
        return;
      }
      this.cancel();
      if (response.kind === 'done') handlers.onDone(response.result);
      else handlers.onFailed(response.message);
    };

    worker.onerror = (event) => {
      this.cancel();
      handlers.onFailed(event.message || 'The simulation worker stopped unexpectedly.');
    };

    const request: SweepRequest = { scenario };
    worker.postMessage(request);
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  get running(): boolean {
    return this.worker !== null;
  }
}
