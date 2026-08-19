import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runExperiment } from '../../src/experiments/runner.js';
import type { RunExperimentResult } from '../../src/experiments/runner.js';
import type { ExperimentPlan } from '../../src/experiments/planner.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

const hash = 'a'.repeat(64);
const cellId = 'b'.repeat(64);
const timestamp = '2026-07-29T12:00:00.000Z';

function plan(): ExperimentPlan {
  return {
    definitionHash: hash,
    cellCount: 1,
    maxConcurrent: 1,
    redactedEffectiveConfiguration: {},
    cells: [
      {
        cellId,
        testcaseId: 'case',
        variantName: 'target',
        repetition: 0,
        configHash: hash,
        config: {},
      },
    ],
  } as unknown as ExperimentPlan;
}

function bundle(workspace: string): ResultsBundle {
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
      total_evaluators: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'agent.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

describe('experiment runner resume residual coverage', () => {
  let temporaryDirectory: string;
  let resultsDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-runner-')
    );
    resultsDirectory = path.join(temporaryDirectory, 'experiments');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function completedRun(): Promise<RunExperimentResult> {
    return runExperiment({
      plan: plan(),
      resultsDirectory,
      retry: {
        max_attempts: 2,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async () => ({
          result: bundle(temporaryDirectory),
          resultPath: 'unused',
          usageQuality: 'unavailable',
        }),
      },
      now: () => new Date(timestamp),
    });
  }

  it('reruns a completed cell whose result path is absent', async () => {
    const initial = await completedRun();
    const stateFile = path.join(initial.experimentDirectory, 'state.json');
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as {
      cells: Array<{ result_path?: string }>;
    };
    delete state.cells[0].result_path;
    await fs.writeFile(stateFile, JSON.stringify(state));
    let calls = 0;
    const resumed = await runExperiment({
      plan: plan(),
      resultsDirectory,
      resume: true,
      experimentId: initial.experimentId,
      retry: {
        max_attempts: 2,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async () => {
          calls += 1;
          return {
            result: bundle(temporaryDirectory),
            resultPath: 'unused',
            usageQuality: 'unavailable' as const,
          };
        },
      },
      now: () => new Date(timestamp),
    });
    expect(calls).toBe(1);
    expect(resumed.finalStatus).toBe('passed');
  });

  it('rejects a dimension mismatch within an otherwise unique matrix', async () => {
    const initial = await completedRun();
    const manifestFile = path.join(
      initial.experimentDirectory,
      'experiment.json'
    );
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
      cells: Array<{ testcase_id: string }>;
    };
    manifest.cells[0].testcase_id = 'different';
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await expect(
      runExperiment({
        plan: plan(),
        resultsDirectory,
        resume: true,
        experimentId: initial.experimentId,
        retry: {
          max_attempts: 2,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          execute: async () => {
            throw new Error('not reached');
          },
        },
        now: () => new Date(timestamp),
      })
    ).rejects.toThrow('does not match the current plan');
  });

  it('requires remote reconciliation for an interrupted E2B attempt', async () => {
    const initial = await completedRun();
    const stateFile = path.join(initial.experimentDirectory, 'state.json');
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as {
      cells: Array<Record<string, unknown>>;
    };
    state.cells[0] = {
      ...state.cells[0],
      status: 'running',
      result_path: undefined,
      attempts: [
        {
          attempt_id: 'attempt',
          attempt_number: 1,
          status: 'running',
          started_at: timestamp,
          execution_provider: 'e2b',
          remote: {
            lifecycle_state: 'running',
            updated_at: timestamp,
            sandbox_id: 'sandbox',
          },
        },
      ],
    };
    await fs.writeFile(stateFile, JSON.stringify(state));
    await expect(
      runExperiment({
        plan: plan(),
        resultsDirectory,
        resume: true,
        experimentId: initial.experimentId,
        retry: {
          max_attempts: 2,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          execute: async () => {
            throw new Error('not reached');
          },
        },
        now: () => new Date(timestamp),
      })
    ).rejects.toThrow('does not support remote reconciliation');
  });

  it('converts SIGINT into the scheduler cancellation signal', async () => {
    const result = await runExperiment({
      plan: plan(),
      resultsDirectory,
      retry: {
        max_attempts: 1,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async (_cell, context) => {
          process.emit('SIGINT');
          throw context.signal?.reason;
        },
      },
      now: () => new Date(timestamp),
    });
    expect(result.exitCode).toBe(3);
  });

  it.each(['collecting', 'killing'] as const)(
    'reconciles an interrupted remote attempt in %s state without optional sandbox timestamps',
    async (lifecycleState) => {
      const initial = await completedRun();
      const stateFile = path.join(initial.experimentDirectory, 'state.json');
      const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as {
        cells: Array<Record<string, unknown>>;
      };
      state.cells[0] = {
        ...state.cells[0],
        status: 'running',
        result_path: undefined,
        attempts: [
          {
            attempt_id: 'attempt',
            attempt_number: 1,
            status: 'running',
            started_at: timestamp,
            execution_provider: 'e2b',
            remote: {
              lifecycle_state: lifecycleState,
              updated_at: timestamp,
              ...(lifecycleState === 'collecting'
                ? { sandbox_started_at: timestamp }
                : {}),
            },
          },
        ],
      };
      await fs.writeFile(stateFile, JSON.stringify(state));
      const reconcileInterrupted = jest.fn().mockResolvedValue(undefined);
      const resumed = await runExperiment({
        plan: plan(),
        resultsDirectory,
        resume: true,
        experimentId: initial.experimentId,
        retry: {
          max_attempts: 2,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          reconcileInterrupted,
          execute: async () => ({
            result: bundle(temporaryDirectory),
            resultPath: 'unused',
            usageQuality: 'unavailable',
          }),
        },
        now: () => new Date(timestamp),
      });
      expect(reconcileInterrupted).toHaveBeenCalledWith(
        expect.not.objectContaining({ sandboxId: expect.anything() })
      );
      expect(resumed.finalStatus).toBe('passed');
    }
  );

  it('marks exhausted running and cancelled resume cells as infrastructure failures', async () => {
    for (const status of ['running', 'cancelled'] as const) {
      const initial = await completedRun();
      const stateFile = path.join(initial.experimentDirectory, 'state.json');
      const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as {
        cells: Array<Record<string, unknown>>;
      };
      state.cells[0].status = status;
      state.cells[0].result_path = undefined;
      if (status === 'running') {
        state.cells[0].attempts = [
          {
            attempt_id: 'attempt',
            attempt_number: 1,
            status: 'failed',
            started_at: timestamp,
            completed_at: timestamp,
            duration_ms: 0,
          },
        ];
      }
      await fs.writeFile(stateFile, JSON.stringify(state));
      const resumed = await runExperiment({
        plan: plan(),
        resultsDirectory,
        resume: true,
        experimentId: initial.experimentId,
        retry: {
          max_attempts: 1,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          execute: async () => {
            throw new Error('must not execute');
          },
        },
        now: () => new Date(timestamp),
      });
      expect(resumed.finalStatus).toBe('infrastructure_failed');
    }
  });

  it('uses the default results directory', async () => {
    const previous = process.cwd();
    process.chdir(temporaryDirectory);
    try {
      const result = await runExperiment({
        plan: plan(),
        retry: {
          max_attempts: 1,
          on: [],
          backoff_ms: 0,
          jitter: 'none',
        },
        executor: {
          execute: async () => ({
            result: bundle(temporaryDirectory),
            resultPath: 'unused',
            usageQuality: 'unavailable',
          }),
        },
        now: () => new Date(timestamp),
      });
      expect(result.experimentDirectory).toContain(
        path.join('results', 'experiments')
      );
    } finally {
      process.chdir(previous);
    }
  });
});
