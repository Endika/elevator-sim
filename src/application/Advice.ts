import { IDLE_POLICIES } from '../domain/config/BuildingConfig';
import { DISPATCHERS, type DispatcherName } from '../domain/dispatch/registry';
import { mean } from '../domain/metrics/Percentiles';
import { runSimulation } from '../domain/sim/Simulation';
import { generateStream } from '../domain/traffic/PassengerStream';
import { buildingOf, type Scenario, trafficConfigOf } from './Scenario';

/**
 * How much work a change is, which matters as much as what it saves. A recommendation that ignores
 * the difference between a notice on the wall and a second lift shaft is not advice.
 */
export type Effort = 'free' | 'a phone call' | 'building work';

export interface Lever {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly effort: Effort;
  readonly waitAfter: number;
  /** Seconds off the average wait. Negative means it makes things worse. */
  readonly saved: number;
}

export interface Advice {
  readonly waitNow: number;
  readonly levers: readonly Lever[];
}

export type AdviceProgress = (done: number, total: number) => void;

/**
 * Tries the changes a building can actually make and ranks them by what they are measured to save,
 * all on the same seeds and the same passengers. This is the part that turns "which algorithm" into
 * "what should we do", and it is usually not the algorithm.
 */
export function adviceFor(
  scenario: Scenario,
  baseline: DispatcherName,
  onProgress?: AdviceProgress,
): Advice {
  const candidates: {
    id: string;
    label: string;
    detail: string;
    effort: Effort;
    scenario: Scenario;
  }[] = [];

  for (const name of Object.keys(DISPATCHERS) as DispatcherName[]) {
    if (name === baseline) continue;
    candidates.push({
      id: `algorithm:${name}`,
      label: `Switch the controller to ${name}`,
      detail: 'A different dispatching rule in the same lift.',
      effort: 'a phone call',
      scenario: { ...scenario, dispatchers: [name, baseline] },
    });
  }

  for (const policy of IDLE_POLICIES) {
    if (policy === scenario.idlePolicy) continue;
    candidates.push({
      id: `idle:${policy}`,
      label: `Park it differently when idle: ${policy}`,
      detail: 'Where the car waits when nobody has called it.',
      effort: 'a phone call',
      scenario: { ...scenario, idlePolicy: policy },
    });
  }

  if (scenario.doorBlockShare > 0 && scenario.doorBlockSeconds > 0) {
    candidates.push({
      id: 'no-blocking',
      label: 'Nobody holds the doors while loading',
      detail: 'A notice in the lobby. The only change here that costs nothing.',
      effort: 'free',
      scenario: { ...scenario, doorBlockShare: 0 },
    });
  }

  candidates.push({
    id: 'faster-doors',
    label: 'One second off the doors, each way',
    detail: 'Often an adjustment rather than a replacement.',
    effort: 'a phone call',
    scenario: {
      ...scenario,
      car: {
        ...scenario.car,
        doorOpenTime: Math.max(0.5, scenario.car.doorOpenTime - 1),
        doorCloseTime: Math.max(0.5, scenario.car.doorCloseTime - 1),
      },
    },
  });

  candidates.push({
    id: 'bigger-car',
    label: `A car that holds ${scenario.car.capacity + 2} instead of ${scenario.car.capacity}`,
    detail: 'A bigger car in the same shaft, where the shaft allows it.',
    effort: 'building work',
    scenario: { ...scenario, car: { ...scenario.car, capacity: scenario.car.capacity + 2 } },
  });

  candidates.push({
    id: 'another-lift',
    label: `${scenario.cars + 1} lifts instead of ${scenario.cars}`,
    detail: 'A second shaft. The most expensive thing on this list, and often the only real fix.',
    effort: 'building work',
    scenario: { ...scenario, cars: scenario.cars + 1 },
  });

  const total = candidates.length + 1;
  let done = 0;
  const step = (): void => {
    done += 1;
    onProgress?.(done, total);
  };

  const waitNow = meanWait(scenario, baseline);
  step();

  const levers = candidates.map((candidate) => {
    const algorithm = candidate.id.startsWith('algorithm:')
      ? (candidate.id.slice('algorithm:'.length) as DispatcherName)
      : baseline;
    const waitAfter = meanWait(candidate.scenario, algorithm);
    step();
    return {
      id: candidate.id,
      label: candidate.label,
      detail: candidate.detail,
      effort: candidate.effort,
      waitAfter,
      saved: waitNow - waitAfter,
    };
  });

  return {
    waitNow,
    levers: [...levers].sort((a, b) => b.saved - a.saved),
  };
}

/** Mean waiting time over the scenario's seeds, for one algorithm. */
function meanWait(scenario: Scenario, dispatcher: DispatcherName): number {
  const building = buildingOf(scenario);
  const traffic = trafficConfigOf(scenario);
  const perSeed: number[] = [];

  for (let offset = 0; offset < scenario.seeds; offset += 1) {
    const stream = generateStream(building, traffic, 1 + offset);
    const result = runSimulation({
      building,
      stream,
      dispatcher: DISPATCHERS[dispatcher],
      idlePolicy: scenario.idlePolicy,
    });
    perSeed.push(
      mean(
        result.journeys
          .filter((journey) => journey.boardedAt !== null)
          .map((journey) => (journey.boardedAt ?? 0) - journey.calledAt),
      ),
    );
  }

  return mean(perSeed);
}
