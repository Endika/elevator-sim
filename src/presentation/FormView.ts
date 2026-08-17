import type { Scenario } from '../application/Scenario';
import { scenarioFromPreset, validateScenario } from '../application/Scenario';
import { IDLE_POLICIES, type IdlePolicy } from '../domain/config/BuildingConfig';
import { PRESET_NAMES, type PresetName } from '../domain/config/presets';
import { TRAFFIC_PATTERNS, type TrafficPattern } from '../domain/config/TrafficConfig';
import { DISPATCHER_NAMES, type DispatcherName } from '../domain/dispatch/registry';
import { el, replace } from './dom';

const IDLE_LABELS: Record<IdlePolicy, string> = {
  'stay-put': 'Stays where the last passenger left it',
  'return-to-entrance': 'Goes back down to the entrance',
  'park-at-busiest': 'Waits on the busiest floor',
  'park-at-middle': 'Waits halfway up',
};

const PATTERN_LABELS: Record<TrafficPattern, string> = {
  'up-peak': 'Morning rush — everyone arriving and going up',
  'down-peak': 'Evening rush — everyone leaving',
  interfloor: 'Between floors, both ways',
  lunch: 'Lunchtime — up, down and across at once',
  'residential-sparse': 'Block of flats — quiet, in bursts',
};

const FIELD =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 ' +
  'focus:border-amber-500 focus:outline-none';
const LABEL = 'block text-sm font-medium text-slate-300 mb-1';

export interface FormViewHandlers {
  readonly onChange: (scenario: Scenario) => void;
  readonly onRun: () => void;
  /** A preset replaces the whole scenario, so the owner rebuilds the view rather than syncing it. */
  readonly onPreset: (scenario: Scenario) => void;
}

export class FormView {
  readonly element: HTMLElement;
  private readonly problems: HTMLElement;
  private readonly runButton: HTMLButtonElement;
  private scenario: Scenario;

