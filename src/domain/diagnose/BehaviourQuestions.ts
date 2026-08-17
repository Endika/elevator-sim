import type { IdlePolicy } from '../config/BuildingConfig';
import type { DispatcherName } from '../dispatch/registry';
import { DISPATCHER_NAMES } from '../dispatch/registry';

export type Answer = 'yes' | 'no' | 'unsure';

/**
 * A question earns its place only by ruling algorithms in or out. `consistentWith` lists the
 * algorithms whose behaviour matches a "yes"; a "no" rules those out instead. Questions about the
 * idle policy answer a different question — where the time goes — and carry no algorithm weight.
 */
export interface BehaviourQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly detail: string;
  readonly consistentWith: readonly DispatcherName[];
  readonly implies?: { readonly idlePolicy: IdlePolicy };
  /** Set when a "yes" means this tool cannot model the installation faithfully. */
  readonly outOfScope?: string;
}

export const QUESTIONS: readonly BehaviourQuestion[] = [
  {
    id: 'passes-opposite-call',
    prompt: 'Travelling up, does it sail past a floor where someone is waiting to go down?',
    detail:
      'Stand on an upper floor and press the down button while the lift is coming up from below ' +
      'with someone in it. Collective control passes you; a simple queue would not.',
    consistentWith: ['collective'],
  },
  {
    id: 'serves-later-nearer-call',
    prompt: 'Does it answer someone who pressed after you, because they were closer to it?',
    detail: 'Order of pressing is ignored by anything that optimises for distance or cost.',
    consistentWith: ['nearest-car', 'etd'],
  },
  {
    id: 'strict-order',
    prompt: 'Does it always answer calls in the order they were pressed, however far away?',
    detail: 'The signature of a naive queue, and unmistakable once you watch for it.',
    consistentWith: ['fcfs'],
  },
  {
    id: 'sweeps-then-reverses',
    prompt: 'Does it finish every call in one direction before turning round?',
    detail: 'A clean sweep up and then a clean sweep down is collective control at work.',
    consistentWith: ['collective', 'etd'],
  },
  {
    id: 'destination-in-lobby',
    prompt: 'Do you enter your floor on a keypad in the lobby, rather than pressing up or down?',
    detail: 'Destination entry changes what the controller knows before you even board.',
    consistentWith: [],
    outOfScope:
      'Destination dispatch is not modelled here. Doing it faithfully needs the car to board by ' +
      'destination rather than by direction, which changes the engine contract — so the ' +
      'comparison below does not apply to your installation.',
  },
  {
    id: 'returns-to-entrance',
    prompt: 'When nobody has called it for a while, does it return to the ground floor by itself?',
    detail:
      'This is the idle parking policy, not the dispatch algorithm. It often matters more than ' +
      'the algorithm does.',
    consistentWith: [],
    implies: { idlePolicy: 'return-to-entrance' },
  },
  {
    id: 'stays-put',
    prompt: 'Does it just sit wherever the last person left it?',
    detail: 'Also the idle policy. Good for the last passenger, worse for everyone in the lobby.',
    consistentWith: [],
    implies: { idlePolicy: 'stay-put' },
  },
];

/**
 * Every question must separate at least two implemented algorithms, or it is decoration. The two
 * exemptions are questions that report the idle policy and questions that exist to say the
 * installation is out of scope — both answer something real, just not "which algorithm".
 */
export function questionsWithoutDiscriminatingPower(): BehaviourQuestion[] {
  const implemented = new Set<string>(DISPATCHER_NAMES);
  return QUESTIONS.filter((question) => {
    if (question.implies || question.outOfScope) return false;
    const known = question.consistentWith.filter((name) => implemented.has(name));
    return known.length === 0 || known.length === implemented.size;
  });
}
