import type { FloorId } from '../config/BuildingConfig';
import type { Direction } from '../ports/Dispatcher';

export interface Journey {
  readonly passengerId: number;
  readonly origin: FloorId;
  readonly destination: FloorId;
  readonly direction: Direction;
  readonly calledAt: number;
  readonly boardedAt: number | null;
  readonly arrivedAt: number | null;
  /** How many times a full car opened and left them behind. */
  readonly leftBehind: number;
  /** When they gave up and took the stairs, or null if they waited it out. */
  readonly abandonedAt: number | null;
  /** False for the pram, the shopping, the delivery round: the lift was their only option. */
  readonly couldUseStairs: boolean;
}

export interface SimResult {
  readonly dispatcher: string;
  readonly idlePolicy: string;
  readonly seed: number;
  readonly journeys: readonly Journey[];
  /** Departures, as a proxy for wear and energy. */
  readonly carStarts: number;
  readonly carDistance: number;
  readonly endTime: number;
  readonly unfinished: number;
  /** People who gave up and walked. They are not failures of the lift, they are demand it lost. */
  readonly abandoned: number;
}
