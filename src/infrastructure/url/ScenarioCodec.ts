import { DEFAULT_SCENARIO, type Scenario } from '../../application/Scenario';
import { IDLE_POLICIES, type IdlePolicy } from '../../domain/config/BuildingConfig';
import { TRAFFIC_PATTERNS, type TrafficPattern } from '../../domain/config/TrafficConfig';
import { DISPATCHER_NAMES, type DispatcherName } from '../../domain/dispatch/registry';

/**
 * Short keys, because the whole scenario lives in the address bar and the link is meant to be
 * pasted into a message. Anything missing or nonsense falls back to the default rather than
 * throwing: a hand-edited link should degrade, not break the page.
 */
const KEYS = {
  floorsAbove: 'f',
  basements: 'b',
  floorHeight: 'h',
  peoplePerFloor: 'p',
  cars: 'c',
  destinationEntry: 'dd',
  idlePolicy: 'ip',
  idleDelaySeconds: 'id',
  pattern: 'tp',
  durationMinutes: 'dm',
  demandPercentPer5Min: 'dp',
  burstiness: 'bu',
  seeds: 's',
  dispatchers: 'a',
  ratedSpeed: 'v',
  acceleration: 'ac',
  jerk: 'j',
  capacity: 'cap',
  doorOpenTime: 'do',
  doorCloseTime: 'dc',
  doorDwellTime: 'dw',
  startDelay: 'sd',
  levellingDelay: 'lv',
  advanceDoorOpenTime: 'ad',
  passengerTransferTime: 'pt',
  opportunistShare: 'op',
  stairsPatiencePerFloor: 'sp',
  stairsMaxFloors: 'sm',
  stairsAbleShare: 'sa',
  roundsPerHour: 'rh',
  roundStops: 'rs',
} as const;

export function encodeScenario(scenario: Scenario): string {
  const params = new URLSearchParams();
  params.set(KEYS.floorsAbove, String(scenario.floorsAbove));
  params.set(KEYS.basements, String(scenario.basements));
  params.set(KEYS.floorHeight, String(scenario.floorHeight));
  params.set(KEYS.peoplePerFloor, String(scenario.peoplePerFloor));
  params.set(KEYS.cars, String(scenario.cars));
  params.set(KEYS.destinationEntry, scenario.destinationEntry ? '1' : '0');
  params.set(KEYS.idlePolicy, scenario.idlePolicy);
  params.set(KEYS.idleDelaySeconds, String(scenario.idleDelaySeconds));
  params.set(KEYS.pattern, scenario.pattern);
  params.set(KEYS.durationMinutes, String(scenario.durationMinutes));
  params.set(KEYS.demandPercentPer5Min, String(scenario.demandPercentPer5Min));
  params.set(KEYS.burstiness, String(scenario.burstiness));
  params.set(KEYS.seeds, String(scenario.seeds));
  params.set(KEYS.dispatchers, scenario.dispatchers.join(','));
  params.set(KEYS.opportunistShare, String(scenario.opportunistShare));
  params.set(KEYS.stairsPatiencePerFloor, String(scenario.stairsPatiencePerFloor));
  params.set(KEYS.stairsMaxFloors, String(scenario.stairsMaxFloors));
  params.set(KEYS.stairsAbleShare, String(scenario.stairsAbleShare));
  params.set(KEYS.roundsPerHour, String(scenario.roundsPerHour));
  params.set(KEYS.roundStops, String(scenario.roundStops));
  params.set(KEYS.capacity, String(scenario.car.capacity));
  params.set(KEYS.ratedSpeed, String(scenario.car.ratedSpeed));
  params.set(KEYS.acceleration, String(scenario.car.acceleration));
  params.set(KEYS.jerk, String(scenario.car.jerk));
  params.set(KEYS.doorOpenTime, String(scenario.car.doorOpenTime));
  params.set(KEYS.doorCloseTime, String(scenario.car.doorCloseTime));
  params.set(KEYS.doorDwellTime, String(scenario.car.doorDwellTime));
  params.set(KEYS.startDelay, String(scenario.car.startDelay));
  params.set(KEYS.levellingDelay, String(scenario.car.levellingDelay));
  params.set(KEYS.advanceDoorOpenTime, String(scenario.car.advanceDoorOpenTime));
  params.set(KEYS.passengerTransferTime, String(scenario.car.passengerTransferTime));
  return params.toString();
}

