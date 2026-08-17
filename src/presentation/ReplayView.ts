import { RunTimeline } from '../application/RunTimeline';
import { buildingOf, type Scenario, trafficConfigOf } from '../application/Scenario';
import { DISPATCHERS, type DispatcherName } from '../domain/dispatch/registry';
import { runSimulation } from '../domain/sim/Simulation';
import { generateStream } from '../domain/traffic/PassengerStream';
import { el, replace, svg } from './dom';

const SHAFT_TOP = 16;
const ROW_HEIGHT = 26;
const CAR_WIDTH = 40;
const SPEEDS = [1, 4, 16, 60] as const;

/** Watching it is what makes the numbers believable, so this replays a single run frame by frame. */
export class ReplayView {
  readonly element: HTMLElement;
  private readonly stage = el('div', { class: 'overflow-x-auto' });
  private readonly clock = el('span', { class: 'tabular-nums text-slate-400', text: '0 s' });
  private readonly scrubber = el('input', {
    type: 'range',
    min: '0',
    max: '100',
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
  private time = 0;
  private speed = 16;
  private playing = false;
  private frame = 0;
  private lastTick: number | null = null;
  private cars: SVGElement[] = [];
  private labels: SVGElement[] = [];

  constructor() {
    this.playButton.addEventListener('click', () => this.toggle());
    this.scrubber.addEventListener('input', () => {
      if (!this.timeline) return;
      this.time = (Number(this.scrubber.value) / 100) * this.timeline.duration;
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
    this.timeline = new RunTimeline(building, result);
    this.time = 0;
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

  private build(): void {
    const scenario = this.scenario;
    if (!scenario) return;

    const floors = buildingOf(scenario).floors;
    const height = SHAFT_TOP * 2 + floors.length * ROW_HEIGHT;
    const shaftLeft = 70;
    const width = shaftLeft + scenario.cars * (CAR_WIDTH + 14) + 90;

    const rows = floors.flatMap((floor, index) => {
      const y = yOf(floors.length, index);
      return [
        svg('line', {
          x1: shaftLeft - 8,
          y1: y,
          x2: width - 80,
          y2: y,
          stroke: '#1e293b',
        }),
        svg(
          'text',
          { x: shaftLeft - 16, y: y + 4, 'text-anchor': 'end', fill: '#94a3b8', 'font-size': '11' },
          [floor.label],
        ),
      ];
    });

    this.cars = Array.from({ length: scenario.cars }, (_, index) =>
      svg('rect', {
        x: shaftLeft + index * (CAR_WIDTH + 14),
        y: 0,
        width: CAR_WIDTH,
        height: ROW_HEIGHT - 8,
        rx: 3,
        fill: '#f59e0b',
      }),
    );

    this.labels = floors.map((_, index) =>
      svg(
        'text',
        {
          x: width - 76,
          y: yOf(floors.length, index) + 4,
          fill: '#64748b',
          'font-size': '11',
        },
        [''],
      ),
    );

    // Capped rather than full-width: a portrait viewBox stretched across a wide card turns a
    // seven-floor shaft into something a thousand pixels tall.
    replace(this.stage, [
      svg(
        'svg',
        {
          viewBox: `0 0 ${width} ${height}`,
          class: 'h-auto',
          style: `width:min(100%, ${Math.round(width * 1.5)}px)`,
        },
        [...rows, ...this.cars, ...this.labels],
      ),
    ]);
  }

  private draw(): void {
    const timeline = this.timeline;
    const scenario = this.scenario;
    if (!timeline || !scenario) return;

    const floors = buildingOf(scenario).floors;
    const snapshot = timeline.at(this.time);
    const lowest = floors[0]?.id ?? 0;

    snapshot.cars.forEach((car, index) => {
      const node = this.cars[index];
      if (!node) return;
      const rowFromBottom = car.position - lowest;
      const y = SHAFT_TOP + (floors.length - 1 - rowFromBottom) * ROW_HEIGHT + 4;
      node.setAttribute('y', String(y));
      node.setAttribute('fill', car.doorsOpen ? '#fbbf24' : '#f59e0b');
      node.setAttribute('opacity', car.doorsOpen ? '0.7' : '1');
    });

    floors.forEach((floor, index) => {
      const waiting = snapshot.waiting.get(floor.id) ?? 0;
      const label = this.labels[index];
      if (label)
        label.textContent = waiting > 0 ? `${'•'.repeat(Math.min(waiting, 8))} ${waiting}` : '';
    });

    this.clock.textContent = `${this.time.toFixed(0)} s of ${timeline.duration.toFixed(0)} s`;
    this.scrubber.value = String((this.time / Math.max(1, timeline.duration)) * 100);
  }
}

function yOf(floorCount: number, index: number): number {
  return SHAFT_TOP + (floorCount - 1 - index) * ROW_HEIGHT + ROW_HEIGHT / 2;
}
