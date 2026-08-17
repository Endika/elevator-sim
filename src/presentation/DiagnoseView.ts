import { fingerprint } from '../domain/diagnose/AlgorithmFingerprint';
import { type Answer, QUESTIONS } from '../domain/diagnose/BehaviourQuestions';
import { el, replace } from './dom';

const CHOICES: readonly { value: Answer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

/** Answers what the comparison alone cannot: which algorithm your own lift behaves like. */
export class DiagnoseView {
  readonly element: HTMLElement;
  private readonly summary = el('div', { class: 'mt-5 space-y-2 text-sm' });
  private readonly answers = new Map<string, Answer>();

  constructor() {
    this.element = el('div', { class: 'space-y-5' }, [
      el('p', {
        class: 'text-sm text-slate-400',
        text:
          'Answer from what you can see on the landing. Each question is here because it rules an ' +
          'algorithm in or out — none of them are filler.',
      }),
      el(
        'div',
        { class: 'space-y-4' },
        QUESTIONS.map((question) => this.questionRow(question)),
      ),
      this.summary,
    ]);
    this.render();
  }

  private questionRow(question: (typeof QUESTIONS)[number]): HTMLElement {
    const buttons = CHOICES.map((choice) => {
      const button = el('button', {
        type: 'button',
        class: buttonClass(false),
        text: choice.label,
      });
      button.addEventListener('click', () => {
        this.answers.set(question.id, choice.value);
        for (const [index, sibling] of buttons.entries()) {
          sibling.className = buttonClass(CHOICES[index]?.value === choice.value);
        }
        this.render();
      });
      return button;
    });

    return el('div', { class: 'rounded-md border border-slate-800 p-3' }, [
      el('p', { class: 'font-medium text-slate-200', text: question.prompt }),
      el('p', { class: 'mt-1 text-xs text-slate-500', text: question.detail }),
      el('div', { class: 'mt-2 flex gap-2' }, buttons),
    ]);
  }

  private render(): void {
    const result = fingerprint(this.answers);
    const lines: HTMLElement[] = [];

    if (this.answers.size === 0) {
      lines.push(el('p', { class: 'text-slate-500', text: 'Nothing answered yet.' }));
    } else if (result.identified) {
      lines.push(
        el('p', { class: 'text-amber-300' }, [
          'Your lift behaves like ',
          el('strong', { text: result.identified }),
          `. Confidence ${(result.confidence * 100).toFixed(0)}% — that is how much of the `,
          'available evidence you gave, not a probability.',
        ]),
      );
    } else if (result.ambiguous) {
      const leaders = result.candidates
        .filter((entry) => entry.score === result.candidates[0]?.score)
        .map((entry) => entry.name);
      lines.push(
        el('p', {
          class: 'text-slate-300',
          text: `Still indistinguishable between ${leaders.join(' and ')}.`,
        }),
      );
      if (result.nextQuestion) {
        lines.push(
          el('p', {
            class: 'text-slate-400',
            text: `What would settle it: ${result.nextQuestion.prompt}`,
          }),
        );
      }
    } else {
      lines.push(
        el('p', {
          class: 'text-slate-300',
          text: 'Nothing fits yet. Answer another question or two.',
        }),
      );
    }

    if (result.idlePolicy) {
      lines.push(
        el('p', {
          class: 'text-slate-400',
          text:
            `Idle policy: ${result.idlePolicy}. Set it in the form above and rerun — in a small ` +
            'building this usually moves the numbers more than the algorithm does.',
        }),
      );
    }

    replace(this.summary, lines);
  }
}

function buttonClass(active: boolean): string {
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
  return active
    ? `${base} bg-amber-500 text-slate-950`
    : `${base} border border-slate-700 text-slate-300 hover:border-slate-500`;
}
