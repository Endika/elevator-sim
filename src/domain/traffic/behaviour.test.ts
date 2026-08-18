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

describe('the concierge and the courier', () => {
  const withRounds = { ...TRAFFIC, roundsPerHour: 6, roundStops: 3 };

  it('is the only source of between-floor traffic in a block of flats', () => {
    const withoutRounds = generateStream(residential, { ...withRounds, roundsPerHour: 0 }, 4);
    const entrances = new Set(residential.entrances.map((floor) => floor.id));
    for (const passenger of withoutRounds.passengers) {
      const touchesEntrance =
        entrances.has(passenger.origin) || entrances.has(passenger.destination);
      expect(touchesEntrance).toBe(true);
    }

    const stream = generateStream(residential, withRounds, 4);
    const between = stream.passengers.filter(
      (passenger) => !entrances.has(passenger.origin) && !entrances.has(passenger.destination),
    );
    expect(between.length).toBeGreaterThan(0);
  });

  it('starts and finishes at an entrance', () => {
    const stream = generateStream(residential, withRounds, 4);
    const entrances = new Set(residential.entrances.map((floor) => floor.id));
    // Every leg that leaves an upper floor eventually has a matching leg arriving at one.
    const legsFromEntrance = stream.passengers.filter((p) => entrances.has(p.origin)).length;
    const legsToEntrance = stream.passengers.filter((p) => entrances.has(p.destination)).length;
    expect(legsFromEntrance).toBeGreaterThan(0);
    expect(legsToEntrance).toBeGreaterThan(0);
  });

  it('never takes the stairs, because of the parcels', () => {
    const stream = generateStream(residential, withRounds, 4);
    const entrances = new Set(residential.entrances.map((floor) => floor.id));
    const onRound = stream.passengers.filter(
      (passenger) => !entrances.has(passenger.origin) && !entrances.has(passenger.destination),
    );
    for (const passenger of onRound) {
      expect(passenger.canUseStairs).toBe(false);
      expect(passenger.patienceSeconds).toBeNull();
    }
  });

  it('adds load: more rounds means more journeys', () => {
    const few = generateStream(residential, { ...withRounds, roundsPerHour: 1 }, 4);
    const many = generateStream(residential, { ...withRounds, roundsPerHour: 12 }, 4);
    expect(many.passengers.length).toBeGreaterThan(few.passengers.length);
  });

  it('leaves the resident traffic untouched when rounds are switched off', () => {
    const withOut = generateStream(residential, { ...withRounds, roundsPerHour: 0 }, 4);
    const withIn = generateStream(residential, withRounds, 4);
    const residentsOf = (stream: PassengerStream) =>
      stream.passengers.filter((p) => p.canUseStairs || p.patienceSeconds !== null).length;
    // Rounds are drawn from their own sub-stream, so they cannot shift the residents' arrivals.
    expect(residentsOf(withIn)).toBe(residentsOf(withOut));
  });

  it('keeps every journey inside the building', () => {
    const stream = generateStream(residential, withRounds, 4);
    const ids = new Set(residential.floorIds);
    for (const passenger of stream.passengers) {
      expect(ids.has(passenger.origin)).toBe(true);
      expect(ids.has(passenger.destination)).toBe(true);
      expect(passenger.origin).not.toBe(passenger.destination);
    }
  });

  it('survives a run with the invariants intact', () => {
    const stream = generateStream(residential, withRounds, 4);
    const result = runSimulation({
      building: residential,
      stream,
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    expect(checkInvariants(stream, result)).toEqual([]);
  });
});

describe('a single button on the landing changes what squeezing even means', () => {
  it('makes the behaviour irrelevant, because nobody announced a direction', () => {
    // On a down-collective landing there is no wrong direction to squeeze against: the controller
    // never asked where you were going, so getting in is simply how it works.
    const downOnly = Building.of({ ...RESIDENTIAL_LOW, landingButtons: 'down-only' });
    const run = (boardsAnyDirection: boolean) =>
      runSimulation({
        building: downOnly,
        stream: handMade([
          person({ id: 1, origin: 0, destination: 5 }),
          person({ id: 2, arrivalTime: 1, origin: 2, destination: 5 }),
          person({ id: 3, arrivalTime: 1, origin: 2, destination: 0, boardsAnyDirection }),
        ]),
        dispatcher: collective,
        idlePolicy: 'stay-put',
      });

    const boarded = (opportunist: boolean) =>
      run(opportunist).journeys.find((j) => j.passengerId === 3)?.boardedAt;
    expect(boarded(true)).toBe(boarded(false));
  });
});

describe('the three landing arrangements behave differently', () => {
  const stream = () =>
    handMade([
      person({ id: 1, origin: 0, destination: 5 }),
      person({ id: 2, arrivalTime: 1, origin: 2, destination: 0 }),
    ]);

  const boardedUnder = (landingButtons: 'up-and-down' | 'down-only' | 'single-any-direction') => {
    const result = runSimulation({
      building: Building.of({ ...RESIDENTIAL_LOW, landingButtons }),
      stream: stream(),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    return result.journeys.find((j) => j.passengerId === 2)?.boardedAt ?? Number.POSITIVE_INFINITY;
  };

  it('picks the down passenger up on the way up only when the button says nothing', () => {
    // Non-directional stops a car going either way, so the wait is shortest. Full collective knows
    // they want to go down and passes them; down collective takes the call to be a down call and
    // passes them too, so both wait for the car to come back.
    expect(boardedUnder('single-any-direction')).toBeLessThan(boardedUnder('up-and-down'));
    expect(boardedUnder('single-any-direction')).toBeLessThan(boardedUnder('down-only'));
  });

  it('delivers everybody under all three', () => {
    for (const arrangement of ['up-and-down', 'down-only', 'single-any-direction'] as const) {
      const result = runSimulation({
        building: Building.of({ ...RESIDENTIAL_LOW, landingButtons: arrangement }),
        stream: stream(),
        dispatcher: collective,
        idlePolicy: 'stay-put',
      });
      expect(result.unfinished).toBe(0);
      expect(checkInvariants(stream(), result)).toEqual([]);
    }
  });
});

describe('squeezing into a car going the wrong way', () => {
  // Needs two buttons on the landing, or there is no wrong direction to squeeze against.
  const fullCollective = Building.of({ ...RESIDENTIAL_LOW, landingButtons: 'up-and-down' });

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
      building: fullCollective,
      stream: goingUp(true),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const waits = runSimulation({
      building: fullCollective,
      stream: goingUp(false),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });

    const boarded = (r: typeof squeezes) => r.journeys.find((j) => j.passengerId === 3)?.boardedAt;
    expect(boarded(squeezes) ?? 0).toBeLessThan(boarded(waits) ?? 0);
  });

  it('costs them a longer ride, since they go the wrong way first', () => {
    const squeezes = runSimulation({
      building: fullCollective,
      stream: goingUp(true),
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const journey = squeezes.journeys.find((j) => j.passengerId === 3);
    if (!journey?.boardedAt || !journey.arrivedAt) throw new Error('expected a completed journey');
    const waits = runSimulation({
      building: fullCollective,
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
      landingButtons: 'up-and-down',
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