  constructor(
    initial: Scenario,
    private readonly handlers: FormViewHandlers,
  ) {
    this.scenario = initial;
    this.problems = el('div', { class: 'mt-4 space-y-1 text-sm text-rose-400' });
    this.runButton = el('button', {
      type: 'submit',
      class:
        'rounded-md bg-amber-500 px-5 py-2.5 font-semibold text-slate-950 ' +
        'hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50',
      text: 'Compare algorithms',
    });

    this.element = el('form', { class: 'space-y-6' }, [
      this.presetRow(),
      this.basicSection(),
      this.advancedSection(),
      el('div', { class: 'flex flex-wrap items-center gap-4' }, [this.runButton]),
      this.problems,
    ]);

    this.element.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handlers.onRun();
    });

    this.showProblems();
  }

  setBusy(busy: boolean): void {
    this.runButton.disabled = busy;
    this.runButton.textContent = busy ? 'Simulating…' : 'Compare algorithms';
  }

  private update(patch: Partial<Scenario>): void {
    this.scenario = { ...this.scenario, ...patch };
    this.showProblems();
    this.handlers.onChange(this.scenario);
  }

  private updateCar(patch: Partial<Scenario['car']>): void {
    this.update({ car: { ...this.scenario.car, ...patch } });
  }

  private showProblems(): void {
    const problems = validateScenario(this.scenario);
    this.runButton.disabled = problems.length > 0;
    replace(
      this.problems,
      problems.map((problem) => el('p', { text: problem })),
    );
  }

  private presetRow(): HTMLElement {
    const select = el('select', { class: FIELD, 'aria-label': 'Preset building' }, [
      el('option', { value: '', text: 'Start from a preset…' }),
      ...PRESET_NAMES.map((name) => el('option', { value: name, text: name })),
    ]);
    select.addEventListener('change', () => {
      if (select.value) this.handlers.onPreset(scenarioFromPreset(select.value as PresetName));
    });
    return el('div', { class: 'max-w-sm' }, [select]);
  }

  private number(
    label: string,
    value: number,
    onInput: (value: number) => void,
    { step = '1', min = '0', hint }: { step?: string; min?: string; hint?: string } = {},
  ): HTMLElement {
    const input = el('input', { type: 'number', class: FIELD, value: String(value), step, min });
    input.addEventListener('input', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) onInput(parsed);
    });
    return el('div', {}, [
      el('label', { class: LABEL, text: label }),
      input,
      hint ? el('p', { class: 'mt-1 text-xs text-slate-500', text: hint }) : null,
    ]);
  }

  private basicSection(): HTMLElement {
    const idle = el(
      'select',
      { class: FIELD },
      IDLE_POLICIES.map((policy) =>
        el('option', {
          value: policy,
          text: IDLE_LABELS[policy],
          selected: policy === this.scenario.idlePolicy,
        }),
      ),
    );
    idle.addEventListener('change', () => this.update({ idlePolicy: idle.value as IdlePolicy }));

    const pattern = el(
      'select',
      { class: FIELD },
      TRAFFIC_PATTERNS.map((option) =>
        el('option', {
          value: option,
          text: PATTERN_LABELS[option],
          selected: option === this.scenario.pattern,
        }),
      ),
    );
    pattern.addEventListener('change', () =>
      this.update({ pattern: pattern.value as TrafficPattern }),
    );

    return el('fieldset', { class: 'space-y-4' }, [
      el('legend', { class: 'text-lg font-semibold text-slate-100', text: 'Your building' }),
      el('div', { class: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' }, [
        this.number('Floors above the entrance', this.scenario.floorsAbove, (value) =>
          this.update({ floorsAbove: Math.round(value) }),
        ),
        this.number('Basement levels', this.scenario.basements, (value) =>
          this.update({ basements: Math.round(value) }),
        ),
        this.number('Lifts', this.scenario.cars, (value) =>
          this.update({ cars: Math.round(value) }),
        ),
        this.number('People per floor', this.scenario.peoplePerFloor, (value) =>
          this.update({ peoplePerFloor: Math.round(value) }),
        ),
        this.number('People the car holds', this.scenario.car.capacity, (value) =>
          this.updateCar({ capacity: Math.round(value) }),
        ),
        this.number(
          'Seeds',
          this.scenario.seeds,
          (value) => this.update({ seeds: Math.round(value) }),
          {
            min: '2',
            hint: 'Runs per algorithm. Below about 30 the noise swallows small differences.',
          },
        ),
        el('div', {}, [
          el('label', { class: LABEL, text: 'When nobody is calling it, the lift…' }),
          idle,
        ]),
        el('div', {}, [el('label', { class: LABEL, text: 'Traffic' }), pattern]),
        this.number(
          'Demand, % of residents per 5 min',
          this.scenario.demandPercentPer5Min,
          (value) => this.update({ demandPercentPer5Min: value }),
          { step: '0.5' },
        ),
      ]),
      this.algorithmPicker(),
    ]);
  }

  private algorithmPicker(): HTMLElement {
    const boxes = DISPATCHER_NAMES.map((name) => {
      const box = el('input', {
        type: 'checkbox',
        class: 'size-4 accent-amber-500',
        checked: this.scenario.dispatchers.includes(name),
      });
      box.addEventListener('change', () => {
        const chosen = new Set<DispatcherName>(this.scenario.dispatchers);
        if (box.checked) chosen.add(name);
        else chosen.delete(name);
        this.update({ dispatchers: DISPATCHER_NAMES.filter((entry) => chosen.has(entry)) });
      });
      return el('label', { class: 'flex items-center gap-2 text-sm text-slate-300' }, [box, name]);
    });

    return el('div', {}, [
      el('span', { class: LABEL, text: 'Algorithms to compare' }),
      el('div', { class: 'flex flex-wrap gap-4' }, boxes),
    ]);
  }

  private advancedSection(): HTMLElement {
    const car = this.scenario.car;
    return el('details', { class: 'rounded-lg border border-slate-800 bg-slate-900/50 p-4' }, [
      el('summary', {
        class: 'cursor-pointer font-medium text-slate-200',
        text: 'Lift mechanics and timings',
      }),
      el('p', {
        class: 'mt-2 text-xs text-slate-500',
        text:
          'Defaults come from published measurements where a source exists and are marked as ' +
          'estimates where none was found. Leave them alone unless you know your installation.',
      }),
      el('div', { class: 'mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3' }, [
        this.number(
          'Floor height, m',
          this.scenario.floorHeight,
          (v) => this.update({ floorHeight: v }),
          { step: '0.1' },
        ),
        this.number('Rated speed, m/s', car.ratedSpeed, (v) => this.updateCar({ ratedSpeed: v }), {
          step: '0.1',
        }),
        this.number(
          'Acceleration, m/s²',
          car.acceleration,
          (v) => this.updateCar({ acceleration: v }),
          { step: '0.05' },
        ),
        this.number('Jerk, m/s³', car.jerk, (v) => this.updateCar({ jerk: v }), { step: '0.05' }),
        this.number(
          'Door opening, s',
          car.doorOpenTime,
          (v) => this.updateCar({ doorOpenTime: v }),
          { step: '0.1' },
        ),
        this.number(
          'Door closing, s',
          car.doorCloseTime,
          (v) => this.updateCar({ doorCloseTime: v }),
          { step: '0.1' },
        ),
        this.number(
          'Doors held open, s',
          car.doorDwellTime,
          (v) => this.updateCar({ doorDwellTime: v }),
          { step: '0.1' },
        ),
        this.number('Start delay, s', car.startDelay, (v) => this.updateCar({ startDelay: v }), {
          step: '0.1',
        }),
        this.number(
          'Levelling delay, s',
          car.levellingDelay,
          (v) => this.updateCar({ levellingDelay: v }),
          { step: '0.1' },
        ),
        this.number(
          'Advance door opening, s',
          car.advanceDoorOpenTime,
          (v) => this.updateCar({ advanceDoorOpenTime: v }),
          { step: '0.1' },
        ),
        this.number(
          'Per passenger in or out, s',
          car.passengerTransferTime,
          (v) => this.updateCar({ passengerTransferTime: v }),
          { step: '0.05' },
        ),
        this.number('Simulated period, minutes', this.scenario.durationMinutes, (v) =>
          this.update({ durationMinutes: v }),
        ),
        this.number('Burstiness', this.scenario.burstiness, (v) => this.update({ burstiness: v }), {
          step: '0.5',
          min: '1',
          hint: '1 is a smooth trickle; higher means people arrive in groups.',
        }),
        this.number('Idle delay, s', this.scenario.idleDelaySeconds, (v) =>
          this.update({ idleDelaySeconds: v }),
        ),
      ]),
    ]);
  }
}
