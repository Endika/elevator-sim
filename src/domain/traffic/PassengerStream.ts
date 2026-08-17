/**
 * The passenger stream: who wants to go where, and when.
 *
 * This is the keystone of the whole method. For a given (building, traffic, seed) the stream is
 * generated **once**, before any simulation runs, and the same frozen value is handed to every
 * dispatch algorithm. Comparisons are therefore paired — the algorithms face an identical
 * morning, not two independent samples of one.
 *
 * The guarantee is structural, not a convention to remember: the generator takes no algorithm,
 * and the result is deeply frozen, so a dispatcher cannot alter the demand it is being judged on
 * even by accident.
 */

import type { BuildingConfig, FloorId } from '../config/BuildingConfig';
import { totalPopulation } from '../config/BuildingConfig';
import type { TrafficConfig } from '../config/TrafficConfig';
import { validateTraffic } from '../config/TrafficConfig';
import { createPrng, deriveSeed } from '../random/Prng';
import { drawDestination, drawOrigin, drawTripKind, patternIsPossible } from './patterns';

export interface Passenger {
  readonly id: number;
  /** Seconds from the start of the simulated period. */
  readonly arrivalTime: number;
  readonly origin: FloorId;
  readonly destination: FloorId;
}

export interface PassengerStream {
  readonly seed: number;
  readonly building: string;
  readonly pattern: string;
  readonly durationSeconds: number;
  readonly passengers: readonly Passenger[];
}

/**
 * Mean group size when burstiness is 1: exactly one. Groups arrive together — a family leaving
 * the flat presses the button once — so members share an origin but each picks their own
 * destination.
 */
function drawGroupSize(burstiness: number, uniform: number): number {
  if (burstiness <= 1) return 1;
  // Geometric with mean `burstiness`: p = 1 / burstiness, size = 1 + Geometric0(p).
  const p = 1 / burstiness;
  return 1 + Math.floor(Math.log(1 - uniform) / Math.log(1 - p));
}

export function generateStream(
  building: BuildingConfig,
  traffic: TrafficConfig,
  seed: number,
): PassengerStream {
  const problems = [...validateTraffic(traffic), ...patternIsPossible(building, traffic.pattern)];
  if (problems.length > 0) {
    throw new Error(`Cannot generate traffic:\n- ${problems.join('\n- ')}`);
  }

  const population = totalPopulation(building);
  // Demand is given as a percentage of the population per five minutes; convert to a rate.
  const passengersPerSecond = (population * traffic.demandPercentPer5Min) / 100 / 300;
  // Groups arrive less often than individuals, by exactly the mean group size, so the total
  // expected demand is unchanged by burstiness. That is what makes burstiness a pure
  // clumping knob rather than a hidden intensity knob.
  const groupsPerSecond = passengersPerSecond / traffic.burstiness;

  // A dedicated sub-stream, so anything else that wants randomness later cannot shift the
  // demand out from under a comparison.
  const prng = createPrng(deriveSeed(seed, 'passenger-stream'));

  const passengers: Passenger[] = [];
  let time = prng.nextExponentialGap(groupsPerSecond);
  let nextId = 1;

  while (time < traffic.durationSeconds) {
    const size = drawGroupSize(traffic.burstiness, prng.nextFloat());
    // A group shares a kind of journey and a starting floor — they came out of the same door
    // together — but each member picks their own destination.
    const kind = drawTripKind(traffic.pattern, prng);
    const origin = drawOrigin(building, kind, prng);

    for (let member = 0; member < size; member += 1) {
      passengers.push(
        Object.freeze({
          id: nextId,
          arrivalTime: time,
          origin,
          destination: drawDestination(building, kind, origin, prng),
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
