import { describe, expect, it } from 'vitest';
import { collective } from '../domain/dispatch/Collective';
import { runSimulation } from '../domain/sim/Simulation';
import { generateStream } from '../domain/traffic/PassengerStream';
import { RunTimeline } from './RunTimeline';
import { buildingOf, DEFAULT_SCENARIO, trafficConfigOf } from './Scenario';

const scenario = { ...DEFAULT_SCENARIO, durationMinutes: 10 };
const building = buildingOf(scenario);
const stream = generateStream(building, trafficConfigOf(scenario), 1);
const result = runSimulation({
  building,
  stream,
  dispatcher: collective,
  idlePolicy: 'stay-put',
  trace: true,
});
const timeline = new RunTimeline(building, result);

describe('positions', () => {
  it('stays within the shaft at every moment sampled', () => {
    const lowest = building.floors[0]?.id ?? 0;
    const highest = building.floors.at(-1)?.id ?? 0;
    for (let time = 0; time <= timeline.duration; time += 2) {
      for (const car of timeline.at(time).cars) {
        expect(car.position).toBeGreaterThanOrEqual(lowest);
        expect(car.position).toBeLessThanOrEqual(highest);
      }
    }
  });

  it('moves continuously, never jumping a floor between frames', () => {
    let previous = timeline.at(0).cars[0]?.position ?? 0;
    for (let time = 0.25; time <= timeline.duration; time += 0.25) {
      const position = timeline.at(time).cars[0]?.position ?? 0;
      expect(Math.abs(position - previous)).toBeLessThan(1);
      previous = position;
    }
  });

  it('sits exactly on a floor while the doors are open', () => {
    for (let time = 0; time <= timeline.duration; time += 1) {
      for (const car of timeline.at(time).cars) {
        if (car.doorsOpen) expect(car.position).toBeCloseTo(Math.round(car.position), 6);
      }
    }
  });
});

describe('waiting counts', () => {
  it('starts empty and ends empty', () => {
    expect([...timeline.at(0).waiting.values()].reduce((a, b) => a + b, 0)).toBe(0);
    const atEnd = timeline.at(timeline.duration).waiting;
    expect([...atEnd.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('never counts more people than ever called from that floor', () => {
    for (let time = 0; time <= timeline.duration; time += 5) {
      for (const [floor, waiting] of timeline.at(time).waiting) {
        const everCalled = result.journeys.filter((journey) => journey.origin === floor).length;
        expect(waiting).toBeLessThanOrEqual(everCalled);
      }
    }
  });

  it('counts somebody the instant they press the button', () => {
    const first = result.journeys[0];
    if (!first) throw new Error('expected a journey');
    expect(timeline.at(first.calledAt).waiting.get(first.origin) ?? 0).toBeGreaterThan(0);
  });
});

describe('the timeline reads the run rather than redoing it', () => {
  it('does not alter the result it was given', () => {
    const before = JSON.stringify(result.journeys);
    new RunTimeline(building, result).at(50);
    expect(JSON.stringify(result.journeys)).toBe(before);
  });
});
