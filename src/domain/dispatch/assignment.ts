import type { FloorId } from '../config/BuildingConfig';
import type { CarView, DispatchContext, HallCall } from '../ports/Dispatcher';

/** Floors other cars have already taken responsibility for. */
export function claimedByOthers(car: CarView, context: DispatchContext): ReadonlySet<FloorId> {
  return new Set(context.cars.filter((other) => other.index !== car.index).flatMap(claimOf));
}

/**
 * Which hall calls this car owns. Shared by every algorithm so they differ only in how they order
 * their own stops, never in how work is shared out. A floor another car has claimed is off the
 * table — without that, two cars chase one call and the second arrives to an empty landing.
 */
export function callsFor(car: CarView, context: DispatchContext): readonly HallCall[] {
  const claimed = claimedByOthers(car, context);

  // A full car is no candidate: it cannot pick anybody up, and letting it hold a call means the
  // call is never handed to a car that could. The asking car counts even mid-door-cycle, since
  // boardingDirection is asked while its activity is 'doors' and a car blind to the calls at its
  // own floor opens for nobody.
  const candidates = context.cars.filter(
    (other) =>
      other.spaceUsed < other.capacity && (other.index === car.index || other.activity === 'idle'),
  );

  // A car with a place and a half free is no use to somebody with a pram: answering that call
  // would mean opening the doors for nobody.
  const room = car.capacity - car.spaceUsed;

  return context.hallCalls.filter(
    (call) =>
      call.smallestSpace <= room &&
      !claimed.has(call.floor) &&
      nearestCarTo(call.floor, candidates) === car.index,
  );
}

/**
 * The floor a car has already taken responsibility for: where it is heading while serving, or
 * where it stands with its doors open. Without the second case two cars open at the same landing
 * and the slower one finds it empty. A parking car claims nothing — it is not serving anyone.
 */
function claimOf(car: CarView): FloorId[] {
  if (car.activity === 'moving' && car.target !== null) return [car.target];
  if (car.activity === 'doors') return [car.floor];
  return [];
}

function nearestCarTo(floor: FloorId, cars: readonly CarView[]): number | null {
  return (
    [...cars].sort(
      (a, b) => Math.abs(a.floor - floor) - Math.abs(b.floor - floor) || a.index - b.index,
    )[0]?.index ?? null
  );
}

/** Floors this car has to visit: its passengers' destinations plus the calls it owns. */
export function stopsFor(car: CarView, context: DispatchContext): readonly FloorId[] {
  return [...new Set([...car.carCalls, ...callsFor(car, context).map((call) => call.floor)])];
}
