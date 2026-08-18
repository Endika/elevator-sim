import type { Building } from '../building/Building';
import type { Floor, FloorId } from '../config/BuildingConfig';
import type { TrafficPattern } from '../config/TrafficConfig';
import type { Prng } from '../random/Prng';

export type TripKind = 'up' | 'down' | 'interfloor';

export interface Trip {
  readonly kind: TripKind;
  readonly origin: FloorId;
  readonly destination: FloorId;
}

/**
 * DECLARED ASSUMPTIONS, not sourced figures. Both are balanced up and down; what separates them is
 * how much traffic never touches the entrance.
 *
 * In a block of flats that share is close to nothing, from watching one: you come in from the
 * street or the garage and go up to your floor, or you come down from your floor and leave.
 * Somebody riding from the second to the fourth is a rarity. Crossing between floors is an office
 * habit, and mostly a lunchtime one.
 */
const MIXES: Record<'lunch' | 'residential-sparse', Record<TripKind, number>> = {
  lunch: { up: 0.4, down: 0.4, interfloor: 0.2 },
  // No random interfloor at all: in a block of flats that traffic is not neighbours visiting each
  // other, it is the concierge and the courier doing rounds, and rounds are generated separately.
  'residential-sparse': { up: 0.5, down: 0.5, interfloor: 0 },
};

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
 * The peaks are deliberately pure — every trip starts or ends at an entrance, with no interfloor
 * share. The closed-form handling-capacity check in T7 assumes pure up-peak, and that is what
 * makes the comparison meaningful. Realistic mixes live in `lunch` and `residential-sparse`.
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

export function drawOrigin(building: Building, kind: TripKind, prng: Prng): FloorId {
  if (kind === 'up') return pickUniform(building.entrances, prng, 'entrance');
  return pickByPopulation(building.occupied, prng);
}

/** Never the origin: the candidate list excludes it, so no passenger is dropped afterwards. */
export function drawDestination(
  building: Building,
  kind: TripKind,
  origin: FloorId,
  prng: Prng,
): FloorId {
  if (kind === 'down') {
    const options = building.entrances.filter((floor) => floor.id !== origin);
    return pickUniform(options, prng, 'entrance other than the origin');
  }
  return pickByPopulation(
    building.occupied.filter((floor) => floor.id !== origin),
    prng,
  );
}

export function drawTrip(building: Building, pattern: TrafficPattern, prng: Prng): Trip {
  const kind = drawTripKind(pattern, prng);
  const origin = drawOrigin(building, kind, prng);
  return { kind, origin, destination: drawDestination(building, kind, origin, prng) };
}

export function patternIsPossible(building: Building, pattern: TrafficPattern): string[] {
  const problems: string[] = [];

  if (building.entrances.length === 0) {
    problems.push('The building has no entrance floor, so nobody can arrive.');
  }

  if (building.occupied.length === 0) {
    problems.push('No floor has any population, so there are no journeys to make.');
    return problems;
  }

  const needsTwoOccupied = pattern !== 'up-peak' && pattern !== 'down-peak';
  if (needsTwoOccupied && building.occupied.length < 2) {
    problems.push(
      `"${pattern}" traffic moves people between occupied floors, but only ` +
        `${building.occupied.length} floor has anybody on it.`,
    );
  }

  if (building.occupied.every((floor) => floor.isEntrance) && building.entrances.length === 1) {
    problems.push(
      'The only populated floor is the only entrance, so there is no journey to simulate.',
    );
  }

  return problems;
}
