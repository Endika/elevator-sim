import { describe, expect, it } from 'vitest';
import type { FloorId } from '../config/BuildingConfig';
import { RESIDENTIAL_CAR } from '../config/PhysicsDefaults';
import { RESIDENTIAL_LOW } from '../config/presets';
import type { TrafficConfig } from '../config/TrafficConfig';
import { generateStream, type PassengerStream } from '../traffic/PassengerStream';
import { checkInvariants, timeToDestinationOf, waitOf } from './invariants';
import { flightTime } from './Kinematics';
import { runSimulation } from './Simulation';
import type { Dispatcher } from './types';

/**
 * An in-memory fake dispatcher, not a mock: it really decides, it is just the simplest thing
 * that can. Each free car takes a distinct pending hall call; passengers inside come first.
 */
const nearestFirst: Dispatcher = {
  name: 'test-nearest',
  nextStop(car, context) {
    const nearest = (floors: readonly FloorId[]): FloorId | null =>
      floors.length === 0
        ? null
        : ([...floors].sort(
            (a, b) => Math.abs(a - car.floor) - Math.abs(b - car.floor) || a - b,
          )[0] ?? null);

    if (car.carCalls.length > 0) return nearest(car.carCalls);

    // Stable assignment: call i belongs to car i mod carCount. Ranking cars by who happens to
    // be free instead would let two cars chase the same call, because the ranking shifts as
    // each car decides. Proper group assignment arrives in T12.
    const mine = context.hallCalls.filter((_, index) => index % context.cars.length === car.index);
    return mine.length > 0 ? nearest(mine.map((call) => call.floor)) : null;
  },
  boardingDirection: () => 'any',
};

function handMadeStream(
  passengers: readonly { id: number; arrivalTime: number; origin: number; destination: number }[],
  durationSeconds = 600,
): PassengerStream {
  return {
    seed: 0,
    building: RESIDENTIAL_LOW.name,
    pattern: 'hand-made',
    durationSeconds,
    passengers,
  };
}

const TRAFFIC: TrafficConfig = {
  pattern: 'residential-sparse',
  durationSeconds: 1800,
  demandPercentPer5Min: 12,
  burstiness: 1,
};

describe('a single journey, timed by hand', () => {
  // One passenger at the ground floor going to floor 3, with the car already at the ground
  // floor. Every component of the timing is checked, because if this is wrong everything
  // downstream is wrong in a way that still looks plausible.
  const stream = handMadeStream([{ id: 1, arrivalTime: 10, origin: 0, destination: 3 }]);
  const result = runSimulation({
    building: { ...RESIDENTIAL_LOW, idlePolicy: 'stay-put' },
    stream,
    dispatcher: nearestFirst,
    trace: true,
  });
  const journey = result.journeys[0];
  const car = RESIDENTIAL_CAR;

  it('delivers the passenger', () => {
    expect(result.unfinished).toBe(0);
    expect(journey?.arrivedAt).not.toBeNull();
  });

  it('boards them after the doors open and they walk in', () => {
    // Doors open in place (no advance opening, there was no trip), then one transfer time.
    expect(journey?.boardedAt).toBeCloseTo(10 + car.doorOpenTime + car.passengerTransferTime, 6);
  });

  it('arrives after close, start delay, flight, levelling, opening and stepping out', () => {
    const doorsClosed =
      10 + car.doorOpenTime + car.passengerTransferTime + car.doorDwellTime + car.doorCloseTime;
    const distance = 3 * 2.8;
    const travel = car.startDelay + flightTime(distance, car) + car.levellingDelay;
    const doorsOpenThere = doorsClosed + travel + (car.doorOpenTime - car.advanceDoorOpenTime);
    expect(journey?.arrivedAt).toBeCloseTo(doorsOpenThere + car.passengerTransferTime, 6);
  });

  it('lands in the ballpark a real lift would', () => {
    // Roughly 25 s from button to stepping out, three floors up. A wholesale modelling error
    // would not sit in this band.
    expect(timeToDestinationOf(journey!) ?? 0).toBeGreaterThan(15);
    expect(timeToDestinationOf(journey!) ?? 0).toBeLessThan(40);
  });

  it('counts one departure and the distance travelled', () => {
    expect(result.carStarts).toBe(1);
    expect(result.carDistance).toBeCloseTo(8.4, 6);
  });

  it('never has the car in two states at once', () => {
    const kinds = result.trace?.map((entry) => entry.kind) ?? [];
    expect(kinds).toEqual([
      'opens',
      'transfers',
      'closes',
      'departs',
      'arrives',
      'transfers',
      'closes',
    ]);
  });
});

