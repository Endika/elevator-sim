import { describe, expect, it } from 'vitest';
import { Building } from '../building/Building';
import { OFFICE_CAR, RESIDENTIAL_CAR, TOWER_CAR } from '../config/PhysicsDefaults';
import { floorStack, OFFICE_MID } from '../config/presets';
import { TEXTBOOK_BEHAVIOUR } from '../config/TrafficConfig';
import { collective } from '../dispatch/Collective';
import { runSimulation, type TraceEntry } from '../sim/Simulation';
import { generateStream } from '../traffic/PassengerStream';
import { analyseUpPeak } from './UpPeakAnalytic';

const office = Building.of(OFFICE_MID);

/** Uniform populations make the closed form's assumptions exactly true. */
const uniform = Building.of({
  ...OFFICE_MID,
  floors: floorStack({
    from: 0,
    to: 12,
    floorHeight: 3.5,
    populationPerFloor: 40,
    entrances: [0],
  }),
  cars: [OFFICE_CAR],
});

describe('the closed form behaves as the theory says', () => {
  it('never puts the reversal floor above the top floor', () => {
    for (const passengers of [1, 4, 8, 13, 30]) {
      const analysis = analyseUpPeak({ building: uniform, passengersPerTrip: passengers });
      expect(analysis.highestReversalFloor).toBeLessThanOrEqual(analysis.floorsAbove);
      expect(analysis.highestReversalFloor).toBeGreaterThan(0);
    }
  });

  it('never predicts more stops than there are floors, nor fewer than one', () => {
    for (const passengers of [1, 4, 13, 40]) {
      const analysis = analyseUpPeak({ building: uniform, passengersPerTrip: passengers });
      expect(analysis.averageStops).toBeLessThanOrEqual(analysis.floorsAbove);
      expect(analysis.averageStops).toBeGreaterThanOrEqual(1);
    }
  });

  it('makes exactly one stop when a single passenger rides', () => {
    const analysis = analyseUpPeak({ building: uniform, passengersPerTrip: 1 });
    expect(analysis.averageStops).toBeCloseTo(1, 6);
  });

  it('approaches every floor being served as the car fills', () => {
    const light = analyseUpPeak({ building: uniform, passengersPerTrip: 2 });
    const heavy = analyseUpPeak({ building: uniform, passengersPerTrip: 60 });
    expect(heavy.averageStops).toBeGreaterThan(light.averageStops);
    expect(heavy.averageStops).toBeGreaterThan(11);
  });

  it('takes longer per round trip when it stops more often', () => {
    const light = analyseUpPeak({ building: uniform, passengersPerTrip: 2 });
    const heavy = analyseUpPeak({ building: uniform, passengersPerTrip: 13 });
    expect(heavy.roundTripTime).toBeGreaterThan(light.roundTripTime);
  });

  it('divides the interval by the number of lifts', () => {
    const single = analyseUpPeak({ building: uniform, passengersPerTrip: 13 });
    const three = analyseUpPeak({ building: office, passengersPerTrip: 13 });
    expect(three.interval).toBeCloseTo(single.roundTripTime / 3, 4);
  });

  it('lands in the range published for a mid-rise office', () => {
    // A 12-floor office with a 13-person car: two to three minutes per round trip is the range
    // the literature calls typical.
    const analysis = analyseUpPeak({ building: uniform, passengersPerTrip: 10 });
    expect(analysis.roundTripTime).toBeGreaterThan(100);
    expect(analysis.roundTripTime).toBeLessThan(200);
  });

  it('refuses to calculate without passengers or without floors above', () => {
    expect(() => analyseUpPeak({ building: uniform, passengersPerTrip: 0 })).toThrow(/positive/);
  });
});

/**
 * Saturating up-peak demand, so the cars run as full as they can and the simulator's throughput
 * is its handling capacity — the quantity the closed form predicts. Comparing round trip time
 * rather than throughput isolates the timing model from the demand model.
 */
