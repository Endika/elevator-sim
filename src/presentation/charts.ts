import type { Aggregate } from '../application/Experiment';
import type { PairedResult } from '../domain/metrics/PairedComparison';
import { el, svg } from './dom';

/**
 * Inline SVG, no chart library. Colour carries meaning and nothing else: amber is the baseline,
 * sky and violet the other algorithms, rose a result that is worse, emerald one that is better,
 * slate one that is indistinguishable.
 */
export const SERIES_COLOURS = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#fb7185'] as const;

const AXIS = '#475569';
const TEXT = '#94a3b8';

export function colourFor(index: number): string {
  return SERIES_COLOURS[index % SERIES_COLOURS.length] ?? '#f59e0b';
}

function frame(width: number, height: number, children: SVGElement[]): HTMLElement {
  return el('div', { class: 'overflow-x-auto' }, [
    svg(
      'svg',
      {
        viewBox: `0 0 ${width} ${height}`,
        class: 'h-auto w-full min-w-[420px]',
        role: 'img',
      },
      children,
    ),
  ]);
}

function text(x: number, y: number, value: string, anchor = 'middle', fill = TEXT): SVGElement {
  return svg('text', { x, y, 'text-anchor': anchor, fill, 'font-size': '11' }, [value]);
}

/** Mean wait per origin floor, grouped by algorithm. Where starvation of the far floors shows. */
export function waitByFloorChart(aggregates: readonly Aggregate[]): HTMLElement {
  // Union across every seed and algorithm: taking one seed's floors would silently drop the
  // floors that happened to generate no traffic in it.
  const floors = new Map<string, number>();
  for (const aggregate of aggregates) {
    for (const metrics of aggregate.perSeed) {
      for (const entry of metrics.waitByFloor) floors.set(entry.label, entry.floor);
    }
  }
  const labels = [...floors.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  if (labels.length === 0) return el('p', { class: 'text-sm text-slate-500', text: 'No traffic.' });

  const series = aggregates.map((aggregate) => ({
    name: aggregate.dispatcher,
    values: labels.map((label) => averageFloorWait(aggregate, label)),
  }));

  const width = 720;
  const height = 260;
  const left = 44;
  const bottom = 34;
  const peak = Math.max(1, ...series.flatMap((entry) => entry.values));
  const groupWidth = (width - left - 12) / labels.length;
  const barWidth = Math.max(2, (groupWidth - 6) / series.length);

  const bars = series.flatMap((entry, seriesIndex) =>
    entry.values.map((value, floorIndex) => {
      const barHeight = ((height - bottom - 12) * value) / peak;
      return svg('rect', {
        x: left + floorIndex * groupWidth + 3 + seriesIndex * barWidth,
        y: height - bottom - barHeight,
        width: barWidth,
        height: barHeight,
        fill: colourFor(seriesIndex),
        rx: 1,
      });
    }),
  );

  return el('div', {}, [
    frame(width, height, [
      svg('line', {
        x1: left,
        y1: height - bottom,
        x2: width - 6,
        y2: height - bottom,
        stroke: AXIS,
      }),
      svg('line', { x1: left, y1: 10, x2: left, y2: height - bottom, stroke: AXIS }),
      text(left - 8, 16, `${peak.toFixed(0)} s`, 'end'),
      text(left - 8, height - bottom, '0', 'end'),
      ...bars,
      ...labels.map((label, index) =>
        text(left + index * groupWidth + groupWidth / 2, height - bottom + 16, label),
      ),
      text(width / 2, height - 4, 'origin floor'),
    ]),
    legend(series.map((entry) => entry.name)),
  ]);
}

function averageFloorWait(aggregate: Aggregate, label: string): number {
  const values = aggregate.perSeed
    .flatMap((metrics) => metrics.waitByFloor.filter((entry) => entry.label === label))
    .map((entry) => entry.mean)
    .filter((value) => Number.isFinite(value));
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Paired difference against the baseline, with its interval. Zero is the line that matters. */
export function pairedDifferenceChart(comparisons: readonly PairedResult[]): HTMLElement {
  const rows = comparisons.filter((comparison) =>
    ['waitMean', 'waitP95', 'waitWorst', 'journeyMean'].includes(comparison.metric),
  );
  if (rows.length === 0) {
    return el('p', { class: 'text-sm text-slate-500', text: 'Nothing to compare.' });
  }

  const width = 720;
  const rowHeight = 26;
  const height = rows.length * rowHeight + 44;
  const left = 190;
  const span = Math.max(
    1,
    ...rows.map((row) => Math.max(Math.abs(row.ci95[0]), Math.abs(row.ci95[1]))),
  );
  const scale = (value: number): number =>
    left + ((width - left - 20) / 2) * (1 + value / (span * 1.1));

  const marks = rows.flatMap((row, index) => {
    const y = 24 + index * rowHeight;
    const colour =
      row.verdict === 'better' ? '#34d399' : row.verdict === 'worse' ? '#fb7185' : '#94a3b8';
    return [
      text(left - 10, y + 4, `${row.candidate} · ${row.metric}`, 'end'),
      svg('line', {
        x1: scale(row.ci95[0]),
        y1: y,
        x2: scale(row.ci95[1]),
        y2: y,
        stroke: colour,
        'stroke-width': '3',
        'stroke-linecap': 'round',
      }),
      svg('circle', { cx: scale(row.meanDifference), cy: y, r: 4, fill: colour }),
    ];
  });

  return el('div', {}, [
    frame(width, height, [
      svg('line', {
        x1: scale(0),
        y1: 10,
        x2: scale(0),
        y2: height - 26,
        stroke: '#f8fafc',
        'stroke-dasharray': '3 3',
        'stroke-opacity': '0.4',
      }),
      ...marks,
      text(scale(0), height - 8, 'no difference'),
      text(left + 20, height - 8, 'better than baseline', 'start', '#34d399'),
      text(width - 20, height - 8, 'worse', 'end', '#fb7185'),
    ]),
  ]);
}

function legend(names: readonly string[]): HTMLElement {
  return el(
    'div',
    { class: 'mt-2 flex flex-wrap gap-4 text-xs text-slate-400' },
    names.map((name, index) =>
      el('span', { class: 'flex items-center gap-1.5' }, [
        el('span', {
          class: 'inline-block size-2.5 rounded-sm',
          style: `background:${colourFor(index)}`,
        }),
        name,
      ]),
    ),
  );
}
