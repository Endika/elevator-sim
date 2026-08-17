/**
 * The discrete-event simulation.
 *
 * Time advances by jumping to the next event, never by ticking, so nothing is quantised and a
 * long run costs almost nothing. Everything that varies comes from the passenger stream, which
 * was generated before this ran and cannot be touched from here.
 *
 * DECLARED SIMPLIFICATION — in-flight calls. A car commits to the stop it chose and is never
 * re-routed mid-flight; a call registered while it is moving is served on its next decision.
 * Real collective control can still take a call it has not yet passed. The window is one hop,
 * a few seconds, and the bias is slightly against the smarter algorithms rather than for them,
 * which is the safe direction for an honest comparison. Choosing the *nearest* pending stop in
 * the direction of travel — which the collective dispatcher does — reproduces multi-stop
 * behaviour faithfully despite this.
 */

import type { BuildingConfig, CarSpec, FloorId, IdlePolicy } from '../config/BuildingConfig';
import type { Passenger, PassengerStream } from '../traffic/PassengerStream';
import { EventQueue, PRIORITY } from './EventQueue';
import { flightTime } from './Kinematics';
import type {
  CarActivity,
  CarView,
  Direction,
  DispatchContext,
  Dispatcher,
  HallCall,
  Journey,
  SimResult,
} from './types';

export interface TraceEntry {
  readonly time: number;
  readonly carIndex: number;
  readonly kind: string;
  readonly floor: FloorId;
  readonly onboard: number;
}

export interface SimOptions {
  readonly building: BuildingConfig;
  readonly stream: PassengerStream;
  readonly dispatcher: Dispatcher;
  /** Overrides the building's own policy, for crossing policies against algorithms. */
  readonly idlePolicy?: IdlePolicy;
  /** Extra seconds after the last arrival, so journeys in progress can finish. */
  readonly drainSeconds?: number;
  /** Record a timeline for the animated replay. Off by default; it costs memory. */
  readonly trace?: boolean;
}

interface CarState {
  readonly index: number;
  readonly spec: CarSpec;
  floor: FloorId;
  target: FloorId | null;
  activity: CarActivity;
  direction: Direction | null;
  onboard: Passenger[];
  idleSince: number | null;
  fruitlessStops: number;
}

interface MutableJourney {
  readonly passengerId: number;
  readonly origin: FloorId;
  readonly destination: FloorId;
  readonly direction: Direction;
  readonly calledAt: number;
  boardedAt: number | null;
  arrivedAt: number | null;
  leftBehind: number;
}

type EventKind =
  | 'arrival'
  | 'reachedStop'
  | 'doorsOpen'
  | 'doorsClosed'
  | 'decide'
  | 'idleCheck'
  | 'reachedPark';

interface SimEvent {
  readonly kind: EventKind;
  readonly carIndex: number;
  readonly passenger?: Passenger;
}

const DEFAULT_DRAIN_SECONDS = 3600;
/** A car that opens its doors this many times with nobody moving means a broken dispatcher. */
const FRUITLESS_STOP_LIMIT = 3;

export function directionOf(passenger: Passenger): Direction {
  return passenger.destination > passenger.origin ? 'up' : 'down';
}

