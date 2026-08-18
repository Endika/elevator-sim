import { Building } from '../domain/building/Building';
import type {
  BuildingConfig,
  CarSpec,
  IdlePolicy,
  LandingButtons,
} from '../domain/config/BuildingConfig';
import { validateBuilding } from '../domain/config/BuildingConfig';
import { RESIDENTIAL_CAR } from '../domain/config/PhysicsDefaults';
import { floorStack, PRESETS, type PresetName } from '../domain/config/presets';
import type { TrafficConfig, TrafficPattern } from '../domain/config/TrafficConfig';
import { OBSERVED_BEHAVIOUR, validateTraffic } from '../domain/config/TrafficConfig';
import { DISPATCHER_NAMES, type DispatcherName } from '../domain/dispatch/registry';

/**
 * What the form holds: a flat, serializable description of a building and a morning. Kept
 * separate from BuildingConfig so the URL stays short and so nothing in the domain has to know a
 * form exists.
 */
export interface Scenario {
  readonly floorsAbove: number;
  readonly basements: number;
  readonly floorHeight: number;
  readonly peoplePerFloor: number;
  readonly cars: number;
  readonly destinationEntry: boolean;
  readonly landingButtons: LandingButtons;
  readonly idlePolicy: IdlePolicy;
  readonly idleDelaySeconds: number;
  readonly pattern: TrafficPattern;
  readonly durationMinutes: number;
  readonly demandPercentPer5Min: number;
  readonly burstiness: number;
  readonly seeds: number;
  readonly dispatchers: readonly DispatcherName[];
  readonly car: CarSpec;
  /** How people behave, not how the lift does. See OBSERVED_BEHAVIOUR. */
  readonly opportunistShare: number;
  readonly stairsPatiencePerFloor: number;
  readonly stairsMaxFloors: number;
  readonly stairsAbleShare: number;
  readonly roundsPerHour: number;
  readonly roundStops: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  floorsAbove: 7,
  basements: 0,
  floorHeight: 2.8,
  peoplePerFloor: 6,
  cars: 1,
  destinationEntry: false,
  landingButtons: 'down-only',
  idlePolicy: 'stay-put',
  idleDelaySeconds: 30,
  pattern: 'residential-sparse',
  durationMinutes: 30,
  demandPercentPer5Min: 12,
  burstiness: 2,
  seeds: 30,
  dispatchers: DISPATCHER_NAMES,
  car: RESIDENTIAL_CAR,
  ...OBSERVED_BEHAVIOUR,
};

export function scenarioFromPreset(name: PresetName): Scenario {
  const preset = PRESETS[name];
  const above = preset.floors.filter((floor) => floor.id > 0);
  const below = preset.floors.filter((floor) => floor.id < 0);
  const first = preset.floors[0];
  const second = preset.floors[1];
  const height =
    first && second
      ? second.heightAboveGround - first.heightAboveGround
      : DEFAULT_SCENARIO.floorHeight;

  return {
    ...DEFAULT_SCENARIO,
    floorsAbove: above.length,
    basements: below.length,
    floorHeight: height,
    peoplePerFloor: above[0]?.population ?? DEFAULT_SCENARIO.peoplePerFloor,
    cars: preset.cars.length,
    destinationEntry: preset.destinationEntry,
    landingButtons: preset.landingButtons,
    idlePolicy: preset.idlePolicy,
    idleDelaySeconds: preset.idleDelaySeconds,
    car: preset.cars[0] ?? DEFAULT_SCENARIO.car,
    pattern: name === 'office-mid' || name === 'tower' ? 'up-peak' : 'residential-sparse',
  };
}

export function buildingConfigOf(scenario: Scenario): BuildingConfig {
  const floors = floorStack({
    from: -scenario.basements,
    to: scenario.floorsAbove,
    floorHeight: scenario.floorHeight,
    populationPerFloor: scenario.peoplePerFloor,
    entrances: scenario.basements > 0 ? [-scenario.basements, 0] : [0],
  });

  return {
    name: describe(scenario),
    floors,
    cars: Array.from({ length: scenario.cars }, () => scenario.car),
    destinationEntry: scenario.destinationEntry,
    landingButtons: scenario.landingButtons,
    idlePolicy: scenario.idlePolicy,
    idleDelaySeconds: scenario.idleDelaySeconds,
  };
}

export function trafficConfigOf(scenario: Scenario): TrafficConfig {
  return {
    pattern: scenario.pattern,
    durationSeconds: scenario.durationMinutes * 60,
    demandPercentPer5Min: scenario.demandPercentPer5Min,
    burstiness: scenario.burstiness,
    opportunistShare: scenario.opportunistShare,
    stairsPatiencePerFloor: scenario.stairsPatiencePerFloor,
    stairsMaxFloors: scenario.stairsMaxFloors,
    stairsAbleShare: scenario.stairsAbleShare,
    roundsPerHour: scenario.roundsPerHour,
    roundStops: scenario.roundStops,
  };
}

export function buildingOf(scenario: Scenario): Building {
  return Building.of(buildingConfigOf(scenario));
}

function describe(scenario: Scenario): string {
  const basements = scenario.basements > 0 ? ` + ${scenario.basements} basement` : '';
  const cars = scenario.cars === 1 ? '1 car' : `${scenario.cars} cars`;
  return `${scenario.floorsAbove} floors${basements}, ${cars}`;
}

const MIN_SEEDS = 2;
const MAX_SEEDS = 200;

/** Everything wrong with a scenario, worded for the person who typed it. */
export function validateScenario(scenario: Scenario): string[] {
  const problems = [
    ...validateBuilding(buildingConfigOf(scenario)),
    ...validateTraffic(trafficConfigOf(scenario)),
  ];

  if (scenario.floorsAbove < 1) {
    problems.push('A building needs at least one floor above the entrance.');
  }
  if (scenario.basements < 0) problems.push('The number of basements cannot be negative.');
  if (scenario.cars < 1) problems.push('There has to be at least one lift.');
  if (scenario.peoplePerFloor < 1) {
    problems.push('With nobody living on any floor there is no traffic to simulate.');
  }
  if (scenario.floorHeight <= 0) problems.push('Floor height must be greater than zero.');
  if (scenario.seeds < MIN_SEEDS) {
    problems.push(`Use at least ${MIN_SEEDS} seeds; one run proves nothing.`);
  }
  if (scenario.seeds > MAX_SEEDS) {
    problems.push(`${MAX_SEEDS} seeds is the ceiling, to keep the run inside a few seconds.`);
  }
  if (scenario.dispatchers.length < 2) {
    problems.push('Pick at least two algorithms; there is nothing to compare otherwise.');
  }
  if (scenario.durationMinutes <= 0) problems.push('The simulated period must be positive.');

  return problems;
}
