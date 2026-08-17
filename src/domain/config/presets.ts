/**
 * Buildings you can pick from a dropdown. Each one is plain data — the point of the presets is
 * that nothing about them is special-cased anywhere in the engine.
 */

import type { BuildingConfig, CarSpec, Floor } from './BuildingConfig';
import { FLOOR_HEIGHT, OFFICE_CAR, RESIDENTIAL_CAR, TOWER_CAR } from './PhysicsDefaults';

interface FloorRangeSpec {
  /** Lowest floor id, negative for basements. */
  readonly from: number;
  /** Highest floor id. */
  readonly to: number;
  readonly floorHeight: number;
  /** People per floor above ground. Entrances and basements get none by default. */
  readonly populationPerFloor: number;
  /** Which ids people enter the building through. */
  readonly entrances: readonly number[];
}

/** Builds a contiguous stack of floors, labelling basements B1, B2… and ground G. */
export function floorStack(spec: FloorRangeSpec): Floor[] {
  const floors: Floor[] = [];
  for (let id = spec.from; id <= spec.to; id += 1) {
    const isEntrance = spec.entrances.includes(id);
    floors.push({
      id,
      label: id < 0 ? `B${-id}` : id === 0 ? 'G' : String(id),
      heightAboveGround: id * spec.floorHeight,
      population: id > 0 ? spec.populationPerFloor : 0,
      isEntrance,
    });
  }
  return floors;
}

function cars(spec: CarSpec, count: number): CarSpec[] {
  return Array.from({ length: count }, () => spec);
}

/**
 * A low block of flats with a single car: the case that motivated the project, and the one
 * where the dispatch algorithm is least likely to be what is wrong.
 */
export const RESIDENTIAL_LOW: BuildingConfig = {
  name: 'Low-rise residential, 7 floors, 1 car',
  floors: floorStack({
    from: 0,
    to: 7,
    floorHeight: FLOOR_HEIGHT.residential,
    populationPerFloor: 6,
    entrances: [0],
  }),
  cars: cars(RESIDENTIAL_CAR, 1),
  destinationEntry: false,
  idlePolicy: 'stay-put',
  idleDelaySeconds: 30,
};

/** A mid-rise office with a small group: where dispatch choices start to bite. */
export const OFFICE_MID: BuildingConfig = {
  name: 'Mid-rise office, 12 floors, 3 cars',
  floors: floorStack({
    from: 0,
    to: 12,
    floorHeight: FLOOR_HEIGHT.office,
    populationPerFloor: 40,
    entrances: [0],
  }),
  cars: cars(OFFICE_CAR, 3),
  destinationEntry: false,
  idlePolicy: 'return-to-entrance',
  idleDelaySeconds: 60,
};

/** A tower with a garage level, six cars, and the measured high-speed car from S1. */
export const TOWER: BuildingConfig = {
  name: 'Tower, 25 floors + garage, 6 cars',
  floors: floorStack({
    from: -2,
    to: 25,
    floorHeight: FLOOR_HEIGHT.office,
    populationPerFloor: 50,
    entrances: [-2, 0],
  }),
  cars: cars(TOWER_CAR, 6),
  destinationEntry: true,
  idlePolicy: 'park-at-busiest',
  idleDelaySeconds: 60,
};

/**
 * The building this project exists to answer questions about.
 *
 * Currently a copy of RESIDENTIAL_LOW because the real figures have not been supplied yet.
 * Deliberately kept as a separate export rather than an alias, so that filling in real
 * numbers is an edit to this object and nothing else.
 */
export const MY_BUILDING: BuildingConfig = {
  ...RESIDENTIAL_LOW,
  name: 'My building (placeholder — real figures pending)',
};

export const PRESETS = {
  'residential-low': RESIDENTIAL_LOW,
  'office-mid': OFFICE_MID,
  tower: TOWER,
  'my-building': MY_BUILDING,
} as const;

export type PresetName = keyof typeof PRESETS;

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];
