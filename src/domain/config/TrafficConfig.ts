/**
 * Demand in the industry unit — percentage of population per five minutes — so results can be
 * checked against published handling-capacity figures rather than only against ourselves.
 */

export type TrafficPattern =
  | 'up-peak'
  | 'down-peak'
  | 'interfloor'
  | 'lunch'
  | 'residential-sparse';

export const TRAFFIC_PATTERNS: readonly TrafficPattern[] = [
  'up-peak',
  'down-peak',
  'interfloor',
  'lunch',
  'residential-sparse',
];

export interface TrafficConfig {
  readonly pattern: TrafficPattern;
  /** How long to simulate, seconds. */
  readonly durationSeconds: number;
  /** Percentage of the building population arriving per 5 minutes. */
  readonly demandPercentPer5Min: number;
  /** 1 is a plain Poisson process; higher clumps the same demand into bursts. */
  readonly burstiness: number;
  /**
   * Fraction of people who will squeeze into a car going the wrong way rather than wait for it to
   * come back — because by the time it does there is often no room. 0 disables the behaviour.
   */
  readonly opportunistShare: number;
  /**
   * Seconds per floor somebody will wait before giving up and taking the stairs. 0 disables it:
   * everybody waits forever, which is what a simulator does and a building does not.
   */
  readonly stairsPatiencePerFloor: number;
  /** Nobody walks further than this, however long the wait. */
  readonly stairsMaxFloors: number;
  /**
   * Fraction of people who *could* take the stairs at all. The rest have a pram, the shopping, a
   * suitcase or bad knees: for them the lift is not a preference, and they wait however long it
   * takes. They are also the people the worst waits land on, which is why they are counted apart.
   */
  readonly stairsAbleShare: number;
  /**
   * How much room somebody who cannot manage the stairs takes up, in whole-person units. A pram is
   * the reason capacity is not a headcount: at the school run three people fill a six-person car
   * because two of them are pushing one. 1 means everybody takes the same space.
   */
  readonly encumberedSpace: number;
  /**
   * Rounds started per hour by somebody who visits several floors before leaving: the concierge,
   * a courier with a bag of parcels. This is where a block of flats' between-floor traffic
   * actually comes from — neighbours almost never ride from the second to the fourth.
   */
  readonly roundsPerHour: number;
  /** Floors visited in one round before they head back out. */
  readonly roundStops: number;
}

/**
 * Nobody gives up and nobody squeezes into a car going the wrong way. The classic simulator
 * assumption, and the one every published comparison rests on — including this project's earlier
 * results. Kept as a named position so it can be compared against, not as a silent default.
 */
export const TEXTBOOK_BEHAVIOUR = {
  opportunistShare: 0,
  stairsPatiencePerFloor: 0,
  stairsMaxFloors: 0,
  stairsAbleShare: 0,
  encumberedSpace: 1,
  roundsPerHour: 0,
  roundStops: 0,
} as const;

/**
 * What people in a block of flats actually do. DECLARED ASSUMPTIONS, not measurements:
 * two in five will board a car going the wrong way rather than wait for it to come back, and
 * people give up after about twenty seconds per floor they would have to walk, for up to three
 * floors. Both were described from life; the numbers are guesses at their size.
 */
export const OBSERVED_BEHAVIOUR = {
  opportunistShare: 0.4,
  stairsPatiencePerFloor: 20,
  stairsMaxFloors: 3,
  stairsAbleShare: 0.7,
  encumberedSpace: 2.5,
  roundsPerHour: 2,
  roundStops: 3,
} as const;

export function validateTraffic(traffic: TrafficConfig): string[] {
  const problems: string[] = [];

  if (!TRAFFIC_PATTERNS.includes(traffic.pattern)) {
    problems.push(
      `"${traffic.pattern}" is not a traffic pattern. Pick one of: ${TRAFFIC_PATTERNS.join(', ')}.`,
    );
  }

  if (!(traffic.durationSeconds > 0) || !Number.isFinite(traffic.durationSeconds)) {
    problems.push(`The simulated period is ${traffic.durationSeconds} s; it must be positive.`);
  }

  if (!(traffic.demandPercentPer5Min > 0) || !Number.isFinite(traffic.demandPercentPer5Min)) {
    problems.push(
      `Demand is ${traffic.demandPercentPer5Min}% of the population per 5 minutes; it must be ` +
        'greater than zero or nobody ever calls the lift.',
    );
  }

  if (traffic.demandPercentPer5Min > 100) {
    problems.push(
      `Demand is ${traffic.demandPercentPer5Min}% per 5 minutes, which means more than the whole ` +
        'building arrives in five minutes. Check the figure.',
    );
  }

  if (!(traffic.burstiness >= 1) || !Number.isFinite(traffic.burstiness)) {
    problems.push(
      `Burstiness is ${traffic.burstiness}; 1 is a smooth Poisson process and higher values ` +
        'clump the arrivals, so it cannot be below 1.',
    );
  }

  if (
    !Number.isFinite(traffic.opportunistShare) ||
    traffic.opportunistShare < 0 ||
    traffic.opportunistShare > 1
  ) {
    problems.push(
      `${traffic.opportunistShare} is not a share of people; it runs from 0 (nobody boards a car ` +
        'going the wrong way) to 1 (everybody does).',
    );
  }

  if (!Number.isFinite(traffic.stairsPatiencePerFloor) || traffic.stairsPatiencePerFloor < 0) {
    problems.push('Patience before taking the stairs cannot be negative.');
  }

  if (!Number.isInteger(traffic.stairsMaxFloors) || traffic.stairsMaxFloors < 0) {
    problems.push('The furthest anybody walks must be a whole number of floors, zero or more.');
  }

  if (
    !Number.isFinite(traffic.stairsAbleShare) ||
    traffic.stairsAbleShare < 0 ||
    traffic.stairsAbleShare > 1
  ) {
    problems.push(
      `${traffic.stairsAbleShare} is not a share of people; it runs from 0 (nobody can manage the ` +
        'stairs) to 1 (everybody can).',
    );
  }

  if (!Number.isFinite(traffic.encumberedSpace) || traffic.encumberedSpace < 1) {
    problems.push(
      `Somebody with a pram takes ${traffic.encumberedSpace} places; it cannot be less than the ` +
        'one place anybody takes.',
    );
  }

  if (!Number.isFinite(traffic.roundsPerHour) || traffic.roundsPerHour < 0) {
    problems.push('Rounds per hour cannot be negative.');
  }

  if (!Number.isInteger(traffic.roundStops) || traffic.roundStops < 0) {
    problems.push('A round visits a whole number of floors, zero or more.');
  }

  return problems;
}

/** Expected number of passengers over the whole simulated period. */
export function expectedArrivals(traffic: TrafficConfig, population: number): number {
  const fiveMinuteBlocks = traffic.durationSeconds / 300;
  return ((population * traffic.demandPercentPer5Min) / 100) * fiveMinuteBlocks;
}