describe('determinism', () => {
  it('produces an identical result for an identical run', () => {
    const stream = generateStream(RESIDENTIAL_LOW, TRAFFIC, 5);
    const once = runSimulation({ building: RESIDENTIAL_LOW, stream, dispatcher: nearestFirst });
    const twice = runSimulation({ building: RESIDENTIAL_LOW, stream, dispatcher: nearestFirst });
    expect(once).toEqual(twice);
  });

  it('gives every algorithm the same demand to face', () => {
    const stream = generateStream(RESIDENTIAL_LOW, TRAFFIC, 5);
    const before = JSON.stringify(stream);
    runSimulation({ building: RESIDENTIAL_LOW, stream, dispatcher: nearestFirst });
    expect(JSON.stringify(stream)).toBe(before);
  });
});

describe('invariants hold on a full run', () => {
  const stream = generateStream(RESIDENTIAL_LOW, TRAFFIC, 7);
  const result = runSimulation({
    building: RESIDENTIAL_LOW,
    stream,
    dispatcher: nearestFirst,
    trace: true,
  });

  it('loses nobody', () => {
    expect(checkInvariants(stream, result)).toEqual([]);
  });

  it('carries everybody who called', () => {
    expect(result.journeys).toHaveLength(stream.passengers.length);
    expect(result.unfinished).toBe(0);
  });

  it('never exceeds the car capacity', () => {
    for (const entry of result.trace ?? []) {
      expect(entry.onboard).toBeLessThanOrEqual(RESIDENTIAL_CAR.capacity);
    }
  });

  it('never records a negative wait', () => {
    for (const journey of result.journeys) {
      const wait = waitOf(journey);
      if (wait !== null) expect(wait).toBeGreaterThanOrEqual(0);
    }
  });

  it('rides take time, nobody teleports', () => {
    for (const journey of result.journeys) {
      if (journey.boardedAt !== null && journey.arrivedAt !== null) {
        expect(journey.arrivedAt).toBeGreaterThan(journey.boardedAt);
      }
    }
  });
});

describe('a full car leaves people behind rather than swallowing them', () => {
  const tiny = {
    ...RESIDENTIAL_LOW,
    cars: [{ ...RESIDENTIAL_CAR, capacity: 1 }],
    idlePolicy: 'stay-put' as const,
  };
  // Four people at the ground floor at the same instant, one seat.
  const stream = handMadeStream([
    { id: 1, arrivalTime: 0, origin: 0, destination: 5 },
    { id: 2, arrivalTime: 0, origin: 0, destination: 6 },
    { id: 3, arrivalTime: 0, origin: 0, destination: 7 },
    { id: 4, arrivalTime: 0, origin: 0, destination: 4 },
  ]);
  const result = runSimulation({ building: tiny, stream, dispatcher: nearestFirst, trace: true });

  it('records the people it could not take', () => {
    expect(result.journeys.some((journey) => journey.leftBehind > 0)).toBe(true);
  });

  it('still delivers all four eventually', () => {
    expect(result.unfinished).toBe(0);
    expect(checkInvariants(stream, result)).toEqual([]);
  });

  it('never carries two people in a one-person car', () => {
    for (const entry of result.trace ?? []) {
      expect(entry.onboard).toBeLessThanOrEqual(1);
    }
  });
});

