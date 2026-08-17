import { describe, expect, it } from 'vitest';
import { expectedArrivals, type TrafficConfig, validateTraffic } from './TrafficConfig';

const UP_PEAK: TrafficConfig = {
  pattern: 'up-peak',
  durationSeconds: 1800,
  demandPercentPer5Min: 12,
  burstiness: 1,
};

describe('traffic config', () => {
  it('accepts a plain up-peak', () => {
    expect(validateTraffic(UP_PEAK)).toEqual([]);
  });

  it('rejects demand of zero, because then nobody calls the lift', () => {
    expect(validateTraffic({ ...UP_PEAK, demandPercentPer5Min: 0 })).toContain(
      'Demand is 0% of the population per 5 minutes; it must be greater than zero or nobody ' +
        'ever calls the lift.',
    );
  });

  it('flags demand above the whole building arriving at once', () => {
    expect(validateTraffic({ ...UP_PEAK, demandPercentPer5Min: 140 })).toContain(
      'Demand is 140% per 5 minutes, which means more than the whole building arrives in five ' +
        'minutes. Check the figure.',
    );
  });

  it('rejects burstiness below a plain Poisson process', () => {
    expect(validateTraffic({ ...UP_PEAK, burstiness: 0.5 }).length).toBe(1);
  });

  it('rejects a period of zero', () => {
    expect(validateTraffic({ ...UP_PEAK, durationSeconds: 0 })).toContain(
      'The simulated period is 0 s; it must be positive.',
    );
  });

  it('rejects an unknown pattern', () => {
    expect(validateTraffic({ ...UP_PEAK, pattern: 'rush' as never }).length).toBe(1);
  });
});

describe('expectedArrivals', () => {
  it('scales demand over the simulated period', () => {
    // 12% of 100 people per 5 min = 12 people per 5 min; 1800 s is six of those blocks.
    expect(expectedArrivals(UP_PEAK, 100)).toBe(72);
  });

  it('is proportional to population', () => {
    expect(expectedArrivals(UP_PEAK, 50)).toBe(36);
  });
});
