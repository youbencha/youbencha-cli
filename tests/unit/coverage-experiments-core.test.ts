import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as experiments from '../../src/experiments/index.js';
import { ExperimentBudget } from '../../src/experiments/budget.js';
import {
  assertLinkSafePath,
  ensureLinkSafeDirectory,
} from '../../src/experiments/artifact-security.js';
import {
  ExperimentExecutionError,
  abortableDelay,
  classifyExecutionError,
  shouldRetry,
} from '../../src/experiments/retry.js';
import type {
  PlannedExperimentCell,
  SingleRunExecutionContext,
  SingleRunExecutor,
} from '../../src/experiments/single-run-executor.js';
import {
  TargetCircuitBreakerExecutor,
  TargetUnavailableError,
} from '../../src/experiments/target-circuit-breaker.js';
import { TokenBucket } from '../../src/experiments/token-bucket.js';
import type { ExperimentPlan } from '../../src/experiments/planner.js';
import {
  runExperiment,
  type RunExperimentOptions,
} from '../../src/experiments/runner.js';
import type { ExperimentState } from '../../src/schemas/experiment-result.schema.js';

function state(cells: ExperimentState['cells'] = []): ExperimentState {
  return {
    schema_version: '1.0.0',
    experiment_id: 'experiment',
    definition_hash: 'a'.repeat(64),
    status: 'pending',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cells,
    budget: {
      duration_ms_used: 0,
      cost_usd_used: 0,
      sandbox_runtime_ms_used: 0,
    },
  };
}

const cell = {
  cellId: 'cell',
  testcaseId: 'case',
  variantName: 'target',
  repetition: 1,
  configHash: 'a'.repeat(64),
  config: {},
} as unknown as PlannedExperimentCell;

const context = {
  experimentId: 'experiment',
  attemptId: 'attempt',
  attemptNumber: 1,
} as SingleRunExecutionContext;

