import { writeFileSync } from 'node:fs';
import { runExperiment } from '../src/application/Experiment';
import { buildingOf, scenarioFromPreset, trafficConfigOf } from '../src/application/Scenario';
import { verdictOf } from '../src/application/Verdict';
import type { IdlePolicy } from '../src/domain/config/BuildingConfig';
import { IDLE_POLICIES } from '../src/domain/config/BuildingConfig';
import type { PresetName } from '../src/domain/config/presets';
import { PRESET_NAMES } from '../src/domain/config/presets';
import type { TrafficPattern } from '../src/domain/config/TrafficConfig';
import { TRAFFIC_PATTERNS } from '../src/domain/config/TrafficConfig';
import { clairvoyantOf } from '../src/domain/dispatch/Clairvoyant';
import { DISPATCHER_NAMES, DISPATCHERS } from '../src/domain/dispatch/registry';
import { mean } from '../src/domain/metrics/Percentiles';
import { runSimulation } from '../src/domain/sim/Simulation';
import { generateStream } from '../src/domain/traffic/PassengerStream';
import { overheadAgainstIdeal } from '../src/domain/validation/IdealJourney';
import { analyseUpPeak } from '../src/domain/validation/UpPeakAnalytic';

/**
 * Batch runner for the report. Same engine as the browser — there is a test that the two agree —
 * but able to sweep every preset, pattern and idle policy in one go.
 */

interface Options {
  readonly preset: PresetName;
  readonly pattern: TrafficPattern | 'all';
  readonly idlePolicy: IdlePolicy | 'all';
  readonly seeds: number;
  readonly demand: number | null;
  readonly out: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg?.startsWith('--')) flags.set(arg.slice(2), argv[i + 1] ?? '');
  }

  const preset = flags.get('preset') ?? 'residential-low';
  if (!(PRESET_NAMES as readonly string[]).includes(preset)) {
    throw new Error(`Unknown preset "${preset}". Options: ${PRESET_NAMES.join(', ')}.`);
  }

  const pattern = flags.get('pattern') ?? 'all';
  if (pattern !== 'all' && !(TRAFFIC_PATTERNS as readonly string[]).includes(pattern)) {
    throw new Error(`Unknown pattern "${pattern}". Options: all, ${TRAFFIC_PATTERNS.join(', ')}.`);
  }

  const idlePolicy = flags.get('idle') ?? 'all';
  if (idlePolicy !== 'all' && !(IDLE_POLICIES as readonly string[]).includes(idlePolicy)) {
    throw new Error(
      `Unknown idle policy "${idlePolicy}". Options: all, ${IDLE_POLICIES.join(', ')}.`,
    );
  }

  const seeds = Number(flags.get('seeds') ?? '30');
  if (!Number.isInteger(seeds) || seeds < 2)
    throw new Error('--seeds needs an integer of 2 or more.');

  const rawDemand = flags.get('demand');
  const demand = rawDemand === undefined ? null : Number(rawDemand);
  if (demand !== null && !(demand > 0 && demand <= 100)) {
    throw new Error('--demand is a percentage of the population per 5 minutes, above 0 up to 100.');
  }

  return {
    preset: preset as PresetName,
    pattern: pattern as TrafficPattern | 'all',
    idlePolicy: idlePolicy as IdlePolicy | 'all',
    seeds,
    demand,
    out: flags.get('out') ?? null,
  };
}

const options = parseArgs(process.argv.slice(2));
const base = scenarioFromPreset(options.preset);
const patterns = options.pattern === 'all' ? TRAFFIC_PATTERNS : [options.pattern];
const policies = options.idlePolicy === 'all' ? IDLE_POLICIES : [options.idlePolicy];

const rows: Record<string, unknown>[] = [];

