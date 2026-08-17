/**
 * Flight time for a trip of a given distance, under jerk-limited kinematics.
 *
 * This is the part of the model that decides whether the simulator resembles a real lift at all.
 * A one-floor hop does not reach rated speed, so travel time is emphatically not proportional to
 * distance, and in a low-rise building almost every hop is of that kind.
 *
 * Formulae from Peters, "Lift Performance Time" (see ../../../elevator-sim-notes/sources.md, S1),
 * equations (3)–(5). Equations (4) and (5) were corrupted in the PDF text extraction and have
 * been reconstructed; the reconstruction is pinned by continuity at both case boundaries, which
 * is asserted in the tests.
 */

import type { CarSpec } from '../config/BuildingConfig';

/**
 * The acceleration the car can actually use.
 *
 * Ramping acceleration up to `a` and back down again costs `a²/j` of speed. If that exceeds the
 * rated speed, the car reaches its speed limit before its acceleration limit and the rated
 * acceleration is simply unreachable — so the usable value is capped at √(v·j).
 *
 * This is not a nicety. The three cases below are only well ordered when a² ≤ v·j: substituting
 * x = a²/(v·j) into `2a³/j² ≤ (a²v + v²j)/(ja)` gives `2x² − x − 1 ≤ 0`, i.e. x ≤ 1. Without the
 * cap, a slow car with a brisk rated acceleration makes the case boundaries cross over and the
 * formula returns nonsense. Real configurations hit this: 1 m/s with 0.81 m/s² and 0.51 m/s³ does.
 */
export function effectiveAcceleration(car: CarSpec): number {
  return Math.min(car.acceleration, Math.sqrt(car.ratedSpeed * car.jerk));
}

/** True when the car can never use its stated acceleration, because speed limits it first. */
export function accelerationIsCapped(car: CarSpec): boolean {
  return effectiveAcceleration(car) < car.acceleration - 1e-12;
}

/** Distance at or above which the car reaches its rated speed. */
export function ratedSpeedDistance(car: CarSpec): number {
  const { ratedSpeed: v, jerk: j } = car;
  const a = effectiveAcceleration(car);
  return (a * a * v + v * v * j) / (j * a);
}

/** Distance below which the car never reaches its usable acceleration either. */
export function ratedAccelerationDistance(car: CarSpec): number {
  const { jerk: j } = car;
  const a = effectiveAcceleration(car);
  return (2 * a * a * a) / (j * j);
}

/** Seconds to travel `distance` metres, from a standstill to a standstill. */
export function flightTime(distance: number, car: CarSpec): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new Error(`Flight distance must be a non-negative number of metres; got ${distance}.`);
  }
  if (distance === 0) return 0;

  const { ratedSpeed: v, jerk: j } = car;
  const a = effectiveAcceleration(car);

  if (distance >= ratedSpeedDistance(car)) {
    // Case (3): reaches rated speed and cruises.
    return distance / v + a / j + v / a;
  }

  if (distance >= ratedAccelerationDistance(car)) {
    // Case (4): reaches rated acceleration but never rated speed.
    return a / j + Math.sqrt(a * a * a + 4 * distance * j * j) / (j * Math.sqrt(a));
  }

  // Case (5): so short that even rated acceleration is never reached.
  return Math.cbrt((32 * distance) / j);
}

/**
 * Performance time: doors starting to close on one floor until they are fully open on the next.
 * Peters equation (2). The advance door opening overlaps the end of the trip, so it is
 * subtracted — which is why the config refuses to let it exceed the opening time itself.
 */
export function performanceTime(distance: number, car: CarSpec): number {
  return (
    car.doorCloseTime +
    car.startDelay +
    flightTime(distance, car) +
    car.levellingDelay +
    car.doorOpenTime -
    car.advanceDoorOpenTime
  );
}
