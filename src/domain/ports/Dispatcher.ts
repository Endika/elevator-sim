import type { Building } from '../building/Building';
import type { FloorId } from '../config/BuildingConfig';

export type Direction = 'up' | 'down';

export interface HallCall {
  readonly floor: FloorId;
  readonly direction: Direction;
  readonly since: number;
  readonly waiting: number;
}

export type CarActivity = 'idle' | 'doors' | 'moving' | 'parking';

export interface CarView {
  readonly index: number;
  readonly floor: FloorId;
  readonly target: FloorId | null;
  readonly activity: CarActivity;
  readonly direction: Direction | null;
  readonly onboard: number;
  readonly capacity: number;
  readonly carCalls: readonly FloorId[];
  readonly idleSince: number | null;
}

export interface DispatchContext {
  readonly building: Building;
  readonly now: number;
  readonly cars: readonly CarView[];
  readonly hallCalls: readonly HallCall[];
}

/**
 * A dispatcher may read the state of the building and say where a car goes next. It cannot move
 * a car, see the future, or touch the passenger stream — that is what keeps the comparison fair.
 */
export interface Dispatcher {
  readonly name: string;
  /** Next stop for this car, or null when it has nothing to do. */
  nextStop(car: CarView, context: DispatchContext): FloorId | null;
  /** Whose hall calls the car clears on opening. 'any' boards everyone waiting. */
  boardingDirection(car: CarView, context: DispatchContext): Direction | 'any';
}
