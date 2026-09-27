import { describe, expect, it } from 'vitest';
import type { ExperimentResult } from '../application/Experiment';
import { DEFAULT_SCENARIO } from '../application/Scenario';
import type { DispatcherName } from '../domain/dispatch/registry';
import type { Metrics } from '../domain/metrics/Metrics';
import { comparePaired } from '../domain/metrics/PairedComparison';
import { ResultsView } from './ResultsView';

const BASELINE: DispatcherName = 'collective';

function metricsWithWait(dispatcher: string, seed: number, waitMean: number): Metrics {
  return {
    dispatcher,
    idlePolicy: 'test',
    seed,
    passengers: 10,
    delivered: 10,
    unfinished: 0,
    waitMean,
    waitP50: waitMean,
    waitP90: waitMean,
    waitP95: waitMean,
    waitWorst: waitMean,
    overThresholdShare: 0,
    journeyMean: waitMean,
    journeyP95: waitMean,
    leftBehind: 0,
    abandoned: 0,
    abandonedShare: 0,
    waitWhenStairsImpossible: waitMean,
    carStarts: 0,
    carDistance: 0,
    deliveredPercentPer5Min: 0,
    waitByFloor: [],
    worstFloorMeanWait: waitMean,
  };
}

/** Only mean wait decides the ranking, so each algorithm is given as its per-seed mean waits. */
function resultWith(waits: Partial<Record<DispatcherName, number[]>>): ExperimentResult {
  const entries = Object.entries(waits) as [DispatcherName, number[]][];
  const baselineValues = waits[BASELINE] ?? [];
  return {
    building: 'test',
    pattern: 'test',
    idlePolicy: 'test',
    seeds: baselineValues.length,
    baseline: BASELINE,
    aggregates: entries.map(([dispatcher, values]) => ({
      dispatcher,
      perSeed: values.map((waitMean, seed) => metricsWithWait(dispatcher, seed + 1, waitMean)),
      means: { waitMean: values.reduce((total, value) => total + value, 0) / values.length },
      sds: { waitMean: 0 },
    })),
    comparisons: entries
      .filter(([dispatcher]) => dispatcher !== BASELINE)
      .map(([dispatcher, values]) =>
        comparePaired(
          'waitMean',
          { name: BASELINE, values: baselineValues },
          { name: dispatcher, values },
          true,
        ),
      ),
    blockedDoorsCost: null,
  };
}

function render(result: ExperimentResult) {
  const view = new ResultsView();
  view.show(DEFAULT_SCENARIO, result, { waitNow: 0, levers: [] });
  const bestRows = [...view.element.querySelectorAll('tbody tr')]
    .filter((row) => [...row.querySelectorAll('span')].some((span) => span.textContent === 'best'))
    .map((row) => row.querySelector('td')?.firstChild?.textContent);
  return { headline: view.element.querySelector('h2')?.textContent, bestRows };
}

describe('the best badge', () => {
  it('marks the lowest mean when it beats every other algorithm beyond seed noise', () => {
    const { headline, bestRows } = render(
      resultWith({
        collective: [40, 42, 41, 43, 40, 42],
        etd: [30, 31, 30, 32, 29, 31],
        'nearest-car': [35, 36, 35, 37, 34, 36],
      }),
    );
    expect(bestRows).toEqual(['etd']);
    expect(headline).toBe('etd is the best fit for this building, and collective the worst.');
  });

  it('marks nobody when the lowest mean is inside the noise of the runner-up', () => {
    const { headline, bestRows } = render(
      resultWith({
        collective: [40, 42, 41, 43, 40, 42],
        etd: [30, 33, 29, 32, 30, 31],
        'nearest-car': [31, 32, 30, 31, 31, 30],
      }),
    );
    expect(bestRows).toEqual([]);
    expect(headline).toBe(
      'No algorithm beats every other by more than seed noise, but collective is the worst.',
    );
  });

  it('marks nobody when every algorithm is inside the noise of the others', () => {
    const { headline, bestRows } = render(
      resultWith({
        collective: [40, 42, 41, 43, 40, 42],
        etd: [41, 40, 42, 41, 43, 40],
      }),
    );
    expect(bestRows).toEqual([]);
    expect(headline).toContain('barely matters');
  });

  it('names no worst algorithm when the highest mean is inside the noise of another', () => {
    const { headline, bestRows } = render(
      resultWith({
        collective: [40, 43, 39, 42, 40, 41],
        etd: [30, 31, 30, 32, 29, 31],
        'nearest-car': [41, 42, 40, 41, 41, 40],
      }),
    );
    expect(bestRows).toEqual(['etd']);
    expect(headline).toBe('etd is the best fit for this building.');
  });
});