describe('idle policy is a separate dimension from dispatch', () => {
  const stream = handMadeStream([{ id: 1, arrivalTime: 0, origin: 0, destination: 5 }]);

  it('leaves the car where it finished when told to stay put', () => {
    const result = runSimulation({
      building: RESIDENTIAL_LOW,
      stream,
      dispatcher: nearestFirst,
      idlePolicy: 'stay-put',
      trace: true,
    });
    expect(result.trace?.some((entry) => entry.kind === 'parks')).toBe(false);
    expect(result.trace?.at(-1)?.floor).toBe(5);
  });

  it('sends the car back to the entrance when told to', () => {
    const result = runSimulation({
      building: RESIDENTIAL_LOW,
      stream,
      dispatcher: nearestFirst,
      idlePolicy: 'return-to-entrance',
      trace: true,
    });
    expect(result.trace?.some((entry) => entry.kind === 'parks')).toBe(true);
    expect(result.trace?.at(-1)?.floor).toBe(0);
  });

  it('costs extra starts and distance to park', () => {
    const stay = runSimulation({
      building: RESIDENTIAL_LOW,
      stream,
      dispatcher: nearestFirst,
      idlePolicy: 'stay-put',
    });
    const park = runSimulation({
      building: RESIDENTIAL_LOW,
      stream,
      dispatcher: nearestFirst,
      idlePolicy: 'return-to-entrance',
    });
    expect(park.carStarts).toBeGreaterThan(stay.carStarts);
    expect(park.carDistance).toBeGreaterThan(stay.carDistance);
  });
});

describe('several cars', () => {
  it('runs a six-car tower with no special casing in the engine', () => {
    const stream = generateStream(RESIDENTIAL_LOW, TRAFFIC, 3);
    const sixCars = { ...RESIDENTIAL_LOW, cars: Array.from({ length: 6 }, () => RESIDENTIAL_CAR) };
    const result = runSimulation({ building: sixCars, stream, dispatcher: nearestFirst });
    expect(checkInvariants(stream, result)).toEqual([]);
    expect(result.unfinished).toBe(0);
  });
});

describe('refusing to hide a broken dispatcher', () => {
  it('rejects a stop at a floor the building does not have', () => {
    const offPiste: Dispatcher = {
      name: 'off-piste',
      nextStop: () => 99,
      boardingDirection: () => 'any',
    };
    const stream = handMadeStream([{ id: 1, arrivalTime: 0, origin: 0, destination: 3 }]);
    expect(() =>
      runSimulation({ building: RESIDENTIAL_LOW, stream, dispatcher: offPiste }),
    ).toThrow(/does not exist in this building/);
  });

  it('rejects a dispatcher that parks a car on a pointless loop', () => {
    // Always stops at floor 2, where nobody ever is. A real lift would never, and a silent
    // infinite loop is worse than a crash.
    const pointless: Dispatcher = {
      name: 'pointless',
      nextStop: () => 2,
      boardingDirection: () => 'up',
    };
    const stream = handMadeStream([{ id: 1, arrivalTime: 0, origin: 0, destination: 3 }]);
    expect(() =>
      runSimulation({ building: RESIDENTIAL_LOW, stream, dispatcher: pointless }),
    ).toThrow(/dispatcher bug, not a slow lift/);
  });
});

describe('running out of time', () => {
  it('reports unfinished journeys instead of pretending they arrived', () => {
    const stream = handMadeStream([{ id: 1, arrivalTime: 0, origin: 0, destination: 7 }], 1);
    const result = runSimulation({
      building: RESIDENTIAL_LOW,
      stream,
      dispatcher: nearestFirst,
      drainSeconds: 0,
    });
    expect(result.unfinished).toBe(1);
    expect(result.journeys[0]?.arrivedAt).toBeNull();
    expect(checkInvariants(stream, result)).toEqual([]);
  });
});
