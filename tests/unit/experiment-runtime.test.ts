import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { TestCaseConfig } from '../../src/schemas/testcase.schema.js';
import type { ExperimentPlan } from '../../src/experiments/planner.js';
import {
  abortableDelay,
  ExperimentExecutionError,
  ExperimentScheduler,
  ExperimentStateStore,
  TargetUnavailableError,
  runExperiment,
  type SingleRunExecutionResult,
  type SingleRunExecutor,
} from '../../src/experiments/index.js';

const retry = {
  max_attempts: 1,
  on: [] as Array<'infrastructure_failure' | 'timeout'>,
  backoff_ms: 0,
};

function result(
  overall: 'passed' | 'failed' | 'partial' = 'passed'
): ResultsBundle {
  const skipped = overall === 'partial' ? 1 : 0;
  const failed = overall === 'failed' ? 1 : 0;
  return {
    version: '1.0.0',
    test_case: {
      name: 'test',
      description: 'test',
      config_file: 'test.yaml',
      config_hash: 'a'.repeat(64),
      repo: 'local',
      branch: 'main',
      commit: 'abc',
    },
    execution: {
      started_at: new Date(0).toISOString(),
      completed_at: new Date(1).toISOString(),
      duration_ms: 1,
      youbencha_version: 'test',
      environment: {
        os: 'test',
        node_version: 'test',
        workspace_dir: 'workspace',
      },
    },
    agent: {
      type: 'fake',
      youbencha_log_path: 'agent.log',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [],
    summary: {
      total_evaluators: skipped + failed + (overall === 'passed' ? 1 : 0),
      passed: overall === 'passed' ? 1 : 0,
      failed,
      skipped,
      overall_status: overall,
    },
    artifacts: { agent_log: 'agent.log', reports: [], evaluator_artifacts: [] },
  };
}

function plan(cellCount: number, maxConcurrent = 1): ExperimentPlan {
  return {
    definitionHash: 'b'.repeat(64),
    cellCount,
    maxConcurrent,
    budget: undefined,
    redactedEffectiveConfiguration: { safe: true },
    cells: Array.from({ length: cellCount }, (_, index) => ({
      cellId: index.toString(16).padStart(64, '0'),
      testcaseId: `test-${index}`,
      variantName: 'fake',
      repetition: 0,
      configHash: 'c'.repeat(64),
      config: {} as TestCaseConfig,
    })),
  };
}

describe('experiment runtime', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-runtime-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('bounds concurrency and durably creates state before execution', async () => {
    let active = 0;
    let maximum = 0;
    const executor: SingleRunExecutor = {
      execute: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        };
      },
    };

    const outcome = await runExperiment({
      plan: plan(6, 2),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
    });

    expect(maximum).toBe(2);
    expect(outcome.finalStatus).toBe('passed');
    await expect(
      fs.readFile(path.join(outcome.experimentDirectory, 'experiment.json'))
    ).resolves.toBeDefined();
    const state = JSON.parse(
      await fs.readFile(
        path.join(outcome.experimentDirectory, 'state.json'),
        'utf8'
      )
    ) as { status: string };
    expect(state.status).toBe('completed');
    expect(
      (await fs.readdir(outcome.experimentDirectory)).filter((file) =>
        file.endsWith('.tmp')
      )
    ).toEqual([]);
  });

  test('durably records remote lifecycle ownership updates', async () => {
    const outcome = await runExperiment({
      plan: plan(1),
      executor: {
        execute: async (_cell, context) => {
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'creating',
            templateId: 'template-ref',
            templateBuildId: 'build-123',
          });
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'running',
            sandboxId: 'sandbox-123',
            templateId: 'template-ref',
            templateBuildId: 'build-123',
          });
          return {
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
          };
        },
      },
      retry,
      resultsDirectory: temporaryDirectory,
    });

    expect(outcome.state.cells[0].attempts[0]).toMatchObject({
      execution_provider: 'e2b',
      remote: {
        lifecycle_state: 'running',
        sandbox_id: 'sandbox-123',
        template_id: 'template-ref',
        template_build_id: 'build-123',
      },
    });
    const persisted = JSON.parse(
      await fs.readFile(
        path.join(outcome.experimentDirectory, 'state.json'),
        'utf8'
      )
    ) as { cells: Array<{ attempts: unknown[] }> };
    expect(persisted.cells[0].attempts[0]).toMatchObject({
      execution_provider: 'e2b',
      remote: { sandbox_id: 'sandbox-123' },
    });
  });

  test('retries only configured failure classes with exact attempt limits', async () => {
    let calls = 0;
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        if (calls < 3) {
          throw new ExperimentExecutionError('temporary', 'timeout');
        }
        return {
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        };
      },
    };

    const outcome = await runExperiment({
      plan: plan(1),
      executor,
      retry: { max_attempts: 3, on: ['timeout'], backoff_ms: 0 },
      resultsDirectory: temporaryDirectory,
    });
    expect(calls).toBe(3);
    expect(outcome.state.cells[0].attempts).toHaveLength(3);
    expect(outcome.finalStatus).toBe('passed');

    calls = 0;
    const notRetried = await runExperiment({
      plan: plan(1),
      executor,
      retry: {
        max_attempts: 3,
        on: ['infrastructure_failure'],
        backoff_ms: 0,
      },
      resultsDirectory: temporaryDirectory,
    });
    expect(calls).toBe(1);
    expect(notRetried.finalStatus).toBe('infrastructure_failed');
  });

  test('cancels pending target fan-out after deterministic unavailability', async () => {
    let calls = 0;
    const outcome = await runExperiment({
      plan: plan(3, 1),
      executor: {
        execute: async () => {
          calls += 1;
          throw new TargetUnavailableError(
            'fake',
            'requested model is unavailable'
          );
        },
      },
      retry: {
        max_attempts: 3,
        on: ['infrastructure_failure'],
        backoff_ms: 0,
      },
      resultsDirectory: temporaryDirectory,
    });
    expect(calls).toBe(1);
    expect(outcome.state.cells.map((cell) => cell.status)).toEqual([
      'infrastructure_failed',
      'cancelled',
      'cancelled',
    ]);
    expect(outcome.state.cells[1].terminal_reason).toContain(
      'target_unavailable'
    );
    expect(outcome.exitCode).toBe(1);
  });

  test('classifies exhausted configured retries as partial and accumulates usage', async () => {
    const outcome = await runExperiment({
      plan: plan(1),
      executor: {
        execute: async (): Promise<{
          result: ResultsBundle;
          resultPath: string;
          costUsd: number;
          tokenCount: number;
          usageQuality: 'measured';
        }> => ({
          result: {
            ...result(),
            agent: {
              ...result().agent,
              status: 'error',
              exit_code: 1,
            },
          },
          resultPath: 'ignored.json',
          costUsd: 0.25,
          tokenCount: 7,
          usageQuality: 'estimated',
          tokenQuality: 'measured',
          costQuality: 'estimated',
        }),
      },
      retry: {
        max_attempts: 2,
        on: ['infrastructure_failure'],
        backoff_ms: 0,
      },
      resultsDirectory: temporaryDirectory,
    });

    expect(outcome.finalStatus).toBe('partial');
    expect(outcome.exitCode).toBe(3);
    expect(outcome.state.cells[0]).toMatchObject({
      cost_usd: 0.5,
      token_count: 14,
      usage_quality: 'estimated',
      token_quality: 'measured',
      cost_quality: 'estimated',
      terminal_reason: 'retry_exhausted:infrastructure_failure',
    });
    expect(outcome.state.budget.cost_usd_used).toBe(0.5);
  });

  test('accounts returned usage before an attempt artifact write fails', async () => {
    const runtimePlan = plan(1);
    const store = new ExperimentStateStore(
      temporaryDirectory,
      'artifact-write-failure'
    );
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    jest
      .spyOn(store, 'saveAttemptResult')
      .mockRejectedValue(new Error('disk full'));
    const scheduler = new ExperimentScheduler({
      plan: runtimePlan,
      state,
      store,
      executor: {
        execute: async (): Promise<SingleRunExecutionResult> => ({
          result: result(),
          resultPath: 'ignored.json',
          costUsd: 0.75,
          tokenCount: 11,
          usageQuality: 'measured',
        }),
      },
      retry: {
        max_attempts: 1,
        on: ['infrastructure_failure'],
        backoff_ms: 0,
      },
    });

    const outcome = await scheduler.run();
    expect(outcome.exitCode).toBe(3);
    expect(state.budget.cost_usd_used).toBe(0.75);
    expect(state.cells[0]).toMatchObject({
      cost_usd: 0.75,
      token_count: 11,
    });
  });

  test('aborts and drains launched attempts before surfacing a scheduler persistence failure', async () => {
    const runtimePlan = plan(2, 2);
    const store = new ExperimentStateStore(
      temporaryDirectory,
      'drain-on-failure'
    );
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    let saves = 0;
    const originalSave = store.save.bind(store);
    jest.spyOn(store, 'save').mockImplementation(async (nextState) => {
      saves += 1;
      if (saves === 3) {
        throw new Error('state persistence failed');
      }
      await originalSave(nextState);
    });
    let drained = false;
    const scheduler = new ExperimentScheduler({
      plan: runtimePlan,
      state,
      store,
      executor: {
        execute: async (
          cell,
          context
        ): Promise<{
          result: ResultsBundle;
          resultPath: string;
          usageQuality: 'unavailable';
        }> => {
          if (cell.cellId === runtimePlan.cells[0].cellId) {
            return {
              result: result(),
              resultPath: 'ignored.json',
              usageQuality: 'unavailable',
            };
          }
          await new Promise<void>((resolve) => {
            context.signal?.addEventListener(
              'abort',
              () => {
                drained = true;
                resolve();
              },
              { once: true }
            );
          });
          throw new ExperimentExecutionError(
            'cancelled by scheduler',
            'infrastructure_failure'
          );
        },
      },
      retry,
    });

    await expect(scheduler.run()).rejects.toThrow('state persistence failed');
    expect(drained).toBe(true);
  });

  test('uses deterministic cancellable backoff', async () => {
    let calls = 0;
    const delays: number[] = [];
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        if (calls === 1) {
          throw new ExperimentExecutionError('temporary', 'timeout');
        }
        return {
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        };
      },
    };
    let current = 0;
    const outcome = await runExperiment({
      plan: plan(1),
      executor,
      retry: { max_attempts: 2, on: ['timeout'], backoff_ms: 25 },
      resultsDirectory: temporaryDirectory,
      now: () => new Date(current),
      delay: async (milliseconds) => {
        delays.push(milliseconds);
        current += milliseconds;
      },
    });
    expect(delays).toEqual([25]);
    expect(outcome.finalStatus).toBe('passed');
  });

  test('applies deterministic full jitter when configured', async () => {
    let calls = 0;
    let current = 0;
    const delays: number[] = [];
    await runExperiment({
      plan: plan(1),
      executor: {
        execute: async () => {
          calls += 1;
          if (calls === 1) {
            throw new ExperimentExecutionError(
              'provider throttled',
              'provider_rate_limit'
            );
          }
          return {
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
          };
        },
      },
      retry: {
        max_attempts: 2,
        on: ['provider_rate_limit'],
        backoff_ms: 100,
        jitter: 'full',
      },
      resultsDirectory: temporaryDirectory,
      now: () => new Date(current),
      random: () => 0.5,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
        current += milliseconds;
      },
    });
    expect(delays).toEqual([50]);
  });

  test('cancels the default backoff promptly', async () => {
    const controller = new AbortController();
    const waiting = abortableDelay(60_000, controller.signal);
    controller.abort(new Error('stop'));
    await expect(waiting).rejects.toThrow('stop');
  });

  test('stops new starts at the cost budget boundary', async () => {
    let calls = 0;
    const budgetPlan = plan(3);
    budgetPlan.budget = { max_cost_usd: 1 };
    const outcome = await runExperiment({
      plan: budgetPlan,
      executor: {
        execute: async () => {
          calls += 1;
          return {
            result: result(),
            resultPath: 'ignored.json',
            costUsd: 1,
            usageQuality: 'measured',
          };
        },
      },
      retry,
      resultsDirectory: temporaryDirectory,
    });
    expect(calls).toBe(1);
    expect(outcome.state.budget.stop_reason).toBe('cost');
    expect(outcome.state.cells.map((cell) => cell.status)).toEqual([
      'passed',
      'cancelled',
      'cancelled',
    ]);
    expect(outcome.exitCode).toBe(3);
  });

  test('stops new starts at the duration budget boundary', async () => {
    let calls = 0;
    let current = 0;
    const budgetPlan = plan(2);
    budgetPlan.budget = { max_duration_minutes: 1 / 60_000 };
    const outcome = await runExperiment({
      plan: budgetPlan,
      executor: {
        execute: async () => {
          calls += 1;
          current = 1;
          return {
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
          };
        },
      },
      retry,
      resultsDirectory: temporaryDirectory,
      now: () => new Date(current),
    });
    expect(calls).toBe(1);
    expect(outcome.state.budget.stop_reason).toBe('duration');
    expect(outcome.state.cells[1].status).toBe('cancelled');
  });

  test('stops new starts at the cumulative sandbox runtime boundary', async () => {
    const budgetedPlan = plan(2);
    budgetedPlan.budget = { max_sandbox_runtime_minutes: 1 };
    let starts = 0;
    const outcome = await runExperiment({
      plan: budgetedPlan,
      executor: {
        execute: async (_cell, context) => {
          starts += 1;
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'running',
            sandboxId: `sandbox-${starts}`,
            sandboxStartedAt: '2026-01-01T00:00:00.000Z',
          });
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'killed',
            sandboxId: `sandbox-${starts}`,
            sandboxStartedAt: '2026-01-01T00:00:00.000Z',
            sandboxCompletedAt: '2026-01-01T00:01:01.000Z',
            sandboxRuntimeMs: 61_000,
          });
          return {
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
            sandboxRuntimeMs: 61_000,
            sandboxCostQuality: 'unavailable',
          };
        },
      },
      retry,
      resultsDirectory: temporaryDirectory,
    });

    expect(starts).toBe(1);
    expect(outcome.state.budget.stop_reason).toBe('sandbox_runtime');
    expect(outcome.state.budget.sandbox_runtime_ms_used).toBe(61_000);
    expect(outcome.finalStatus).toBe('partial');
  });

  test('resumes without rerunning valid results and reruns a corrupt artifact', async () => {
    let calls = 0;
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        return {
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        };
      },
    };
    const first = await runExperiment({
      plan: plan(2),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
    });
    await runExperiment({
      plan: plan(2),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: first.experimentId,
    });
    expect(calls).toBe(2);

    const corruptPath = path.join(
      first.experimentDirectory,
      first.state.cells[0].result_path as string
    );
    await fs.writeFile(corruptPath, '{not json', 'utf8');
    await runExperiment({
      plan: plan(2),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: first.experimentId,
    });
    expect(calls).toBe(3);
  });

  test('converts a persisted running attempt to interrupted before resuming', async () => {
    const runtimePlan = plan(1);
    const store = new ExperimentStateStore(
      temporaryDirectory,
      'resume-interrupted'
    );
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    state.status = 'running';
    state.started_at = new Date(0).toISOString();
    state.cells[0].status = 'running';
    state.cells[0].attempts.push({
      attempt_id: 'old-attempt',
      attempt_number: 1,
      status: 'running',
      started_at: new Date(0).toISOString(),
    });
    await store.save(state);

    const outcome = await runExperiment({
      plan: runtimePlan,
      executor: {
        execute: async () => ({
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        }),
      },
      retry: { max_attempts: 2, on: [], backoff_ms: 0 },
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: 'resume-interrupted',
      now: () => new Date(10),
    });
    expect(outcome.state.cells[0].attempts).toHaveLength(2);
    expect(outcome.state.cells[0].attempts[0]).toMatchObject({
      status: 'infrastructure_failed',
      terminal_reason: 'interrupted',
    });
    expect(outcome.finalStatus).toBe('passed');
  });

  test('kills an owned interrupted remote attempt before resuming with a new attempt', async () => {
    const runtimePlan = plan(1);
    const store = new ExperimentStateStore(
      temporaryDirectory,
      'resume-remote-interrupted'
    );
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    state.status = 'running';
    state.started_at = new Date(0).toISOString();
    state.cells[0].status = 'running';
    state.cells[0].attempts.push({
      attempt_id: 'old-remote-attempt',
      attempt_number: 1,
      status: 'running',
      started_at: new Date(0).toISOString(),
      execution_provider: 'e2b',
      remote: {
        lifecycle_state: 'running',
        sandbox_id: 'sandbox-old',
        updated_at: new Date(0).toISOString(),
      },
    });
    await store.save(state);
    const reconciled: string[] = [];
    const executor: SingleRunExecutor = {
      reconcileInterrupted: async (context): Promise<void> => {
        reconciled.push(context.sandboxId ?? 'missing');
      },
      execute: async () => ({
        result: result(),
        resultPath: 'ignored.json',
        usageQuality: 'unavailable',
      }),
    };

    const outcome = await runExperiment({
      plan: runtimePlan,
      executor,
      retry: { max_attempts: 2, on: [], backoff_ms: 0 },
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: 'resume-remote-interrupted',
      now: () => new Date(10),
    });

    expect(reconciled).toEqual(['sandbox-old']);
    expect(outcome.state.cells[0].attempts).toHaveLength(2);
    expect(outcome.state.cells[0].attempts[0].remote?.lifecycle_state).toBe(
      'killed'
    );
  });

  test('aborts without starting pending work and leaves resumable state', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const outcome = await runExperiment({
      plan: plan(2),
      executor: {
        execute: async () => {
          calls += 1;
          return {
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
          };
        },
      },
      retry,
      resultsDirectory: temporaryDirectory,
      signal: controller.signal,
    });
    expect(calls).toBe(0);
    expect(outcome.state.status).toBe('cancelled');
    expect(outcome.exitCode).toBe(3);
  });

  test('creates a fresh invocation ID unless explicitly resumed', async () => {
    const executor: SingleRunExecutor = {
      execute: async () => ({
        result: result(),
        resultPath: 'ignored.json',
        usageQuality: 'unavailable',
      }),
    };
    const first = await runExperiment({
      plan: plan(1),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
    });
    const second = await runExperiment({
      plan: plan(1),
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
    });
    expect(first.experimentId).not.toBe(second.experimentId);
  });

  test('prevents concurrent processes from running the same experiment', async () => {
    const first = new ExperimentStateStore(temporaryDirectory, 'locked-run');
    const second = new ExperimentStateStore(temporaryDirectory, 'locked-run');
    const release = await first.acquireRunLock();
    await expect(second.acquireRunLock()).rejects.toThrow(
      'already running in another process'
    );
    await release();
    const releaseSecond = await second.acquireRunLock();
    await releaseSecond();
  });

  test('does not count interruption downtime against a resumed duration budget', async () => {
    const runtimePlan = plan(1);
    runtimePlan.budget = { max_duration_minutes: 1 };
    const store = new ExperimentStateStore(temporaryDirectory, 'resume-budget');
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    state.started_at = new Date(0).toISOString();
    state.budget.duration_ms_used = 50;
    await store.save(state);

    const outcome = await runExperiment({
      plan: runtimePlan,
      executor: {
        execute: async () => ({
          result: result(),
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        }),
      },
      retry,
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: 'resume-budget',
      now: () => new Date(100_000),
    });

    expect(outcome.state.budget.duration_ms_used).toBe(50);
    expect(outcome.finalStatus).toBe('passed');
  });

  test('applies cost budgets per invocation while retaining cumulative usage on resume', async () => {
    const runtimePlan = plan(3);
    runtimePlan.budget = { max_cost_usd: 1 };
    let calls = 0;
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        return {
          result: result(),
          resultPath: 'ignored.json',
          costUsd: 1,
          usageQuality: 'measured',
        };
      },
    };
    const first = await runExperiment({
      plan: runtimePlan,
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
    });
    const second = await runExperiment({
      plan: runtimePlan,
      executor,
      retry,
      resultsDirectory: temporaryDirectory,
      resume: true,
      experimentId: first.experimentId,
    });

    expect(calls).toBe(2);
    expect(second.state.budget.cost_usd_used).toBe(2);
    expect(
      second.state.cells.filter((cell) => cell.status === 'passed')
    ).toHaveLength(2);
    expect(second.exitCode).toBe(3);
  });

  test('rejects duplicate or dimension-mismatched resume state cells', async () => {
    const runtimePlan = plan(2);
    const store = new ExperimentStateStore(
      temporaryDirectory,
      'invalid-resume-matrix'
    );
    const state = await store.create(runtimePlan, new Date(0).toISOString());
    state.cells[1] = {
      ...state.cells[0],
      testcase_id: 'wrong-testcase',
    };
    await store.save(state);

    await expect(
      runExperiment({
        plan: runtimePlan,
        executor: {
          execute: async () => ({
            result: result(),
            resultPath: 'ignored.json',
            usageQuality: 'unavailable',
          }),
        },
        retry,
        resultsDirectory: temporaryDirectory,
        resume: true,
        experimentId: 'invalid-resume-matrix',
      })
    ).rejects.toThrow('must map uniquely');
  });

  test('allows only one concurrent stale-lock recovery winner', async () => {
    const experimentId = 'stale-lock-race';
    const first = new ExperimentStateStore(temporaryDirectory, experimentId);
    const second = new ExperimentStateStore(temporaryDirectory, experimentId);
    await fs.mkdir(first.experimentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(first.experimentDirectory, '.run.lock'),
      JSON.stringify({ pid: 2147483647, token: 'stale' }),
      'utf8'
    );

    const attempts = await Promise.allSettled([
      first.acquireRunLock(),
      second.acquireRunLock(),
    ]);
    const winners = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<() => Promise<void>> =>
        attempt.status === 'fulfilled'
    );
    expect(winners).toHaveLength(1);
    await winners[0].value();
  });

  test('rejects a linked results root before creating experiment storage', async () => {
    const external = path.join(temporaryDirectory, 'external-results');
    const linkedRoot = path.join(temporaryDirectory, 'linked-results');
    await fs.mkdir(external);
    await fs.symlink(external, linkedRoot, 'junction');

    expect(() => new ExperimentStateStore(linkedRoot, 'linked-root')).toThrow(
      'Linked path component is not allowed'
    );
  });

  test('rejects a linked cell artifact directory', async () => {
    const runtimePlan = plan(1);
    const store = new ExperimentStateStore(temporaryDirectory, 'linked-cell');
    await store.create(runtimePlan, new Date(0).toISOString());
    const external = path.join(temporaryDirectory, 'external-cell');
    await fs.mkdir(external);
    await fs.symlink(
      external,
      path.join(
        store.experimentDirectory,
        'cells',
        runtimePlan.cells[0].cellId
      ),
      'junction'
    );

    await expect(
      store.saveAttemptResult(runtimePlan.cells[0].cellId, 1, result())
    ).rejects.toThrow('Linked path component is not allowed');
  });

  test('sanitizes authenticated repository URLs at the attempt persistence boundary', async () => {
    const unsafeResult = result();
    unsafeResult.test_case.repo =
      'https://user:password@example.com/repo?access_token=secret#fragment';
    const outcome = await runExperiment({
      plan: plan(1),
      executor: {
        execute: async () => ({
          result: unsafeResult,
          resultPath: 'ignored.json',
          usageQuality: 'unavailable',
        }),
      },
      retry,
      resultsDirectory: temporaryDirectory,
    });
    const persisted = await fs.readFile(
      path.join(
        outcome.experimentDirectory,
        outcome.state.cells[0].result_path as string
      ),
      'utf8'
    );
    expect(persisted).not.toContain('user');
    expect(persisted).not.toContain('password');
    expect(persisted).not.toContain('secret');
    expect(persisted).not.toContain('fragment');
  });
});
