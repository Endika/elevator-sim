import type { Building } from '../domain/building/Building';
import { mean } from '../domain/metrics/Percentiles';
import { analyseUpPeak } from '../domain/validation/UpPeakAnalytic';
import type { Aggregate } from './Experiment';

/**
 * The closed-form up-peak round trip time for the load an algorithm actually carried, or null when
 * it carried nobody. Load comes from the raw per-seed metrics: `delivered` is not a compared
 * metric, so it never appears in the aggregate's means.
 */
export function upPeakRoundTripOf(building: Building, aggregate: Aggregate): number | null {
  const car = building.cars[0];
  if (!car) return null;
  const load = mean(aggregate.perSeed.map((metrics) => metrics.delivered));
  if (!(load > 0)) return null;
  return analyseUpPeak({
    building,
    passengersPerTrip: Math.max(1, Math.min(car.capacity, load / 10)),
  }).roundTripTime;
}
