import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { OFFICE_MID, RESIDENTIAL_LOW, TOWER } from '../config/presets';
import { TRAFFIC_PATTERNS } from '../config/TrafficConfig';
import { createPrng } from '../random/Prng';
import { drawTrip, drawTripKind, patternIsPossible } from './patterns';

const office = Building.of(OFFICE_MID);
const tower = Building.of(TOWER);

describe('every pattern produces valid journeys', () => {
  it.each(TRAFFIC_PATTERNS)('%s', (pattern) => {
    const prng = createPrng(21);
    const ids = new Set(office.floorIds);
    for (let i = 0; i < 500; i += 1) {
      const trip = drawTrip(office, pattern, prng);
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

  it('never sends a neighbour from one floor to another in a block of flats', () => {
    // Residents ride to and from the entrance and nowhere else. The between-floor traffic a block
    // really has belongs to the concierge and the courier, and those are generated as rounds.
    const prng = createPrng(2);
    for (let i = 0; i < 20_000; i += 1) {
      expect(drawTripKind('residential-sparse', prng)).not.toBe('interfloor');
    }
  });

  it('gives office lunch more interfloor traffic than a block of flats', () => {
    const share = (pattern: 'lunch' | 'residential-sparse'): number => {
      const prng = createPrng(3);
      let interfloor = 0;
      for (let i = 0; i < 20_000; i += 1) {
        if (drawTripKind(pattern, prng) === 'interfloor') interfloor += 1;
      }
      return interfloor / 20_000;
    };
    expect(share('lunch')).toBeGreaterThan(0.15);
    expect(share('residential-sparse')).toBe(0);
  });

  it('makes every pattern produce a different morning', () => {
    // Two patterns with identical mixes are the same pattern wearing two names, and the report
    // silently prints the same numbers twice. This caught exactly that.
    const streams = TRAFFIC_PATTERNS.map((pattern) => {
      const prng = createPrng(7);
      return Array.from({ length: 200 }, () => drawTrip(office, pattern, prng))
        .map((trip) => `${trip.kind}${trip.origin}>${trip.destination}`)
        .join('|');
    });
    expect(new Set(streams).size).toBe(TRAFFIC_PATTERNS.length);
  });
});

describe('busier floors generate more traffic', () => {
  it('weights origins by population in down-peak', () => {
    const lopsided = Building.of({
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? { ...floor, population: 100 } : floor,
      ),
    });
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
      Array.from({ length: 500 }, () => drawTrip(tower, 'up-peak', prng).origin),
    );
    expect([...origins].sort((a, b) => a - b)).toEqual([-2, 0]);
  });
});

describe('patternIsPossible', () => {
  it('accepts every pattern in a normal building', () => {
    for (const pattern of TRAFFIC_PATTERNS) {
      expect(patternIsPossible(office, pattern)).toEqual([]);
    }
  });

  it('rejects interfloor traffic when only one floor is occupied', () => {
    const single = Building.of({
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? floor : { ...floor, population: 0 },
      ),
    });
    expect(patternIsPossible(single, 'interfloor')).toContain(
      '"interfloor" traffic moves people between occupied floors, but only 1 floor has anybody ' +
        'on it.',
    );
  });

  it('still allows up-peak with a single occupied floor', () => {
    const single = Building.of({
      ...RESIDENTIAL_LOW,
      floors: RESIDENTIAL_LOW.floors.map((floor) =>
        floor.id === 1 ? floor : { ...floor, population: 0 },
      ),
    });
    expect(patternIsPossible(single, 'up-peak')).toEqual([]);
  });
});
