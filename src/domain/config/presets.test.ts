import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { validateBuilding } from './BuildingConfig';
import { floorStack, PRESET_NAMES, PRESETS } from './presets';

describe('presets', () => {
  it.each(PRESET_NAMES)('%s is a usable building', (name) => {
    expect(validateBuilding(PRESETS[name])).toEqual([]);
  });

  it('covers one car and six cars with no special casing', () => {
    expect(PRESETS['residential-low'].cars).toHaveLength(1);
    expect(PRESETS.tower.cars).toHaveLength(6);
  });

  it('gives the tower a garage entrance below ground', () => {
    const entrances = PRESETS.tower.floors.filter((f) => f.isEntrance).map((f) => f.label);
    expect(entrances).toEqual(['B2', 'G']);
  });

  it('ships starting points rather than one particular building', () => {
    // A public tool has no business carrying one person's address as a preset.
    expect(PRESET_NAMES).toEqual(['residential-low', 'office-mid', 'tower']);
  });
});

describe('floorStack', () => {
  it('labels basements, ground and upper floors the way the buttons do', () => {
    const floors = floorStack({
      from: -2,
      to: 3,
      floorHeight: 3,
      populationPerFloor: 10,
      entrances: [0],
    });
    expect(floors.map((f) => f.label)).toEqual(['B2', 'B1', 'G', '1', '2', '3']);
  });

  it('puts basements below ground level', () => {
    const floors = floorStack({
      from: -1,
      to: 1,
      floorHeight: 3,
      populationPerFloor: 0,
      entrances: [0],
    });
    expect(floors.map((f) => f.heightAboveGround)).toEqual([-3, 0, 3]);
  });

  it('houses nobody on the ground floor or in the basement', () => {
    const floors = floorStack({
      from: -1,
      to: 2,
      floorHeight: 3,
      populationPerFloor: 8,
      entrances: [0],
    });
    expect(floors.map((f) => f.population)).toEqual([0, 0, 8, 8]);
  });

  it('changing the floor count changes nothing but the config', () => {
    const short = { ...PRESETS['residential-low'] };
    const tall = {
      ...short,
      floors: floorStack({
        from: 0,
        to: 20,
        floorHeight: 2.8,
        populationPerFloor: 6,
        entrances: [0],
      }),
    };
    expect(validateBuilding(tall)).toEqual([]);
    expect(Building.of(tall).totalPopulation).toBe(120);
  });
});
