import { createPrng, deriveSeed } from '../random/Prng';
import { mean, percentile, standardDeviation } from './Percentiles';

export type Verdict = 'better' | 'worse' | 'indistinguishable';

export interface PairedResult {
  readonly metric: string;
  readonly baseline: string;
  readonly candidate: string;
  readonly seeds: number;
  readonly baselineMean: number;
  readonly candidateMean: number;
  /** candidate − baseline, averaged over the paired differences. */
  readonly meanDifference: number;
  readonly differenceSd: number;
  readonly ci95: readonly [number, number];
  readonly verdict: Verdict;
}

const BOOTSTRAP_RESAMPLES = 2000;

/**
 * Compares two algorithms on differences taken seed by seed, because both faced the identical
 * passenger stream for each seed. Comparing two independent means would throw that pairing away
 * and need far more seeds to see the same effect.
 *
 * The interval is a seeded percentile bootstrap: no distributional assumption, and reproducible.
 * When it straddles zero the verdict is `indistinguishable` — the honest answer, and the one that
 * stops a lucky seed from crowning a winner.
 */
export function comparePaired(
  metric: string,
  baseline: { readonly name: string; readonly values: readonly number[] },
  candidate: { readonly name: string; readonly values: readonly number[] },
  lowerIsBetter: boolean,
): PairedResult {
  if (baseline.values.length !== candidate.values.length) {
    throw new Error(
      `Paired comparison needs one value per seed on both sides; got ${baseline.values.length} ` +
        `and ${candidate.values.length}.`,
    );
  }
  if (baseline.values.length < 2) {
    throw new Error('A paired comparison needs at least two seeds to say anything.');
  }

  const differences = candidate.values.map((value, index) => value - (baseline.values[index] ?? 0));
  const meanDifference = mean(differences);
  const ci95 = bootstrapInterval(differences, metric);

  const straddlesZero = ci95[0] <= 0 && ci95[1] >= 0;
  const candidateIsBetter = lowerIsBetter ? meanDifference < 0 : meanDifference > 0;

  return {
    metric,
    baseline: baseline.name,
    candidate: candidate.name,
    seeds: differences.length,
    baselineMean: mean(baseline.values),
    candidateMean: mean(candidate.values),
    meanDifference,
    differenceSd: standardDeviation(differences),
    ci95,
    verdict: straddlesZero ? 'indistinguishable' : candidateIsBetter ? 'better' : 'worse',
  };
}

function bootstrapInterval(
  differences: readonly number[],
  label: string,
): readonly [number, number] {
  const prng = createPrng(deriveSeed(differences.length, `bootstrap:${label}`));
  const means: number[] = [];

  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample += 1) {
    let total = 0;
    for (let i = 0; i < differences.length; i += 1) {
      total += differences[prng.nextInt(0, differences.length)] ?? 0;
    }
    means.push(total / differences.length);
  }

  return [percentile(means, 0.025), percentile(means, 0.975)];
}
