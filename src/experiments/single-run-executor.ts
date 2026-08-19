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
  reportLifecycle?: (event: RemoteAttemptLifecycleEvent) => Promise<void>;
}

export interface RemoteAttemptLifecycleEvent {
  executionProvider: 'host-trusted' | 'e2b';
  lifecycleState:
    | 'creating'
    | 'running'
    | 'collecting'
    | 'killing'
    | 'paused'
    | 'killed'
    | 'lost';
  sandboxId?: string;
  templateId?: string;
  templateBuildId?: string;
  sdkVersion?: string;
  secureAccess?: boolean;
  resources?: { cpu_count: number; memory_mb: number };
  networkPolicy?: unknown;
  runnerProtocol?: string;
  artifactProtocol?: string;
  fixtureSnapshotId?: string;
  retainedUntil?: string;
  retentionReason?: string;
  sandboxStartedAt?: string;
  sandboxCompletedAt?: string;
  sandboxRuntimeMs?: number;
}

export interface InterruptedExecutionContext {
  experimentId: string;
  cellId: string;
  targetId: string;
  attemptId: string;
  sandboxId?: string;
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
  sandboxRuntimeMs?: number;
  sandboxCostUsd?: number;
  sandboxCostQuality?: 'measured' | 'estimated' | 'unavailable';
}

export interface SingleRunExecutor {
  execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult>;
  reconcileInterrupted?(context: InterruptedExecutionContext): Promise<void>;
}
