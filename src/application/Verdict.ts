import type { DispatcherName } from '../domain/dispatch/registry';
import { flightTime, performanceTime } from '../domain/sim/Kinematics';
import type { ExperimentResult } from './Experiment';
import type { Scenario } from './Scenario';

export interface Verdict {
  readonly headline: string;
  readonly points: readonly string[];
  readonly best: DispatcherName;
  /** False when no algorithm beats the baseline beyond seed noise. */
  readonly algorithmMatters: boolean;
  /** Share of a single-floor trip spent on doors and delays rather than moving. */
  readonly doorShare: number;
}

const SECONDS = (value: number): string => `${value.toFixed(1)} s`;

/**
 * Turns an experiment into the two or three sentences a person actually reads. Its most important
 * job is being willing to say the algorithm is not the problem — which, for a low-rise building
 * with one car, is usually the truth.
 */
export function verdictOf(scenario: Scenario, result: ExperimentResult): Verdict {
  const waitComparisons = result.comparisons.filter(
    (comparison) => comparison.metric === 'waitMean',
  );
  const decisive = waitComparisons.filter(
    (comparison) => comparison.verdict !== 'indistinguishable',
  );
  const algorithmMatters = decisive.length > 0;

  const ranked = [...result.aggregates].sort(
    (a, b) => (a.means.waitMean ?? 0) - (b.means.waitMean ?? 0),
  );
  const best = ranked[0]?.dispatcher ?? result.baseline;
  const worst = ranked[ranked.length - 1];
  const baselineWait =
    result.aggregates.find((entry) => entry.dispatcher === result.baseline)?.means.waitMean ?? 0;

  const hop = scenario.floorHeight;
  const flight = flightTime(hop, scenario.car);
  const overhead = performanceTime(hop, scenario.car) - flight;
  const doorShare = overhead / (overhead + flight);

  const points: string[] = [];

  points.push(
    `Across ${result.seeds} seeds, ${result.baseline} averages ${SECONDS(baselineWait)} of waiting.`,
  );

  if (algorithmMatters) {
    for (const comparison of decisive) {
      const better = comparison.verdict === 'better';
      points.push(
        `${comparison.candidate} is ${better ? 'better' : 'worse'} than ${comparison.baseline} by ` +
          `${SECONDS(Math.abs(comparison.meanDifference))} on average ` +
          `(95% interval ${SECONDS(comparison.ci95[0])} to ${SECONDS(comparison.ci95[1])}).`,
      );
    }
  } else {
    points.push(
      'No algorithm beat any other by more than seed noise: every paired interval crosses zero.',
    );
  }

  for (const comparison of waitComparisons.filter((c) => c.verdict === 'indistinguishable')) {
    points.push(
      `${comparison.candidate} versus ${comparison.baseline}: indistinguishable, interval ` +
        `${SECONDS(comparison.ci95[0])} to ${SECONDS(comparison.ci95[1])}.`,
    );
  }

  points.push(
    `A single-floor trip spends ${(doorShare * 100).toFixed(0)}% of its time on doors, start ` +
      `delay and levelling, and only ${SECONDS(flight)} actually moving.`,
  );

  if (scenario.cars === 1 && doorShare > 0.5) {
    points.push(
      'With one car and doors dominating, shortening the door dwell or the transfer time buys ' +
        'more than any change of algorithm.',
    );
  }

  const headline = algorithmMatters
    ? `${best} is the best fit for this building` +
      (worst ? `, and ${worst.dispatcher} the worst.` : '.')
    : 'For this building the algorithm barely matters — your time goes into the doors.';

  return { headline, points, best, algorithmMatters, doorShare };
}
