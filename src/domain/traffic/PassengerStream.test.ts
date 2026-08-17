import { describe, expect, it } from 'vitest';
import { totalPopulation } from '../config/BuildingConfig';
import { OFFICE_MID, RESIDENTIAL_LOW } from '../config/presets';
import { expectedArrivals, type TrafficConfig } from '../config/TrafficConfig';
import { generateStream } from './PassengerStream';

const UP_PEAK: TrafficConfig = {
  pattern: 'up-peak',
  durationSeconds: 1800,
  demandPercentPer5Min: 12,
  burstiness: 1,
};

const entranceIds = RESIDENTIAL_LOW.floors.filter((f) => f.isEntrance).map((f) => f.id);

describe('common random numbers — the guarantee the whole method rests on', () => {
  it('produces an identical stream for the same seed', () => {
    const a = generateStream(RESIDENTIAL_LOW, UP_PEAK, 1);
    const b = generateStream(RESIDENTIAL_LOW, UP_PEAK, 1);
    expect(a).toEqual(b);
  });

  it('produces different demand for different seeds', () => {
    const a = generateStream(RESIDENTIAL_LOW, UP_PEAK, 1);
    const b = generateStream(RESIDENTIAL_LOW, UP_PEAK, 2);
    expect(a.passengers).not.toEqual(b.passengers);
  });

  it('cannot be mutated by whoever is being judged on it', () => {
    const stream = generateStream(RESIDENTIAL_LOW, UP_PEAK, 1);
    const first = stream.passengers[0];
    if (!first) throw new Error('expected at least one passenger');
    // Frozen, so a dispatcher cannot quietly alter the demand it is being measured against.
    expect(Object.isFrozen(stream)).toBe(true);
    expect(Object.isFrozen(stream.passengers)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { arrivalTime: number }).arrivalTime = 0;
    }).toThrow(TypeError);
  });

  it('produces byte-for-byte the same stream as when this test was pinned', () => {
    // A golden digest, verified stable across separate processes. Its job is to fail when the
    // generator changes by accident; a deliberate change means updating this number on purpose
    // and saying so, which is the point.
    const json = JSON.stringify(generateStream(RESIDENTIAL_LOW, UP_PEAK, 1));
    let hash = 0x811c9dc5;
    for (let i = 0; i < json.length; i += 1) {
      hash ^= json.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    expect((hash >>> 0).toString(16)).toBe('1bdef9fe');
  });

  it('does not depend on anything but building, traffic and seed', () => {
    // No algorithm is an argument, so no algorithm can influence its own demand. This test
    // exists to fail loudly if that signature ever grows.
    expect(generateStream.length).toBe(3);
  });
});

