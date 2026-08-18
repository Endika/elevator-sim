import type { Building } from '../building/Building';
import type { CarSpec, FloorId, IdlePolicy } from '../config/BuildingConfig';
import type {
  CarActivity,
  CarView,
  Direction,
  DispatchContext,
  Dispatcher,
  HallCall,
} from '../ports/Dispatcher';
import type { Passenger, PassengerStream } from '../traffic/PassengerStream';
import { EventQueue, PRIORITY } from './EventQueue';
import { flightTime } from './Kinematics';
import type { Journey, SimResult } from './types';

export interface TraceEntry {
  readonly time: number;
  readonly carIndex: number;
  readonly kind: string;
  readonly floor: FloorId;
  readonly onboard: number;
}

export interface SimOptions {
  readonly building: Building;
  readonly stream: PassengerStream;
  readonly dispatcher: Dispatcher;
  /** Overrides the building's own policy, for crossing policies against algorithms. */
  readonly idlePolicy?: IdlePolicy;
  readonly drainSeconds?: number;
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

type MutableJourney = { -readonly [K in keyof Journey]: Journey[K] };

type EventKind =
  | 'arrival'
  | 'giveUp'
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
const FRUITLESS_STOP_LIMIT = 3;

export function directionOf(passenger: Passenger): Direction {
  return passenger.destination > passenger.origin ? 'up' : 'down';
}

/**
 * DECLARED SIMPLIFICATION — a car commits to the stop it chose and is never re-routed in flight,
 * so a call raised while it moves is served on its next decision. The window is one hop and the
 * bias runs against the smarter algorithms, which is the safe direction for the comparison.
 */
export function runSimulation(options: SimOptions): SimResult & { readonly trace?: TraceEntry[] } {
  const { building, stream, dispatcher } = options;
  const idlePolicy = options.idlePolicy ?? building.idlePolicy;
  const horizon = stream.durationSeconds + (options.drainSeconds ?? DEFAULT_DRAIN_SECONDS);

  const startFloor = (building.mainEntrance ?? building.floors[0])?.id;
  if (startFloor === undefined) throw new Error('The building has no floors to start from.');

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

  const waiting = new Map<FloorId, Passenger[]>();
  const journeys = new Map<number, MutableJourney>();
  const trace: TraceEntry[] = [];
  const queue = new EventQueue<SimEvent>();

  let carStarts = 0;
  let carDistance = 0;
  let now = 0;

  for (const passenger of stream.passengers) {
    queue.push(passenger.arrivalTime, PRIORITY.passengerArrival, {
      kind: 'arrival',
      carIndex: -1,
      passenger,
    });
  }

  const record = (car: CarState, kind: string): void => {
    if (!options.trace) return;
    trace.push({
      time: now,
      carIndex: car.index,
      kind,
      floor: car.floor,
      onboard: car.onboard.length,
    });
  };

  const viewOf = (car: CarState): CarView => ({
    index: car.index,
    floor: car.floor,
    target: car.target,
    activity: car.activity,
    direction: car.direction,
    onboard: car.onboard.length,
    capacity: car.spec.capacity,
    carCalls: [...new Set(car.onboard.map((p) => p.destination))],
    idleSince: car.idleSince,
  });

  /**
   * Floor-then-direction order, so what a dispatcher sees never depends on Map iteration.
   *
   * On a landing with a single button the controller learns nothing about where anybody is going:
   * everyone waiting shows up as one call in the only direction the button offers. That is down
   * collective, and it is what most blocks of flats actually have.
   */
  const hallCalls = (): HallCall[] =>
    building.floorIds.flatMap((floor) => {
      const queued = waiting.get(floor) ?? [];
      if (queued.length === 0) return [];

      if (building.singleButtonAt(floor)) {
        return [
          {
            floor,
            direction: 'down' as const,
            since: Math.min(...queued.map((p) => p.arrivalTime)),
            waiting: queued.length,
          },
        ];
      }

      return (['up', 'down'] as const).flatMap((direction) => {
        const behind = queued.filter((p) => directionOf(p) === direction);
        if (behind.length === 0) return [];
        return [
          {
            floor,
            direction,
            since: Math.min(...behind.map((p) => p.arrivalTime)),
            waiting: behind.length,
          },
        ];
      });
    });

  const context = (): DispatchContext => ({
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
      case 'park-at-busiest':
        return building.busiest?.id ?? null;
      case 'park-at-middle':
        return building.middle?.id ?? null;
    }
  };

  const depart = (car: CarState, target: FloorId, kind: 'reachedStop' | 'reachedPark'): void => {
    const distance = building.gap(car.floor, target);
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
      abandonedAt: null,
      couldUseStairs: passenger.canUseStairs,
    });
    waiting.set(passenger.origin, [...(waiting.get(passenger.origin) ?? []), passenger]);