export function runSimulation(options: SimOptions): SimResult & { readonly trace?: TraceEntry[] } {
  const { building, stream, dispatcher } = options;
  const idlePolicy = options.idlePolicy ?? building.idlePolicy;
  const horizon = stream.durationSeconds + (options.drainSeconds ?? DEFAULT_DRAIN_SECONDS);

  const heights = new Map(building.floors.map((floor) => [floor.id, floor.heightAboveGround]));
  const floorIds = building.floors.map((floor) => floor.id);
  const entranceIds = building.floors.filter((floor) => floor.isEntrance).map((floor) => floor.id);
  const startFloor = entranceIds[0] ?? floorIds[0];
  if (startFloor === undefined) throw new Error('The building has no floors to start from.');

  const heightOf = (floor: FloorId): number => {
    const height = heights.get(floor);
    if (height === undefined) throw new Error(`Floor ${floor} is not in this building.`);
    return height;
  };

  const cars: CarState[] = building.cars.map((spec, index) => ({
    index,
    spec,
    floor: startFloor,
    target: null,
    activity: 'idle',
    direction: null,
    onboard: [],
    idleSince: 0,
    fruitlessStops: 0,
  }));

  /** Everyone who has pressed a button and not yet got in, in the order they pressed it. */
  const waiting = new Map<FloorId, Passenger[]>();
  const journeys = new Map<number, MutableJourney>();
  const trace: TraceEntry[] = [];

  let carStarts = 0;
  let carDistance = 0;
  let now = 0;

  const queue = new EventQueue<SimEvent>();
  for (const passenger of stream.passengers) {
    queue.push(passenger.arrivalTime, PRIORITY.passengerArrival, {
      kind: 'arrival',
      carIndex: -1,
      passenger,
    });
  }

  const record = (car: CarState, kind: string): void => {
    if (options.trace) {
      trace.push({
        time: now,
        carIndex: car.index,
        kind,
        floor: car.floor,
        onboard: car.onboard.length,
      });
    }
  };

  const viewOf = (car: CarState): CarView => ({
    index: car.index,
    floor: car.floor,
    target: car.target,
    activity: car.activity,
    direction: car.direction,
    onboard: car.onboard.length,
    capacity: car.spec.capacity,
    carCalls: [...new Set(car.onboard.map((p) => p.destination))].sort((a, b) => a - b),
    idleSince: car.idleSince,
  });

  const hallCalls = (): HallCall[] => {
    const calls: HallCall[] = [];
    // Sorted by floor then direction so the list a dispatcher sees never depends on Map order.
    for (const floor of floorIds) {
      const queued = waiting.get(floor);
      if (!queued || queued.length === 0) continue;
      for (const direction of ['up', 'down'] as const) {
        const behind = queued.filter((p) => directionOf(p) === direction);
        if (behind.length === 0) continue;
        calls.push({
          floor,
          direction,
          since: Math.min(...behind.map((p) => p.arrivalTime)),
          waiting: behind.length,
        });
      }
    }
    return calls;
  };

  const contextNow = (): DispatchContext => ({
    building,
    now,
    cars: cars.map(viewOf),
    hallCalls: hallCalls(),
  });

  const scheduleDecision = (car: CarState): void => {
    queue.push(now, PRIORITY.carDecision, { kind: 'decide', carIndex: car.index });
  };

  const parkingFloor = (): FloorId | null => {
    switch (idlePolicy) {
      case 'stay-put':
        return null;
      case 'return-to-entrance':
        return startFloor;
      case 'park-at-busiest': {
        const busiest = [...building.floors].sort(
          (a, b) => b.population - a.population || a.id - b.id,
        )[0];
        return busiest?.id ?? null;
      }
      case 'park-at-middle': {
        const middle = floorIds[Math.floor(floorIds.length / 2)];
        return middle ?? null;
      }
    }
  };

  const depart = (car: CarState, target: FloorId, kind: 'reachedStop' | 'reachedPark'): void => {
    const distance = Math.abs(heightOf(target) - heightOf(car.floor));
    car.target = target;
    car.direction = target > car.floor ? 'up' : 'down';
    car.activity = kind === 'reachedStop' ? 'moving' : 'parking';
    car.idleSince = null;
    carStarts += 1;
    carDistance += distance;
    record(car, kind === 'reachedStop' ? 'departs' : 'parks');
    const travel = car.spec.startDelay + flightTime(distance, car.spec) + car.spec.levellingDelay;
    queue.push(now + travel, PRIORITY.carMotion, { kind, carIndex: car.index });
  };

  const handleArrival = (passenger: Passenger): void => {
    journeys.set(passenger.id, {
      passengerId: passenger.id,
      origin: passenger.origin,
      destination: passenger.destination,
      direction: directionOf(passenger),
      calledAt: passenger.arrivalTime,
      boardedAt: null,
      arrivedAt: null,
      leftBehind: 0,
    });
    const queued = waiting.get(passenger.origin) ?? [];
    queued.push(passenger);
    waiting.set(passenger.origin, queued);

    // Only a standing car can react; one in flight is committed to its stop.
    for (const car of cars) {
      if (car.activity === 'idle') scheduleDecision(car);
    }
  };

  const handleDecision = (car: CarState): void => {
    if (car.activity !== 'idle') return;

    const target = dispatcher.nextStop(viewOf(car), contextNow());
    if (target === null) {
      if (car.idleSince === null) car.idleSince = now;
      queue.push(now + building.idleDelaySeconds, PRIORITY.idleCheck, {
        kind: 'idleCheck',
        carIndex: car.index,
      });
      return;
    }
    if (!heights.has(target)) {
      throw new Error(
        `${dispatcher.name} sent car ${car.index + 1} to floor ${target}, which ` +
          'does not exist in this building.',
      );
    }

    car.idleSince = null;
    if (target === car.floor) {
      // Opening in place: no advance door opening, because there was no trip to overlap with.
      car.activity = 'doors';
      record(car, 'opens');
      queue.push(now + car.spec.doorOpenTime, PRIORITY.carMotion, {
        kind: 'doorsOpen',
        carIndex: car.index,
      });
      return;
    }
    depart(car, target, 'reachedStop');
  };

  const handleReachedStop = (car: CarState): void => {
    const target = car.target;
    if (target === null) throw new Error(`Car ${car.index + 1} arrived without a target.`);
    car.floor = target;
    car.target = null;
    car.activity = 'doors';
    record(car, 'arrives');
    // Advance door opening overlaps the end of the trip, so only the remainder is left to wait.
    const remaining = Math.max(0, car.spec.doorOpenTime - car.spec.advanceDoorOpenTime);
    queue.push(now + remaining, PRIORITY.carMotion, { kind: 'doorsOpen', carIndex: car.index });
  };

  const handleDoorsOpen = (car: CarState): void => {
    const tp = car.spec.passengerTransferTime;

    const alighting = car.onboard.filter((p) => p.destination === car.floor);
    car.onboard = car.onboard.filter((p) => p.destination !== car.floor);
    alighting.forEach((passenger, position) => {
      const journey = journeys.get(passenger.id);
      if (journey) journey.arrivedAt = now + (position + 1) * tp;
    });

    const direction = dispatcher.boardingDirection(viewOf(car), contextNow());
    const queued = waiting.get(car.floor) ?? [];
    const eligible = queued.filter((p) => direction === 'any' || directionOf(p) === direction);
    const space = car.spec.capacity - car.onboard.length;
    const boarding = eligible.slice(0, Math.max(0, space));
    const leftBehind = eligible.slice(Math.max(0, space));

    const boardingBase = now + alighting.length * tp;
    boarding.forEach((passenger, position) => {
      const journey = journeys.get(passenger.id);
      if (journey) journey.boardedAt = boardingBase + (position + 1) * tp;
      car.onboard.push(passenger);
    });
    for (const passenger of leftBehind) {
      const journey = journeys.get(passenger.id);
      if (journey) journey.leftBehind += 1;
    }

    const boarded = new Set(boarding.map((p) => p.id));
    waiting.set(
      car.floor,
      queued.filter((p) => !boarded.has(p.id)),
    );

    if (car.onboard.length > car.spec.capacity) {
      throw new Error(
        `Car ${car.index + 1} holds ${car.onboard.length} people but its capacity is ` +
          `${car.spec.capacity}.`,
      );
    }

    const moved = alighting.length + boarding.length;
    car.fruitlessStops = moved === 0 ? car.fruitlessStops + 1 : 0;
    if (car.fruitlessStops > FRUITLESS_STOP_LIMIT) {
      throw new Error(
        `${dispatcher.name} keeps stopping car ${car.index + 1} at floor ${car.floor} with ` +
          'nobody getting in or out. That is a dispatcher bug, not a slow lift.',
      );
    }

    record(car, 'transfers');
    const cycle = moved * tp + car.spec.doorDwellTime + car.spec.doorCloseTime;
    queue.push(now + cycle, PRIORITY.carMotion, { kind: 'doorsClosed', carIndex: car.index });
  };

  const handleDoorsClosed = (car: CarState): void => {
    car.activity = 'idle';
    record(car, 'closes');
    scheduleDecision(car);
  };

  const handleIdleCheck = (car: CarState): void => {
    if (car.activity !== 'idle') return;
    if (dispatcher.nextStop(viewOf(car), contextNow()) !== null) {
      scheduleDecision(car);
      return;
    }
    const park = parkingFloor();
    if (park === null || park === car.floor) return;
    depart(car, park, 'reachedPark');
  };

  const handleReachedPark = (car: CarState): void => {
    const target = car.target;
    if (target === null) throw new Error(`Car ${car.index + 1} finished parking with no target.`);
    car.floor = target;
    car.target = null;
    car.activity = 'idle';
    car.idleSince = now;
    record(car, 'parked');
    scheduleDecision(car);
  };

  for (;;) {
    const next = queue.pop();
    if (!next) break;
    if (next.time > horizon) break;
    now = next.time;

    const event = next.payload;
    if (event.kind === 'arrival') {
      if (event.passenger) handleArrival(event.passenger);
      continue;
    }

    const car = cars[event.carIndex];
    if (!car) throw new Error(`Event refers to car ${event.carIndex}, which does not exist.`);

    switch (event.kind) {
      case 'decide':
        handleDecision(car);
        break;
      case 'reachedStop':
        handleReachedStop(car);
        break;
      case 'doorsOpen':
        handleDoorsOpen(car);
        break;
      case 'doorsClosed':
        handleDoorsClosed(car);
        break;
      case 'idleCheck':
        handleIdleCheck(car);
        break;
      case 'reachedPark':
        handleReachedPark(car);
        break;
    }
  }

  const finished: Journey[] = stream.passengers.map((passenger) => {
    const journey = journeys.get(passenger.id);
    if (!journey) {
      throw new Error(`Passenger ${passenger.id} was never registered; the stream was not read.`);
    }
    return Object.freeze({ ...journey });
  });

  const result: SimResult & { trace?: TraceEntry[] } = {
    dispatcher: dispatcher.name,
    idlePolicy,
    seed: stream.seed,
    journeys: finished,
    carStarts,
    carDistance,
    endTime: now,
    unfinished: finished.filter((journey) => journey.arrivedAt === null).length,
  };
  if (options.trace) result.trace = trace;
  return result;
}
