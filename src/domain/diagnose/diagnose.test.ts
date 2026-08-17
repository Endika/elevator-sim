import { describe, expect, it } from 'vitest';
import { fingerprint } from './AlgorithmFingerprint';
import { type Answer, QUESTIONS, questionsWithoutDiscriminatingPower } from './BehaviourQuestions';

function answers(entries: Record<string, Answer>): Map<string, Answer> {
  return new Map(Object.entries(entries));
}

describe('the questionnaire earns its questions', () => {
  it('has no question that fails to separate at least two algorithms', () => {
    expect(questionsWithoutDiscriminatingPower().map((question) => question.id)).toEqual([]);
  });

  it('gives every question a prompt somebody could answer from the landing', () => {
    for (const question of QUESTIONS) {
      expect(question.prompt.length).toBeGreaterThan(20);
      expect(question.detail.length).toBeGreaterThan(20);
    }
  });
});

describe('identifying an algorithm', () => {
  it('names collective when the answers only fit collective', () => {
    const result = fingerprint(
      answers({
        'passes-opposite-call': 'yes',
        'serves-later-nearer-call': 'no',
        'strict-order': 'no',
        'sweeps-then-reverses': 'yes',
      }),
    );
    expect(result.identified).toBe('collective');
    expect(result.ambiguous).toBe(false);
  });

  it('names fcfs when calls are answered strictly in order', () => {
    const result = fingerprint(
      answers({
        'strict-order': 'yes',
        'passes-opposite-call': 'no',
        'serves-later-nearer-call': 'no',
        'sweeps-then-reverses': 'no',
      }),
    );
    expect(result.identified).toBe('fcfs');
  });

  it('admits when it cannot separate nearest-car from etd', () => {
    const result = fingerprint(
      answers({ 'serves-later-nearer-call': 'yes', 'strict-order': 'no' }),
    );
    expect(result.identified).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(
      result.candidates
        .slice(0, 2)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(['etd', 'nearest-car']);
  });

  it('offers a question that would settle an ambiguity', () => {
    const result = fingerprint(
      answers({ 'serves-later-nearer-call': 'yes', 'strict-order': 'no' }),
    );
    expect(result.nextQuestion?.id).toBe('sweeps-then-reverses');
  });

  it('treats unsure as no evidence at all', () => {
    const result = fingerprint(answers({ 'passes-opposite-call': 'unsure' }));
    expect(result.confidence).toBe(0);
    expect(result.identified).toBeNull();
  });

  it('grows confidence as questions are answered', () => {
    const few = fingerprint(answers({ 'passes-opposite-call': 'yes' }));
    const many = fingerprint(
      answers({
        'passes-opposite-call': 'yes',
        'serves-later-nearer-call': 'no',
        'strict-order': 'no',
        'sweeps-then-reverses': 'yes',
      }),
    );
    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.confidence).toBeLessThanOrEqual(1);
  });
});

describe('the idle policy is diagnosed separately from the algorithm', () => {
  it('reads it off the parking behaviour without touching the algorithm scores', () => {
    const withoutParking = fingerprint(answers({ 'strict-order': 'yes' }));
    const withParking = fingerprint(
      answers({ 'strict-order': 'yes', 'returns-to-entrance': 'yes' }),
    );
    expect(withParking.idlePolicy).toBe('return-to-entrance');
    expect(withParking.candidates).toEqual(withoutParking.candidates);
  });

  it('reports staying put', () => {
    expect(fingerprint(answers({ 'stays-put': 'yes' })).idlePolicy).toBe('stay-put');
  });
});

describe('installations this tool cannot model', () => {
  it('flags destination entry rather than pretending to cover it', () => {
    const question = QUESTIONS.find((entry) => entry.id === 'destination-in-lobby');
    expect(question?.outOfScope).toContain('not modelled here');
    expect(question?.consistentWith).toEqual([]);
  });
});
