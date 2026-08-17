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
}

export interface PassengerStream {
  readonly seed: number;
  readonly building: string;
  readonly pattern: string;
  readonly durationSeconds: number;
  readonly passengers: readonly Passenger[];
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
