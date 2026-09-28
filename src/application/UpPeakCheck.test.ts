import { describe, expect, it } from 'vitest';
import { Building } from '../domain/building/Building';
import { OFFICE_MID } from '../domain/config/presets';
import { TEXTBOOK_BEHAVIOUR } from '../domain/config/TrafficConfig';
import { analyseUpPeak } from '../domain/validation/UpPeakAnalytic';
import { runExperiment } from './Experiment';
import { upPeakRoundTripOf } from './UpPeakCheck';

const office = Building.of(OFFICE_MID);

describe('the up-peak round trip check', () => {
  const result = runExperiment({
    building: office,
    traffic: {
      pattern: 'up-peak',
      durationSeconds: 1800,
      demandPercentPer5Min: 10,
      burstiness: 1,
      ...TEXTBOOK_BEHAVIOUR,
    },
    dispatchers: ['collective'],
    baseline: 'collective',
    seeds: 3,
  });
  const collective = result.aggregates[0];
  if (!collective) throw new Error('The experiment ran no algorithm.');

  it('derives its load from the per-seed deliveries', () => {
    const delivered =
      collective.perSeed.reduce((sum, metrics) => sum + metrics.delivered, 0) /
      collective.perSeed.length;
    expect(delivered).toBeGreaterThan(0);
    const car = office.cars[0];
    if (!car) throw new Error('The office has no car.');
    const expected = analyseUpPeak({
      building: office,
      passengersPerTrip: Math.max(1, Math.min(car.capacity, delivered / 10)),
    }).roundTripTime;

    expect(upPeakRoundTripOf(office, collective)).toBeCloseTo(expected, 10);
  });

  it('has nothing to say when nobody was delivered', () => {
    const empty = {
      ...collective,
      perSeed: collective.perSeed.map((metrics) => ({ ...metrics, delivered: 0 })),
    };
    expect(upPeakRoundTripOf(office, empty)).toBeNull();
  });
});
