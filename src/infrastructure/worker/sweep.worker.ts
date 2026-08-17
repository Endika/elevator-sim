/// <reference lib="webworker" />

import { runExperiment } from '../../application/Experiment';
import { buildingOf, type Scenario, trafficConfigOf } from '../../application/Scenario';
import { BASELINE } from '../../domain/dispatch/registry';
import type { SweepRequest, SweepResponse } from './protocol';

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  const { scenario } = event.data;
  try {
    const result = runExperiment(specOf(scenario), (done, total) => {
      post({ kind: 'progress', done, total });
    });
    post({ kind: 'done', result });
  } catch (error) {
    post({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

function specOf(scenario: Scenario) {
  return {
    building: buildingOf(scenario),
    traffic: trafficConfigOf(scenario),
    dispatchers: scenario.dispatchers,
    idlePolicy: scenario.idlePolicy,
    seeds: scenario.seeds,
    baseline: scenario.dispatchers.includes(BASELINE)
      ? BASELINE
      : (scenario.dispatchers[0] ?? BASELINE),
  };
}

function post(response: SweepResponse): void {
  self.postMessage(response);
}
