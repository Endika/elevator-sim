import type { Advice } from '../../application/Advice';
import type { ExperimentResult } from '../../application/Experiment';
import type { Scenario } from '../../application/Scenario';

export interface SweepRequest {
  readonly scenario: Scenario;
}

export type SweepResponse =
  | {
      readonly kind: 'progress';
      readonly done: number;
      readonly total: number;
      readonly stage: 'comparing' | 'working out what would help';
    }
  | {
      readonly kind: 'done';
      readonly result: ExperimentResult;
      readonly advice: Advice;
    }
  | { readonly kind: 'failed'; readonly message: string };
