import type { Building } from '../building/Building';
import type { CarSpec, FloorId } from '../config/BuildingConfig';
import { flightTime } from '../sim/Kinematics';
import type { Journey } from '../sim/types';

/**
 * The fastest a journey could possibly go: the car is already at your floor, nobody else exists,
 * and every remaining step is mandatory physics — doors open, you walk in, doors close, the car
 * starts, flies, levels, opens again, you walk out.
 *
 * A provable lower bound within this model, which is what makes it useful: subtract it from a real
 * journey and what is left is pure overhead, attributable to waiting and to sharing the lift.
 */
export function unavoidableJourneyTime(
  building: Building,
  car: CarSpec,
  origin: FloorId,
  destination: FloorId,
): number {
  return (
    car.doorOpenTime +
    car.passengerTransferTime +
    car.doorCloseTime +
    car.startDelay +
    flightTime(building.gap(origin, destination), car) +
    car.levellingDelay +
    Math.max(0, car.doorOpenTime - car.advanceDoorOpenTime) +
    car.passengerTransferTime
  );
}

export interface OverheadSummary {
  readonly journeys: number;
  readonly meanActual: number;
  readonly meanUnavoidable: number;
  /** Seconds of the average journey that sharing a lift with other people cost. */
  readonly meanOverhead: number;
  /** Fraction of the average journey that was overhead rather than physics. */
  readonly overheadShare: number;
  /** The worst single journey's overhead. */
  readonly worstOverhead: number;
}

export function overheadAgainstIdeal(
  building: Building,
  car: CarSpec,
  journeys: readonly Journey[],
): OverheadSummary {
  const completed = journeys.filter(
    (journey): journey is Journey & { arrivedAt: number } => journey.arrivedAt !== null,
  );
  if (completed.length === 0) {
    return {
      journeys: 0,
      meanActual: 0,
      meanUnavoidable: 0,
      meanOverhead: 0,
      overheadShare: 0,
      worstOverhead: 0,
    };
  }

  const rows = completed.map((journey) => {
    const actual = journey.arrivedAt - journey.calledAt;
    const ideal = unavoidableJourneyTime(building, car, journey.origin, journey.destination);
    return { actual, ideal, overhead: actual - ideal };
  });

  const average = (pick: (row: (typeof rows)[number]) => number): number =>
    rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;

  const meanActual = average((row) => row.actual);

  return {
    journeys: rows.length,
    meanActual,
    meanUnavoidable: average((row) => row.ideal),
    meanOverhead: average((row) => row.overhead),
    overheadShare: meanActual === 0 ? 0 : average((row) => row.overhead) / meanActual,
    worstOverhead: rows.reduce((worst, row) => Math.max(worst, row.overhead), 0),
  };
}
