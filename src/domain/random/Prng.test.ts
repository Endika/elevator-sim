import { describe, expect, it } from 'vitest';
import { createPrng, deriveSeed } from './Prng';

// Fixed seeds throughout: the statistical-looking assertions are deterministic and cannot go
// intermittent.

describe('determinism', () => {
  const draw = (seed: number, count: number): number[] => {
    const prng = createPrng(seed);
    return Array.from({ length: count }, () => prng.nextUint32());
  };

  it('gives the same sequence for the same seed', () => {
    expect(draw(42, 20)).toEqual(draw(42, 20));
  });

  it('advances, rather than returning the same number forever', () => {
    const prng = createPrng(42);
    const draws = Array.from({ length: 10 }, () => prng.nextUint32());
    expect(new Set(draws).size).toBe(10);
  });

  it('gives different sequences for different seeds', () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it('refuses a non-integer seed, which could not be written down and reused', () => {
    expect(() => createPrng(0.5)).toThrow(/must be an integer/);
  });

  it('works with seed zero and with negative seeds', () => {
    expect(() => createPrng(0).nextUint32()).not.toThrow();
    expect(() => createPrng(-7).nextUint32()).not.toThrow();
  });
});

describe('nextFloat', () => {
  it('stays inside [0, 1) over a long run', () => {
    const prng = createPrng(7);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const value = prng.nextFloat();
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('is roughly uniform across ten buckets', () => {
    const prng = createPrng(7);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) {
      const bucket = Math.floor(prng.nextFloat() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    // Expect 10 000 per bucket; allow 5%, which a broken generator would blow through.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9_500);
      expect(count).toBeLessThan(10_500);
    }
  });
});

describe('nextInt', () => {
  it('covers the whole range and never leaves it', () => {
    const prng = createPrng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i += 1) {
      const value = prng.nextInt(2, 7);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(7);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('rejects an empty range instead of returning something arbitrary', () => {
    expect(() => createPrng(1).nextInt(4, 4)).toThrow(/nothing to choose from/);
  });
});

describe('nextExponentialGap', () => {
  it('averages 1/rate, which is what makes the arrival rate mean what it says', () => {
    const prng = createPrng(11);
    const rate = 0.25;
    let total = 0;
    const draws = 200_000;
    for (let i = 0; i < draws; i += 1) total += prng.nextExponentialGap(rate);
    // Mean gap should be 4 s; 1% tolerance on a fixed seed.
    expect(total / draws).toBeGreaterThan(3.96);
    expect(total / draws).toBeLessThan(4.04);
  });

  it('never returns a negative gap, which would send a passenger back in time', () => {
    const prng = createPrng(5);
    for (let i = 0; i < 10_000; i += 1) {
      expect(prng.nextExponentialGap(2)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects a rate of zero rather than returning infinity', () => {
    expect(() => createPrng(1).nextExponentialGap(0)).toThrow(/must be positive/);
  });
});

describe('nextWeightedIndex', () => {
  it('picks in proportion to the weights', () => {
    const prng = createPrng(13);
    const counts = [0, 0, 0];
    const draws = 60_000;
    for (let i = 0; i < draws; i += 1) {
      const index = prng.nextWeightedIndex([1, 2, 3]);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    // Expected shares 1/6, 2/6, 3/6 of 60 000 = 10 000, 20 000, 30 000.
    expect(counts[0]).toBeGreaterThan(9_600);
    expect(counts[0]).toBeLessThan(10_400);
    expect(counts[1]).toBeGreaterThan(19_500);
    expect(counts[1]).toBeLessThan(20_500);
    expect(counts[2]).toBeGreaterThan(29_400);
    expect(counts[2]).toBeLessThan(30_600);
  });

  it('never picks a zero-weight option', () => {
    const prng = createPrng(17);
    for (let i = 0; i < 5_000; i += 1) {
      expect(prng.nextWeightedIndex([0, 1, 0])).toBe(1);
    }
  });

  it('rejects all-zero weights instead of guessing', () => {
    expect(() => createPrng(1).nextWeightedIndex([0, 0])).toThrow(/nothing to choose/);
  });

  it('rejects a negative weight', () => {
    expect(() => createPrng(1).nextWeightedIndex([1, -1])).toThrow(/non-negative/);
  });
});

describe('deriveSeed', () => {
  it('is stable for the same seed and label', () => {
    expect(deriveSeed(42, 'passenger-stream')).toBe(deriveSeed(42, 'passenger-stream'));
  });

  it('separates labels, so one sub-stream cannot shift another', () => {
    expect(deriveSeed(42, 'passenger-stream')).not.toBe(deriveSeed(42, 'something-else'));
  });

  it('separates seeds', () => {
    expect(deriveSeed(1, 'x')).not.toBe(deriveSeed(2, 'x'));
  });

  it('returns an integer, so it can seed the generator', () => {
    expect(Number.isInteger(deriveSeed(42, 'passenger-stream'))).toBe(true);
  });
});
