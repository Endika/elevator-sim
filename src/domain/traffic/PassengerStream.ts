import type { Building } from '../building/Building';
import type { FloorId } from '../config/BuildingConfig';
import type { TrafficConfig } from '../config/TrafficConfig';
import { validateTraffic } from '../config/TrafficConfig';
import { createPrng, deriveSeed } from '../random/Prng';
import { drawDestination, drawOrigin, drawTripKind, patternIsPossible } from './patterns';

export interface Passenger {
  readonly id: number;
  readonly arrivalTime: number;
  readonly origin: FloorId;
  readonly destination: FloorId;
  /**
   * Will squeeze into a car going the wrong way rather than wait for it to come back, because by
   * then there is often no room.
   */
  readonly boardsAnyDirection: boolean;
  /**
   * Could physically take the stairs. False for the pram, the shopping, the delivery round and
   * the crutches — for them the lift is not a preference, and they wait however long it takes.
   */
  readonly canUseStairs: boolean;
  /**
   * Seconds they will wait before giving up and walking, or null if they never will. Worked out
   * here rather than in the engine so it is a property of the person, identical for every
   * algorithm being compared.
   */
  readonly patienceSeconds: number | null;
}

export interface PassengerStream {
  readonly seed: number;
  readonly building: string;
  readonly pattern: string;
  readonly durationSeconds: number;
  readonly passengers: readonly Passenger[];
}

/**
 * Walking down is easier than walking up, so a descent counts as half the effort. Not a form knob:
 * one embedded, stated constant beats a fifth slider nobody would know how to set.
 */
const DOWNWARD_EFFORT = 0.5;

/**
 * How long somebody waits before walking, and whether they can at all.
 *
 * Patience grows with the climb — you hang on longer for five floors than for one — and beyond the
 * configured reach nobody walks at all, however long the wait. That is the rule that keeps the
 * person on the fifth floor waiting for the lift no matter what.
 */
export function stairsDecisionFor(
  able: boolean,
  origin: FloorId,
  destination: FloorId,
  traffic: TrafficConfig,
): { canUseStairs: boolean; patienceSeconds: number | null } {
  const floors = Math.abs(destination - origin);
  const effort = floors * (destination < origin ? DOWNWARD_EFFORT : 1);
  const willWalk =
    able && traffic.stairsPatiencePerFloor > 0 && floors > 0 && effort <= traffic.stairsMaxFloors;
  return {
    canUseStairs: able,
    patienceSeconds: willWalk ? traffic.stairsPatiencePerFloor * effort : null,
  };
}

/** Geometric with mean `burstiness`, so raising it clumps arrivals without adding demand. */
function drawGroupSize(burstiness: number, uniform: number): number {
  if (burstiness <= 1) return 1;
  const p = 1 / burstiness;
  return 1 + Math.floor(Math.log(1 - uniform) / Math.log(1 - p));
}

/**
 * Generated once per (building, traffic, seed) and handed frozen to every algorithm, so all of
 * them face an identical morning. Takes no dispatcher, by design: nothing being measured can
 * influence its own demand.
 */
export function generateStream(
  building: Building,
  traffic: TrafficConfig,
  seed: number,
): PassengerStream {
  const problems = [...validateTraffic(traffic), ...patternIsPossible(building, traffic.pattern)];
  if (problems.length > 0) {
    throw new Error(`Cannot generate traffic:\n- ${problems.join('\n- ')}`);
  }

  const passengersPerSecond = (building.totalPopulation * traffic.demandPercentPer5Min) / 100 / 300;
  const groupsPerSecond = passengersPerSecond / traffic.burstiness;
  const prng = createPrng(deriveSeed(seed, 'passenger-stream'));

  const passengers: Passenger[] = [];
  let time = prng.nextExponentialGap(groupsPerSecond);
  let nextId = 1;

  while (time < traffic.durationSeconds) {
    const size = drawGroupSize(traffic.burstiness, prng.nextFloat());
    const kind = drawTripKind(traffic.pattern, prng);
    const origin = drawOrigin(building, kind, prng);

    for (let member = 0; member < size; member += 1) {
      const destination = drawDestination(building, kind, origin, prng);
      // Drawn here, in the stream, so every algorithm faces the same people behaving the same way.
      // Deciding it inside the engine would let the dispatcher influence its own demand.
      passengers.push(
        Object.freeze({
          id: nextId,
          arrivalTime: time,
          origin,
          destination,
          boardsAnyDirection: prng.nextFloat() < traffic.opportunistShare,
          ...stairsDecisionFor(
            prng.nextFloat() < traffic.stairsAbleShare,
            origin,
            destination,
            traffic,
          ),
        }),
      );
      nextId += 1;
    }

    time += prng.nextExponentialGap(groupsPerSecond);
  }

  return Object.freeze({
    seed,
    building: building.name,
    pattern: traffic.pattern,
    durationSeconds: traffic.durationSeconds,
    passengers: Object.freeze(passengers),
  });
}
