import type { Advice, Effort } from '../application/Advice';
import type { ExperimentResult } from '../application/Experiment';
import type { Scenario } from '../application/Scenario';
import { verdictOf } from '../application/Verdict';
import { pairedDifferenceChart, waitByFloorChart } from './charts';
import { el, replace } from './dom';

const COLUMNS = [
  ['waitMean', 'mean wait'],
  ['waitP95', '95th percentile'],
  ['waitWorst', 'worst wait'],
  ['journeyMean', 'mean total'],
  ['overThresholdShare', 'over 60 s'],
  ['leftBehind', 'left behind'],
  ['abandoned', 'took the stairs'],
  ['waitWhenStairsImpossible', 'wait if you cannot walk'],
  ['carStarts', 'starts'],
  ['carDistance', 'metres'],
] as const;

const CARD = 'rounded-lg border border-slate-800 bg-slate-900/50 p-4';

export class ResultsView {
  readonly element = el('section', { class: 'space-y-6' });

  clear(message: string): void {
    replace(this.element, [el('p', { class: 'text-sm text-slate-500', text: message })]);
  }

  showError(message: string): void {
    replace(this.element, [
      el('div', { class: 'rounded-lg border border-rose-800 bg-rose-950/40 p-4' }, [
        el('p', { class: 'font-medium text-rose-300', text: 'The simulation stopped' }),
        el('p', { class: 'mt-1 text-sm text-rose-200', text: message }),
      ]),
    ]);
  }

  show(scenario: Scenario, result: ExperimentResult, advice: Advice): void {
    const verdict = verdictOf(scenario, result);

    replace(this.element, [
      el('div', { class: `${CARD} border-amber-700/60 bg-amber-950/20` }, [
        el('h2', { class: 'text-xl font-semibold text-amber-300', text: verdict.headline }),
        el(
          'ul',
          { class: 'mt-3 space-y-1.5 text-sm text-slate-300' },
          verdict.points.map((point) => el('li', { text: `— ${point}` })),
        ),
      ]),
      adviceCard(advice),
      blockedDoorsNotice(result),
      el('div', { class: CARD }, [
        heading('Every algorithm, side by side'),
        this.table(result),
        el('p', {
          class: 'mt-3 text-xs text-slate-500',
          text:
            `Averages over ${result.seeds} seeds, with the spread between seeds in brackets. ` +
            `Every difference is measured against ${result.baseline}, the algorithm most single-car ` +
            'lifts actually run — being the yardstick is not the same as winning.',
        }),
      ]),
      el('div', { class: CARD }, [
        heading('Difference from the baseline'),
        el('p', {
          class: 'mb-3 text-xs text-slate-500',
          text:
            'Each bar is a 95% interval on the seed-by-seed difference. A bar crossing the dashed ' +
            'line means the two algorithms are indistinguishable on that measure.',
        }),
        pairedDifferenceChart(result.comparisons),
      ]),
      el('div', { class: CARD }, [
        heading('Mean wait by floor'),
        el('p', {
          class: 'mb-3 text-xs text-slate-500',
          text: 'Starvation of the far floors shows up here and nowhere else.',
        }),
        waitByFloorChart(result.aggregates),
      ]),
    ]);
  }

  private table(result: ExperimentResult): HTMLElement {
    const header = el('tr', {}, [
      cell('th', 'algorithm', 'text-left'),
      cell('th', 'vs baseline', 'text-left'),
      ...COLUMNS.map(([, label]) => cell('th', label, 'text-right')),
    ]);

    const verdicts = new Map(
      result.comparisons
        .filter((comparison) => comparison.metric === 'waitMean')
        .map((comparison) => [comparison.candidate, comparison.verdict]),
    );

    const ranked = [...result.aggregates].sort(
      (a, b) => (a.means.waitMean ?? 0) - (b.means.waitMean ?? 0),
    );

    const rows = ranked.map((aggregate, index) => {
      const isBaseline = aggregate.dispatcher === result.baseline;
      // The winner is what the reader is looking for. Highlighting the baseline instead — which
      // is only ever the yardstick — reads as "this one won" and is exactly backwards.
      const isBest = index === 0;

      return el('tr', { class: isBest ? 'bg-amber-500/10' : '' }, [
        el('td', { class: 'px-2 py-2 text-left font-medium text-slate-200' }, [
          aggregate.dispatcher,
          isBest ? badge('best', 'bg-amber-500 text-slate-950') : null,
          isBaseline ? badge('baseline', 'border border-slate-600 text-slate-400') : null,
        ]),
        el('td', { class: 'px-2 py-2 text-left' }, [
          isBaseline
            ? el('span', { class: 'text-slate-600', text: '—' })
            : verdict(verdicts, aggregate.dispatcher),
        ]),
        ...COLUMNS.map(([key]) =>
          cell(
            'td',
            format(key, aggregate.means[key] ?? 0, aggregate.sds[key] ?? 0),
            'text-right tabular-nums',
          ),
        ),
      ]);
    });

    return el('div', { class: 'overflow-x-auto' }, [
      el('table', { class: 'w-full min-w-[1000px] text-sm text-slate-400' }, [
        el('thead', { class: 'border-b border-slate-700 text-xs uppercase tracking-wide' }, [
          header,
        ]),
        el('tbody', { class: 'divide-y divide-slate-800' }, rows),
      ]),
    ]);
  }
}

function badge(text: string, tone: string): HTMLElement {
  return el('span', {
    class: `ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase ${tone}`,
    text,
  });
}

