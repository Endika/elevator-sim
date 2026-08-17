/**
 * Where passengers come from and where they are going, per traffic pattern.
 *
 * These are modelling choices, and the ones that are choices rather than convention are marked
 * as such. Getting them wrong biases every comparison, so they are stated here in one place
 * instead of being spread through the generator.
 */

import type { BuildingConfig, Floor, FloorId } from '../config/BuildingConfig';
import type { TrafficPattern } from '../config/TrafficConfig';
import type { Prng } from '../random/Prng';

/** Up means entrance to an occupied floor; down the reverse; interfloor stays upstairs. */
export type TripKind = 'up' | 'down' | 'interfloor';

export interface Trip {
  readonly kind: TripKind;
  readonly origin: FloorId;
  readonly destination: FloorId;
}

/**
 * Share of trips by kind for the mixed patterns. DECLARED ASSUMPTION, not a sourced figure:
 * both lunch and residential traffic are treated as balanced up and down with a slice of
 * interfloor. Kept as data so it can be argued with, and so a reader can see it is an assumption
 * rather than a measurement.
 */
const MIXES: Record<'lunch' | 'residential-sparse', Record<TripKind, number>> = {
  lunch: { up: 0.45, down: 0.45, interfloor: 0.1 },
  // People in a block of flats rarely visit each other by lift.
  'residential-sparse': { up: 0.45, down: 0.45, interfloor: 0.1 },
};

function entrances(building: BuildingConfig): readonly Floor[] {
  return building.floors.filter((floor) => floor.isEntrance);
}

function occupied(building: BuildingConfig): readonly Floor[] {
  return building.floors.filter((floor) => floor.population > 0);
}

function pickUniform(options: readonly Floor[], prng: Prng, what: string): FloorId {
  if (options.length === 0) throw new Error(`No ${what} available to pick.`);
  const floor = options[prng.nextInt(0, options.length)];
  if (!floor) throw new Error(`Uniform choice fell off the end of the ${what} list.`);
  return floor.id;
}

function pickByPopulation(options: readonly Floor[], prng: Prng): FloorId {
  if (options.length === 0) throw new Error('No occupied floor available to pick.');
  const floor = options[prng.nextWeightedIndex(options.map((f) => f.population))];
  if (!floor) throw new Error('Weighted choice fell off the end of the floor list.');
  return floor.id;
}

/**
 * `up-peak` and `down-peak` are deliberately *pure*: every trip starts at an entrance, or ends
 * at one, with no interfloor share mixed in. Real morning traffic has a small interfloor
 * component, but the closed-form handling-capacity result that validates this simulator in T7
 * assumes pure up-peak, and keeping the pattern pure is what makes that comparison meaningful.
 * The realistic mixes live in `lunch` and `residential-sparse`.
 */
export function drawTripKind(pattern: TrafficPattern, prng: Prng): TripKind {
  switch (pattern) {
    case 'up-peak':
      return 'up';
    case 'down-peak':
      return 'down';
    case 'interfloor':
      return 'interfloor';
    case 'lunch':
    case 'residential-sparse': {
      const mix = MIXES[pattern];
      const draw = prng.nextFloat();
      if (draw < mix.up) return 'up';
      if (draw < mix.up + mix.down) return 'down';
      return 'interfloor';
    }
  }
}

export function drawOrigin(building: BuildingConfig, kind: TripKind, prng: Prng): FloorId {
  if (kind === 'up') return pickUniform(entrances(building), prng, 'entrance');
  return pickByPopulation(occupied(building), prng);
}

/**
 * Always returns a floor different from the origin. Not a filter applied afterwards — the
 * candidate list excludes the origin before drawing, so no passenger is ever silently dropped
 * for wanting to travel nowhere.
 */
export function drawDestination(
  building: BuildingConfig,
  kind: TripKind,
  origin: FloorId,
  prng: Prng,
): FloorId {
  if (kind === 'down') {
    const options = entrances(building).filter((floor) => floor.id !== origin);
    return pickUniform(options, prng, 'entrance other than the origin');
  }
  const options = occupied(building).filter((floor) => floor.id !== origin);
  return pickByPopulation(options, prng);
}

export function drawTrip(building: BuildingConfig, pattern: TrafficPattern, prng: Prng): Trip {
  const kind = drawTripKind(pattern, prng);
  const origin = drawOrigin(building, kind, prng);
  return { kind, origin, destination: drawDestination(building, kind, origin, prng) };
}

/** Whether a pattern can produce any journey at all in this building. */
export function patternIsPossible(building: BuildingConfig, pattern: TrafficPattern): string[] {
  const problems: string[] = [];
  const entranceFloors = entrances(building);
  const occupiedFloors = occupied(building);

  if (entranceFloors.length === 0) {
    problems.push('The building has no entrance floor, so nobody can arrive.');
  }

  if (occupiedFloors.length === 0) {
    problems.push('No floor has any population, so there are no journeys to make.');
    return problems;
  }

  // Every pattern with an interfloor share needs two occupied floors, not just the pure one.
  const needsTwoOccupied =
    pattern === 'interfloor' || pattern === 'lunch' || pattern === 'residential-sparse';
  if (needsTwoOccupied && occupiedFloors.length < 2) {
    problems.push(
      `"${pattern}" traffic moves people between occupied floors, but only ` +
        `${occupiedFloors.length} floor has anybody on it.`,
    );
  }

  // The pathological case: everyone lives on the only way in, so there is nowhere to go.
  const everyoneLivesAtTheDoor = occupiedFloors.every((floor) => floor.isEntrance);
  if (everyoneLivesAtTheDoor && entranceFloors.length === 1) {
    problems.push(
      'The only populated floor is the only entrance, so there is no journey to simulate.',
    );
  }

  return problems;
}
