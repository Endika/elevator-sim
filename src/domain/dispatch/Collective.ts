import type { FloorId } from '../config/BuildingConfig';
import type {
  CarView,
  Direction,
  DispatchContext,
  Dispatcher,
  HallCall,
} from '../ports/Dispatcher';
import { callsFor } from './assignment';

/**
 * Full collective control, the SCAN/LOOK of lifts and what most single-car installations run.
 * The car sweeps in one direction serving everything on the way, then reverses.
 *
 * The behaviour people complain about is deliberate: travelling up, it passes a landing where
 * somebody is waiting to go down. That is not a fault, it is the algorithm. Crucially it does not
 * *stop* there either — it takes that call on the way back, or as its reversal point.
 */
export const collective: Dispatcher = {
  name: 'collective',

  nextStop(car, context) {
    const { heading, calls, carCalls } = survey(car, context);

    const onward = [
      ...carCalls.filter((floor) => isAhead(floor, car.floor, heading)),
      ...floorsOf(calls, heading, (call) => isAhead(call.floor, car.floor, heading)),
    ];
    if (onward.length > 0) return nearest(onward, heading);

    // Nothing left to serve this way, so the furthest opposite call ahead becomes the reversal
    // point: the classic sweep to the end of the shaft before turning round.
    const reversal = floorsOf(calls, opposite(heading), (call) =>
      isAhead(call.floor, car.floor, heading),
    );
    if (reversal.length > 0) return furthest(reversal, heading);

    if (calls.some((call) => call.floor === car.floor)) return car.floor;

    const behind = [
      ...carCalls.filter((floor) => isAhead(floor, car.floor, opposite(heading))),
      ...calls
        .filter((call) => isAhead(call.floor, car.floor, opposite(heading)))
        .map((call) => call.floor),
    ];
    return behind.length > 0 ? nearest(behind, opposite(heading)) : null;
  },

  boardingDirection(car, context) {
    const { heading, calls, carCalls } = survey(car, context);

    const continues =
      carCalls.some((floor) => isAhead(floor, car.floor, heading)) ||
      floorsOf(calls, heading, (call) => isAhead(call.floor, car.floor, heading)).length > 0;
    if (continues) return heading;

    const waitingHere = new Set(
      calls.filter((call) => call.floor === car.floor).map((call) => call.direction),
    );
    return waitingHere.has(heading) ? heading : opposite(heading);
  },
};

interface Survey {
  readonly heading: Direction;
  /** Landing calls this car can answer; empty once it is full, since it can take nobody. */
  readonly calls: readonly HallCall[];
  readonly carCalls: readonly FloorId[];
}

function survey(car: CarView, context: DispatchContext): Survey {
  const calls = car.onboard >= car.capacity ? [] : callsFor(car, context);
  const stops = [...car.carCalls, ...calls.map((call) => call.floor)];
  return { heading: headingOf(car, stops), calls, carCalls: car.carCalls };
}

/** The committed direction, or — for a car with none — whichever way the nearest work lies. */
function headingOf(car: CarView, stops: readonly FloorId[]): Direction {
  if (car.direction) return car.direction;
  const closest = [...stops].sort(
    (a, b) => Math.abs(a - car.floor) - Math.abs(b - car.floor) || a - b,
  )[0];
  return closest !== undefined && closest < car.floor ? 'down' : 'up';
}

function floorsOf(
  calls: readonly HallCall[],
  direction: Direction,
  where: (call: HallCall) => boolean,
): FloorId[] {
  return calls.filter((call) => call.direction === direction && where(call)).map((c) => c.floor);
}

function isAhead(floor: FloorId, from: FloorId, direction: Direction): boolean {
  return direction === 'up' ? floor > from : floor < from;
}

function nearest(floors: readonly FloorId[], direction: Direction): FloorId {
  return direction === 'up' ? Math.min(...floors) : Math.max(...floors);
}

function furthest(floors: readonly FloorId[], direction: Direction): FloorId {
  return direction === 'up' ? Math.max(...floors) : Math.min(...floors);
}

function opposite(direction: Direction): Direction {
  return direction === 'up' ? 'down' : 'up';
}