    if (passenger.patienceSeconds !== null) {
      queue.push(passenger.arrivalTime + passenger.patienceSeconds, PRIORITY.passengerArrival, {
        kind: 'giveUp',
        carIndex: -1,
        passenger,
      });
    }

    for (const car of cars) {
      if (car.activity === 'idle') scheduleDecision(car);
    }
  };

  /** Somebody walks. Their call disappears with them, which is demand the lift never sees. */
  const handleGiveUp = (passenger: Passenger): void => {
    const journey = journeys.get(passenger.id);
    if (!journey || journey.boardedAt !== null) return;

    const queued = waiting.get(passenger.origin) ?? [];
    waiting.set(
      passenger.origin,
      queued.filter((waiter) => waiter.id !== passenger.id),
    );
    journey.abandonedAt = now;
  };

  const handleDecision = (car: CarState): void => {
    if (car.activity !== 'idle') return;

    const target = dispatcher.nextStop(viewOf(car), context());
    if (target === null) {
      car.idleSince ??= now;
      queue.push(now + building.idleDelaySeconds, PRIORITY.idleCheck, {
        kind: 'idleCheck',
        carIndex: car.index,
      });
      return;
    }
    if (!building.has(target)) {
      throw new Error(
        `${dispatcher.name} sent car ${car.index + 1} to floor ${target}, which does not exist.`,
      );
    }

    car.idleSince = null;
    if (target !== car.floor) {
      depart(car, target, 'reachedStop');
      return;
    }
    // Opening in place: no advance opening, there was no trip to overlap with.
    car.activity = 'doors';
    record(car, 'opens');
    queue.push(now + car.spec.doorOpenTime, PRIORITY.carMotion, {
      kind: 'doorsOpen',
      carIndex: car.index,
    });
  };

  const handleReachedStop = (car: CarState): void => {
    const target = car.target;
    if (target === null) throw new Error(`Car ${car.index + 1} arrived without a target.`);
    car.floor = target;
    car.target = null;
    car.activity = 'doors';
    record(car, 'arrives');
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

    // With one button on the landing nobody announced a direction, so everybody simply gets in
    // whatever turned up — the controller had no way to sort them and neither do they.
    const direction = building.singleButtonAt(car.floor)
      ? 'any'
      : dispatcher.boardingDirection(viewOf(car), context());
    const queued = waiting.get(car.floor) ?? [];
    const wanted = queued.filter((p) => direction === 'any' || directionOf(p) === direction);
    // Whoever is left over squeezes in anyway if they are that sort and there is still room —
    // the lift is going the wrong way, but by the time it comes back there may be no space.
    const squeezing = queued.filter((p) => !wanted.includes(p) && p.boardsAnyDirection);
    const eligible = [...wanted, ...squeezing];
    const space = Math.max(0, car.spec.capacity - car.onboard.length);
    const boarding = eligible.slice(0, space);

    const boardingBase = now + alighting.length * tp;
    boarding.forEach((passenger, position) => {
      const journey = journeys.get(passenger.id);
      if (journey) journey.boardedAt = boardingBase + (position + 1) * tp;
      car.onboard.push(passenger);
    });
    // Only people the car was actually serving count as left behind; somebody who tried to
    // squeeze into a car going the other way was never owed a place on it.
    for (const passenger of wanted.slice(space)) {
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
        `Car ${car.index + 1} holds ${car.onboard.length} people, over its capacity of ` +
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
    if (dispatcher.nextStop(viewOf(car), context()) !== null) {
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

  const handlers: Record<Exclude<EventKind, 'arrival' | 'giveUp'>, (car: CarState) => void> = {
    decide: handleDecision,
    reachedStop: handleReachedStop,
    doorsOpen: handleDoorsOpen,
    doorsClosed: handleDoorsClosed,
    idleCheck: handleIdleCheck,
    reachedPark: handleReachedPark,
  };

  for (;;) {
    const next = queue.pop();
    if (!next || next.time > horizon) break;
    now = next.time;

    const event = next.payload;
    if (event.kind === 'arrival') {
      if (event.passenger) handleArrival(event.passenger);
      continue;
    }
    if (event.kind === 'giveUp') {
      if (event.passenger) handleGiveUp(event.passenger);
      continue;
    }

    const car = cars[event.carIndex];
    if (!car) throw new Error(`Event refers to car ${event.carIndex}, which does not exist.`);
    handlers[event.kind](car);
  }

  const finished: Journey[] = stream.passengers.map((passenger) => {
    const journey = journeys.get(passenger.id);
    if (!journey) throw new Error(`Passenger ${passenger.id} was never registered.`);
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
    unfinished: finished.filter(
      (journey) => journey.arrivedAt === null && journey.abandonedAt === null,
    ).length,
    abandoned: finished.filter((journey) => journey.abandonedAt !== null).length,
  };
  if (options.trace) result.trace = trace;
  return result;
}
