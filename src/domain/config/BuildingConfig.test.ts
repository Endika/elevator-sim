import { describe, expect, it } from 'vitest';
import {
  type BuildingConfig,
  entranceFloors,
  parseBuilding,
  totalPopulation,
  validateBuilding,
} from './BuildingConfig';
import { RESIDENTIAL_CAR } from './PhysicsDefaults';
import { floorStack, RESIDENTIAL_LOW } from './presets';

function building(overrides: Partial<BuildingConfig> = {}): BuildingConfig {
  return { ...RESIDENTIAL_LOW, ...overrides };
}

describe('a usable building', () => {
  it('accepts the residential preset', () => {
    expect(validateBuilding(RESIDENTIAL_LOW)).toEqual([]);
  });

  it('counts population across floors, ignoring the entrance', () => {
    // 7 floors above ground at 6 people each; the ground floor houses nobody.
    expect(totalPopulation(RESIDENTIAL_LOW)).toBe(42);
  });

  it('finds the entrance floors', () => {
    expect(entranceFloors(RESIDENTIAL_LOW).map((f) => f.label)).toEqual(['G']);
  });
});

describe('rejecting a building nobody could use', () => {
  it('needs at least two floors', () => {
    const problems = validateBuilding(building({ floors: RESIDENTIAL_LOW.floors.slice(0, 1) }));
    expect(problems).toContain('A building needs at least 2 floors to have a lift; got 1.');
  });

  it('needs at least one car', () => {
    expect(validateBuilding(building({ cars: [] }))).toContain('The building has no lift cars.');
  });

  it('needs somebody to carry', () => {
    const empty = floorStack({
      from: 0,
      to: 4,
      floorHeight: 2.8,
      populationPerFloor: 0,
      entrances: [0],
    });
    expect(validateBuilding(building({ floors: empty }))).toContain(
      'Total population is zero, so there would be nobody to carry.',
    );
  });

  it('needs a way in', () => {
    const noEntrance = RESIDENTIAL_LOW.floors.map((floor) => ({ ...floor, isEntrance: false }));
    expect(validateBuilding(building({ floors: noEntrance }))).toContain(
      'No floor is marked as an entrance, so nobody can get into the building.',
    );
  });

  it('rejects a car that holds nobody', () => {
    const problems = validateBuilding(building({ cars: [{ ...RESIDENTIAL_CAR, capacity: 0 }] }));
    expect(problems).toContain('Car 1 has a capacity of 0; it must hold at least 1 person.');
  });

  it('rejects a fractional number of people on a floor', () => {
    const floors = RESIDENTIAL_LOW.floors.map((floor) =>
      floor.id === 3 ? { ...floor, population: 6.5 } : floor,
    );
    expect(validateBuilding(building({ floors }))).toContain(
      'Floor "3" has a population of 6.5; it must be a whole number of people, zero or more.',
    );
  });

  it('rejects a negative population', () => {
    const floors = RESIDENTIAL_LOW.floors.map((floor) =>
      floor.id === 2 ? { ...floor, population: -1 } : floor,
    );
    expect(validateBuilding(building({ floors }))).toContain(
      'Floor "2" has a population of -1; it must be a whole number of people, zero or more.',
    );
  });

  it('rejects a stationary lift', () => {
    const problems = validateBuilding(building({ cars: [{ ...RESIDENTIAL_CAR, ratedSpeed: 0 }] }));
    expect(problems).toContain('Car 1 has a rated speed of 0; it must be greater than zero.');
  });

  it('rejects doors that open early for longer than they take to open', () => {
    const problems = validateBuilding(
      building({ cars: [{ ...RESIDENTIAL_CAR, doorOpenTime: 2, advanceDoorOpenTime: 3 }] }),
    );
    expect(problems).toContain(
      'Car 1 opens its doors early by 3 s but only takes 2 s to open them; the head start ' +
        'cannot exceed the opening.',
    );
  });

  it('rejects floors listed out of order', () => {
    const [ground, first, ...rest] = RESIDENTIAL_LOW.floors;
    if (!ground || !first) throw new Error('preset changed shape');
    const problems = validateBuilding(building({ floors: [first, ground, ...rest] }));
    expect(problems.some((p) => p.includes('must be listed bottom to top'))).toBe(true);
  });

  it('rejects an unknown idle policy', () => {
    // Cast because the point is to reject what a hand-edited URL could deliver.
    const problems = validateBuilding(building({ idlePolicy: 'teleport' as never }));
    expect(problems).toContain(
      '"teleport" is not an idle policy. Pick one of: stay-put, return-to-entrance, ' +
        'park-at-busiest, park-at-middle.',
    );
  });

  it('names every problem at once instead of stopping at the first', () => {
    const problems = validateBuilding(
      building({ cars: [{ ...RESIDENTIAL_CAR, capacity: 0, ratedSpeed: -1 }] }),
    );
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe('parseBuilding', () => {
  it('returns the building when it is usable', () => {
    expect(parseBuilding(RESIDENTIAL_LOW)).toBe(RESIDENTIAL_LOW);
  });

  it('throws listing what is wrong', () => {
    expect(() => parseBuilding(building({ cars: [] }))).toThrow(/has no lift cars/);
  });
});
