import type { IdlePolicy, LandingButtons } from '../config/BuildingConfig';
import { DISPATCHER_NAMES, type DispatcherName } from '../dispatch/registry';
import { type Answer, type BehaviourQuestion, QUESTIONS } from './BehaviourQuestions';

export interface Fingerprint {
  /** Algorithms still consistent with everything answered, best first. */
  readonly candidates: readonly { readonly name: DispatcherName; readonly score: number }[];
  /** Set when exactly one algorithm survives. */
  readonly identified: DispatcherName | null;
  /** True when two or more algorithms fit equally well. */
  readonly ambiguous: boolean;
  /** A question that would separate the leaders, if one exists. */
  readonly nextQuestion: BehaviourQuestion | null;
  readonly idlePolicy: IdlePolicy | null;
  /**
   * What the landings offer, when the answers reveal it. Worth more than it looks: a single button
   * means the lift never learns your direction, so half the behaviours people blame on the
   * algorithm are not the algorithm at all.
   */
  readonly landingButtons: LandingButtons | null;
  /** 0 to 1: how much of the available evidence was actually given. */
  readonly confidence: number;
}

/**
 * Matches observed behaviour to an algorithm. It is a decision process over things anyone can see
 * from the landing, not a guess: every question either rules an algorithm in or rules it out, and
 * when the evidence cannot separate two of them it says so instead of picking.
 */
export function fingerprint(answers: ReadonlyMap<string, Answer>): Fingerprint {
  const scores = new Map<DispatcherName, number>(DISPATCHER_NAMES.map((name) => [name, 0]));
  let answered = 0;
  let idlePolicy: IdlePolicy | null = null;
  let landingButtons: LandingButtons | null = null;

  for (const question of QUESTIONS) {
    const answer = answers.get(question.id);
    if (answer === undefined || answer === 'unsure') continue;
    answered += 1;

    if (question.implies) {
      if (answer === 'yes') {
        idlePolicy = question.implies.idlePolicy ?? idlePolicy;
        landingButtons = question.implies.landingButtons ?? landingButtons;
      }
      continue;
    }

    for (const name of DISPATCHER_NAMES) {
      const consistent = question.consistentWith.includes(name);
      const matches = answer === 'yes' ? consistent : !consistent;
      scores.set(name, (scores.get(name) ?? 0) + (matches ? 1 : -1));
    }
  }

  const candidates = [...scores.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const best = candidates[0];
  const runnerUp = candidates[1];
  const ambiguous = best !== undefined && runnerUp !== undefined && best.score === runnerUp.score;
  const scoring = QUESTIONS.filter((question) => !question.implies).length;

  return {
    candidates,
    identified: best && !ambiguous && best.score > 0 ? best.name : null,
    ambiguous,
    nextQuestion:
      ambiguous && best && runnerUp ? separator(answers, best.name, runnerUp.name) : null,
    idlePolicy,
    landingButtons,
    confidence: scoring === 0 ? 0 : Math.min(1, answered / scoring),
  };
}

/** An unanswered question that fits one of the two leaders but not the other. */
function separator(
  answers: ReadonlyMap<string, Answer>,
  first: DispatcherName,
  second: DispatcherName,
): BehaviourQuestion | null {
  return (
    QUESTIONS.find((question) => {
      const answer = answers.get(question.id);
      if (answer !== undefined && answer !== 'unsure') return false;
      if (question.implies) return false;
      return question.consistentWith.includes(first) !== question.consistentWith.includes(second);
    }) ?? null
  );
}
