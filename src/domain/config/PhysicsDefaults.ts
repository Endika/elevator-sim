/**
 * Default car physics, with provenance. See ../../../elevator-sim-notes/sources.md.
 *
 * Two markers are used and they mean different things:
 *   SOURCED  — traceable to a published figure, cited inline.
 *   ESTIMATE — a plausible value with no source found. Not dressed up as precision.
 *
 * The distinction matters: the whole comparison is invalid if the physics is wrong, so it has
 * to be obvious at a glance which numbers are load-bearing evidence and which are guesses.
 */

import type { CarSpec } from './BuildingConfig';

/**
 * A lift in a low-rise apartment block.
 *
 * Careful: searching for "residential lift speed" surfaces 0.15 m/s, which is a domestic
 * platform lift for a single home, not the lift in a block of flats. Different machine,
 * different regulations. Not used here.
 */
export const RESIDENTIAL_CAR: CarSpec = {
  // ESTIMATE — 6 persons / 450 kg is the common small apartment car.
  capacity: 6,
  // ESTIMATE — 1.0 m/s is ordinary for a low-rise block; no citable table found.
  ratedSpeed: 1.0,
  // SOURCED — 0.81 m/s² measured on a real installation (S1, Table 1). Acceleration is
  // limited by comfort rather than by rise, so it carries over to a slower car.
  acceleration: 0.81,
  // SOURCED — 0.51 m/s³, same measurement (S1, Table 1).
  jerk: 0.51,
  // SOURCED — 2 s appears as an example value in traffic analysis material (S3). Example,
  // not standard.
  doorOpenTime: 2.0,
  // SOURCED — 3 s, same caveat (S3).
  doorCloseTime: 3.0,
  // ESTIMATE — held open after transfer completes.
  doorDwellTime: 3.0,
  // SOURCED — CIBSE guidance per S1: ask the installer, otherwise assume 0.5 s.
  startDelay: 0.5,
  // ESTIMATE — modern drives usually land directly; a small residential machine less so.
  levellingDelay: 0.3,
  // ESTIMATE — conservative; the measured installation in S1 showed 1.0 s on a fast lift.
  advanceDoorOpenTime: 0.5,
  // SOURCED — ISO 4190-6 considers 1.75 s appropriate for residential buildings (S2).
  passengerTransferTime: 1.75,
};

/** A lift in a mid-rise office building. */
export const OFFICE_CAR: CarSpec = {
  // ESTIMATE — 13 persons / 1000 kg, a common office car.
  capacity: 13,
  // ESTIMATE — 1.6 m/s for a mid-rise group.
  ratedSpeed: 1.6,
  // SOURCED — S1, Table 1.
  acceleration: 0.81,
  // SOURCED — S1, Table 1.
  jerk: 0.51,
  // SOURCED — example value, S3.
  doorOpenTime: 2.0,
  // SOURCED — example value, S3.
  doorCloseTime: 3.0,
  // ESTIMATE.
  doorDwellTime: 2.0,
  // SOURCED — CIBSE default via S1.
  startDelay: 0.5,
  // ESTIMATE.
  levellingDelay: 0.2,
  // ESTIMATE.
  advanceDoorOpenTime: 0.8,
  // SOURCED — 1.2 s per passenger each way is the traffic-analysis reference value (S2).
  passengerTransferTime: 1.2,
};

/**
 * A high-rise car, taken straight from the one real installation measured in S1, Table 1.
 * The only preset whose kinematics and door times all come from the same measurement.
 */
export const TOWER_CAR: CarSpec = {
  // ESTIMATE — 21 persons / 1600 kg.
  capacity: 21,
  // SOURCED — 3.97 m/s measured (S1, Table 1).
  ratedSpeed: 3.97,
  // SOURCED — S1, Table 1.
  acceleration: 0.81,
  // SOURCED — S1, Table 1.
  jerk: 0.51,
  // SOURCED — 4.31 s measured (S1, Table 1).
  doorOpenTime: 4.31,
  // SOURCED — 3.84 s measured (S1, Table 1).
  doorCloseTime: 3.84,
  // ESTIMATE.
  doorDwellTime: 2.0,
  // SOURCED — 1.00 s measured (S1, Table 1).
  startDelay: 1.0,
  // SOURCED — 0.61 s measured (S1, Table 1).
  levellingDelay: 0.61,
  // SOURCED — 1.00 s measured (S1, Table 1).
  advanceDoorOpenTime: 1.0,
  // SOURCED — 1.2 s, traffic-analysis reference (S2).
  passengerTransferTime: 1.2,
};

/** ESTIMATE — floor-to-floor heights, metres. */
export const FLOOR_HEIGHT = {
  residential: 2.8,
  office: 3.5,
} as const;
