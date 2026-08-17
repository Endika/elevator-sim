/**
 * Demand in the industry unit — percentage of population per five minutes — so results can be
 * checked against published handling-capacity figures rather than only against ourselves.
 */

export type TrafficPattern =
  | 'up-peak'
  | 'down-peak'
  | 'interfloor'
  | 'lunch'
  | 'residential-sparse';

export const TRAFFIC_PATTERNS: readonly TrafficPattern[] = [
  'up-peak',
  'down-peak',
  'interfloor',
  'lunch',
  'residential-sparse',
];

export interface TrafficConfig {
  readonly pattern: TrafficPattern;
  /** How long to simulate, seconds. */
  readonly durationSeconds: number;
  /** Percentage of the building population arriving per 5 minutes. */
  readonly demandPercentPer5Min: number;
  /** 1 is a plain Poisson process; higher clumps the same demand into bursts. */
  readonly burstiness: number;
}

export function validateTraffic(traffic: TrafficConfig): string[] {
  const problems: string[] = [];

  if (!TRAFFIC_PATTERNS.includes(traffic.pattern)) {
    problems.push(
      `"${traffic.pattern}" is not a traffic pattern. Pick one of: ${TRAFFIC_PATTERNS.join(', ')}.`,
    );
  }

  if (!(traffic.durationSeconds > 0) || !Number.isFinite(traffic.durationSeconds)) {
    problems.push(`The simulated period is ${traffic.durationSeconds} s; it must be positive.`);
  }

  if (!(traffic.demandPercentPer5Min > 0) || !Number.isFinite(traffic.demandPercentPer5Min)) {
    problems.push(
      `Demand is ${traffic.demandPercentPer5Min}% of the population per 5 minutes; it must be ` +
        'greater than zero or nobody ever calls the lift.',
    );
  }

  if (traffic.demandPercentPer5Min > 100) {
    problems.push(
      `Demand is ${traffic.demandPercentPer5Min}% per 5 minutes, which means more than the whole ` +
        'building arrives in five minutes. Check the figure.',
    );
  }

  if (!(traffic.burstiness >= 1) || !Number.isFinite(traffic.burstiness)) {
    problems.push(
      `Burstiness is ${traffic.burstiness}; 1 is a smooth Poisson process and higher values ` +
        'clump the arrivals, so it cannot be below 1.',
    );
  }

  return problems;
}

/** Expected number of passengers over the whole simulated period. */
export function expectedArrivals(traffic: TrafficConfig, population: number): number {
  const fiveMinuteBlocks = traffic.durationSeconds / 300;
  return ((population * traffic.demandPercentPer5Min) / 100) * fiveMinuteBlocks;
}
