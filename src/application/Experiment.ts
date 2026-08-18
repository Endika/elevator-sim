import type { Building } from '../domain/building/Building';
import type { IdlePolicy } from '../domain/config/BuildingConfig';
import type { TrafficConfig } from '../domain/config/TrafficConfig';
import { BASELINE, DISPATCHERS, type DispatcherName } from '../domain/dispatch/registry';
import { LOWER_IS_BETTER, type Metrics, metricsOf } from '../domain/metrics/Metrics';
import { comparePaired, type PairedResult } from '../domain/metrics/PairedComparison';
import { mean, standardDeviation } from '../domain/metrics/Percentiles';
import { runSimulation } from '../domain/sim/Simulation';
import { generateStream } from '../domain/traffic/PassengerStream';
import { buildingOf, type Scenario, trafficConfigOf } from './Scenario';

export interface ExperimentSpec {
  readonly building: Building;
  readonly traffic: TrafficConfig;
  readonly dispatchers: readonly DispatcherName[];
  readonly idlePolicy?: IdlePolicy;
  readonly seeds: number;
  readonly firstSeed?: number;
  readonly baseline: DispatcherName;
}

export interface Aggregate {
  readonly dispatcher: DispatcherName;
  readonly perSeed: readonly Metrics[];
  readonly means: Readonly<Record<string, number>>;
  readonly sds: Readonly<Record<string, number>>;
}

/**
 * What the door-holders cost, as a controlled experiment rather than an estimate.
 *
 * Setting the share to zero changes which people hold the doors and nothing else: the draw is
 * still made, so the arrival times, destinations, prams and patience are identical passenger for
 * passenger. The difference is attributable to the blocking and to nothing else.
 */
export interface BlockedDoorsCost {
  readonly withBlocking: number;
  readonly without: number;
  readonly difference: number;
}

export interface ExperimentResult {
  readonly building: string;
  readonly pattern: string;
  readonly idlePolicy: string;
  readonly seeds: number;
  readonly baseline: DispatcherName;
  readonly aggregates: readonly Aggregate[];
  readonly comparisons: readonly PairedResult[];
  /** Null when nobody was holding the doors in the first place. */
  readonly blockedDoorsCost: BlockedDoorsCost | null;
}

export type Progress = (done: number, total: number) => void;

/**
 * The one place a scenario becomes an experiment. The browser worker and the command line both go
 * through here, which is what makes "the same scenario gives the same numbers in both" true by
 * construction rather than by coincidence.
 */
export function experimentSpecOf(
  scenario: Scenario,
  dispatchers: readonly DispatcherName[] = scenario.dispatchers,
): ExperimentSpec {
  return {
    building: buildingOf(scenario),
    traffic: trafficConfigOf(scenario),
    dispatchers,
    idlePolicy: scenario.idlePolicy,
    seeds: scenario.seeds,
    baseline: dispatchers.includes(BASELINE) ? BASELINE : (dispatchers[0] ?? BASELINE),
  };
}

const NUMERIC_METRICS = [...LOWER_IS_BETTER, 'deliveredPercentPer5Min'] as const;

const MINIMUM_SEEDS = 2;

/**
 * One passenger stream per seed, reused by every algorithm — that is what makes the comparisons
 * paired. Generating inside the per-dispatcher loop would silently break the whole method.
 */
export function runExperiment(spec: ExperimentSpec, onProgress?: Progress): ExperimentResult {
  if (spec.seeds < MINIMUM_SEEDS) {
    throw new Error(`An experiment needs at least ${MINIMUM_SEEDS} seeds; got ${spec.seeds}.`);
  }
  if (!spec.dispatchers.includes(spec.baseline)) {
    throw new Error(`The baseline "${spec.baseline}" is not among the algorithms being run.`);
  }

  const firstSeed = spec.firstSeed ?? 1;
  const perDispatcher = new Map<DispatcherName, Metrics[]>(
    spec.dispatchers.map((name) => [name, []]),
  );
  const total = spec.seeds * spec.dispatchers.length;
  let done = 0;

  for (let offset = 0; offset < spec.seeds; offset += 1) {
    const seed = firstSeed + offset;
    const stream = generateStream(spec.building, spec.traffic, seed);

    for (const name of spec.dispatchers) {
      const result = runSimulation({
        building: spec.building,
        stream,
        dispatcher: DISPATCHERS[name],
        ...(spec.idlePolicy ? { idlePolicy: spec.idlePolicy } : {}),
      });
      perDispatcher.get(name)?.push(metricsOf(spec.building, result, spec.traffic.durationSeconds));
      done += 1;
      onProgress?.(done, total);
    }
  }

  const aggregates: Aggregate[] = spec.dispatchers.map((name) => {
    const perSeed = perDispatcher.get(name) ?? [];
    return {
      dispatcher: name,
      perSeed,
      means: summarise(perSeed, mean),
      sds: summarise(perSeed, standardDeviation),
    };
  });

  const baselineSeries = seriesOf(perDispatcher.get(spec.baseline) ?? []);
  const comparisons = spec.dispatchers
    .filter((name) => name !== spec.baseline)
    .flatMap((name) => {
      const candidate = seriesOf(perDispatcher.get(name) ?? []);
      return NUMERIC_METRICS.map((metric) =>
        comparePaired(
          metric,
          { name: spec.baseline, values: baselineSeries[metric] ?? [] },
          { name, values: candidate[metric] ?? [] },
          LOWER_IS_BETTER.has(metric as keyof Metrics),
        ),
      );
    });

  return {
    blockedDoorsCost: costOfBlockedDoors(spec),
    building: spec.building.name,
    pattern: spec.traffic.pattern,
    idlePolicy: spec.idlePolicy ?? spec.building.idlePolicy,
    seeds: spec.seeds,
    baseline: spec.baseline,
    aggregates,
    comparisons,
  };
}

function costOfBlockedDoors(spec: ExperimentSpec): BlockedDoorsCost | null {
  if (spec.traffic.doorBlockShare <= 0 || spec.traffic.doorBlockSeconds <= 0) return null;

  const firstSeed = spec.firstSeed ?? 1;
  const meanWaitWith = (traffic: typeof spec.traffic): number => {
    const waits: number[] = [];
    for (let offset = 0; offset < spec.seeds; offset += 1) {
      const stream = generateStream(spec.building, traffic, firstSeed + offset);
      const result = runSimulation({
        building: spec.building,
        stream,
        dispatcher: DISPATCHERS[spec.baseline],
        ...(spec.idlePolicy ? { idlePolicy: spec.idlePolicy } : {}),
      });
      waits.push(
        mean(
          result.journeys
            .filter((journey) => journey.boardedAt !== null)
            .map((journey) => (journey.boardedAt ?? 0) - journey.calledAt),
        ),
      );
    }
    return mean(waits);
  };

  const withBlocking = meanWaitWith(spec.traffic);
  const without = meanWaitWith({ ...spec.traffic, doorBlockShare: 0 });
  return { withBlocking, without, difference: withBlocking - without };
}

function seriesOf(perSeed: readonly Metrics[]): Record<string, number[]> {
  const series: Record<string, number[]> = {};
  for (const metric of NUMERIC_METRICS) {
    series[metric] = perSeed.map((entry) => Number(entry[metric as keyof Metrics] ?? 0));
  }
  return series;
}

function summarise(
  perSeed: readonly Metrics[],
  reduce: (values: readonly number[]) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of NUMERIC_METRICS) {
    out[metric] = reduce(perSeed.map((entry) => Number(entry[metric as keyof Metrics] ?? 0)));
  }
  return out;
}
