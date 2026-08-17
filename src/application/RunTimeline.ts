import type { Building } from '../domain/building/Building';
import type { FloorId } from '../domain/config/BuildingConfig';
import type { TraceEntry } from '../domain/sim/Simulation';
import type { Journey, SimResult } from '../domain/sim/types';

export interface CarSnapshot {
  /** Fractional floor position: 3.5 means halfway between floors 3 and 4. */
  readonly position: number;
  readonly doorsOpen: boolean;
  readonly onboard: number;
}

/** Somebody mid-step between the landing and the car. `progress` runs 0 → 1 as they walk. */
export interface Transfer {
  readonly floor: FloorId;
  readonly direction: 'boarding' | 'alighting';
  readonly progress: number;
}

export interface Snapshot {
  readonly time: number;
  readonly cars: readonly CarSnapshot[];
  readonly waiting: ReadonlyMap<FloorId, number>;
  readonly transfers: readonly Transfer[];
}

interface Move {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly end: number;
}

interface CarTrack {
  readonly moves: readonly Move[];
  readonly doorWindows: readonly { start: number; end: number }[];
  readonly occupancy: readonly { time: number; onboard: number }[];
  readonly startFloor: number;
}

/**
 * Turns a completed run into something you can watch. The simulation is not re-run and not
 * altered: this only reads the trace it already produced.
 *
 * Positions between floors are eased rather than physically integrated. The jerk-limited profile
 * decides *when* the car arrives, which is what the numbers rest on; the in-between path here is
 * visual smoothing, deliberately not presented as physics.
 */
export class RunTimeline {
  private readonly tracks: readonly CarTrack[];
  private readonly journeys: readonly Journey[];
  private readonly transferTime: number;

  constructor(building: Building, result: SimResult & { readonly trace?: readonly TraceEntry[] }) {
    const trace = result.trace ?? [];
    this.journeys = result.journeys;
    this.transferTime = building.cars[0]?.passengerTransferTime ?? 1;
    this.tracks = building.cars.map((_, index) =>
      trackOf(trace.filter((e) => e.carIndex === index)),
    );
    this.duration = trace.at(-1)?.time ?? result.endTime;
  }

  readonly duration: number;

  at(time: number): Snapshot {
    return {
      time,
      cars: this.tracks.map((track) => ({
        position: positionAt(track, time),
        doorsOpen: track.doorWindows.some((window) => time >= window.start && time <= window.end),
        onboard: occupancyAt(track, time),
      })),
      waiting: this.waitingAt(time),
      transfers: this.transfersAt(time),
    };
  }

  private waitingAt(time: number): Map<FloorId, number> {
    const counts = new Map<FloorId, number>();
    for (const journey of this.journeys) {
      const boarded = journey.boardedAt;
      const stillWaiting = journey.calledAt <= time && (boarded === null || boarded > time);
      if (stillWaiting) counts.set(journey.origin, (counts.get(journey.origin) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Who is stepping in or out right now. Read straight off the journeys: a passenger's `boardedAt`
   * is the instant they finish walking in, so they were crossing the threshold for the transfer
   * time before it. Nothing extra is recorded during the run to make this work.
   */
  private transfersAt(time: number): Transfer[] {
    const transfers: Transfer[] = [];

    for (const journey of this.journeys) {
      const boarded = journey.boardedAt;
      if (boarded !== null && time > boarded - this.transferTime && time <= boarded) {
        transfers.push({
          floor: journey.origin,
          direction: 'boarding',
          progress: 1 - (boarded - time) / this.transferTime,
        });
      }

      const arrived = journey.arrivedAt;
      if (arrived !== null && time > arrived - this.transferTime && time <= arrived) {
        transfers.push({
          floor: journey.destination,
          direction: 'alighting',
          progress: 1 - (arrived - time) / this.transferTime,
        });
      }
    }

    return transfers;
  }
}

function trackOf(entries: readonly TraceEntry[]): CarTrack {
  const moves: Move[] = [];
  const doorWindows: { start: number; end: number }[] = [];
  const occupancy: { time: number; onboard: number }[] = [];

  let pendingMove: { from: number; start: number } | null = null;
  let doorsOpenedAt: number | null = null;

  for (const entry of entries) {
    occupancy.push({ time: entry.time, onboard: entry.onboard });

    if (entry.kind === 'departs' || entry.kind === 'parks') {
      pendingMove = { from: entry.floor, start: entry.time };
      continue;
    }
    if (entry.kind === 'arrives' || entry.kind === 'parked') {
      if (pendingMove) {
        moves.push({ ...pendingMove, to: entry.floor, end: entry.time });
        pendingMove = null;
      }
      if (entry.kind === 'arrives') doorsOpenedAt = entry.time;
      continue;
    }
    if (entry.kind === 'opens') doorsOpenedAt = entry.time;
    if (entry.kind === 'closes' && doorsOpenedAt !== null) {
      doorWindows.push({ start: doorsOpenedAt, end: entry.time });
      doorsOpenedAt = null;
    }
  }

  return { moves, doorWindows, occupancy, startFloor: entries[0]?.floor ?? 0 };
}

function positionAt(track: CarTrack, time: number): number {
  let position = track.startFloor;
  for (const move of track.moves) {
    if (time >= move.end) {
      position = move.to;
      continue;
    }
    if (time <= move.start) break;
    const progress = (time - move.start) / (move.end - move.start);
    return move.from + (move.to - move.from) * ease(progress);
  }
  return position;
}

/** Smoothstep: starts and ends at rest, like a lift, without pretending to be the real profile. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function occupancyAt(track: CarTrack, time: number): number {
  let onboard = 0;
  for (const point of track.occupancy) {
    if (point.time > time) break;
    onboard = point.onboard;
  }
  return onboard;
}
