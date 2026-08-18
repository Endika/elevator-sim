import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { RESIDENTIAL_LOW } from '../config/presets';
import type { Journey, SimResult } from '../sim/types';
import { metricsOf } from './Metrics';
import { comparePaired } from './PairedComparison';
import { mean, percentile, standardDeviation } from './Percentiles';

const residential = Building.of(RESIDENTIAL_LOW);

function journey(overrides: Partial<Journey> & Pick<Journey, 'passengerId'>): Journey {
  return {
    origin: 0,
    destination: 3,
    direction: 'up',
    calledAt: 0,
    boardedAt: 10,
    arrivedAt: 40,
    leftBehind: 0,
    abandonedAt: null,
    couldUseStairs: true,
    ...overrides,
  };
}

function resultOf(journeys: readonly Journey[]): SimResult {
  return {
    dispatcher: 'test',
    idlePolicy: 'stay-put',
    seed: 1,
    journeys,
    carStarts: 3,
    carDistance: 25,
    endTime: 500,
    unfinished: journeys.filter((j) => j.arrivedAt === null && j.abandonedAt === null).length,
    abandoned: journeys.filter((j) => j.abandonedAt !== null).length,
  };
}

describe('percentiles', () => {
  it('matches hand-computed nearest-rank values', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.9)).toBe(90);
    expect(percentile(values, 0.95)).toBe(100);
  });

  it('does not care about input order', () => {
    expect(percentile([50, 10, 30], 0.5)).toBe(30);
  });

  it('returns the single value for a one-element sample', () => {
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('rejects a fraction outside zero to one', () => {
    expect(() => percentile([1, 2], 95)).toThrow(/between 0 and 1/);
  });
});

describe('spread', () => {
  it('computes the sample standard deviation', () => {
    // Hand-computed: mean 4, deviations -2,-1,0,1,2, sum of squares 10, /4 = 2.5, sqrt = 1.5811
    expect(standardDeviation([2, 3, 4, 5, 6])).toBeCloseTo(1.5811388, 6);
  });

  it('is undefined for a single seed, rather than zero', () => {
    expect(standardDeviation([5])).toBeNaN();
  });

  it('averages', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('metrics', () => {
  const result = resultOf([
    journey({ passengerId: 1, calledAt: 0, boardedAt: 10, arrivedAt: 40 }),
    journey({ passengerId: 2, calledAt: 0, boardedAt: 100, arrivedAt: 140, origin: 7 }),
    journey({ passengerId: 3, calledAt: 0, boardedAt: 20, arrivedAt: null, leftBehind: 2 }),
  ]);
  const metrics = metricsOf(residential, result, 600);

  it('averages the waits of everyone who boarded', () => {
    expect(metrics.waitMean).toBeCloseTo((10 + 100 + 20) / 3, 6);
  });

  it('reports the worst wait, not just the average', () => {
    expect(metrics.waitWorst).toBe(100);
  });

  it('counts the share above the industry threshold', () => {
    expect(metrics.overThresholdShare).toBeCloseTo(1 / 3, 6);
  });

  it('separates delivered from unfinished', () => {
    expect(metrics.delivered).toBe(2);
    expect(metrics.unfinished).toBe(1);
  });

  it('totals the times a full car left someone behind', () => {
    expect(metrics.leftBehind).toBe(2);
  });

  it('breaks waits down by origin floor, so starvation is visible', () => {
    const top = metrics.waitByFloor.find((entry) => entry.floor === 7);
    expect(top?.mean).toBe(100);
    expect(metrics.worstFloorMeanWait).toBe(100);
  });

  it('lists only floors that actually generated traffic', () => {
    expect(metrics.waitByFloor.map((entry) => entry.floor)).toEqual([0, 7]);
  });

  it('expresses throughput as a percentage of the population per five minutes', () => {
    // 2 delivered over 600 s (two 5-minute blocks) with 42 residents.
    expect(metrics.deliveredPercentPer5Min).toBeCloseTo((2 / 2 / 42) * 100, 6);
  });
});

describe('paired comparison', () => {
  const seeds = 30;
  const baseline = Array.from({ length: seeds }, (_, i) => 40 + (i % 5));

  it('calls a consistent improvement better', () => {
    const candidate = baseline.map((value) => value - 10);
    const result = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      true,
    );
    expect(result.verdict).toBe('better');
    expect(result.meanDifference).toBeCloseTo(-10, 6);
    expect(result.ci95[1]).toBeLessThan(0);
  });

  it('calls a consistent regression worse', () => {
    const candidate = baseline.map((value) => value + 10);
    const result = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      true,
    );
    expect(result.verdict).toBe('worse');
  });

  it('refuses to crown a winner when the difference straddles zero', () => {
    const candidate = baseline.map((value, i) => value + (i % 2 === 0 ? 6 : -6));
    const result = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      true,
    );
    expect(result.verdict).toBe('indistinguishable');
    expect(result.ci95[0]).toBeLessThanOrEqual(0);
    expect(result.ci95[1]).toBeGreaterThanOrEqual(0);
  });

  it('calls two identical algorithms indistinguishable', () => {
    const result = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: [...baseline] },
      true,
    );
    expect(result.verdict).toBe('indistinguishable');
    expect(result.meanDifference).toBe(0);
  });

  it('reverses the meaning of better for a metric where more is good', () => {
    const candidate = baseline.map((value) => value + 10);
    const result = comparePaired(
      'deliveredPercentPer5Min',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      false,
    );
    expect(result.verdict).toBe('better');
  });

  it('gives the same interval every time it is asked', () => {
    const candidate = baseline.map((value, i) => value - (i % 3));
    const once = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      true,
    );
    const twice = comparePaired(
      'waitMean',
      { name: 'a', values: baseline },
      { name: 'b', values: candidate },
      true,
    );
    expect(once.ci95).toEqual(twice.ci95);
  });

  it('will not compare series of different lengths', () => {
    expect(() =>
      comparePaired('waitMean', { name: 'a', values: [1, 2] }, { name: 'b', values: [1] }, true),
    ).toThrow(/one value per seed/);
  });

  it('will not draw a conclusion from a single seed', () => {
    expect(() =>
      comparePaired('waitMean', { name: 'a', values: [1] }, { name: 'b', values: [2] }, true),
    ).toThrow(/at least two seeds/);
  });
});
