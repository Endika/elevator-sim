import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, scenarioFromPreset } from '../../application/Scenario';
import { decodeScenario, encodeScenario } from './ScenarioCodec';

describe('a scenario survives the round trip', () => {
  it('comes back identical', () => {
    expect(decodeScenario(encodeScenario(DEFAULT_SCENARIO))).toEqual(DEFAULT_SCENARIO);
  });

  it('comes back identical for every preset', () => {
    for (const name of ['residential-low', 'office-mid', 'tower', 'my-building'] as const) {
      const scenario = scenarioFromPreset(name);
      expect(decodeScenario(encodeScenario(scenario))).toEqual(scenario);
    }
  });

  it('tolerates a leading question mark', () => {
    expect(decodeScenario(`?${encodeScenario(DEFAULT_SCENARIO)}`)).toEqual(DEFAULT_SCENARIO);
  });
});

describe('a hand-edited link degrades instead of breaking', () => {
  it('falls back to defaults when the query is empty', () => {
    expect(decodeScenario('')).toEqual(DEFAULT_SCENARIO);
  });

  it('ignores junk values', () => {
    const scenario = decodeScenario('f=banana&c=-3&s=NaN&v=0');
    expect(scenario.floorsAbove).toBe(DEFAULT_SCENARIO.floorsAbove);
    expect(scenario.cars).toBe(DEFAULT_SCENARIO.cars);
    expect(scenario.seeds).toBe(DEFAULT_SCENARIO.seeds);
    expect(scenario.car.ratedSpeed).toBe(DEFAULT_SCENARIO.car.ratedSpeed);
  });

  it('ignores an idle policy or pattern it does not know', () => {
    const scenario = decodeScenario('ip=teleport&tp=rush-hour');
    expect(scenario.idlePolicy).toBe(DEFAULT_SCENARIO.idlePolicy);
    expect(scenario.pattern).toBe(DEFAULT_SCENARIO.pattern);
  });

  it('keeps only algorithms it recognises, and falls back below two', () => {
    expect(decodeScenario('a=collective,made-up').dispatchers).toEqual(
      DEFAULT_SCENARIO.dispatchers,
    );
    expect(decodeScenario('a=collective,fcfs,nonsense').dispatchers).toEqual([
      'collective',
      'fcfs',
    ]);
  });

  it('accepts zero for values that may legitimately be zero', () => {
    expect(decodeScenario('b=0&ad=0&lv=0').basements).toBe(0);
    expect(decodeScenario('ad=0').car.advanceDoorOpenTime).toBe(0);
  });

  it('keeps the query short enough to paste', () => {
    expect(encodeScenario(DEFAULT_SCENARIO).length).toBeLessThan(300);
  });
});
