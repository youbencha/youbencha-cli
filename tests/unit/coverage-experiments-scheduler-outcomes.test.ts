import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runExperiment } from '../../src/experiments/runner.js';
import type { ExperimentPlan } from '../../src/experiments/planner.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import {
  ExperimentScheduler,
  type ExperimentSchedulerOptions,
} from '../../src/experiments/scheduler.js';
import { ExperimentBudget } from '../../src/experiments/budget.js';
import type {
  ExperimentAttempt,
  ExperimentCellResult,
  ExperimentState,
} from '../../src/schemas/experiment-result.schema.js';
import type { PlannedExperimentCell } from '../../src/experiments/single-run-executor.js';
import type { ExperimentStateStore } from '../../src/experiments/state-store.js';

const hash = 'a'.repeat(64);
const timestamp = '2026-07-29T12:00:00.000Z';

function plan(): ExperimentPlan {
  return {
    definitionHash: hash,
    cellCount: 1,
    maxConcurrent: 1,
    redactedEffectiveConfiguration: {},
    cells: [
      {
        cellId: 'b'.repeat(64),
        testcaseId: 'case',
        variantName: 'target',
        repetition: 0,
        configHash: hash,
        config: {},
      },
    ],
  } as unknown as ExperimentPlan;
}

function bundle(
  workspace: string,
  overall: 'passed' | 'failed' | 'partial'
): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'fixture',
      config_file: 'case.yaml',
      config_hash: hash,
      repo: 'https://example.test/repo.git',
      branch: 'main',
      commit: 'abc',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 1,
      youbencha_version: 'test',
      environment: {
        os: 'test',
        node_version: '20',
        workspace_dir: workspace,
      },
    },
    agent: {
      type: 'codex-cli',
      youbencha_log_path: 'agent.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [],
    summary: {
      total_evaluators: 1,
      passed: overall === 'passed' ? 1 : 0,
      failed: overall === 'failed' ? 1 : 0,
      skipped: overall === 'partial' ? 1 : 0,
      overall_status: overall,
    },
    artifacts: {
      agent_log: 'agent.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

describe('experiment scheduler final outcomes and lifecycle metadata', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-scheduler-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  for (const [overall, finalStatus, exitCode] of [
    ['failed', 'failed', 2],
    ['partial', 'partial', 3],
  ] as const) {
    it(`maps a ${overall} result to its final process outcome`, async () => {
      const result = await runExperiment({
        plan: plan(),
        resultsDirectory: path.join(temporaryDirectory, overall),
        retry: {
          max_attempts: 1,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          execute: async () => ({
            result: bundle(temporaryDirectory, overall),
            resultPath: 'unused',
            usageQuality: 'unavailable',
          }),
        },
        now: () => new Date(timestamp),
      });
      expect(result).toMatchObject({ finalStatus, exitCode });
    });
  }

  it('persists every optional remote lifecycle and sandbox usage field', async () => {
    const result = await runExperiment({
      plan: plan(),
      resultsDirectory: path.join(temporaryDirectory, 'lifecycle'),
      retry: {
        max_attempts: 1,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async (_cell, context) => {
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'running',
            sandboxId: 'sandbox',
            templateId: 'template',
            templateBuildId: 'build',
            sdkVersion: '1.0.0',
            secureAccess: true,
            resources: { cpu_count: 2, memory_mb: 4096 },
            networkPolicy: { inbound: 'none', outbound: 'none' },
            runnerProtocol: '1.0.0',
            artifactProtocol: '1.0.0',
            fixtureSnapshotId: 'fixture',
            retainedUntil: timestamp,
            retentionReason: 'debug',
            sandboxStartedAt: timestamp,
            sandboxCompletedAt: timestamp,
            sandboxRuntimeMs: 10,
          });
          return {
            result: bundle(temporaryDirectory, 'passed'),
            resultPath: 'unused',
            tokenCount: 10,
            costUsd: 1,
            usageQuality: 'measured' as const,
            tokenQuality: 'estimated' as const,
            costQuality: 'measured' as const,
            sandboxRuntimeMs: 10,
            sandboxCostUsd: 2,
            sandboxCostQuality: 'measured' as const,
          };
        },
      },
      now: () => new Date(timestamp),
    });
    expect(result.state.cells[0]).toMatchObject({
      token_count: 10,
      cost_usd: 1,
      sandbox_runtime_ms: 10,
      sandbox_cost_usd: 2,
      sandbox_cost_quality: 'measured',
    });
    expect(result.state.cells[0].attempts[0].remote).toMatchObject({
      sandbox_id: 'sandbox',
      fixture_snapshot_id: 'fixture',
      sandbox_runtime_ms: 10,
    });
  });

  it('covers private capacity, plan validation, lifecycle ownership, draining, and retry timing', async () => {
    const planned = plan().cells[0];
    const cellState: ExperimentCellResult = {
      cell_id: planned.cellId,
      testcase_id: planned.testcaseId,
      variant_name: planned.variantName,
      repetition: planned.repetition,
      status: 'pending',
      attempts: [],
      usage_quality: 'unavailable',
    };
    const state: ExperimentState = {
      schema_version: '1.0.0',
      experiment_id: 'experiment',
      definition_hash: hash,
      status: 'pending',
      updated_at: timestamp,
      cells: [cellState],
      budget: {
        duration_ms_used: 0,
        cost_usd_used: 0,
        sandbox_runtime_ms_used: 0,
      },
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const store = {
      experimentId: 'experiment',
      save,
      saveAttemptResult: jest.fn().mockResolvedValue('result.json'),
    } as unknown as ExperimentStateStore;
    const options: ExperimentSchedulerOptions = {
      plan: { ...plan(), maxConcurrent: 0 },
      state,
      store,
      executor: {
        execute: async () => ({
          result: bundle(temporaryDirectory, 'passed'),
          resultPath: 'unused',
          usageQuality: 'unavailable',
        }),
      },
      retry: {
        max_attempts: 1,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      now: () => new Date(timestamp),
    };
    const scheduler = new ExperimentScheduler(options);
    const internals = scheduler as unknown as {
      startReadyCells: () => Promise<void>;
      execute: (
        cell: PlannedExperimentCell,
        cellState: ExperimentCellResult,
        attempt: ExperimentAttempt,
        startedAtMs: number
      ) => Promise<{
        cell: PlannedExperimentCell;
        cellState: ExperimentCellResult;
        attempt: ExperimentAttempt;
        error?: unknown;
      }>;
      drainActive: (
        budget: ExperimentBudget,
        persist: boolean
      ) => Promise<void>;
      applySettled: (
        settled: {
          cell: PlannedExperimentCell;
          cellState: ExperimentCellResult;
          attempt: ExperimentAttempt;
          execution?: {
            result: ResultsBundle;
            resultPath: string;
            usageQuality: 'unavailable';
            sandboxRuntimeMs?: number;
          };
          error?: unknown;
        },
        budget: ExperimentBudget
      ) => Promise<void>;
      nextRetryDelay: () => number | undefined;
      cancelPending: (
        state: ExperimentState,
        budget: ExperimentBudget
      ) => Promise<void>;
      active: Map<string, Promise<unknown>>;
      retryNotBefore: Map<string, number>;
    };
    await expect(internals.startReadyCells()).resolves.toBeUndefined();

    options.plan = { ...plan(), cells: [] };
    options.plan.maxConcurrent = 1;
    await expect(internals.startReadyCells()).rejects.toThrow(
      'is not in the plan'
    );

    const attempt: ExperimentAttempt = {
      attempt_id: 'owned',
      attempt_number: 1,
      status: 'running',
      started_at: timestamp,
    };
    cellState.attempts = [{ ...attempt, attempt_id: 'different' }];
    options.executor = {
      execute: async (_cell, context): Promise<never> => {
        await context.reportLifecycle?.({
          executionProvider: 'e2b',
          lifecycleState: 'running',
        });
        throw new Error('unreachable');
      },
    };
    const ownership = await internals.execute(
      planned,
      cellState,
      attempt,
      Date.parse(timestamp)
    );
    expect(ownership.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('does not own'),
      })
    );

    const budget = new ExperimentBudget(undefined, Date.parse(timestamp));
    internals.active.set('ignored', Promise.resolve(ownership));
    await internals.drainActive(budget, false);
    expect(internals.active.size).toBe(0);
    cellState.attempts = [attempt];
    cellState.status = 'running';
    internals.active.set(
      'persisted',
      Promise.resolve({
        cell: planned,
        cellState,
        attempt,
        error: new Error('settled failure'),
      })
    );
    await internals.drainActive(budget, true);
    expect(save).toHaveBeenCalled();

    const infrastructureBundle = bundle(temporaryDirectory, 'passed');
    infrastructureBundle.agent.status = 'failed';
    infrastructureBundle.agent.exit_code = 1;
    cellState.status = 'running';
    cellState.duration_ms = 5;
    cellState.attempts = [attempt];
    attempt.duration_ms = undefined;
    await internals.applySettled(
      {
        cell: planned,
        cellState,
        attempt,
        execution: {
          result: infrastructureBundle,
          resultPath: 'unused',
          usageQuality: 'unavailable',
          sandboxRuntimeMs: 1,
        },
      },
      budget
    );
    expect(cellState.terminal_reason).toBe('infrastructure_failure');

    const timeoutBundle = bundle(temporaryDirectory, 'passed');
    timeoutBundle.agent.status = 'timeout';
    timeoutBundle.agent.exit_code = 124;
    const timeoutAttempt: ExperimentAttempt = {
      ...attempt,
      attempt_id: 'timeout',
      status: 'running',
      terminal_reason: undefined,
    };
    cellState.status = 'running';
    cellState.attempts = [timeoutAttempt];
    await internals.applySettled(
      {
        cell: planned,
        cellState,
        attempt: timeoutAttempt,
        execution: {
          result: timeoutBundle,
          resultPath: 'unused',
          usageQuality: 'unavailable',
        },
      },
      budget
    );

    cellState.status = 'running';
    attempt.duration_ms = undefined;
    await internals.applySettled(
      {
        cell: planned,
        cellState,
        attempt,
        error: new Error('without execution'),
      },
      budget
    );

    cellState.status = 'pending';
    internals.retryNotBefore.clear();
    expect(internals.nextRetryDelay()).toBe(0);
    internals.retryNotBefore.set(cellState.cell_id, Date.parse(timestamp) + 50);
    expect(internals.nextRetryDelay()).toBe(50);
    cellState.status = 'passed';
    expect(internals.nextRetryDelay()).toBeUndefined();

    cellState.status = 'pending';
    state.budget.stop_reason = undefined;
    await internals.cancelPending(state, budget);
    expect(cellState).toMatchObject({
      status: 'cancelled',
      terminal_reason: 'cancelled',
    });
  });

  it('cancels pending retries when the retry delay rejects', async () => {
    const planned = plan().cells[0];
    const state: ExperimentState = {
      schema_version: '1.0.0',
      experiment_id: 'delay-rejection',
      definition_hash: hash,
      status: 'pending',
      updated_at: timestamp,
      cells: [
        {
          cell_id: planned.cellId,
          testcase_id: planned.testcaseId,
          variant_name: planned.variantName,
          repetition: planned.repetition,
          status: 'pending',
          attempts: [],
          usage_quality: 'unavailable',
        },
      ],
      budget: {
        duration_ms_used: 0,
        cost_usd_used: 0,
        sandbox_runtime_ms_used: 0,
      },
    };
    const scheduler = new ExperimentScheduler({
      plan: plan(),
      state,
      store: {
        experimentId: 'delay-rejection',
        save: jest.fn().mockResolvedValue(undefined),
      } as unknown as ExperimentStateStore,
      executor: {
        execute: async (): Promise<never> => {
          throw new Error('not ready');
        },
      },
      retry: {
        max_attempts: 1,
        on: [],
        backoff_ms: 100,
        jitter: 'none',
      },
      now: (): Date => new Date(timestamp),
      delay: async (): Promise<never> => {
        throw new Error('delay cancelled');
      },
    });
    (
      scheduler as unknown as {
        retryNotBefore: Map<string, number>;
      }
    ).retryNotBefore.set(planned.cellId, Date.parse(timestamp) + 100);
    await expect(scheduler.run()).resolves.toMatchObject({
      finalStatus: 'partial',
      exitCode: 3,
    });
  });

  it('classifies returned timeouts and exhausts their configured retry', async () => {
    let calls = 0;
    const timeoutBundle = bundle(temporaryDirectory, 'passed');
    timeoutBundle.agent.status = 'timeout';
    timeoutBundle.agent.exit_code = 124;
    const result = await runExperiment({
      plan: plan(),
      resultsDirectory: path.join(temporaryDirectory, 'timeout-result'),
      retry: {
        max_attempts: 2,
        on: ['timeout'],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async () => {
          calls += 1;
          return {
            result: timeoutBundle,
            resultPath: 'unused',
            usageQuality: 'unavailable' as const,
          };
        },
      },
      now: () => new Date(timestamp),
    });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ finalStatus: 'partial', exitCode: 3 });
  });
});
