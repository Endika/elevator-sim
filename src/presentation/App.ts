import type { ExperimentResult } from '../application/Experiment';
import { DEFAULT_SCENARIO, type Scenario, validateScenario } from '../application/Scenario';
import { DISPATCHER_NAMES, type DispatcherName } from '../domain/dispatch/registry';
import { decodeScenario, encodeScenario } from '../infrastructure/url/ScenarioCodec';
import type { SweepClient } from '../infrastructure/worker/SweepClient';
import { DiagnoseView } from './DiagnoseView';
import { el, replace } from './dom';
import { FormView } from './FormView';
import { ReplayView } from './ReplayView';
import { ResultsView } from './ResultsView';

const CARD = 'rounded-lg border border-slate-800 bg-slate-900/50 p-4 sm:p-6';

export class App {
  private readonly results = new ResultsView();
  private readonly replay = new ReplayView();
  private readonly diagnose = new DiagnoseView();
  private readonly formSlot = el('div');
  private readonly progress = el('div', {
    class: 'h-1 w-full overflow-hidden rounded bg-slate-800',
  });
  private readonly progressBar = el('div', { class: 'h-full w-0 bg-amber-500 transition-[width]' });
  private readonly progressLabel = el('p', { class: 'mt-2 text-xs text-slate-500' });
  private readonly replayPicker: HTMLSelectElement;

  private form: FormView;
  private scenario: Scenario;

  constructor(
    private readonly root: HTMLElement,
    private readonly sweeps: SweepClient,
    search: string,
  ) {
    this.scenario = decodeScenario(search);
    this.progress.appendChild(this.progressBar);
    this.replayPicker = this.buildReplayPicker();
    this.form = this.buildForm();
    replace(this.formSlot, [this.form.element]);
    this.render();
    this.results.clear('Describe your building and press the button.');
    // Written on load too, not only on edit: otherwise the link is only shareable after you
    // happen to change something.
    this.syncUrl();
    this.loadReplay();
  }

  private buildForm(): FormView {
    return new FormView(this.scenario, {
      onChange: (scenario) => {
        this.scenario = scenario;
        this.syncUrl();
      },
      onRun: () => this.run(),
      onPreset: (scenario) => {
        this.scenario = scenario;
        this.form = this.buildForm();
        replace(this.formSlot, [this.form.element]);
        this.syncUrl();
        this.loadReplay();
      },
    });
  }

  private buildReplayPicker(): HTMLSelectElement {
    const select = el(
      'select',
      {
        class: 'rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200',
      },
      DISPATCHER_NAMES.map((name) =>
        el('option', { value: name, text: name, selected: name === 'collective' }),
      ),
    );
    select.addEventListener('change', () => this.loadReplay());
    return select;
  }

  private loadReplay(): void {
    if (validateScenario(this.scenario).length > 0) return;
    this.replay.load(this.scenario, this.replayPicker.value as DispatcherName);
  }

  private syncUrl(): void {
    const query = encodeScenario(this.scenario);
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
  }

  private run(): void {
    this.form.setBusy(true);
    this.progressBar.style.width = '0%';
    this.progressLabel.textContent = 'Starting…';
    this.results.clear('Running.');

    this.sweeps.run(this.scenario, {
      onProgress: (done, total) => {
        this.progressBar.style.width = `${(done / total) * 100}%`;
        this.progressLabel.textContent = `${done} of ${total} simulated mornings`;
      },
      onDone: (result: ExperimentResult) => {
        this.form.setBusy(false);
        this.progressLabel.textContent = `${result.seeds} seeds per algorithm, done.`;
        this.results.show(this.scenario, result);
        this.loadReplay();
      },
      onFailed: (message) => {
        this.form.setBusy(false);
        this.progressLabel.textContent = '';
        this.results.showError(message);
      },
    });
  }

  private render(): void {
    replace(this.root, [
      el('div', { class: 'mx-auto max-w-5xl px-4 py-10 sm:px-6' }, [
        el('header', { class: 'mb-8' }, [
          el('h1', {
            class: 'text-3xl font-bold tracking-tight text-slate-50',
            text: 'elevator-sim',
          }),
          el('p', {
            class: 'mt-2 max-w-2xl text-slate-400',
            text:
              'Describe a building and find out which lift dispatch algorithm suits it — and ' +
              'whether the choice even matters. Everything runs in your browser.',
          }),
        ]),
        el('main', { class: 'space-y-8' }, [
          el('section', { class: CARD }, [this.formSlot, this.progress, this.progressLabel]),
          this.results.element,
          el('section', { class: CARD }, [
            el('div', { class: 'mb-4 flex flex-wrap items-center justify-between gap-3' }, [
              el('h3', { class: 'font-semibold text-slate-200', text: 'Watch one morning' }),
              this.replayPicker,
            ]),
            el('p', {
              class: 'mb-3 text-xs text-slate-500',
              text:
                'One seed, played back. Pale dots on the landing are people waiting, dark heads ' +
                'inside the car are riders, and an amber dot is somebody stepping in or out. ' +
                'Compare it with what your own lift does.',
            }),
            this.replay.element,
          ]),
          el('section', { class: CARD }, [
            el('h3', { class: 'mb-3 font-semibold text-slate-200', text: 'Which one is yours?' }),
            this.diagnose.element,
          ]),
        ]),
        el('footer', { class: 'mt-12 border-t border-slate-800 pt-6 text-xs text-slate-500' }, [
          el('p', {
            text:
              'Discrete-event simulation with jerk-limited kinematics, validated against the ' +
              'classical up-peak round trip calculation. Paired comparisons over many seeds; ' +
              'differences that cross zero are reported as indistinguishable.',
          }),
        ]),
      ]),
    ]);
  }
}

export { DEFAULT_SCENARIO };
