/** Nearest-rank percentile on a sorted copy. p is a fraction in [0, 1]. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  if (p < 0 || p > 1) throw new Error(`Percentile must be between 0 and 1; got ${p}.`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? Number.NaN;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation, the spread between seeds rather than of the population. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  const sumSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

export function max(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => (b > a ? b : a));
}
