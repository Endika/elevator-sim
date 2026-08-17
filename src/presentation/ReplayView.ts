import { RunTimeline, type Snapshot } from '../application/RunTimeline';
import { buildingOf, type Scenario, trafficConfigOf } from '../application/Scenario';
import type { FloorId } from '../domain/config/BuildingConfig';
import { DISPATCHERS, type DispatcherName } from '../domain/dispatch/registry';
import { runSimulation } from '../domain/sim/Simulation';
import { generateStream } from '../domain/traffic/PassengerStream';
import { el, replace, svg } from './dom';

const TOP = 14;
const ROW = 30;
const LABEL_X = 22;
const LANDING_RIGHT = 118;
const DOOR_X = 126;
const CAR_WIDTH = 52;
const CAR_GAP = 12;
const PERSON_R = 3.2;
const MAX_WAITING_DOTS = 6;
const MAX_OCCUPANT_DOTS = 12;
const SPEEDS = [1, 4, 16, 60] as const;

const CAR_FILL = '#f59e0b';
const CAR_OPEN = '#fbbf24';
const PERSON = '#e2e8f0';
const RIDER = '#0f172a';

/** Watching it is what makes the numbers believable, so this replays a single run frame by frame. */
export class ReplayView {
  readonly element: HTMLElement;
  private readonly stage = el('div', { class: 'overflow-x-auto' });
  private readonly clock = el('span', { class: 'tabular-nums text-slate-400', text: '0 s' });
  // In seconds, not percent: a percentage slider on a half-hour run jumps eighteen seconds a
  // notch and skips straight over the door cycles worth watching.
  private readonly scrubber = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '0.5',
    value: '0',
    class: 'w-full accent-amber-500',
  });
  private readonly playButton = el('button', {
    type: 'button',
    class: 'rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200',
    text: 'Play',
  });

  private timeline: RunTimeline | null = null;
  private scenario: Scenario | null = null;
  private floors: readonly { id: FloorId; label: string }[] = [];
  private capacity = 1;
  private time = 0;
  private speed = 16;
  private playing = false;
  private frame = 0;
  private lastTick: number | null = null;
  private cars: SVGElement[] = [];
  private dynamic: SVGElement | null = null;

  constructor() {
    this.playButton.addEventListener('click', () => this.toggle());
    this.scrubber.addEventListener('input', () => {
      if (!this.timeline) return;
      this.time = Number(this.scrubber.value);
      this.draw();
    });

    this.element = el('div', { class: 'space-y-3' }, [
      this.stage,
      el('div', { class: 'flex flex-wrap items-center gap-3' }, [
        this.playButton,
        this.speedPicker(),
        this.clock,
      ]),
      this.scrubber,
    ]);
  }

  /** Runs one seed of the chosen algorithm with tracing on, purely to have something to watch. */
  load(scenario: Scenario, dispatcher: DispatcherName): void {
    this.stop();
    const building = buildingOf(scenario);
    const stream = generateStream(building, trafficConfigOf(scenario), 1);
    const result = runSimulation({
      building,
      stream,
      dispatcher: DISPATCHERS[dispatcher],
      idlePolicy: scenario.idlePolicy,
      trace: true,
    });

    this.scenario = scenario;
    this.floors = building.floors.map((floor) => ({ id: floor.id, label: floor.label }));
    this.capacity = building.cars[0]?.capacity ?? 1;
    this.timeline = new RunTimeline(building, result);
    this.time = 0;
    this.scrubber.max = String(Math.max(1, Math.round(this.timeline.duration)));
    this.build();
    this.draw();
  }

  private speedPicker(): HTMLElement {
    const select = el(
      'select',
      {
        class: 'rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200',
      },
      SPEEDS.map((speed) =>
        el('option', { value: String(speed), text: `${speed}×`, selected: speed === this.speed }),
      ),
    );
    select.addEventListener('change', () => {
      this.speed = Number(select.value);
    });
    return select;
  }

  private toggle(): void {
    if (!this.timeline) return;
    this.playing = !this.playing;
    this.playButton.textContent = this.playing ? 'Pause' : 'Play';
    if (this.playing) {
      this.lastTick = null;
      this.frame = requestAnimationFrame((now) => this.tick(now));
    } else {
      cancelAnimationFrame(this.frame);
    }
  }

  private stop(): void {
    this.playing = false;
    this.playButton.textContent = 'Play';
    cancelAnimationFrame(this.frame);
  }

  private tick(now: number): void {
    if (!this.timeline || !this.playing) return;
    const elapsed = this.lastTick === null ? 0 : (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.time += elapsed * this.speed;
    if (this.time >= this.timeline.duration) {
      this.time = this.timeline.duration;
      this.stop();
    }
    this.draw();
    if (this.playing) this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private get carCount(): number {
    return this.scenario?.cars ?? 1;
  }

  private carX(index: number): number {
    return DOOR_X + 6 + index * (CAR_WIDTH + CAR_GAP);
  }

  private get width(): number {
    return this.carX(this.carCount - 1) + CAR_WIDTH + 16;
  }

  private yOf(index: number): number {
    return TOP + (this.floors.length - 1 - index) * ROW + ROW / 2;
  }

  private carTop(rowFromBottom: number): number {
    return TOP + (this.floors.length - 1 - rowFromBottom) * ROW + 4;
  }

  private rowIndexOf(floor: FloorId): number {
    return this.floors.findIndex((entry) => entry.id === floor);
  }

  private build(): void {
    const height = TOP * 2 + this.floors.length * ROW;

    const landings = this.floors.flatMap((floor, index) => {
      const y = this.yOf(index);
      return [
        svg('line', {
          x1: 32,
          y1: y + ROW / 2 - 1,
          x2: LANDING_RIGHT,
          y2: y + ROW / 2 - 1,
          stroke: '#1e293b',
        }),
        svg(
          'text',
          { x: LABEL_X, y: y + 4, 'text-anchor': 'end', fill: '#94a3b8', 'font-size': '11' },
          [floor.label],
        ),
      ];
    });

    // The threshold people visibly cross, and a dark shaft behind each car.
    const shaft = [
      ...Array.from({ length: this.carCount }, (_, index) =>
        svg('rect', {
          x: this.carX(index) - 2,
          y: TOP,
          width: CAR_WIDTH + 4,
          height: height - TOP * 2,
          fill: '#0b1220',
          rx: 3,
        }),
      ),
      svg('line', {
        x1: DOOR_X,
        y1: TOP,
        x2: DOOR_X,
        y2: height - TOP,
        stroke: '#334155',
        'stroke-dasharray': '2 3',
      }),
    ];

    this.cars = Array.from({ length: this.carCount }, (_, index) =>
      svg('rect', {
        x: this.carX(index),
        y: 0,
        width: CAR_WIDTH,
        height: ROW - 8,
        rx: 3,
        fill: CAR_FILL,
      }),
    );

    this.dynamic = svg('g', {});

    replace(this.stage, [
      svg(
        'svg',
        {
          viewBox: `0 0 ${this.width} ${height}`,
          class: 'h-auto',
          style: `width:min(100%, ${Math.round(this.width * 1.6)}px)`,
        },
        [...shaft, ...landings, ...this.cars, this.dynamic],
      ),
    ]);
  }

  private draw(): void {
    const timeline = this.timeline;
    const dynamic = this.dynamic;
    if (!timeline || !dynamic) return;

    const snapshot = timeline.at(this.time);
    const lowest = this.floors[0]?.id ?? 0;

    snapshot.cars.forEach((car, index) => {
      const node = this.cars[index];
      if (!node) return;
      node.setAttribute('y', String(this.carTop(car.position - lowest)));
      node.setAttribute('fill', car.doorsOpen ? CAR_OPEN : CAR_FILL);
    });

    replace(dynamic, [
      ...this.waitingDots(snapshot),
      ...this.occupantDots(snapshot, lowest),
      ...this.transferDots(snapshot),
    ]);

    this.clock.textContent = `${this.time.toFixed(0)} s of ${timeline.duration.toFixed(0)} s`;
    this.scrubber.value = String(this.time);
  }

  /** People still waiting, queued on the landing towards the doors. */
  private waitingDots(snapshot: Snapshot): SVGElement[] {
    return [...snapshot.waiting].flatMap(([floor, count]) => {
      const index = this.rowIndexOf(floor);
      if (index < 0 || count === 0) return [];
      const y = this.yOf(index);
      const shown = Math.min(count, MAX_WAITING_DOTS);
      const step = PERSON_R * 2 + 2.5;

      const dots: SVGElement[] = Array.from({ length: shown }, (_, i) =>
        svg('circle', { cx: LANDING_RIGHT - 6 - i * step, cy: y, r: PERSON_R, fill: PERSON }),
      );

      if (count > shown) {
        dots.push(
          svg(
            'text',
            {
              x: LANDING_RIGHT - 10 - shown * step,
              y: y + 4,
              'text-anchor': 'end',
              fill: '#64748b',
              'font-size': '10',
            },
            [`+${count - shown}`],
          ),
        );
      }
      return dots;
    });
  }

  /** Who is inside, drawn as heads in the car — or a count once a car holds too many to draw. */
  private occupantDots(snapshot: Snapshot, lowest: FloorId): SVGElement[] {
    return snapshot.cars.flatMap((car, index) => {
      if (car.onboard === 0) return [];
      const top = this.carTop(car.position - lowest);
      const left = this.carX(index);

      if (this.capacity > MAX_OCCUPANT_DOTS) {
        return [
          svg(
            'text',
            {
              x: left + CAR_WIDTH / 2,
              y: top + (ROW - 8) / 2 + 4,
              'text-anchor': 'middle',
              fill: RIDER,
              'font-size': '11',
              'font-weight': '600',
            },
            [`${car.onboard}/${this.capacity}`],
          ),
        ];
      }

      const perRow = Math.min(6, Math.max(1, this.capacity));
      const spread = (CAR_WIDTH - 16) / Math.max(1, perRow - 1);
      return Array.from({ length: car.onboard }, (_, i) =>
        svg('circle', {
          cx: left + 8 + (i % perRow) * spread,
          cy: top + 7 + Math.floor(i / perRow) * 8,
          r: PERSON_R - 0.4,
          fill: RIDER,
        }),
      );
    });
  }

  /** The bit that makes it read as people rather than counters: someone crossing the threshold. */
  private transferDots(snapshot: Snapshot): SVGElement[] {
    return snapshot.transfers.flatMap((transfer) => {
      const index = this.rowIndexOf(transfer.floor);
      if (index < 0) return [];
      const y = this.yOf(index);
      const landing = LANDING_RIGHT - 4;
      const inside = this.carX(0) + 10;
      const along = transfer.direction === 'boarding' ? transfer.progress : 1 - transfer.progress;

      return [
        svg('circle', {
          cx: landing + (inside - landing) * along,
          cy: y,
          r: PERSON_R,
          fill: transfer.direction === 'boarding' ? '#fde68a' : PERSON,
        }),
      ];
    });
  }
}
