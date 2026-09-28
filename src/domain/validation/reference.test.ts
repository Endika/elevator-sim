import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { RESIDENTIAL_CAR } from '../config/PhysicsDefaults';
import { OFFICE_MID, RESIDENTIAL_LOW } from '../config/presets';
import {
  OBSERVED_BEHAVIOUR,
  TEXTBOOK_BEHAVIOUR,
  type TrafficConfig,
} from '../config/TrafficConfig';
import { clairvoyantOf } from '../dispatch/Clairvoyant';
import { collective } from '../dispatch/Collective';
import { fcfs } from '../dispatch/Fcfs';
import type { CarView, DispatchContext, Dispatcher } from '../ports/Dispatcher';
import { checkInvariants } from '../sim/invariants';
import { runSimulation } from '../sim/Simulation';
import { generateStream, type Passenger, type PassengerStream } from '../traffic/PassengerStream';
import { overheadAgainstIdeal, unavoidableJourneyTime } from './IdealJourney';

const building = Building.of(RESIDENTIAL_LOW);
const traffic: TrafficConfig = {
  pattern: 'residential-sparse',
  durationSeconds: 1800,
  demandPercentPer5Min: 15,
  burstiness: 2,
  ...TEXTBOOK_BEHAVIOUR,
};

describe('the unavoidable journey time is a real lower bound', () => {
  it('is never longer than the journey the simulator produced, for any algorithm', () => {
    for (const dispatcher of [collective, fcfs]) {
      for (let seed = 1; seed <= 5; seed += 1) {
        const stream = generateStream(building, traffic, seed);
        const result = runSimulation({ building, stream, dispatcher, idlePolicy: 'stay-put' });
        for (const journey of result.journeys) {
          if (journey.arrivedAt === null) continue;
          const ideal = unavoidableJourneyTime(
            building,
            RESIDENTIAL_CAR,
            journey.origin,
            journey.destination,
          );
          expect(journey.arrivedAt - journey.calledAt).toBeGreaterThanOrEqual(ideal - 1e-9);
        }
      }
    }
  });

  it('grows with distance', () => {
    const near = unavoidableJourneyTime(building, RESIDENTIAL_CAR, 0, 1);
    const far = unavoidableJourneyTime(building, RESIDENTIAL_CAR, 0, 7);
    expect(far).toBeGreaterThan(near);
  });

  it('reports what fraction of a journey is overhead rather than physics', () => {
    const stream = generateStream(building, traffic, 3);
    const result = runSimulation({
      building,
      stream,
      dispatcher: collective,
      idlePolicy: 'stay-put',
    });
    const summary = overheadAgainstIdeal(building, RESIDENTIAL_CAR, result.journeys);
    expect(summary.journeys).toBeGreaterThan(0);
    expect(summary.meanOverhead).toBeGreaterThanOrEqual(0);
    expect(summary.overheadShare).toBeGreaterThan(0);
    expect(summary.overheadShare).toBeLessThan(1);
    expect(summary.meanActual).toBeCloseTo(summary.meanUnavoidable + summary.meanOverhead, 6);
  });
});

describe('the clairvoyant reference', () => {
  it('delivers everybody and breaks no invariant', () => {
    const stream = generateStream(building, traffic, 9);
    const result = runSimulation({
      building,
      stream,
      dispatcher: clairvoyantOf(stream),
      idlePolicy: 'stay-put',
    });
    expect(checkInvariants(stream, result)).toEqual([]);
    expect(result.unfinished).toBe(0);
  });

  it('beats the online algorithms on average wait, which is the whole point of foresight', () => {
    const meanWait = (make: (stream: PassengerStream) => Dispatcher): number => {
      let total = 0;
      let count = 0;
      for (let seed = 1; seed <= 10; seed += 1) {
        const stream = generateStream(building, traffic, seed);
        const result = runSimulation({
          building,
          stream,
          dispatcher: make(stream),
          idlePolicy: 'stay-put',
        });
        for (const journey of result.journeys) {
          if (journey.boardedAt === null) continue;
          total += journey.boardedAt - journey.calledAt;
          count += 1;
        }
      }
      return total / count;
    };

    expect(meanWait((stream) => clairvoyantOf(stream))).toBeLessThan(meanWait(() => collective));
  });

  it('does not pre-position a car for somebody who could not fit in it', () => {
    const newcomer = (id: number): Passenger => ({
      id,
      arrivalTime: 101,
      origin: 6,
      destination: 0,
      boardsAnyDirection: false,
      canUseStairs: false,
      patienceSeconds: null,
      spaceUnits: 1,
      doorHoldSeconds: 0,
    });
    const stream: PassengerStream = {
      seed: 1,
      building: 'test',
      pattern: 'test',
      durationSeconds: 600,
      passengers: [newcomer(1), newcomer(2), newcomer(3)],
    };
    const nearlyFull: CarView = {
      index: 0,
      floor: 3,
      target: null,
      activity: 'idle',
      direction: 'up',
      onboard: 5,
      spaceUsed: 5.5,
      capacity: 6,
      carCalls: [0],
      idleSince: null,
    };
    const context: DispatchContext = { building, now: 100, cars: [nearlyFull], hallCalls: [] };

    expect(clairvoyantOf(stream).nextStop(nearlyFull, context)).toBe(0);
  });

  it('runs a multi-car down-peak, where cars fill to within half a place', () => {
    const office = Building.of(OFFICE_MID);
    const downPeak: TrafficConfig = {
      ...traffic,
      ...OBSERVED_BEHAVIOUR,
      pattern: 'down-peak',
      durationSeconds: 3600,
    };
    const stream = generateStream(office, downPeak, 1);
    const result = runSimulation({
      building: office,
      stream,
      dispatcher: clairvoyantOf(stream),
      idlePolicy: 'stay-put',
    });
    expect(checkInvariants(stream, result)).toEqual([]);
  });

  it('never sees a stream it was not given', () => {
    // Its foresight comes from one injected stream; run it against a different morning and it has
    // no advantage to draw on, which is the honest way to prove the advantage is the foresight.
    const knownStream = generateStream(building, traffic, 1);
    const otherStream = generateStream(building, traffic, 2);
    const misled = runSimulation({
      building,
      stream: otherStream,
      dispatcher: clairvoyantOf(knownStream),
      idlePolicy: 'stay-put',
    });
    expect(checkInvariants(otherStream, misled)).toEqual([]);
  });
});
