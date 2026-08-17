import type { FloorId } from '../config/BuildingConfig';
import type { CarView, DispatchContext, Dispatcher, HallCall } from '../ports/Dispatcher';
import { performanceTime } from '../sim/Kinematics';
import type { Passenger, PassengerStream } from '../traffic/PassengerStream';
import { callsFor, claimedByOthers } from './assignment';

/** Seconds a pre-positioned car must arrive *after* the passenger, so the landing is not empty. */
const PRE_POSITION_MARGIN = 2;

/**
 * An offline reference, not a competitor: this one is handed the passenger stream and may look at
 * arrivals that have not happened yet. No real controller can do that, which is exactly the point
 * — the gap between it and the online algorithms is what foresight is worth.
 *
 * It is NOT a proven optimum and must never be presented as one. It is a clairvoyant heuristic:
 * a lower bound for multi-car lift scheduling is a research problem in its own right, and a weak
 * bound would mislead more than it informs. The provable bound this project does offer is the
 * unavoidable journey time in IdealJourney.ts.
 *
 * It only pre-positions for somebody who will already be standing there when it arrives, so
 * foresight never turns into a door cycle opened for nobody.
 */
export function clairvoyantOf(stream: PassengerStream, horizonSeconds = 120): Dispatcher {
  const byTime = [...stream.passengers].sort((a, b) => a.arrivalTime - b.arrivalTime);

  const upcoming = (now: number): Passenger[] =>
    byTime.filter(
      (passenger) => passenger.arrivalTime > now && passenger.arrivalTime <= now + horizonSeconds,
    );

  return {
    name: 'clairvoyant',

    nextStop(car, context) {
      const calls = car.onboard >= car.capacity ? [] : callsFor(car, context);
      const future = car.onboard >= car.capacity ? [] : upcoming(context.now);

      // Pre-position only where the passenger will certainly be standing when the car arrives,
      // and only to a floor no other car has taken. Without both, foresight turns into a door
      // cycle opened for somebody another car already collected.
      const claimed = claimedByOthers(car, context);
      const reachable = future.filter(
        (passenger) =>
          !claimed.has(passenger.origin) &&
          passenger.arrivalTime + PRE_POSITION_MARGIN <=
            context.now + travel(car.floor, passenger.origin, context),
      );

      const candidates = [
        ...new Set([
          ...car.carCalls,
          ...calls.map((call) => call.floor),
          ...reachable.map((passenger) => passenger.origin),
        ]),
      ];
      if (candidates.length === 0) return null;

      return candidates.reduce((best, candidate) =>
        cost(candidate, car, context, calls, future) < cost(best, car, context, calls, future)
          ? candidate
          : best,
      );
    },

    boardingDirection: () => 'any',
  };
}

function cost(
  candidate: FloorId,
  car: CarView,
  context: DispatchContext,
  calls: readonly HallCall[],
  future: readonly Passenger[],
): number {
  const reach = travel(car.floor, candidate, context);

  const waitingNow = calls.reduce((sum, call) => {
    const beyond = call.floor === candidate ? 0 : travel(candidate, call.floor, context);
    return sum + call.waiting * (Math.max(0, context.now - call.since) + reach + beyond);
  }, 0);

  const waitingSoon = future.reduce((sum, passenger) => {
    const beyond =
      passenger.origin === candidate ? 0 : travel(candidate, passenger.origin, context);
    const servedAt = context.now + reach + beyond;
    return sum + Math.max(0, servedAt - passenger.arrivalTime);
  }, 0);

  const riding = car.carCalls.reduce((sum, floor) => {
    const beyond = floor === candidate ? 0 : travel(candidate, floor, context);
    return sum + reach + beyond;
  }, 0);

  return waitingNow + waitingSoon + riding;
}

function travel(from: FloorId, to: FloorId, context: DispatchContext): number {
  if (from === to) return 0;
  const car = context.building.cars[0];
  return car ? performanceTime(context.building.gap(from, to), car) : 0;
}
