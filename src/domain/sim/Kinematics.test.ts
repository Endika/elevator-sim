import { describe, expect, it } from 'vitest';
import { OFFICE_CAR, RESIDENTIAL_CAR, TOWER_CAR } from '../config/PhysicsDefaults';
import {
  accelerationIsCapped,
  effectiveAcceleration,
  flightTime,
  performanceTime,
  ratedAccelerationDistance,
  ratedSpeedDistance,
} from './Kinematics';

const CARS = [
  ['residential', RESIDENTIAL_CAR],
  ['office', OFFICE_CAR],
  ['tower', TOWER_CAR],
] as const;

describe('the reconstruction is pinned by continuity', () => {
  // Equations (4) and (5) came out of the PDF corrupted. If the reconstruction were wrong, the
  // three cases would not meet at the boundaries. They do, to floating-point precision, for
  // every car — which is what licenses using them.
  it.each(CARS)('%s car is continuous at the rated-speed boundary', (_name, car) => {
    const a = effectiveAcceleration(car);
    const d = ratedSpeedDistance(car);
    const cruising = d / car.ratedSpeed + a / car.jerk + car.ratedSpeed / a;
    expect(flightTime(d, car)).toBeCloseTo(cruising, 9);
    // Both sides of the boundary agree in the limit.
    expect(flightTime(d - 1e-9, car)).toBeCloseTo(flightTime(d + 1e-9, car), 6);
    // And the closed form for that exact distance is 2a/j + 2v/a.
    expect(flightTime(d, car)).toBeCloseTo((2 * a) / car.jerk + (2 * car.ratedSpeed) / a, 9);
  });

  it.each(CARS)('%s car is continuous at the rated-acceleration boundary', (_name, car) => {
    const a = effectiveAcceleration(car);
    const d = ratedAccelerationDistance(car);
    expect(flightTime(d - 1e-9, car)).toBeCloseTo(flightTime(d + 1e-9, car), 6);
    // The closed form for that exact distance is 4a/j.
    expect(flightTime(d, car)).toBeCloseTo((4 * a) / car.jerk, 9);
  });

  it.each(CARS)('%s car has its case boundaries in the right order', (_name, car) => {
    // The whole reason the acceleration cap exists. If this ever inverts, flightTime is
    // choosing between overlapping cases and its answer is meaningless.
    expect(ratedAccelerationDistance(car)).toBeLessThanOrEqual(ratedSpeedDistance(car) + 1e-9);
  });
});

describe('the acceleration cap', () => {
  it('caps an acceleration the car could never reach at its rated speed', () => {
    // 1 m/s with 0.81 m/s² and 0.51 m/s³ — the combination that broke this before. Ramping up
    // and down would cost a²/j = 1.29 m/s, more than the car's whole rated speed.
    const incoherent = { ...RESIDENTIAL_CAR, ratedSpeed: 1.0, acceleration: 0.81, jerk: 0.51 };
    expect(accelerationIsCapped(incoherent)).toBe(true);
    expect(effectiveAcceleration(incoherent)).toBeCloseTo(Math.sqrt(1.0 * 0.51), 9);
    // And with the cap, the boundaries no longer cross.
    expect(ratedAccelerationDistance(incoherent)).toBeLessThanOrEqual(
      ratedSpeedDistance(incoherent) + 1e-9,
    );
  });

  it('leaves a coherent car alone', () => {
    for (const [, car] of CARS) {
      expect(accelerationIsCapped(car)).toBe(false);
      expect(effectiveAcceleration(car)).toBeCloseTo(car.acceleration, 12);
    }
  });

  it('still returns a sane flight time for a capped car', () => {
    const incoherent = { ...RESIDENTIAL_CAR, ratedSpeed: 1.0, acceleration: 0.81, jerk: 0.51 };
    const time = flightTime(2.8, incoherent);
    expect(time).toBeGreaterThan(3);
    expect(time).toBeLessThan(10);
  });
});

describe('flightTime behaves like a lift', () => {
  it('takes no time to go nowhere', () => {
    expect(flightTime(0, RESIDENTIAL_CAR)).toBe(0);
  });

  it('grows with distance, always', () => {
    let previous = 0;
    for (let d = 0.5; d <= 80; d += 0.5) {
      const time = flightTime(d, RESIDENTIAL_CAR);
      expect(time).toBeGreaterThan(previous);
      previous = time;
    }
  });

  it('is emphatically not proportional to distance on short hops', () => {
    // The headline reason the model needs real kinematics: two floors cost far less than twice
    // one floor, so a simulator that scales linearly would misjudge every low-rise building.
    const oneFloor = flightTime(2.8, RESIDENTIAL_CAR);
    const twoFloors = flightTime(5.6, RESIDENTIAL_CAR);
    expect(twoFloors).toBeLessThan(2 * oneFloor);
    expect(twoFloors).toBeGreaterThan(oneFloor);
  });

  it('approaches the cruise formula over a long rise', () => {
    const d = 200;
    const car = TOWER_CAR;
    const expected =
      d / car.ratedSpeed + car.acceleration / car.jerk + car.ratedSpeed / car.acceleration;
    expect(flightTime(d, car)).toBeCloseTo(expected, 9);
  });

  it('gives a plausible single-floor time for a residential lift', () => {
    // 2.8 m at 1 m/s with 0.6 m/s² and 0.8 m/s³: a single-floor flight lands around 5 s.
    const time = flightTime(2.8, RESIDENTIAL_CAR);
    expect(time).toBeGreaterThan(3);
    expect(time).toBeLessThan(8);
  });

  it('is faster in a faster car over the same distance', () => {
    expect(flightTime(30, TOWER_CAR)).toBeLessThan(flightTime(30, RESIDENTIAL_CAR));
  });

  it('rejects a negative distance rather than returning nonsense', () => {
    expect(() => flightTime(-1, RESIDENTIAL_CAR)).toThrow(/non-negative/);
  });
});

describe('performanceTime', () => {
  it('adds the door and start components to the flight', () => {
    const car = RESIDENTIAL_CAR;
    const expected =
      car.doorCloseTime +
      car.startDelay +
      flightTime(2.8, car) +
      car.levellingDelay +
      car.doorOpenTime -
      car.advanceDoorOpenTime;
    expect(performanceTime(2.8, car)).toBeCloseTo(expected, 9);
  });

  it('is dominated by doors and delays on a single-floor hop, not by travel', () => {
    // This is hypothesis H1 in the spec, visible in the arithmetic before any simulation runs.
    const car = RESIDENTIAL_CAR;
    const flight = flightTime(2.8, car);
    const overhead = performanceTime(2.8, car) - flight;
    expect(overhead).toBeGreaterThan(flight * 0.8);
  });

  it('credits advance door opening', () => {
    const car = { ...RESIDENTIAL_CAR, advanceDoorOpenTime: 0 };
    expect(performanceTime(2.8, RESIDENTIAL_CAR)).toBeLessThan(performanceTime(2.8, car));
  });
});
