import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { RESIDENTIAL_CAR } from '../config/PhysicsDefaults';
import { RESIDENTIAL_LOW } from '../config/presets';
import {
  OBSERVED_BEHAVIOUR,
  TEXTBOOK_BEHAVIOUR,
  type TrafficConfig,
} from '../config/TrafficConfig';
import { collective } from '../dispatch/Collective';
import { checkInvariants } from '../sim/invariants';
import { runSimulation } from '../sim/Simulation';
import {
  generateStream,
  type Passenger,
  type PassengerStream,
  stairsDecisionFor,
} from './PassengerStream';

const residential = Building.of(RESIDENTIAL_LOW);

const TRAFFIC: TrafficConfig = {
  pattern: 'residential-sparse',
  durationSeconds: 1800,
  demandPercentPer5Min: 15,
  burstiness: 2,
  ...OBSERVED_BEHAVIOUR,
};

function handMade(passengers: readonly Passenger[], durationSeconds = 600): PassengerStream {
  return {
    seed: 0,
    building: residential.name,
    pattern: 'hand-made',
    durationSeconds,
    passengers,
  };
}

function person(overrides: Partial<Passenger> & Pick<Passenger, 'id'>): Passenger {
  return {
    arrivalTime: 0,
    origin: 3,
    destination: 0,
    boardsAnyDirection: false,
    canUseStairs: false,
    patienceSeconds: null,
    ...overrides,
  };
}

describe('who can take the stairs at all', () => {
  it('never lets somebody with a pram give up, whichever floor they are on', () => {
    for (const [origin, destination] of [
      [1, 0],
      [5, 0],
      [0, 1],
      [0, 5],
    ] as const) {
      const decision = stairsDecisionFor(false, origin, destination, TRAFFIC);
      expect(decision.canUseStairs).toBe(false);
      expect(decision.patienceSeconds).toBeNull();
    }
  });

  it('never lets anybody give up when the behaviour is switched off', () => {
    const stream = generateStream(residential, { ...TRAFFIC, ...TEXTBOOK_BEHAVIOUR }, 5);
    for (const passenger of stream.passengers) {
      expect(passenger.patienceSeconds).toBeNull();
      expect(passenger.boardsAnyDirection).toBe(false);
    }
  });
});

describe('how far people will walk', () => {
  const traffic = { ...TRAFFIC, stairsMaxFloors: 3, stairsPatiencePerFloor: 20 };
  const able = (origin: number, destination: number) =>
    stairsDecisionFor(true, origin, destination, traffic);

  it('keeps the fifth floor waiting rather than climbing it', () => {
    expect(able(0, 5).patienceSeconds).toBeNull();
  });

  it('lets somebody walk down five floors, since down is half the effort', () => {
    expect(able(5, 0).patienceSeconds).toBe(50);
  });

  it('makes patience grow with the climb', () => {
    expect(able(0, 1).patienceSeconds).toBe(20);
    expect(able(0, 3).patienceSeconds).toBe(60);
  });

  it('stops nobody who is going nowhere', () => {
    expect(able(2, 2).patienceSeconds).toBeNull();
  });
});

describe('giving up, in a run', () => {
  it('removes them from the landing and counts them apart', () => {
    const stream = handMade([
      person({ id: 1, origin: 2, destination: 0, canUseStairs: true, patienceSeconds: 15 }),
    ]);
    // No car will ever come: there is one, but we send it away by giving it nothing to do until
    // long after the patience runs out.
    const result = runSimulation({
      building: Building.of({
        ...RESIDENTIAL_LOW,
        cars: [{ ...RESIDENTIAL_CAR, startDelay: 400 }],
      }),
      stream,
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });

    expect(result.abandoned).toBe(1);
    expect(result.journeys[0]?.abandonedAt).toBeCloseTo(15, 6);
    expect(result.journeys[0]?.boardedAt).toBeNull();
    expect(result.unfinished).toBe(0);
    expect(checkInvariants(stream, result)).toEqual([]);
  });

  it('leaves the patient ones alone', () => {
    const stream = handMade([person({ id: 1, origin: 2, destination: 0 })]);
    const result = runSimulation({
      building: residential,
      stream,
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    expect(result.abandoned).toBe(0);
    expect(result.journeys[0]?.arrivedAt).not.toBeNull();
  });

  it('shrinks the demand the lift actually sees', () => {
    const stream = generateStream(residential, TRAFFIC, 7);
    const result = runSimulation({
      building: residential,
      stream,
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    expect(result.abandoned).toBeGreaterThan(0);
    expect(checkInvariants(stream, result)).toEqual([]);
  });
});

describe('squeezing into a car going the wrong way', () => {
  // The car must actually stop at floor 2, or nobody there gets the chance to squeeze in — a car
  // that sails past is not an opportunity. So somebody on floor 2 is going up, which is what makes
  // it stop, and our subject standing next to them wants to go down.
  const goingUp = (boardsAnyDirection: boolean) =>
    handMade([
      person({ id: 1, origin: 0, destination: 5 }),
      person({ id: 2, arrivalTime: 1, origin: 2, destination: 5 }),
      person({ id: 3, arrivalTime: 1, origin: 2, destination: 0, boardsAnyDirection }),
    ]);

  it('gets them in sooner than waiting for the car to come back', () => {
    const squeezes = runSimulation({
      building: residential,
      stream: goingUp(true),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const waits = runSimulation({
      building: residential,
      stream: goingUp(false),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });

    const boarded = (r: typeof squeezes) => r.journeys.find((j) => j.passengerId === 3)?.boardedAt;
    expect(boarded(squeezes) ?? 0).toBeLessThan(boarded(waits) ?? 0);
  });

  it('costs them a longer ride, since they go the wrong way first', () => {
    const squeezes = runSimulation({
      building: residential,
      stream: goingUp(true),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const journey = squeezes.journeys.find((j) => j.passengerId === 3);
    if (!journey?.boardedAt || !journey.arrivedAt) throw new Error('expected a completed journey');
    const waits = runSimulation({
      building: residential,
      stream: goingUp(false),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const patient = waits.journeys.find((j) => j.passengerId === 3);
    if (!patient?.boardedAt || !patient.arrivedAt) throw new Error('expected a completed journey');

    // Rode up to the top before coming back down, so the ride is longer than the patient one.
    expect(journey.arrivedAt - journey.boardedAt).toBeGreaterThan(
      patient.arrivedAt - patient.boardedAt,
    );
    expect(checkInvariants(goingUp(true), squeezes)).toEqual([]);
  });

  it('does not count them as left behind when the car was never serving them', () => {
    const full = Building.of({
      ...RESIDENTIAL_LOW,
      cars: [{ ...RESIDENTIAL_CAR, capacity: 1 }],
    });
    const result = runSimulation({
      building: full,
      stream: goingUp(true),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    expect(result.journeys.find((j) => j.passengerId === 3)?.leftBehind).toBe(0);
  });
});