export function decodeScenario(query: string): Scenario {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);

  const number = (key: string, fallback: number, { integer = false } = {}): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return integer ? Math.round(value) : value;
  };

  const nonNegative = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  const share = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
  };

  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const raw = params.get(key);
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  };

  const dispatchers = (params.get(KEYS.dispatchers) ?? '')
    .split(',')
    .filter((name): name is DispatcherName =>
      (DISPATCHER_NAMES as readonly string[]).includes(name),
    );

  return {
    floorsAbove: number(KEYS.floorsAbove, DEFAULT_SCENARIO.floorsAbove, { integer: true }),
    basements: Math.round(nonNegative(KEYS.basements, DEFAULT_SCENARIO.basements)),
    floorHeight: number(KEYS.floorHeight, DEFAULT_SCENARIO.floorHeight),
    peoplePerFloor: number(KEYS.peoplePerFloor, DEFAULT_SCENARIO.peoplePerFloor, { integer: true }),
    cars: number(KEYS.cars, DEFAULT_SCENARIO.cars, { integer: true }),
    destinationEntry: params.get(KEYS.destinationEntry) === '1',
    idlePolicy: oneOf<IdlePolicy>(KEYS.idlePolicy, IDLE_POLICIES, DEFAULT_SCENARIO.idlePolicy),
    idleDelaySeconds: nonNegative(KEYS.idleDelaySeconds, DEFAULT_SCENARIO.idleDelaySeconds),
    pattern: oneOf<TrafficPattern>(KEYS.pattern, TRAFFIC_PATTERNS, DEFAULT_SCENARIO.pattern),
    durationMinutes: number(KEYS.durationMinutes, DEFAULT_SCENARIO.durationMinutes),
    demandPercentPer5Min: number(KEYS.demandPercentPer5Min, DEFAULT_SCENARIO.demandPercentPer5Min),
    burstiness: number(KEYS.burstiness, DEFAULT_SCENARIO.burstiness),
    seeds: number(KEYS.seeds, DEFAULT_SCENARIO.seeds, { integer: true }),
    dispatchers: dispatchers.length >= 2 ? dispatchers : DEFAULT_SCENARIO.dispatchers,
    opportunistShare: share(KEYS.opportunistShare, DEFAULT_SCENARIO.opportunistShare),
    stairsPatiencePerFloor: nonNegative(
      KEYS.stairsPatiencePerFloor,
      DEFAULT_SCENARIO.stairsPatiencePerFloor,
    ),
    stairsMaxFloors: Math.round(
      nonNegative(KEYS.stairsMaxFloors, DEFAULT_SCENARIO.stairsMaxFloors),
    ),
    stairsAbleShare: share(KEYS.stairsAbleShare, DEFAULT_SCENARIO.stairsAbleShare),
    roundsPerHour: nonNegative(KEYS.roundsPerHour, DEFAULT_SCENARIO.roundsPerHour),
    roundStops: Math.round(nonNegative(KEYS.roundStops, DEFAULT_SCENARIO.roundStops)),
    car: {
      capacity: number(KEYS.capacity, DEFAULT_SCENARIO.car.capacity, { integer: true }),
      ratedSpeed: number(KEYS.ratedSpeed, DEFAULT_SCENARIO.car.ratedSpeed),
      acceleration: number(KEYS.acceleration, DEFAULT_SCENARIO.car.acceleration),
      jerk: number(KEYS.jerk, DEFAULT_SCENARIO.car.jerk),
      doorOpenTime: nonNegative(KEYS.doorOpenTime, DEFAULT_SCENARIO.car.doorOpenTime),
      doorCloseTime: nonNegative(KEYS.doorCloseTime, DEFAULT_SCENARIO.car.doorCloseTime),
      doorDwellTime: nonNegative(KEYS.doorDwellTime, DEFAULT_SCENARIO.car.doorDwellTime),
      startDelay: nonNegative(KEYS.startDelay, DEFAULT_SCENARIO.car.startDelay),
      levellingDelay: nonNegative(KEYS.levellingDelay, DEFAULT_SCENARIO.car.levellingDelay),
      advanceDoorOpenTime: nonNegative(
        KEYS.advanceDoorOpenTime,
        DEFAULT_SCENARIO.car.advanceDoorOpenTime,
      ),
      passengerTransferTime: number(
        KEYS.passengerTransferTime,
        DEFAULT_SCENARIO.car.passengerTransferTime,
      ),
    },
  };
}
