/**
 * A building, described entirely by data. Changing floors, cars or population must never
 * require touching code — that is an acceptance criterion, not a preference.
 */

/** Signed floor index: 0 is ground, negatives are basements. Ordered, contiguous not required. */
export type FloorId = number;

export interface Floor {
  readonly id: FloorId;
  /** What the button says: 'B2', 'G', '7'. */
  readonly label: string;
  /** Metres relative to ground. Negative below it. */
  readonly heightAboveGround: number;
  /** People who live or work on this floor. */
  readonly population: number;
  /** Floors people enter the building through: street door, garage. */
  readonly isEntrance: boolean;
}

/**
 * Car kinematics and door timings. Every field is seconds or SI, never a magic multiplier.
 * Sourced values and estimates are separated in PhysicsDefaults.
 */
export interface CarSpec {
  /** Persons. */
  readonly capacity: number;
  /** Rated speed, m/s. */
  readonly ratedSpeed: number;
  /** m/s². */
  readonly acceleration: number;
  /** m/s³. */
  readonly jerk: number;
  /** Seconds from doors starting to open until fully open. */
  readonly doorOpenTime: number;
  /** Seconds to close. */
  readonly doorCloseTime: number;
  /** Seconds the doors are held open once transfer is done. */
  readonly doorDwellTime: number;
  /** Seconds between doors fully closed and the car starting to move. */
  readonly startDelay: number;
  /** Seconds lost arriving at the floor before the doors may open. */
  readonly levellingDelay: number;
  /**
   * Seconds of door opening that overlap the end of the trip. Subtracted from performance
   * time, so it can never exceed the opening itself.
   */
  readonly advanceDoorOpenTime: number;
  /** Seconds per passenger, each way. */
  readonly passengerTransferTime: number;
}

/** What the car does once nobody is calling it. Crossable with any dispatch algorithm. */
export type IdlePolicy = 'stay-put' | 'return-to-entrance' | 'park-at-busiest' | 'park-at-middle';

export const IDLE_POLICIES: readonly IdlePolicy[] = [
  'stay-put',
  'return-to-entrance',
  'park-at-busiest',
  'park-at-middle',
];

export interface BuildingConfig {
  readonly name: string;
  readonly floors: readonly Floor[];
  readonly cars: readonly CarSpec[];
  /** True when passengers enter their destination in the lobby instead of pressing up/down. */
  readonly destinationEntry: boolean;
  readonly idlePolicy: IdlePolicy;
  /** Seconds of inactivity before the idle policy acts. */
  readonly idleDelaySeconds: number;
}

export function totalPopulation(building: BuildingConfig): number {
  return building.floors.reduce((sum, floor) => sum + floor.population, 0);
}

export function entranceFloors(building: BuildingConfig): readonly Floor[] {
  return building.floors.filter((floor) => floor.isEntrance);
}

/**
 * Human-readable problems with a config, empty when it is usable. Messages are written for a
 * person filling in a form, not for a parser.
 */
export function validateBuilding(building: BuildingConfig): string[] {
  return [
    ...validateFloors(building.floors),
    ...building.cars.flatMap((car, index) => validateCar(car, index)),
    ...validateCarCount(building.cars.length),
    ...validateIdle(building),
  ];
}

export function parseBuilding(building: BuildingConfig): BuildingConfig {
  const problems = validateBuilding(building);
  if (problems.length > 0) {
    throw new Error(`Building "${building.name}" is not usable:\n- ${problems.join('\n- ')}`);
  }
  return building;
}

function validateFloors(floors: readonly Floor[]): string[] {
  const problems: string[] = [];

  if (floors.length < 2) {
    problems.push(`A building needs at least 2 floors to have a lift; got ${floors.length}.`);
    return problems;
  }

  for (let i = 1; i < floors.length; i += 1) {
    const previous = floors[i - 1];
    const current = floors[i];
    if (!previous || !current) continue;
    if (current.id <= previous.id) {
      problems.push(
        `Floors must be listed bottom to top: "${current.label}" (id ${current.id}) comes after ` +
          `"${previous.label}" (id ${previous.id}).`,
      );
    }
    if (current.heightAboveGround <= previous.heightAboveGround) {
      problems.push(
        `Floor "${current.label}" is at ${current.heightAboveGround} m, not above ` +
          `"${previous.label}" at ${previous.heightAboveGround} m.`,
      );
    }
  }

  const labels = new Set<string>();
  for (const floor of floors) {
    if (labels.has(floor.label)) {
      problems.push(`Two floors are both labelled "${floor.label}".`);
    }
    labels.add(floor.label);

    if (!Number.isInteger(floor.population) || floor.population < 0) {
      problems.push(
        `Floor "${floor.label}" has a population of ${floor.population}; it must be a whole ` +
          'number of people, zero or more.',
      );
    }
  }

  if (!floors.some((floor) => floor.isEntrance)) {
    problems.push('No floor is marked as an entrance, so nobody can get into the building.');
  }

  const population = floors.reduce((sum, floor) => sum + floor.population, 0);
  if (population <= 0) {
    problems.push('Total population is zero, so there would be nobody to carry.');
  }

  return problems;
}

function validateCarCount(count: number): string[] {
  return count < 1 ? ['The building has no lift cars.'] : [];
}

function validateCar(car: CarSpec, index: number): string[] {
  const problems: string[] = [];
  const label = `Car ${index + 1}`;

  if (!Number.isInteger(car.capacity) || car.capacity < 1) {
    problems.push(`${label} has a capacity of ${car.capacity}; it must hold at least 1 person.`);
  }

  const positives: ReadonlyArray<[string, number]> = [
    ['rated speed', car.ratedSpeed],
    ['acceleration', car.acceleration],
    ['jerk', car.jerk],
    ['passenger transfer time', car.passengerTransferTime],
  ];
  for (const [name, value] of positives) {
    if (!(value > 0) || !Number.isFinite(value)) {
      problems.push(`${label} has a ${name} of ${value}; it must be greater than zero.`);
    }
  }

  const nonNegatives: ReadonlyArray<[string, number]> = [
    ['door opening time', car.doorOpenTime],
    ['door closing time', car.doorCloseTime],
    ['door dwell time', car.doorDwellTime],
    ['start delay', car.startDelay],
    ['levelling delay', car.levellingDelay],
    ['advance door opening time', car.advanceDoorOpenTime],
  ];
  for (const [name, value] of nonNegatives) {
    if (value < 0 || !Number.isFinite(value)) {
      problems.push(`${label} has a ${name} of ${value}; it cannot be negative.`);
    }
  }

  if (car.advanceDoorOpenTime > car.doorOpenTime) {
    problems.push(
      `${label} opens its doors early by ${car.advanceDoorOpenTime} s but only takes ` +
        `${car.doorOpenTime} s to open them; the head start cannot exceed the opening.`,
    );
  }

  return problems;
}

function validateIdle(building: BuildingConfig): string[] {
  const problems: string[] = [];

  if (building.idleDelaySeconds < 0 || !Number.isFinite(building.idleDelaySeconds)) {
    problems.push(`The idle delay is ${building.idleDelaySeconds} s; it cannot be negative.`);
  }

  if (!IDLE_POLICIES.includes(building.idlePolicy)) {
    problems.push(
      `"${building.idlePolicy}" is not an idle policy. Pick one of: ${IDLE_POLICIES.join(', ')}.`,
    );
  }

  return problems;
}
