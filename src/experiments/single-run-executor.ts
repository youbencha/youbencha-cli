import type { ResultsBundle } from '../schemas/result.schema.js';
import type { TestCaseConfig } from '../schemas/testcase.schema.js';

export interface PlannedExperimentCell {
  cellId: string;
  testcaseId: string;
  variantName: string;
  repetition: number;
  configHash: string;
  config: TestCaseConfig;
}

export interface SingleRunExecutionContext {
  experimentId: string;
  attemptId: string;
  attemptNumber: number;
  signal?: AbortSignal;
}

export interface SingleRunExecutionResult {
  result: ResultsBundle;
  resultPath: string;
  costUsd?: number;
  tokenCount?: number;
  /** @deprecated Use tokenQuality and costQuality for new executors. */
  usageQuality: 'measured' | 'estimated' | 'unavailable';
  tokenQuality?: 'measured' | 'estimated' | 'unavailable';
  costQuality?: 'measured' | 'estimated' | 'unavailable';
}

export interface SingleRunExecutor {
  execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult>;
}
