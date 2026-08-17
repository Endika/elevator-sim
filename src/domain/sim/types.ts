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
}
