/// <reference lib="webworker" />

import { adviceFor } from '../../application/Advice';
import { experimentSpecOf, runExperiment } from '../../application/Experiment';
import { isSweepRequest, type SweepResponse } from './protocol';

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isSweepRequest(event.data)) {
    post({ kind: 'failed', message: 'Malformed sweep request.' });
    return;
  }
  const { scenario } = event.data;
  try {
    const result = runExperiment(experimentSpecOf(scenario), (done, total) => {
      post({ kind: 'progress', done, total, stage: 'comparing' });
    });
    const advice = adviceFor(scenario, result.baseline, (done, total) => {
      post({ kind: 'progress', done, total, stage: 'working out what would help' });
    });
    post({ kind: 'done', result, advice });
  } catch (error) {
    post({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

function post(response: SweepResponse): void {
  self.postMessage(response);
}
