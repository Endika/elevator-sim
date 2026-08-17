import type { Building } from '../building/Building';
import type { CarSpec } from '../config/BuildingConfig';
import { flightTime } from '../sim/Kinematics';

/**
 * Classical up-peak round trip time, the lift industry's benchmark calculation. Used here as an
 * external oracle: if the simulator's measured handling capacity disagrees with this, the
 * simulator is wrong.
 *
 * Formulae transcribed from Peters, "Improvements to the Up Peak Round Trip Time Calculation",
 * International Journal of Elevator Engineers 3(1), 2000 — equations (3), (4), (11), (12), (17),
 * (18), (19). See elevator-sim-notes/sources.md, S4. The lineage is Jones, Schroeder, and
 * Barney & dos Santos.
 *
 * One documented extension: the levelling delay is added to the per-stop time. The 2000 paper
 * predates that term; the 2012 performance-time paper (S1, equation 2) includes it, and the
 * simulator models it, so leaving it out would compare unlike with unlike.
 */
export interface UpPeakInputs {
  readonly building: Building;
  /** Average passengers carried per round trip. */
  readonly passengersPerTrip: number;
}

export interface UpPeakAnalysis {
  /** Floors served above the main terminal. */
  readonly floorsAbove: number;
  readonly effectivePopulation: number;
  /** Average highest reversal floor, equation (3). */
  readonly highestReversalFloor: number;
  /** Average number of stops, equation (4). */
  readonly averageStops: number;
  /** Distance to the reversal floor in metres, equation (17). */
  readonly distanceToReversal: number;
  /** Time consumed by one stop, equation (18) plus the levelling term. */
  readonly stopTime: number;
  /** Round trip time in seconds, equation (19). */
  readonly roundTripTime: number;
  /** Average interval between arrivals at the terminal, equation (10). */
  readonly interval: number;
  /** Passengers per five minutes, equation (11). */
  readonly handlingCapacity: number;
  /** Handling capacity as a percentage of the population, equation (12). */
  readonly populationPercent: number;
}

export function analyseUpPeak({ building, passengersPerTrip }: UpPeakInputs): UpPeakAnalysis {
  const car = building.cars[0];
  if (!car) throw new Error('The up-peak calculation needs at least one car.');
  if (!(passengersPerTrip > 0)) {
    throw new Error(`Passengers per trip must be positive; got ${passengersPerTrip}.`);
  }

  const terminal = building.entrances[0];
  if (!terminal) throw new Error('The up-peak calculation needs a main terminal floor.');

  const served = building.floors.filter((floor) => floor.id > terminal.id && floor.population > 0);
  const floorsAbove = served.length;
  if (floorsAbove === 0) throw new Error('No populated floor sits above the main terminal.');

  const populations = served.map((floor) => floor.population);
  const effectivePopulation = populations.reduce((sum, value) => sum + value, 0);
  const heights = served.map((floor) => floor.heightAboveGround - terminal.heightAboveGround);
  const passengers = passengersPerTrip;

  // Equation (3): H = N − Σ_{j=1..N-1} (Σ_{i=1..j} U_i / U_eff)^P
  let reversalSum = 0;
  let cumulative = 0;
  for (let j = 0; j < floorsAbove - 1; j += 1) {
    cumulative += populations[j] ?? 0;
    reversalSum += (cumulative / effectivePopulation) ** passengers;
  }
  const highestReversalFloor = floorsAbove - reversalSum;

  // Equation (4): S = N − Σ_{i=1..N} (1 − U_i / U_eff)^P
  const averageStops =
    floorsAbove -
    populations.reduce(
      (sum, population) => sum + (1 - population / effectivePopulation) ** passengers,
      0,
    );

  const distanceToReversal = interpolateHeight(heights, highestReversalFloor);

  // Equation (18), plus the two terms the simulator models and the 2000 paper does not.
  const averageHop = distanceToReversal / averageStops;
  const stopTime =
    flightTime(averageHop, car) +
    car.startDelay +
    car.levellingDelay +
    car.doorDwellTime -
    averageHop / car.ratedSpeed +
    car.doorCloseTime +
    car.doorOpenTime -
    car.advanceDoorOpenTime;

  // Equation (19).
  const roundTripTime =
    (2 * distanceToReversal) / car.ratedSpeed +
    (averageStops + 1) * stopTime +
    2 * passengers * car.passengerTransferTime;

  const lifts = building.cars.length;
  const handlingCapacity = (300 * passengers * lifts) / roundTripTime;

  return {
    floorsAbove,
    effectivePopulation,
    highestReversalFloor,
    averageStops,
    distanceToReversal,
    stopTime,
    roundTripTime,
    interval: roundTripTime / lifts,
    handlingCapacity,
    populationPercent: (handlingCapacity * 100) / effectivePopulation,
  };
}

/**
 * Equation (17): the height of a fractional reversal floor, interpolated between the two real
 * floors it falls between. Reduces to H × floor height when the floors are evenly spaced.
 */
function interpolateHeight(heights: readonly number[], floorNumber: number): number {
  const whole = Math.floor(floorNumber);
  const fraction = floorNumber - whole;
  const below = heights[whole - 1] ?? 0;
  const above = heights[whole] ?? below;
  return below + fraction * (above - below);
}

/** Single-floor flight time, equation (16), for reporting alongside the simulator's. */
export function singleFloorFlightTime(building: Building, car: CarSpec): number {
  const [first, second] = building.floors;
  if (!first || !second) throw new Error('Need two floors to measure a single-floor hop.');
  return flightTime(second.heightAboveGround - first.heightAboveGround, car) + car.startDelay;
}
