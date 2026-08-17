import { describe, expect, it } from 'vitest';
import { OFFICE_MID, RESIDENTIAL_LOW, TOWER } from '../config/presets';
import { TRAFFIC_PATTERNS } from '../config/TrafficConfig';
import { createPrng } from '../random/Prng';
import { drawTrip, drawTripKind, patternIsPossible } from './patterns';

describe('every pattern produces valid journeys', () => {
  it.each(TRAFFIC_PATTERNS)('%s', (pattern) => {
    const prng = createPrng(21);
    const ids = new Set(OFFICE_MID.floors.map((f) => f.id));
    for (let i = 0; i < 500; i += 1) {
      const trip = drawTrip(OFFICE_MID, pattern, prng);
      expect(trip.origin).not.toBe(trip.destination);
      expect(ids.has(trip.origin)).toBe(true);
      expect(ids.has(trip.destination)).toBe(true);
    }
  });
});

describe('trip kinds by pattern', () => {
  it('makes up-peak purely upward', () => {
    const prng = createPrng(1);
    const kinds = new Set(Array.from({ length: 200 }, () => drawTripKind('up-peak', prng)));
    expect([...kinds]).toEqual(['up']);
  });

  it('makes down-peak purely downward', () => {
    const prng = createPrng(1);
    const kinds = new Set(Array.from({ length: 200 }, () => drawTripKind('down-peak', prng)));
    expect([...kinds]).toEqual(['down']);
  });

  it('mixes all three kinds at lunch', () => {
    const prng = createPrng(1);
    const kinds = new Set(Array.from({ length: 500 }, () => drawTripKind('lunch', prng)));
    expect([...kinds].sort()).toEqual(['down', 'interfloor', 'up']);
  });

  it('keeps interfloor a small slice of residential traffic', () => {
    const prng = createPrng(2);
    const draws = 20_000;
    let interfloor = 0;
    for (let i = 0; i < draws; i += 1) {
      if (drawTripKind('residential-sparse', prng) === 'interfloor') interfloor += 1;
    }
    // Declared assumption in patterns.ts is 10%.
    expect(interfloor / draws).toBeGreaterThan(0.09);
    expect(interfloor / draws).toBeLessThan(0.11);
  });
});

describe('busier floors generate more traffic', () => {
  it('weights origins by population in down-peak', () => {
    const lopsided = {
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? { ...floor, population: 100 } : floor,
      ),
    };
    const prng = createPrng(31);
    let fromFirstFloor = 0;
    const draws = 5_000;
    for (let i = 0; i < draws; i += 1) {
      if (drawTrip(lopsided, 'down-peak', prng).origin === 1) fromFirstFloor += 1;
    }
    // Floor 1 holds 100 of 136 people, so it should dominate.
    expect(fromFirstFloor / draws).toBeGreaterThan(0.65);
  });
});

describe('multiple entrances', () => {
  it('uses both the garage and the street door in the tower', () => {
    const prng = createPrng(41);
    const origins = new Set(
      Array.from({ length: 500 }, () => drawTrip(TOWER, 'up-peak', prng).origin),
    );
    expect([...origins].sort((a, b) => a - b)).toEqual([-2, 0]);
  });
});

describe('patternIsPossible', () => {
  it('accepts every pattern in a normal building', () => {
    for (const pattern of TRAFFIC_PATTERNS) {
      expect(patternIsPossible(OFFICE_MID, pattern)).toEqual([]);
    }
  });

  it('rejects interfloor traffic when only one floor is occupied', () => {
    const single = {
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? floor : { ...floor, population: 0 },
      ),
    };
    expect(patternIsPossible(single, 'interfloor')).toContain(
      '"interfloor" traffic moves people between occupied floors, but only 1 floor has anybody ' +
        'on it.',
    );
  });

  it('still allows up-peak with a single occupied floor', () => {
    const single = {
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? floor : { ...floor, population: 0 },
      ),
    };
    expect(patternIsPossible(single, 'up-peak')).toEqual([]);
  });
});
