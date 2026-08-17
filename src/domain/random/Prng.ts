/**
 * Seeded randomness. There is no unseeded randomness anywhere in the engine — every number
 * that varies traces back to an integer seed the caller chose, which is what makes a run
 * reproducible and what makes paired comparisons between algorithms possible at all.
 *
 * Algorithms: sfc32 for the stream, splitmix32 to expand a single seed into its 128-bit state.
 * Both are small, fast and well travelled. They are verified here statistically and for
 * determinism rather than against published test vectors, which we have no citable source for
 * — stated plainly rather than implied.
 */

export interface Prng {
  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number;
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Exponential inter-arrival gap for a Poisson process of the given rate (events/second). */
  nextExponentialGap(ratePerSecond: number): number;
  /** Index into a list of non-negative weights, proportional to weight. */
  nextWeightedIndex(weights: readonly number[]): number;
}

/** Expands one seed into four 32-bit words of state. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

export function createPrng(seed: number): Prng {
  if (!Number.isInteger(seed)) {
    throw new Error(`Seed must be an integer so a run can be reproduced; got ${seed}.`);
  }

  const expand = splitmix32(seed);
  let a = expand();
  let b = expand();
  let c = expand();
  let d = expand();

  const nextUint32 = (): number => {
    // sfc32
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  const nextFloat = (): number => nextUint32() / 0x1_0000_0000;

  const nextInt = (minInclusive: number, maxExclusive: number): number => {
    if (!(maxExclusive > minInclusive)) {
      throw new Error(
        `Empty range: nextInt(${minInclusive}, ${maxExclusive}) has nothing to choose from.`,
      );
    }
    return minInclusive + Math.floor(nextFloat() * (maxExclusive - minInclusive));
  };

  const nextExponentialGap = (ratePerSecond: number): number => {
    if (!(ratePerSecond > 0) || !Number.isFinite(ratePerSecond)) {
      throw new Error(`Arrival rate must be positive; got ${ratePerSecond}.`);
    }
    // 1 - nextFloat() lands in (0, 1], so the logarithm can never be taken of zero.
    return -Math.log(1 - nextFloat()) / ratePerSecond;
  };

  const nextWeightedIndex = (weights: readonly number[]): number => {
    let total = 0;
    for (const weight of weights) {
      if (weight < 0 || !Number.isFinite(weight)) {
        throw new Error(`Weights must be finite and non-negative; got ${weight}.`);
      }
      total += weight;
    }
    if (total <= 0) {
      throw new Error('All weights are zero, so there is nothing to choose.');
    }

    const target = nextFloat() * total;
    let cumulative = 0;
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i] ?? 0;
      if (target < cumulative) return i;
    }
    // Only reachable through floating-point drift at the very top of the range.
    return weights.length - 1;
  };

  return { nextUint32, nextFloat, nextInt, nextExponentialGap, nextWeightedIndex };
}

/**
 * Derives a stable sub-seed from a seed and a label, so independent parts of a scenario can
 * draw from separate streams without one shifting the other. Used to keep the passenger stream
 * unaffected by anything else that might want randomness later.
 */
export function deriveSeed(seed: number, label: string): number {
  let hash = seed | 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193);
  }
  return hash | 0;
}
