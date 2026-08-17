import type { Dispatcher } from '../ports/Dispatcher';
import { collective } from './Collective';
import { etd } from './Etd';
import { fcfs } from './Fcfs';
import { nearestCar } from './NearestCar';

export const DISPATCHERS = { fcfs, 'nearest-car': nearestCar, collective, etd } as const;

export type DispatcherName = keyof typeof DISPATCHERS;

export const DISPATCHER_NAMES = Object.keys(DISPATCHERS) as DispatcherName[];

/** The yardstick every comparison is expressed against: what most real lifts actually run. */
export const BASELINE: DispatcherName = 'collective';

export function dispatcherByName(name: DispatcherName): Dispatcher {
  return DISPATCHERS[name];
}
