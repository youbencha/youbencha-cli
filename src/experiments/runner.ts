import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ExperimentDefinition } from '../schemas/experiment.schema.js';
import type { ExperimentState } from '../schemas/experiment-result.schema.js';
import type { ExperimentPlan } from './planner.js';
import type { SingleRunExecutor } from './single-run-executor.js';
import {
  ExperimentScheduler,
  type ExperimentScheduleResult,
} from './scheduler.js';
import { ExperimentStateStore } from './state-store.js';

export interface RunExperimentOptions {
  plan: ExperimentPlan;
  executor: SingleRunExecutor;
  retry: ExperimentDefinition['execution']['retry'];
  resultsDirectory?: string;
  experimentId?: string;
  resume?: boolean;
  signal?: AbortSignal;
  now?: () => Date;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface RunExperimentResult extends ExperimentScheduleResult {
  experimentId: string;
  experimentDirectory: string;
  resumed: boolean;
}

function newExperimentId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp}-${randomUUID()}`;
}

async function prepareResumeState(
  store: ExperimentStateStore,
  plan: ExperimentPlan,
  now: () => Date,
  maxAttempts: number
): Promise<ExperimentState> {
  const { manifest, state } = await store.load(plan.definitionHash);
  const planById = new Map(plan.cells.map((cell) => [cell.cellId, cell]));
  const manifestById = new Map(
    manifest.cells.map((cell) => [cell.cell_id, cell])
  );
  const stateById = new Map(state.cells.map((cell) => [cell.cell_id, cell]));
  if (
    planById.size !== plan.cells.length ||
    manifestById.size !== manifest.cells.length ||
    stateById.size !== state.cells.length ||
    plan.cells.length !== manifest.cells.length ||
    plan.cells.length !== state.cells.length
  ) {
    throw new Error(
      'Persisted experiment matrix must map uniquely to the current plan'
    );
  }
  for (const planned of plan.cells) {
    const persistedManifest = manifestById.get(planned.cellId);
    const persistedState = stateById.get(planned.cellId);
    if (
      persistedManifest === undefined ||
      persistedState === undefined ||
      persistedManifest.testcase_id !== planned.testcaseId ||
      persistedManifest.variant_name !== planned.variantName ||
      persistedManifest.repetition !== planned.repetition ||
      persistedManifest.config_hash !== planned.configHash ||
      persistedState.testcase_id !== planned.testcaseId ||
      persistedState.variant_name !== planned.variantName ||
      persistedState.repetition !== planned.repetition
    ) {
      throw new Error(
        `Persisted experiment cell ${planned.cellId} does not match the current plan`
      );
    }
  }

  for (const cell of state.cells) {
    if (
      cell.status === 'passed' ||
      cell.status === 'failed' ||
      cell.status === 'partial'
    ) {
      try {
        if (cell.result_path === undefined) {
          throw new Error('Completed cell has no result path');
        }
        await store.validateAttemptResult(cell.result_path);
      } catch {
        cell.status = 'pending';
        cell.attempts = [];
        cell.result_path = undefined;
        cell.terminal_reason = 'completed artifact missing or invalid';
      }
    } else if (cell.status === 'running') {
      const attempt = cell.attempts[cell.attempts.length - 1];
      if (attempt?.status === 'running') {
        const completed = now();
        attempt.status = 'infrastructure_failed';
        attempt.completed_at = completed.toISOString();
        attempt.duration_ms = Math.max(
          0,
          completed.getTime() - Date.parse(attempt.started_at)
        );
        attempt.terminal_reason = 'interrupted';
      }
      cell.status =
        cell.attempts.length < maxAttempts
          ? 'pending'
          : 'infrastructure_failed';
      cell.terminal_reason = 'interrupted';
    } else if (cell.status === 'cancelled') {
      cell.status =
        cell.attempts.length < maxAttempts
          ? 'pending'
          : 'infrastructure_failed';
      cell.terminal_reason = undefined;
    }
  }
  state.status = 'pending';
  state.budget.stop_reason = undefined;
  state.updated_at = now().toISOString();
  await store.save(state);
  return state;
}

export async function runExperiment(
  options: RunExperimentOptions
): Promise<RunExperimentResult> {
  const now = options.now ?? ((): Date => new Date());
  if (options.resume && options.experimentId === undefined) {
    throw new Error('Resuming an experiment requires an experiment ID');
  }
  if (!options.resume && options.experimentId !== undefined) {
    throw new Error('An experiment ID may only be supplied when resuming');
  }

  const experimentId = options.experimentId ?? newExperimentId(now());
  const resultsRoot = path.resolve(
    options.resultsDirectory ?? path.join('results', 'experiments')
  );
  const store = new ExperimentStateStore(resultsRoot, experimentId);
  const releaseLock = await store.acquireRunLock();
  try {
    const state = options.resume
      ? await prepareResumeState(
          store,
          options.plan,
          now,
          options.retry.max_attempts
        )
      : await store.create(options.plan, now().toISOString());

    const runtimeAbort = new AbortController();
    const onExternalAbort = (): void =>
      runtimeAbort.abort(options.signal?.reason);
    const onSigint = (): void =>
      runtimeAbort.abort(new Error('Experiment interrupted by SIGINT'));
    if (options.signal?.aborted) {
      onExternalAbort();
    } else {
      options.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }
    process.once('SIGINT', onSigint);

    const scheduler = new ExperimentScheduler({
      plan: options.plan,
      state,
      store,
      executor: options.executor,
      retry: options.retry,
      signal: runtimeAbort.signal,
      now,
      delay: options.delay,
    });
    try {
      const result = await scheduler.run();
      return {
        ...result,
        experimentId,
        experimentDirectory: store.experimentDirectory,
        resumed: options.resume === true,
      };
    } finally {
      process.removeListener('SIGINT', onSigint);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  } finally {
    await releaseLock();
  }
}
