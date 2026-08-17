import { describe, expect, it } from 'vitest';
import { runExperiment } from './Experiment';
import { buildingOf, DEFAULT_SCENARIO, scenarioFromPreset, trafficConfigOf } from './Scenario';
import { verdictOf } from './Verdict';

function verdictFor(scenario = DEFAULT_SCENARIO, seeds = 12) {
  const result = runExperiment({
    building: buildingOf(scenario),
    traffic: trafficConfigOf(scenario),
    dispatchers: scenario.dispatchers,
    idlePolicy: scenario.idlePolicy,
    seeds,
    baseline: 'collective',
  });
  return { verdict: verdictOf(scenario, result), result };
}

describe('the residential case', () => {
  const { verdict } = verdictFor();

  it('reports where the time actually goes', () => {
    expect(verdict.doorShare).toBeGreaterThan(0.4);
    expect(verdict.points.some((point) => point.includes('doors, start delay and levelling'))).toBe(
      true,
    );
  });

  it('names a best algorithm even when the difference is noise', () => {
    expect(verdict.best).toBeTruthy();
  });

  it('says so plainly when the algorithm is not the problem', () => {
    if (!verdict.algorithmMatters) {
      expect(verdict.headline).toContain('barely matters');
      expect(verdict.points.some((point) => point.includes('seed noise'))).toBe(true);
    } else {
      expect(verdict.headline).toContain('best fit');
    }
  });

  it('quotes an interval for every comparison it reports', () => {
    const claims = verdict.points.filter((point) => point.includes('interval'));
    expect(claims.length).toBeGreaterThan(0);
  });
});

describe('the office case', () => {
  it('finds the algorithm does matter, and says which', () => {
    const scenario = { ...scenarioFromPreset('office-mid'), seeds: 20 };
    const { verdict } = verdictFor(scenario, 20);
    expect(verdict.algorithmMatters).toBe(true);
    expect(verdict.headline).toContain('best fit');
  });
});

describe('a lift with instant doors', () => {
  it('stops blaming the doors', () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      car: {
        ...DEFAULT_SCENARIO.car,
        doorOpenTime: 0,
        doorCloseTime: 0,
        doorDwellTime: 0,
        startDelay: 0,
        levellingDelay: 0,
        advanceDoorOpenTime: 0,
      },
    };
    const { verdict } = verdictFor(scenario, 6);
    expect(verdict.doorShare).toBe(0);
    expect(verdict.points.some((point) => point.includes('shortening the door dwell'))).toBe(false);
  });
});