describe('experiment control primitive residual coverage', () => {
  it('loads every experiment barrel export', () => {
    expect(Object.keys(experiments)).toEqual(
      expect.arrayContaining([
        'ExperimentBudget',
        'ExperimentScheduler',
        'ExperimentStateStore',
        'TokenBucket',
        'runExperiment',
      ])
    );
    expect(Object.values(experiments).length).toBeGreaterThan(20);
  });

  it('accounts bounded remote runtime and every budget stop reason', () => {
    const runningStart = '2026-01-01T00:00:01.000Z';
    const completedStart = '2026-01-01T00:00:02.000Z';
    const experimentState = state([
      {
        cell_id: 'cell',
        testcase_id: 'case',
        variant_name: 'target',
        repetition: 1,
        status: 'pending',
        attempts: [
          {
            attempt_id: 'a',
            attempt_number: 1,
            status: 'running',
            started_at: runningStart,
            remote: {
              lifecycle_state: 'running',
              updated_at: runningStart,
              sandbox_started_at: runningStart,
            },
          },
          {
            attempt_id: 'b',
            attempt_number: 2,
            status: 'passed',
            started_at: completedStart,
            completed_at: completedStart,
            duration_ms: 0,
            remote: {
              lifecycle_state: 'killed',
              updated_at: completedStart,
              sandbox_started_at: completedStart,
              sandbox_completed_at: '2026-01-01T00:00:01.000Z',
            },
          },
          {
            attempt_id: 'invalid',
            attempt_number: 3,
            status: 'running',
            started_at: runningStart,
            remote: {
              lifecycle_state: 'running',
              updated_at: runningStart,
              sandbox_started_at: 'invalid',
            },
          },
          {
            attempt_id: 'local',
            attempt_number: 4,
            status: 'running',
            started_at: runningStart,
          },
        ],
      },
    ]);
    const configured = {
      max_duration_minutes: 1,
      max_cost_usd: 2,
      max_sandbox_runtime_minutes: 1,
    } as ExperimentPlan['budget'];
    const budget = new ExperimentBudget(configured, 1_000, 10, 5, 20);
    budget.updateDuration(experimentState, 500);
    expect(experimentState.budget.duration_ms_used).toBe(10);
    expect(experimentState.budget.sandbox_runtime_ms_used).toBe(0);
    budget.addCost(experimentState, undefined);
    budget.addCost(experimentState, 7);
    expect(experimentState.budget.cost_usd_used).toBe(7);

    expect(
      new ExperimentBudget(configured, 0).stopReason(state(), 60_000)
    ).toBe('duration');
    const costState = state();
    costState.budget.cost_usd_used = 2;
    expect(new ExperimentBudget(configured, 0).stopReason(costState, 1)).toBe(
      'cost'
    );
    const runtimeState = state([
      {
        cell_id: 'runtime',
        testcase_id: 'case',
        variant_name: 'target',
        repetition: 1,
        status: 'running',
        attempts: [
          {
            attempt_id: 'run',
            attempt_number: 1,
            status: 'running',
            started_at: '1970-01-01T00:00:00.000Z',
            remote: {
              lifecycle_state: 'running',
              updated_at: '1970-01-01T00:00:00.000Z',
              sandbox_started_at: '1970-01-01T00:00:00.000Z',
            },
          },
        ],
      },
    ]);
    expect(
      new ExperimentBudget(configured, 60_000).stopReason(runtimeState, 60_000)
    ).toBe('sandbox_runtime');
    expect(
      new ExperimentBudget(undefined, 0).stopReason(state(), 1)
    ).toBeUndefined();
  });

  it('classifies retries and covers every abortable delay exit', async () => {
    const classified = new ExperimentExecutionError(
      'rate limited',
      'rate_limited'
    );
    expect(classified.name).toBe('ExperimentExecutionError');
    expect(classifyExecutionError(classified)).toBe('rate_limited');
    expect(classifyExecutionError('plain')).toBe('infrastructure_failure');
    expect(shouldRetry('rate_limited', ['rate_limited'], 1, 2)).toBe(true);
    expect(shouldRetry('rate_limited', [], 1, 2)).toBe(false);
    expect(shouldRetry('rate_limited', ['rate_limited'], 2, 2)).toBe(false);
    await expect(abortableDelay(0)).resolves.toBeUndefined();

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(abortableDelay(1, preAborted.signal)).rejects.toBeDefined();
    await expect(
      abortableDelay(1, {
        aborted: true,
        reason: undefined,
      } as AbortSignal)
    ).rejects.toThrow('Operation cancelled');

    const controller = new AbortController();
    const delayed = abortableDelay(100, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(delayed).rejects.toThrow('cancelled');
    await expect(
      abortableDelay(100, {
        aborted: false,
        reason: undefined,
        addEventListener: (_type, listener) => {
          (listener as () => void)();
        },
        removeEventListener: () => undefined,
      } as unknown as AbortSignal)
    ).rejects.toThrow('Operation cancelled');
    await expect(abortableDelay(1)).resolves.toBeUndefined();
  });

  it('validates token buckets, waits, refills, and recovers its queue', async () => {
    for (const rate of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new TokenBucket({ tokensPerSecond: rate })).toThrow(
        'positive finite'
      );
    }
    for (const capacity of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new TokenBucket({ tokensPerSecond: 1, capacity })).toThrow(
        'capacity'
      );
    }

    let now = 0;
    const waits: number[] = [];
    const bucket = new TokenBucket({
      tokensPerSecond: 2,
      capacity: 2,
      now: (): number => now,
      delay: async (milliseconds): Promise<void> => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    now -= 10;
    await bucket.acquire();
    expect(waits).toEqual([500, 500]);

    const aborted = new AbortController();
    aborted.abort(new Error('stop'));
    await expect(bucket.acquire(aborted.signal)).rejects.toThrow('stop');
    await expect(
      bucket.acquire({
        aborted: true,
        reason: undefined,
      } as AbortSignal)
    ).rejects.toThrow('Operation cancelled');
    now += 1_000;
    await expect(bucket.acquire()).resolves.toBeUndefined();
    await expect(
      new TokenBucket({ tokensPerSecond: 1 }).acquire()
    ).resolves.toBeUndefined();
  });

  it('opens, resets, and delegates through the target circuit breaker', async () => {
    const calls: string[] = [];
    const unavailable: SingleRunExecutor = {
      execute: async () => {
        calls.push('execute');
        throw 'offline';
      },
    };
    const breaker = new TargetCircuitBreakerExecutor(unavailable, {
      isUnavailable: (): boolean => true,
    });
    await expect(breaker.execute(cell, context)).rejects.toBe('offline');
    await expect(breaker.execute(cell, context)).rejects.toThrow('offline');
    const errorBreaker = new TargetCircuitBreakerExecutor(
      {
        execute: async (): Promise<never> => {
          throw new Error('error-offline');
        },
      },
      { isUnavailable: (): boolean => true }
    );
    await expect(errorBreaker.execute(cell, context)).rejects.toThrow(
      'error-offline'
    );

    let rejectProbe: ((error: Error) => void) | undefined;
    const ordinary: SingleRunExecutor = {
      execute: () =>
        new Promise((_resolve, reject) => {
          rejectProbe = reject;
        }),
    };
    const resetting = new TargetCircuitBreakerExecutor(ordinary, {
      isUnavailable: (): boolean => false,
    });
    const first = resetting.execute(cell, context);
    rejectProbe?.(new Error('ordinary'));
    await expect(first).rejects.toThrow('ordinary');

    const result = { result: {}, resultPath: 'result' } as never;
    ordinary.execute = async (): Promise<never> => result;
    await expect(resetting.execute(cell, context)).resolves.toBe(result);
    expect(calls).toHaveLength(1);

    await expect(
      resetting.reconcileInterrupted({
        experimentId: 'experiment',
        cellId: 'cell',
        targetId: 'target',
        attemptId: 'attempt',
      })
    ).resolves.toBeUndefined();

    const delegated = jest.fn().mockResolvedValue(undefined);
    const withReconcile = new TargetCircuitBreakerExecutor({
      execute: async (): Promise<never> => result,
      reconcileInterrupted: delegated,
    });
    await withReconcile.reconcileInterrupted({
      experimentId: 'experiment',
      cellId: 'cell',
      targetId: 'target',
      attemptId: 'attempt',
    });
    expect(delegated).toHaveBeenCalledTimes(1);
    expect(new TargetUnavailableError('target', 'message').name).toBe(
      'TargetUnavailableError'
    );

    const missingFailure = new TargetCircuitBreakerExecutor(unavailable);
    const gate = {
      state: 'unavailable' as const,
      probe: Promise.resolve(),
      release: (): void => undefined,
    };
    (
      missingFailure as unknown as {
        gates: Map<string, typeof gate>;
      }
    ).gates.set('target', gate);
    await expect(missingFailure.execute(cell, context)).rejects.toThrow(
      'Target target is unavailable'
    );
  });

  it('checks and creates only link-safe artifact paths', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-security-')
    );
    try {
      await expect(
        assertLinkSafePath(
          temporaryDirectory,
          path.resolve(temporaryDirectory, '..', 'escape')
        )
      ).rejects.toThrow('escapes');
      const trustedFile = path.join(temporaryDirectory, 'file');
      await fs.writeFile(trustedFile, 'file');
      await expect(
        assertLinkSafePath(trustedFile, trustedFile)
      ).rejects.toThrow('not a real directory');

      const nested = path.join(temporaryDirectory, 'one', 'two');
      await expect(
        assertLinkSafePath(temporaryDirectory, nested)
      ).resolves.toBeUndefined();
      await ensureLinkSafeDirectory(temporaryDirectory, nested);
      await ensureLinkSafeDirectory(temporaryDirectory, nested);

      const blocked = path.join(temporaryDirectory, 'blocked');
      await fs.writeFile(blocked, 'file');
      await expect(
        ensureLinkSafeDirectory(temporaryDirectory, path.join(blocked, 'child'))
      ).rejects.toThrow('not a directory');

      const target = path.join(temporaryDirectory, 'target');
      const linked = path.join(temporaryDirectory, 'linked');
      await fs.mkdir(target);
      await fs.symlink(target, linked, 'junction');
      await expect(
        assertLinkSafePath(temporaryDirectory, linked)
      ).rejects.toThrow('Linked path component');

      await Promise.all(
        Array.from({ length: 64 }, async (_value, index) => {
          const raced = path.join(temporaryDirectory, `mkdir-race-${index}`);
          await Promise.allSettled([
            ensureLinkSafeDirectory(temporaryDirectory, raced),
            fs.mkdir(raced),
          ]);
          await expect(fs.stat(raced)).resolves.toBeDefined();
        })
      );

      const raceTarget = path.join(temporaryDirectory, 'race-target');
      await fs.mkdir(raceTarget);
      await Promise.all(
        Array.from({ length: 64 }, async (_value, index) => {
          const raced = path.join(temporaryDirectory, `link-race-${index}`);
          await Promise.allSettled([
            ensureLinkSafeDirectory(temporaryDirectory, raced),
            fs.symlink(raceTarget, raced, 'junction'),
          ]);
        })
      );
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects contradictory experiment resume identifiers', async () => {
    const base = {
      plan: {},
      executor: {},
      retry: {},
    } as unknown as RunExperimentOptions;
    await expect(runExperiment({ ...base, resume: true })).rejects.toThrow(
      'requires an experiment ID'
    );
    await expect(
      runExperiment({
        ...base,
        resume: false,
        experimentId: 'unexpected',
      })
    ).rejects.toThrow('only be supplied when resuming');
  });
});
