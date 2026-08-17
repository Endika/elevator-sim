import type { Building } from '../building/Building';
import type { FloorId } from '../config/BuildingConfig';
import { timeToDestinationOf, waitOf } from '../sim/invariants';
import type { SimResult } from '../sim/types';
import { max, mean, percentile } from './Percentiles';

/** The threshold the lift industry treats as an unacceptable wait. */
export const UNACCEPTABLE_WAIT_SECONDS = 60;

export interface FloorWait {
  readonly floor: FloorId;
  readonly label: string;
  readonly mean: number;
  readonly worst: number;
  readonly passengers: number;
}

export interface Metrics {
  readonly dispatcher: string;
  readonly idlePolicy: string;
  readonly seed: number;
  readonly passengers: number;
  readonly delivered: number;
  readonly unfinished: number;
  readonly waitMean: number;
  readonly waitP50: number;
  readonly waitP90: number;
  readonly waitP95: number;
  readonly waitWorst: number;
  readonly overThresholdShare: number;
  readonly journeyMean: number;
  readonly journeyP95: number;
  readonly leftBehind: number;
  readonly carStarts: number;
  readonly carDistance: number;
  /** Percentage of the building population carried per five minutes. */
  readonly deliveredPercentPer5Min: number;
  /** Per origin floor, so starvation of the far floors is visible rather than averaged away. */
  readonly waitByFloor: readonly FloorWait[];
  /** The worst mean wait any single floor suffered. */
  readonly worstFloorMeanWait: number;
}

export function metricsOf(building: Building, result: SimResult, periodSeconds: number): Metrics {
  const waits = result.journeys.map(waitOf).filter((wait): wait is number => wait !== null);
  const journeys = result.journeys
    .map(timeToDestinationOf)
    .filter((time): time is number => time !== null);

  const waitByFloor = building.floors
    .map((floor) => {
      const atFloor = result.journeys
        .filter((journey) => journey.origin === floor.id)
        .map(waitOf)
        .filter((wait): wait is number => wait !== null);
      return {
        floor: floor.id,
        label: floor.label,
        mean: mean(atFloor),
        worst: max(atFloor),
        passengers: atFloor.length,
      };
    })
    .filter((entry) => entry.passengers > 0);

  const fiveMinuteBlocks = periodSeconds / 300;
  const population = building.totalPopulation;

  return {
    dispatcher: result.dispatcher,
    idlePolicy: result.idlePolicy,
    seed: result.seed,
    passengers: result.journeys.length,
    delivered: result.journeys.length - result.unfinished,
    unfinished: result.unfinished,
    waitMean: mean(waits),
    waitP50: percentile(waits, 0.5),
    waitP90: percentile(waits, 0.9),
    waitP95: percentile(waits, 0.95),
    waitWorst: max(waits),
    overThresholdShare:
      waits.length === 0
        ? 0
        : waits.filter((wait) => wait > UNACCEPTABLE_WAIT_SECONDS).length / waits.length,
    journeyMean: mean(journeys),
    journeyP95: percentile(journeys, 0.95),
    leftBehind: result.journeys.reduce((sum, journey) => sum + journey.leftBehind, 0),
    carStarts: result.carStarts,
    carDistance: result.carDistance,
    deliveredPercentPer5Min:
      population === 0 || fiveMinuteBlocks === 0
        ? 0
        : ((result.journeys.length - result.unfinished) / fiveMinuteBlocks / population) * 100,
    waitByFloor,
    worstFloorMeanWait: max(waitByFloor.map((entry) => entry.mean)),
  };
}

/** Metrics whose lower value is better. Used to word verdicts without hardcoding each name. */
export const LOWER_IS_BETTER = new Set<keyof Metrics>([
  'waitMean',
  'waitP50',
  'waitP90',
  'waitP95',
  'waitWorst',
  'overThresholdShare',
  'journeyMean',
  'journeyP95',
  'leftBehind',
  'carStarts',
  'carDistance',
  'unfinished',
  'worstFloorMeanWait',
]);
