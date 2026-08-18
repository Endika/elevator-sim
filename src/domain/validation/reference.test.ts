import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { RESIDENTIAL_CAR } from '../config/PhysicsDefaults';
import { RESIDENTIAL_LOW } from '../config/presets';
import { TEXTBOOK_BEHAVIOUR, type TrafficConfig } from '../config/TrafficConfig';
import { clairvoyantOf } from '../dispatch/Clairvoyant';
import { collective } from '../dispatch/Collective';
import { fcfs } from '../dispatch/Fcfs';
import type { Dispatcher } from '../ports/Dispatcher';
import { checkInvariants } from '../sim/invariants';
import { runSimulation } from '../sim/Simulation';
import { generateStream, type PassengerStream } from '../traffic/PassengerStream';
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