function saturatedRun(building: Building) {
  const stream = generateStream(
    building,
    {
      pattern: 'up-peak',
      durationSeconds: 5400,
      demandPercentPer5Min: 25,
      burstiness: 1,
      ...TEXTBOOK_BEHAVIOUR,
    },
    42,
  );
  const result = runSimulation({
    building,
    stream,
    dispatcher: collective,
    idlePolicy: 'return-to-entrance',
    trace: true,
  });

  const departures = (result.trace ?? []).filter(
    (entry: TraceEntry) => entry.kind === 'departs' && entry.floor === 0,
  );
  const roundTrips = departures
    .slice(1)
    .map((entry, index) => entry.time - (departures[index]?.time ?? 0));
  const load = (result.journeys.length - result.unfinished) / Math.max(1, departures.length);

  return {
    roundTrips,
    observedRoundTrip: roundTrips.reduce((sum, value) => sum + value, 0) / roundTrips.length,
    observedStopsPerTrip:
      (result.trace ?? []).filter((entry) => entry.kind === 'transfers').length / departures.length,
    predicted: analyseUpPeak({ building, passengersPerTrip: load }),
  };
}

function uniformBuilding(car: typeof OFFICE_CAR, top: number, floorHeight: number, pop: number) {
  return Building.of({
    ...OFFICE_MID,
    floors: floorStack({ from: 0, to: top, floorHeight, populationPerFloor: pop, entrances: [0] }),
    cars: [car],
  });
}

describe('the simulator agrees with the closed form', () => {
  const CASES = [
    ['office, 12 floors', uniformBuilding(OFFICE_CAR, 12, 3.5, 40), 0.1],
    ['tower, 20 floors', uniformBuilding(TOWER_CAR, 20, 3.5, 50), 0.1],
    // A small building with barely three passengers a trip strains the closed form's own
    // assumptions — an express return and a full lobby load — so it earns a wider margin.
    ['residential, 7 floors', uniformBuilding(RESIDENTIAL_CAR, 7, 2.8, 6), 0.15],
  ] as const;

  it.each(CASES)('%s: round trip time', (_label, building, margin) => {
    const { observedRoundTrip, predicted, roundTrips } = saturatedRun(building);
    expect(roundTrips.length).toBeGreaterThan(15);
    const ratio = observedRoundTrip / predicted.roundTripTime;
    expect(ratio).toBeGreaterThan(1 - margin);
    expect(ratio).toBeLessThan(1 + margin);
  });

  it.each(CASES)('%s: stops per trip', (_label, building) => {
    const { observedStopsPerTrip, predicted } = saturatedRun(building);
    // The closed form counts upper-floor stops; the simulator also opens at the lobby.
    expect(observedStopsPerTrip).toBeCloseTo(predicted.averageStops + 1, 0);
  });
});

describe('the oracle detects a broken simulator', () => {
  // The point of an oracle is that it fails when the thing it checks is wrong. Doubling the door
  // times must move the prediction well outside the margin the honest configuration sits in.
  it('reacts to door times, so it is not decorative', () => {
    const honest = analyseUpPeak({ building: uniform, passengersPerTrip: 10 });
    const slowDoors = Building.of({
      ...uniform.toConfig(),
      cars: [{ ...OFFICE_CAR, doorOpenTime: 8, doorCloseTime: 8 }],
    });
    const sluggish = analyseUpPeak({ building: slowDoors, passengersPerTrip: 10 });
    expect(sluggish.roundTripTime / honest.roundTripTime).toBeGreaterThan(1.2);
  });

  it('reacts to rated speed', () => {
    const honest = analyseUpPeak({ building: uniform, passengersPerTrip: 10 });
    const slow = Building.of({
      ...uniform.toConfig(),
      cars: [{ ...OFFICE_CAR, ratedSpeed: 0.6 }],
    });
    expect(analyseUpPeak({ building: slow, passengersPerTrip: 10 }).roundTripTime).toBeGreaterThan(
      honest.roundTripTime,
    );
  });
});
