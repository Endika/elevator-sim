import type { Dispatcher } from '../ports/Dispatcher';
import { stopsFor } from './assignment';

/**
 * Always the closest pending stop. Cheap to implement and intuitively appealing, which is why it
 * turns up in real installations — and it is the algorithm expected to starve the top and bottom
 * floors, since a call far away never becomes the nearest one while nearer traffic keeps arriving.
 */
export const nearestCar: Dispatcher = {
  name: 'nearest-car',

  nextStop(car, context) {
    return (
      [...stopsFor(car, context)].sort(
        (a, b) => Math.abs(a - car.floor) - Math.abs(b - car.floor) || a - b,
      )[0] ?? null
    );
  },

  boardingDirection: () => 'any',
};
