import { describe, expect, it } from 'vitest';
import { Building } from '../domain/building/Building';
import { OFFICE_MID, RESIDENTIAL_LOW } from '../domain/config/presets';
import { TEXTBOOK_BEHAVIOUR, type TrafficConfig } from '../domain/config/TrafficConfig';
import { generateStream } from '../domain/traffic/PassengerStream';
import { experimentSpecOf, runExperiment } from './Experiment';
import { buildingOf, DEFAULT_SCENARIO, trafficConfigOf } from './Scenario';

const residential = Building.of(RESIDENTIAL_LOW);
const office = Building.of(OFFICE_MID);

const RESIDENTIAL_TRAFFIC: TrafficConfig = {
  pattern: 'residential-sparse',
  durationSeconds: 1800,
  demandPercentPer5Min: 15,
  burstiness: 2,
  ...TEXTBOOK_BEHAVIOUR,
};

const OFFICE_TRAFFIC: TrafficConfig = {
  pattern: 'up-peak',
  durationSeconds: 1800,
  demandPercentPer5Min: 10,
  burstiness: 1,
  ...TEXTBOOK_BEHAVIOUR,
};

describe('an experiment', () => {
  const result = runExperiment({
    building: residential,
    traffic: RESIDENTIAL_TRAFFIC,
    dispatchers: ['collective', 'nearest-car', 'fcfs'],
    baseline: 'collective',
    seeds: 8,
  });

  it('reports one aggregate per algorithm', () => {
    expect(result.aggregates.map((entry) => entry.dispatcher)).toEqual([
      'collective',
      'nearest-car',
      'fcfs',
    ]);
  });

  it('runs every algorithm on every seed', () => {
    for (const aggregate of result.aggregates) {
      expect(aggregate.perSeed).toHaveLength(8);
    }
  });

  it('gives every algorithm the identical demand per seed', () => {
    for (const aggregate of result.aggregates) {
      expect(aggregate.perSeed.map((entry) => entry.passengers)).toEqual(
        result.aggregates[0]?.perSeed.map((entry) => entry.passengers),
      );
    }
  });

  it('uses the seeds it says it used', () => {
    expect(result.aggregates[0]?.perSeed.map((entry) => entry.seed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('compares each candidate against the baseline and never against itself', () => {
    const candidates = new Set(result.comparisons.map((comparison) => comparison.candidate));
    expect([...candidates].sort()).toEqual(['fcfs', 'nearest-car']);
    for (const comparison of result.comparisons) {
      expect(comparison.baseline).toBe('collective');
    }
  });

  it('reports spread between seeds, not just averages', () => {
    const sd = result.aggregates[0]?.sds.waitMean;
    expect(sd).toBeGreaterThan(0);
  });

  it('is reproducible', () => {
    const again = runExperiment({
      building: residential,
      traffic: RESIDENTIAL_TRAFFIC,
      dispatchers: ['collective', 'nearest-car', 'fcfs'],
      baseline: 'collective',
      seeds: 8,
    });
    expect(again).toEqual(result);
  });
});

describe('what the office case actually shows', () => {
  const result = runExperiment({
    building: office,
    traffic: OFFICE_TRAFFIC,
    dispatchers: ['collective', 'fcfs'],
    baseline: 'collective',
    seeds: 30,
  });
  const waitMean = result.comparisons.find((comparison) => comparison.metric === 'waitMean');

  it('finds fcfs worse than collective, beyond seed noise', () => {
    expect(waitMean?.candidate).toBe('fcfs');
    expect(waitMean?.verdict).toBe('worse');
    expect(waitMean?.ci95[0]).toBeGreaterThan(0);
  });

  it('reports the effect in seconds, with its interval', () => {
    expect(waitMean?.meanDifference).toBeGreaterThan(0);
    expect(waitMean?.seeds).toBe(30);
  });
});

describe('guard rails', () => {
  it('refuses to run on a single seed', () => {
    expect(() =>
      runExperiment({
        building: residential,
        traffic: RESIDENTIAL_TRAFFIC,
        dispatchers: ['collective'],
        baseline: 'collective',
        seeds: 1,
      }),
    ).toThrow(/at least 2 seeds/);
  });

  it('refuses a baseline it is not running', () => {
    expect(() =>
      runExperiment({
        building: residential,
        traffic: RESIDENTIAL_TRAFFIC,
        dispatchers: ['fcfs'],
        baseline: 'collective',
        seeds: 4,
      }),
    ).toThrow(/not among the algorithms/);
  });

  it('reports progress up to the total number of runs', () => {
    const seen: number[] = [];
    runExperiment(
      {
        building: residential,
        traffic: RESIDENTIAL_TRAFFIC,
        dispatchers: ['collective', 'fcfs'],
        baseline: 'collective',
        seeds: 3,
      },
      (done, total) => {
        expect(total).toBe(6);
        seen.push(done);
      },
    );
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the browser and the command line cannot drift apart', () => {
  it('derives the whole experiment from the scenario alone', () => {
    const scenario = { ...DEFAULT_SCENARIO, seeds: 4 };
    const spec = experimentSpecOf(scenario);
    expect(spec.seeds).toBe(4);
    expect(spec.idlePolicy).toBe(scenario.idlePolicy);
    expect(spec.dispatchers).toEqual(scenario.dispatchers);
    expect(spec.baseline).toBe('collective');
    expect(spec.traffic).toEqual(trafficConfigOf(scenario));
  });

  it('gives identical results for the same scenario, whoever asks', () => {
    const scenario = { ...DEFAULT_SCENARIO, seeds: 4 };
    expect(runExperiment(experimentSpecOf(scenario))).toEqual(
      runExperiment(experimentSpecOf(scenario)),
    );
  });

  it('falls back to a baseline it is actually running', () => {
    const scenario = { ...DEFAULT_SCENARIO, seeds: 4, dispatchers: ['fcfs', 'etd'] as const };
    expect(experimentSpecOf(scenario).baseline).toBe('fcfs');
  });
});

describe('what the door-holders cost', () => {
  const scenario = { ...DEFAULT_SCENARIO, seeds: 6, demandPercentPer5Min: 15 };

  it('is a controlled comparison: only the holding changes', () => {
    // The share is drawn for every passenger either way, so turning it off leaves the arrival
    // times, destinations and prams identical. Without that the difference would mean nothing.
    const held = generateStream(buildingOf(scenario), trafficConfigOf(scenario), 3);
    const free = generateStream(
      buildingOf(scenario),
      { ...trafficConfigOf(scenario), doorBlockShare: 0 },
      3,
    );
    expect(held.passengers.map((p) => ({ ...p, doorHoldSeconds: 0 }))).toEqual(
      free.passengers.map((p) => ({ ...p })),
    );
  });

  it('reports what it costs, and nothing when nobody holds them', () => {
    const cost = runExperiment(experimentSpecOf(scenario)).blockedDoorsCost;
    expect(cost).not.toBeNull();
    expect(cost?.withBlocking).toBeGreaterThan(cost?.without ?? 0);
    expect(cost?.difference).toBeCloseTo((cost?.withBlocking ?? 0) - (cost?.without ?? 0), 6);

    const quiet = runExperiment(experimentSpecOf({ ...scenario, doorBlockShare: 0 }));
    expect(quiet.blockedDoorsCost).toBeNull();
  });
});

describe('the passenger stream is untouched by the experiment', () => {
  it('leaves the stream it generated identical to a fresh one', () => {
    const before = JSON.stringify(generateStream(residential, RESIDENTIAL_TRAFFIC, 3));
    runExperiment({
      building: residential,
      traffic: RESIDENTIAL_TRAFFIC,
      dispatchers: ['collective', 'nearest-car'],
      baseline: 'collective',
      seeds: 5,
    });
    expect(JSON.stringify(generateStream(residential, RESIDENTIAL_TRAFFIC, 3))).toBe(before);
  });
});