for (const pattern of patterns) {
  for (const idlePolicy of policies) {
    const scenario = {
      ...base,
      pattern,
      idlePolicy,
      seeds: options.seeds,
      ...(options.demand === null ? {} : { demandPercentPer5Min: options.demand }),
    };
    const building = buildingOf(scenario);
    const traffic = trafficConfigOf(scenario);

    const result = runExperiment({
      building,
      traffic,
      dispatchers: DISPATCHER_NAMES,
      idlePolicy,
      seeds: options.seeds,
      baseline: 'collective',
    });
    const verdict = verdictOf(scenario, result);

    // The clairvoyant reference runs outside the experiment: it is handed the stream, so it is
    // not a peer of the online algorithms and must not sit in the same paired comparison.
    const clairvoyantWaits: number[] = [];
    for (let seed = 1; seed <= options.seeds; seed += 1) {
      const stream = generateStream(building, traffic, seed);
      const run = runSimulation({
        building,
        stream,
        dispatcher: clairvoyantOf(stream),
        idlePolicy,
      });
      const waits = run.journeys
        .filter((journey) => journey.boardedAt !== null)
        .map((journey) => (journey.boardedAt ?? 0) - journey.calledAt);
      clairvoyantWaits.push(mean(waits));
    }

    const car = building.cars[0];
    const baselineRun = runSimulation({
      building,
      stream: generateStream(building, traffic, 1),
      dispatcher: DISPATCHERS.collective,
      idlePolicy,
    });
    const overhead = car ? overheadAgainstIdeal(building, car, baselineRun.journeys) : null;

    for (const aggregate of result.aggregates) {
      rows.push({
        preset: options.preset,
        pattern,
        idlePolicy,
        algorithm: aggregate.dispatcher,
        seeds: options.seeds,
        waitMean: round(aggregate.means.waitMean),
        waitSd: round(aggregate.sds.waitMean),
        waitP95: round(aggregate.means.waitP95),
        waitWorst: round(aggregate.means.waitWorst),
        journeyMean: round(aggregate.means.journeyMean),
        overThresholdShare: round(aggregate.means.overThresholdShare),
        carStarts: round(aggregate.means.carStarts),
        carDistance: round(aggregate.means.carDistance),
      });
    }

    rows.push({
      preset: options.preset,
      pattern,
      idlePolicy,
      algorithm: 'clairvoyant (offline reference)',
      seeds: options.seeds,
      waitMean: round(mean(clairvoyantWaits)),
    });

    // Saturation has to be stated: once demand outruns capacity everything queues and the
    // algorithm stops being what decides the wait.
    const served = mean(
      result.aggregates
        .filter((entry) => entry.dispatcher === 'collective')
        .flatMap((entry) => entry.perSeed.map((metrics) => metrics.delivered)),
    );
    const totalOffered = mean(
      result.aggregates
        .filter((entry) => entry.dispatcher === 'collective')
        .flatMap((entry) => entry.perSeed.map((metrics) => metrics.passengers)),
    );
    const servedShare = totalOffered === 0 ? 1 : served / totalOffered;

    console.log(
      `\n# ${options.preset} · ${pattern} · idle: ${idlePolicy} · ` +
        `demand ${scenario.demandPercentPer5Min}%/5min`,
    );
    console.log(
      `  offered ${round(totalOffered)} passengers, delivered ${round(served)} ` +
        `(${round(servedShare * 100)}%)${servedShare < 0.95 ? ' — SATURATED' : ''}`,
    );

    console.log(`verdict: ${verdict.headline}`);
    for (const comparison of result.comparisons.filter((c) => c.metric === 'waitMean')) {
      console.log(
        `  ${comparison.candidate} vs ${comparison.baseline}: ${comparison.verdict} ` +
          `(${round(comparison.meanDifference)} s, 95% ${round(comparison.ci95[0])} to ` +
          `${round(comparison.ci95[1])})`,
      );
    }
    console.log(`  clairvoyant reference mean wait: ${round(mean(clairvoyantWaits))} s`);
    if (overhead) {
      console.log(
        `  overhead above the unavoidable journey: ${round(overhead.meanOverhead)} s of ` +
          `${round(overhead.meanActual)} s (${round(overhead.overheadShare * 100)}%)`,
      );
    }
    if (pattern === 'up-peak' && car) {
      const load = mean(
        result.aggregates
          .filter((entry) => entry.dispatcher === 'collective')
          .map((entry) => entry.means.delivered ?? 0),
      );
      if (load > 0) {
        const analytic = analyseUpPeak({
          building,
          passengersPerTrip: Math.max(1, Math.min(car.capacity, load / 10)),
        });
        console.log(`  analytic up-peak RTT: ${round(analytic.roundTripTime)} s`);
      }
    }
  }
}

if (options.out) {
  writeFileSync(options.out, JSON.stringify(rows, null, 2));
  const header = Object.keys(rows[0] ?? {});
  const csv = [
    header.join(','),
    ...rows.map((row) => header.map((key) => String(row[key] ?? '')).join(',')),
  ].join('\n');
  writeFileSync(options.out.replace(/\.json$/, '.csv'), csv);
  console.log(`\nwrote ${options.out} and its .csv sibling`);
}

function round(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.round(value * 100) / 100;
}
