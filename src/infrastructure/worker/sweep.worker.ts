/// <reference lib="webworker" />

import { experimentSpecOf, runExperiment } from '../../application/Experiment';
import type { SweepRequest, SweepResponse } from './protocol';

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  const { scenario } = event.data;
  try {
    const result = runExperiment(experimentSpecOf(scenario), (done, total) => {
      post({ kind: 'progress', done, total });
    });
    post({ kind: 'done', result });
  } catch (error) {
    post({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

function post(response: SweepResponse): void {
  self.postMessage(response);
}