describe('the shape of a stream', () => {
  const stream = generateStream(RESIDENTIAL_LOW, UP_PEAK, 99);

  it('carries the seed and the scenario, so a result can be traced back', () => {
    expect(stream.seed).toBe(99);
    expect(stream.pattern).toBe('up-peak');
    expect(stream.building).toBe(RESIDENTIAL_LOW.name);
  });

  it('is ordered in time', () => {
    const times = stream.passengers.map((p) => p.arrivalTime);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('stays inside the simulated period', () => {
    for (const passenger of stream.passengers) {
      expect(passenger.arrivalTime).toBeGreaterThanOrEqual(0);
      expect(passenger.arrivalTime).toBeLessThan(UP_PEAK.durationSeconds);
    }
  });

  it('never sends anybody to the floor they are already on', () => {
    for (const passenger of stream.passengers) {
      expect(passenger.origin).not.toBe(passenger.destination);
    }
  });

  it('only uses floors the building has', () => {
    const ids = new Set(RESIDENTIAL_LOW.floors.map((f) => f.id));
    for (const passenger of stream.passengers) {
      expect(ids.has(passenger.origin)).toBe(true);
      expect(ids.has(passenger.destination)).toBe(true);
    }
  });

  it('numbers passengers consecutively from one', () => {
    expect(stream.passengers.map((p) => p.id)).toEqual(
      stream.passengers.map((_, index) => index + 1),
    );
  });
});

describe('up-peak is pure, because the T7 analytic check assumes it is', () => {
  it('starts every journey at an entrance', () => {
    const stream = generateStream(OFFICE_MID, UP_PEAK, 4);
    const fromEntrance = stream.passengers.filter((p) =>
      OFFICE_MID.floors.some((f) => f.id === p.origin && f.isEntrance),
    );
    expect(fromEntrance).toHaveLength(stream.passengers.length);
  });

  it('sends everybody upstairs', () => {
    const stream = generateStream(OFFICE_MID, UP_PEAK, 4);
    for (const passenger of stream.passengers) {
      expect(passenger.destination).toBeGreaterThan(passenger.origin);
    }
  });
});

describe('down-peak', () => {
  it('ends every journey at an entrance', () => {
    const stream = generateStream(RESIDENTIAL_LOW, { ...UP_PEAK, pattern: 'down-peak' }, 4);
    expect(stream.passengers.length).toBeGreaterThan(0);
    for (const passenger of stream.passengers) {
      expect(entranceIds).toContain(passenger.destination);
    }
  });
});

describe('demand adds up to what was asked for', () => {
  it('averages the expected number of passengers across 30 seeds', () => {
    const counts = Array.from(
      { length: 30 },
      (_, seed) => generateStream(RESIDENTIAL_LOW, UP_PEAK, seed + 1).passengers.length,
    );
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const expected = expectedArrivals(UP_PEAK, totalPopulation(RESIDENTIAL_LOW));
    // 42 people, 12% per 5 min over 30 min = 30.24 expected arrivals. Fixed seeds, so this is
    // a deterministic assertion despite looking statistical.
    expect(expected).toBeCloseTo(30.24, 2);
    expect(mean).toBeGreaterThan(expected * 0.85);
    expect(mean).toBeLessThan(expected * 1.15);
  });

  it('keeps the same expected demand when arrivals are bursty', () => {
    const smooth = Array.from(
      { length: 30 },
      (_, seed) => generateStream(RESIDENTIAL_LOW, UP_PEAK, seed + 1).passengers.length,
    );
    const bursty = Array.from(
      { length: 30 },
      (_, seed) =>
        generateStream(RESIDENTIAL_LOW, { ...UP_PEAK, burstiness: 3 }, seed + 1).passengers.length,
    );
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Burstiness clumps arrivals; it must not smuggle in extra demand.
    expect(mean(bursty)).toBeGreaterThan(mean(smooth) * 0.8);
    expect(mean(bursty)).toBeLessThan(mean(smooth) * 1.2);
  });

  it('clumps arrivals when bursty and does not when smooth', () => {
    const smooth = generateStream(RESIDENTIAL_LOW, UP_PEAK, 8);
    const bursty = generateStream(RESIDENTIAL_LOW, { ...UP_PEAK, burstiness: 3 }, 8);
    const distinctShare = (times: readonly number[]) => new Set(times).size / times.length;

    expect(distinctShare(smooth.passengers.map((p) => p.arrivalTime))).toBe(1);
    expect(distinctShare(bursty.passengers.map((p) => p.arrivalTime))).toBeLessThan(1);
  });

  it('gives a group a shared origin', () => {
    const bursty = generateStream(RESIDENTIAL_LOW, { ...UP_PEAK, burstiness: 4 }, 8);
    const byTime = new Map<number, Set<number>>();
    for (const passenger of bursty.passengers) {
      const origins = byTime.get(passenger.arrivalTime) ?? new Set<number>();
      origins.add(passenger.origin);
      byTime.set(passenger.arrivalTime, origins);
    }
    for (const origins of byTime.values()) {
      expect(origins.size).toBe(1);
    }
  });
});

describe('refusing to generate nonsense', () => {
  it('rejects impossible demand instead of producing an empty morning', () => {
    expect(() =>
      generateStream(RESIDENTIAL_LOW, { ...UP_PEAK, demandPercentPer5Min: 0 }, 1),
    ).toThrow(/greater than zero/);
  });

  it('rejects a building where the only populated floor is the only way in', () => {
    const oneFloor = {
      ...RESIDENTIAL_LOW,
      floors: [
        { id: 0, label: 'G', heightAboveGround: 0, population: 4, isEntrance: true },
        { id: 1, label: '1', heightAboveGround: 2.8, population: 0, isEntrance: false },
      ],
    };
    expect(() => generateStream(oneFloor, { ...UP_PEAK, pattern: 'down-peak' }, 1)).toThrow(
      /no journey to simulate/,
    );
  });
});
