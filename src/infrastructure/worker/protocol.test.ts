import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO } from '../../application/Scenario';
import { isSweepRequest } from './protocol';

describe('isSweepRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isSweepRequest({ scenario: DEFAULT_SCENARIO })).toBe(true);
  });

  it('rejects null and undefined', () => {
    expect(isSweepRequest(null)).toBe(false);
    expect(isSweepRequest(undefined)).toBe(false);
  });

  it('rejects a request with no scenario', () => {
    expect(isSweepRequest({})).toBe(false);
    expect(isSweepRequest({ scenario: null })).toBe(false);
  });

  it('rejects a scenario missing a field the worker relies on', () => {
    const { seeds, ...rest } = DEFAULT_SCENARIO;
    expect(isSweepRequest({ scenario: rest })).toBe(false);
  });

  it('rejects a scenario with a field of the wrong type', () => {
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, seeds: '30' } })).toBe(false);
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, destinationEntry: 'yes' } })).toBe(
      false,
    );
  });

  it('rejects an idle policy, landing arrangement or pattern it does not recognise', () => {
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, idlePolicy: 'teleport' } })).toBe(
      false,
    );
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, landingButtons: 'sideways' } })).toBe(
      false,
    );
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, pattern: 'rush-hour' } })).toBe(false);
  });

  it('rejects dispatchers that are empty, missing, or contain an unknown name', () => {
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, dispatchers: [] } })).toBe(false);
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, dispatchers: ['made-up'] } })).toBe(
      false,
    );
    const { dispatchers, ...rest } = DEFAULT_SCENARIO;
    expect(isSweepRequest({ scenario: rest })).toBe(false);
  });

  it('rejects a car spec missing a field the worker reads', () => {
    const { capacity, ...restOfCar } = DEFAULT_SCENARIO.car;
    expect(isSweepRequest({ scenario: { ...DEFAULT_SCENARIO, car: restOfCar } })).toBe(false);
  });

  it('rejects a request that is not an object', () => {
    expect(isSweepRequest('scenario')).toBe(false);
    expect(isSweepRequest(42)).toBe(false);
  });
});