const VERDICT_TONE: Record<string, string> = {
  better: 'text-emerald-400',
  worse: 'text-rose-400',
  indistinguishable: 'text-slate-500',
};

function verdict(verdicts: ReadonlyMap<string, string>, dispatcher: string): HTMLElement {
  const value = verdicts.get(dispatcher) ?? 'indistinguishable';
  return el('span', { class: VERDICT_TONE[value] ?? 'text-slate-500', text: value });
}

/**
 * The one thing on this page that costs nothing to fix, so it gets its own notice — and a measured
 * figure for this building rather than a piece of general advice.
 */
const EFFORT_TONE: Record<Effort, string> = {
  free: 'bg-emerald-500/15 text-emerald-300',
  'a phone call': 'bg-sky-500/15 text-sky-300',
  'building work': 'bg-rose-500/15 text-rose-300',
};

/**
 * The answer to the question people actually have, which is not "which algorithm" but "what should
 * we do". Every row was measured on the same seeds and the same passengers, and the effort column
 * is there because a notice on the wall and a second shaft are not comparable prices.
 */
function adviceCard(advice: Advice): HTMLElement {
  const helpful = advice.levers.filter((lever) => lever.saved >= 0.5);
  const best = helpful[0]?.saved ?? 1;

  const row = (lever: Advice['levers'][number]): HTMLElement =>
    el('div', { class: 'flex flex-wrap items-center gap-x-3 gap-y-1 py-2' }, [
      el('span', {
        class: 'w-20 shrink-0 text-right font-semibold tabular-nums text-slate-100',
        text: `−${lever.saved.toFixed(1)} s`,
      }),
      el('div', { class: 'h-1.5 w-24 shrink-0 overflow-hidden rounded bg-slate-800' }, [
        el('div', {
          class: 'h-full bg-amber-500',
          style: `width:${Math.max(3, (lever.saved / best) * 100)}%`,
        }),
      ]),
      el('span', {
        class: `shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${EFFORT_TONE[lever.effort]}`,
        text: lever.effort,
      }),
      el('span', { class: 'text-sm text-slate-200', text: lever.label }),
    ]);

  return el('div', { class: CARD }, [
    heading('What would actually help'),
    el('p', {
      class: 'mb-2 text-xs text-slate-500',
      text:
        `Waiting now averages ${advice.waitNow.toFixed(1)} s. Each row is that same morning with ` +
        'one thing changed, measured on the same seeds — not a rule of thumb. Sorted by what it ' +
        'saves, labelled by what it takes.',
    }),
    helpful.length === 0
      ? el('p', {
          class: 'text-sm text-slate-400',
          text: 'Nothing on the list moves the wait by even half a second. This lift is not the problem.',
        })
      : el('div', { class: 'divide-y divide-slate-800' }, helpful.map(row)),
    advice.levers.some((lever) => lever.saved < 0.5)
      ? el('p', {
          class: 'mt-3 text-xs text-slate-500',
          text:
            'Left out because they changed nothing or made it worse: ' +
            advice.levers
              .filter((lever) => lever.saved < 0.5)
              .map((lever) => lever.label.toLowerCase())
              .join('; ') +
            '.',
        })
      : null,
  ]);
}

function blockedDoorsNotice(result: ExperimentResult): HTMLElement | null {
  const cost = result.blockedDoorsCost;
  if (!cost || cost.difference < 1) return null;

  const share = ((cost.difference / cost.without) * 100).toFixed(0);

  return el('div', { class: `${CARD} border-sky-800/60 bg-sky-950/20` }, [
    el('h3', {
      class: 'font-semibold text-sky-300',
      text: 'Somebody is holding the doors, and it costs more than the algorithm does',
    }),
    el('p', { class: 'mt-2 text-sm text-slate-300' }, [
      'Delivering a parcel with the doors propped open, running the shopping in, emptying the ' +
        'storeroom into the boot. In this building it adds ',
      el('strong', { class: 'text-sky-200', text: `${cost.difference.toFixed(1)} s` }),
      ` to everybody's wait — ${share}% more than the same morning without it ` +
        `(${cost.without.toFixed(1)} s versus ${cost.withBlocking.toFixed(1)} s).`,
    ]),
    el('p', {
      class: 'mt-2 text-sm text-slate-400',
      text:
        'That is a controlled comparison, not an estimate: the same people arrive at the same ' +
        'moments going to the same floors, and the only thing changed is whether anybody holds ' +
        'the doors.',
    }),
    el('p', {
      class: 'mt-2 text-sm text-slate-400',
      text:
        'It is also the only thing on this page that costs nothing. You cannot add a lift by ' +
        'asking politely; you can ask people not to block the doors.',
    }),
  ]);
}

function heading(title: string): HTMLElement {
  return el('h3', { class: 'mb-3 font-semibold text-slate-200', text: title });
}

function cell(tag: 'td' | 'th', value: string, classes: string): HTMLElement {
  return el(tag, { class: `px-2 py-2 ${classes}`, text: value });
}

function format(key: string, value: number, sd: number): string {
  if (!Number.isFinite(value)) return '—';
  if (key === 'overThresholdShare') return `${(value * 100).toFixed(0)}%`;
  if (key === 'carDistance') return value.toFixed(0);
  if (key === 'carStarts' || key === 'leftBehind' || key === 'abandoned') return value.toFixed(1);
  const spread = Number.isFinite(sd) ? ` (±${sd.toFixed(1)})` : '';
  return `${value.toFixed(1)}${spread}`;
}
