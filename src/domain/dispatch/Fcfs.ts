import type { Dispatcher } from '../ports/Dispatcher';
import { callsFor } from './assignment';

/**
 * Strict order of arrival: the car finishes delivering whoever is aboard, then answers the
 * oldest landing call. It honours no direction, so it is the baseline for how bad a lift can be
 * without actually being broken.
 *
 * Passengers aboard come before older landing calls on purpose — a pure global queue can leave
 * somebody riding indefinitely, which no real controller does.
 */
export const fcfs: Dispatcher = {
  name: 'fcfs',

  nextStop(car, context) {
    const [firstAboard] = car.carCalls;
    if (firstAboard !== undefined) return firstAboard;

    const oldest = [...callsFor(car, context)].sort(
      (a, b) => a.since - b.since || a.floor - b.floor,
    )[0];
    return oldest?.floor ?? null;
  },

  boardingDirection: () => 'any',
};
