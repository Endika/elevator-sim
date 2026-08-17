import type { FloorId } from '../config/BuildingConfig';
import type { CarView, DispatchContext, Dispatcher, HallCall } from '../ports/Dispatcher';
import { performanceTime } from '../sim/Kinematics';
import { callsFor } from './assignment';

/**
 * Estimated-cost dispatch, the family modern controllers belong to. Instead of asking which stop
 * is nearest, it asks which stop leaves everybody waiting least — so it accounts for how many
 * people are behind a call and how long they have already stood there.
 *
 * One step of lookahead, not a full schedule search: enough to behave differently from
 * nearest-car in exactly the way the real thing does, without pretending to be optimal. The
 * offline bound is what measures how far short it falls.
 */
export const etd: Dispatcher = {
  name: 'etd',

  nextStop(car, context) {
    const calls = car.onboard >= car.capacity ? [] : callsFor(car, context);
    const candidates = [...new Set([...car.carCalls, ...calls.map((call) => call.floor)])];
    if (candidates.length === 0) return null;

    return candidates.reduce((best, candidate) =>
      costOf(candidate, car, context, calls) < costOf(best, car, context, calls) ? candidate : best,
    );
  },

  /** Once committed to a stop it clears whichever direction the waiting cost is higher. */
  boardingDirection(car, context) {
    const here = callsFor(car, context).filter((call) => call.floor === car.floor);
    if (here.length === 0) return 'any';

    const weight = (direction: 'up' | 'down'): number =>
      here
        .filter((call) => call.direction === direction)
        .reduce((sum, call) => sum + call.waiting * (context.now - call.since + 1), 0);

    const up = weight('up');
    const down = weight('down');
    if (up === 0 || down === 0) return 'any';
    return up >= down ? 'up' : 'down';
  },
};

/**
 * Total waiting cost if this car goes to `candidate` next: everybody already waiting keeps
 * waiting while it travels there, and those not at that floor wait for the hop beyond it too.
 */
function costOf(
  candidate: FloorId,
  car: CarView,
  context: DispatchContext,
  calls: readonly HallCall[],
): number {
  const reach = travel(car.floor, candidate, context);

  const landingCost = calls.reduce((sum, call) => {
    const age = Math.max(0, context.now - call.since);
    const beyond = call.floor === candidate ? 0 : travel(candidate, call.floor, context);
    return sum + call.waiting * (age + reach + beyond);
  }, 0);

  // Passengers already aboard are kept waiting too, and they cannot be left for another car.
  const rideCost = car.carCalls.reduce((sum, floor) => {
    const beyond = floor === candidate ? 0 : travel(candidate, floor, context);
    return sum + reach + beyond;
  }, 0);

  return landingCost + rideCost;
}

function travel(from: FloorId, to: FloorId, context: DispatchContext): number {
  if (from === to) return 0;
  const car = context.building.cars[0];
  if (!car) return 0;
  return performanceTime(context.building.gap(from, to), car);
}
