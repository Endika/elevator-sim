import { describe, expect, it } from 'vitest';
import { RESIDENTIAL_LOW, TOWER } from '../config/presets';
import { Building } from './Building';

const residential = Building.of(RESIDENTIAL_LOW);
const tower = Building.of(TOWER);

describe('queries', () => {
  it('counts only the people who live somewhere', () => {
    expect(residential.totalPopulation).toBe(42);
  });

  it('finds the entrances, garage included', () => {
    expect(tower.entrances.map((floor) => floor.label)).toEqual(['B2', 'G']);
  });

  it('excludes empty floors from the occupied list', () => {
    expect(residential.occupied.map((floor) => floor.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });

  it('picks the busiest floor, breaking ties from the bottom', () => {
    expect(residential.busiest?.label).toBe('1');
  });

  it('measures the gap between floors in metres, either direction', () => {
    expect(residential.gap(0, 3)).toBeCloseTo(8.4, 6);
    expect(residential.gap(3, 0)).toBeCloseTo(8.4, 6);
  });

  it('spans ground level for a building with basements', () => {
    expect(tower.gap(-2, 0)).toBeCloseTo(7, 6);
  });
});

describe('the main terminal', () => {
  it('is the street door, not the garage, when a building has both', () => {
    expect(tower.entrances.map((f) => f.label)).toEqual(['B2', 'G']);
    expect(tower.mainEntrance?.label).toBe('G');
  });

  it('falls back to the only entrance there is', () => {
    expect(residential.mainEntrance?.label).toBe('G');
  });
});

describe('unknown floors', () => {
  it('reports whether a floor exists', () => {
    expect(residential.has(3)).toBe(true);
    expect(residential.has(99)).toBe(false);
  });

  it('names the building when asked for a floor it does not have', () => {
    expect(() => residential.at(99)).toThrow(/Floor 99 is not in/);
  });
});

describe('parse', () => {
  it('rejects a config that would not work', () => {
    expect(() => Building.parse({ ...RESIDENTIAL_LOW, cars: [] })).toThrow(/no lift cars/);
  });
});
