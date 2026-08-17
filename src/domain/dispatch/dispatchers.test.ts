import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { RESIDENTIAL_CAR } from '../config/PhysicsDefaults';
import { RESIDENTIAL_LOW } from '../config/presets';
import type { TrafficConfig } from '../config/TrafficConfig';
import type { CarView, DispatchContext, HallCall } from '../ports/Dispatcher';
import { checkInvariants, waitOf } from '../sim/invariants';
import { runSimulation } from '../sim/Simulation';
import { generateStream } from '../traffic/PassengerStream';
import { collective } from './Collective';
import { fcfs } from './Fcfs';
import { nearestCar } from './NearestCar';
import { DISPATCHER_NAMES, DISPATCHERS } from './registry';

const residential = Building.of(RESIDENTIAL_LOW);

function carAt(floor: number, overrides: Partial<CarView> = {}): CarView {
  return {
    index: 0,
    floor,
    target: null,
    activity: 'idle',
    direction: null,
    onboard: 0,
    capacity: 6,
    carCalls: [],
    idleSince: 0,
    ...overrides,
  };
}

function call(floor: number, direction: 'up' | 'down', since = 0): HallCall {
  return { floor, direction, since, waiting: 1 };
}

function contextWith(cars: readonly CarView[], hallCalls: readonly HallCall[]): DispatchContext {
  return { building: residential, now: 100, cars, hallCalls };
}

describe('collective sweeps and then reverses', () => {
  it('takes the nearest call in its direction of travel', () => {
    const car = carAt(0, { direction: 'up' });
    const context = contextWith([car], [call(5, 'up'), call(2, 'up')]);
    expect(collective.nextStop(car, context)).toBe(2);
  });

  it('passes a landing waiting to go down while it is travelling up', () => {
    // The complaint that started this project, reproduced on purpose: it does not even stop at
    // floor 3, it carries on to the up call above and takes floor 3 on the way back.
    const car = carAt(2, { direction: 'up' });
    const context = contextWith([car], [call(3, 'down'), call(6, 'up')]);
    expect(collective.nextStop(car, context)).toBe(6);
    expect(collective.boardingDirection(car, context)).toBe('up');
  });

  it('will not answer a landing call at all once it is full', () => {
    const full = carAt(0, { direction: 'down', onboard: 6, capacity: 6, carCalls: [4] });
    const context = contextWith([full], [call(0, 'up')]);
    expect(collective.nextStop(full, context)).toBe(4);
  });

  it('reverses at the far end and then takes the down traffic', () => {
    const car = carAt(6, { direction: 'up' });
    const context = contextWith([car], [call(3, 'down')]);
    expect(collective.nextStop(car, context)).toBe(3);
    expect(collective.boardingDirection(car, context)).toBe('down');
  });

  it('clears its own floor when there is nothing further along', () => {
    const car = carAt(4, { direction: 'up' });
    expect(collective.nextStop(car, contextWith([car], [call(4, 'down')]))).toBe(4);
  });

  it('delivers passengers aboard before turning round', () => {
    const car = carAt(1, { direction: 'up', onboard: 1, carCalls: [7] });
    const context = contextWith([car], [call(0, 'up')]);
    expect(collective.nextStop(car, context)).toBe(7);
  });

  it('has nothing to do when nobody is waiting', () => {
    const car = carAt(3);
    expect(collective.nextStop(car, contextWith([car], []))).toBeNull();
  });
});

describe('nearest-car goes for whatever is closest', () => {
  it('prefers a near call over an older far one', () => {
    const car = carAt(2);
    const context = contextWith([car], [call(7, 'down', 0), call(3, 'up', 90)]);
    expect(nearestCar.nextStop(car, context)).toBe(3);
  });

  it('ignores the direction of travel entirely', () => {
    const car = carAt(4, { direction: 'up' });
    const context = contextWith([car], [call(3, 'up'), call(6, 'up')]);
    expect(nearestCar.nextStop(car, context)).toBe(3);
  });
});

describe('fcfs answers in the order buttons were pressed', () => {
  it('takes the oldest call even when it is the furthest away', () => {
    const car = carAt(4);
    const context = contextWith([car], [call(0, 'up', 10), call(5, 'up', 50)]);
    expect(fcfs.nextStop(car, context)).toBe(0);
  });

  it('finishes with the passenger aboard first', () => {
    const car = carAt(1, { onboard: 1, carCalls: [6] });
    const context = contextWith([car], [call(0, 'up', 0)]);
    expect(fcfs.nextStop(car, context)).toBe(6);
  });
});

describe('two cars never chase the same call', () => {
  it('leaves a floor another car is already travelling to', () => {
    const moving = carAt(1, { index: 0, activity: 'moving', target: 5, direction: 'up' });
    const waitingCar = carAt(0, { index: 1 });
    const context = contextWith([moving, waitingCar], [call(5, 'up'), call(2, 'up')]);
    expect(collective.nextStop(waitingCar, context)).toBe(2);
  });

  it('gives a call to the nearer of two idle cars', () => {
    const near = carAt(4, { index: 0 });
    const far = carAt(0, { index: 1 });
    const context = contextWith([near, far], [call(5, 'up')]);
    expect(collective.nextStop(near, context)).toBe(5);
    expect(collective.nextStop(far, context)).toBeNull();
  });
});

describe('every algorithm survives a real run', () => {
  const traffic: TrafficConfig = {
    pattern: 'residential-sparse',
    durationSeconds: 1800,
    demandPercentPer5Min: 15,
    burstiness: 2,
  };
  const stream = generateStream(residential, traffic, 11);

  it.each(DISPATCHER_NAMES)('%s delivers everybody and breaks no invariant', (name) => {
    const result = runSimulation({
      building: residential,
      stream,
      dispatcher: DISPATCHERS[name],
    });
    expect(checkInvariants(stream, result)).toEqual([]);
    expect(result.unfinished).toBe(0);
  });

  it.each(DISPATCHER_NAMES)('%s faces exactly the same demand', (name) => {
    const before = JSON.stringify(stream);
    runSimulation({ building: residential, stream, dispatcher: DISPATCHERS[name] });
    expect(JSON.stringify(stream)).toBe(before);
  });
});

describe('nearest-car starves the far floors, collective does not', () => {
  // Hypothesis H3. A steady stream near the bottom plus one person at the top.
  const busyBottom = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    arrivalTime: 5 + i * 20,
    origin: i % 2 === 0 ? 0 : 1,
    destination: i % 2 === 0 ? 1 : 0,
  }));
  const stream = {
    seed: 0,
    building: residential.name,
    pattern: 'hand-made',
    durationSeconds: 300,
    passengers: [...busyBottom, { id: 99, arrivalTime: 10, origin: 7, destination: 0 }],
  };

  const worstWaitAtTop = (dispatcher: typeof collective): number => {
    const result = runSimulation({
      building: Building.of({ ...RESIDENTIAL_LOW, cars: [RESIDENTIAL_CAR] }),
      stream,
      dispatcher,
      idlePolicy: 'stay-put',
    });
    const top = result.journeys.find((journey) => journey.passengerId === 99);
    return waitOf(top!) ?? Number.POSITIVE_INFINITY;
  };

  it('makes the top floor wait longer under nearest-car', () => {
    expect(worstWaitAtTop(nearestCar)).toBeGreaterThan(worstWaitAtTop(collective));
  });
});
