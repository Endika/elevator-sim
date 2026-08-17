/**
 * The contract between the simulation and a dispatch algorithm.
 *
 * Deliberately narrow: a dispatcher may look at the state of the building and decide where a car
 * goes next and whose calls it clears. It cannot move a car itself, cannot see the future, and
 * cannot touch the passenger stream. That is what keeps the comparison between algorithms fair
 * and what stops an algorithm from cheating by accident.
 */

import type { BuildingConfig, FloorId } from '../config/BuildingConfig';

export type Direction = 'up' | 'down';

export interface HallCall {
  readonly floor: FloorId;
  readonly direction: Direction;
  /** When the longest-waiting passenger behind this call pressed the button. */
  readonly since: number;
  /** How many people are waiting behind it. */
  readonly waiting: number;
}

export type CarActivity = 'idle' | 'doors' | 'moving' | 'parking';

export interface CarView {
  readonly index: number;
  /** Where the car is, or where it left from while moving. */
  readonly floor: FloorId;
  /** Where it is heading, when it is heading anywhere. */
  readonly target: FloorId | null;
  readonly activity: CarActivity;
  /** Direction of travel while moving, or the direction last served. */
  readonly direction: Direction | null;
  readonly onboard: number;
  readonly capacity: number;
  /** Floors the passengers inside have asked for, ascending. */
  readonly carCalls: readonly FloorId[];
  /** Seconds since this car last did anything. */
  readonly idleSince: number | null;
}

export interface DispatchContext {
  readonly building: BuildingConfig;
  readonly now: number;
  readonly cars: readonly CarView[];
  readonly hallCalls: readonly HallCall[];
}

export interface Dispatcher {
  readonly name: string;
  /**
   * Where should this car stop next? `null` means it has nothing to do and may go idle.
   *
   * Called when a car is standing at a floor with its doors closed. A car in flight is never
   * re-routed: it commits to the stop it chose. See the note on in-flight calls in
   * Simulation.ts.
   */
  nextStop(car: CarView, context: DispatchContext): FloorId | null;
  /**
   * Whose hall calls does this car clear when its doors open? 'any' boards everyone waiting,
   * which is what a lift without direction buttons does.
   */
  boardingDirection(car: CarView, context: DispatchContext): Direction | 'any';
}

/** One passenger's journey, as it actually turned out. */
export interface Journey {
  readonly passengerId: number;
  readonly origin: FloorId;
  readonly destination: FloorId;
  readonly direction: Direction;
  /** When they pressed the button. */
  readonly calledAt: number;
  /** When they got in, or null if they never did. */
  readonly boardedAt: number | null;
  /** When they got out, or null if they never arrived. */
  readonly arrivedAt: number | null;
  /** How many times a full car opened and left them behind. */
  readonly leftBehind: number;
}

export interface SimResult {
  readonly dispatcher: string;
  readonly idlePolicy: string;
  readonly seed: number;
  readonly journeys: readonly Journey[];
  /** How many times a car set off. A proxy for wear and energy. */
  readonly carStarts: number;
  /** Metres travelled by all cars. */
  readonly carDistance: number;
  /** When the simulation stopped. */
  readonly endTime: number;
  /** Passengers still waiting or riding when the clock ran out. */
  readonly unfinished: number;
}
