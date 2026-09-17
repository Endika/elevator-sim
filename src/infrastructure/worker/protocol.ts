import type { Advice } from '../../application/Advice';
import type { ExperimentResult } from '../../application/Experiment';
import type { Scenario } from '../../application/Scenario';
import { IDLE_POLICIES, LANDING_BUTTONS } from '../../domain/config/BuildingConfig';
import { TRAFFIC_PATTERNS } from '../../domain/config/TrafficConfig';
import { DISPATCHER_NAMES } from '../../domain/dispatch/registry';

export interface SweepRequest {
  readonly scenario: Scenario;
}

export type SweepResponse =
  | {
      readonly kind: 'progress';
      readonly done: number;
      readonly total: number;
      readonly stage: 'comparing' | 'working out what would help';
    }
  | {
      readonly kind: 'done';
      readonly result: ExperimentResult;
      readonly advice: Advice;
    }
  | { readonly kind: 'failed'; readonly message: string };

const SCENARIO_NUMBER_FIELDS = [
  'floorsAbove',
  'basements',
  'floorHeight',
  'peoplePerFloor',
  'cars',
  'idleDelaySeconds',
  'durationMinutes',
  'demandPercentPer5Min',
  'burstiness',
  'seeds',
  'opportunistShare',
  'stairsPatiencePerFloor',
  'stairsMaxFloors',
  'stairsAbleShare',
  'encumberedSpace',
  'doorBlockShare',
  'doorBlockSeconds',
  'roundsPerHour',
  'roundStops',
] as const;

const CAR_NUMBER_FIELDS = [
  'capacity',
  'ratedSpeed',
  'acceleration',
  'jerk',
  'doorOpenTime',
  'doorCloseTime',
  'doorDwellTime',
  'startDelay',
  'levellingDelay',
  'advanceDoorOpenTime',
  'passengerTransferTime',
] as const;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function hasNumberFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof record[field] === 'number');
}

function isEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isCarSpec(x: unknown): boolean {
  return isRecord(x) && hasNumberFields(x, CAR_NUMBER_FIELDS);
}

/**
 * Runtime check for what actually crosses the worker boundary: `MessageEvent<SweepRequest>` is a
 * compile-time promise only, erased by the time anything posts to the worker.
 */
export function isSweepRequest(x: unknown): x is SweepRequest {
  if (!isRecord(x) || !isRecord(x.scenario)) return false;
  const scenario = x.scenario;

  return (
    hasNumberFields(scenario, SCENARIO_NUMBER_FIELDS) &&
    typeof scenario.destinationEntry === 'boolean' &&
    isEnumValue(LANDING_BUTTONS, scenario.landingButtons) &&
    isEnumValue(IDLE_POLICIES, scenario.idlePolicy) &&
    isEnumValue(TRAFFIC_PATTERNS, scenario.pattern) &&
    Array.isArray(scenario.dispatchers) &&
    scenario.dispatchers.length > 0 &&
    scenario.dispatchers.every((name) => isEnumValue(DISPATCHER_NAMES, name)) &&
    isCarSpec(scenario.car)
  );
}
