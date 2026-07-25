import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { OrchestratorSingleRunExecutor } from '../../src/experiments/orchestrator-executor.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { TestCaseConfig } from '../../src/schemas/testcase.schema.js';

describe('OrchestratorSingleRunExecutor', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-orchestrator-executor-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('adapts a single Orchestrator run and reads usage metadata', async () => {
    const artifacts = path.join(temporaryDirectory, 'artifacts');
    await fs.mkdir(artifacts);
    await fs.writeFile(
      path.join(artifacts, 'youbencha.log.json'),
      JSON.stringify({
        version: '1.0.0',
        agent: { name: 'fake', version: '1', adapter_version: '1' },
        model: { name: 'model', provider: 'test', parameters: {} },
        execution: {
          started_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:00:01.000Z',
          duration_ms: 1000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
          estimated_cost_usd: 0.01,
        },
        errors: [],
        environment: {
          os: 'test',
          node_version: '20',
          youbencha_version: 'test',
          working_directory: temporaryDirectory,
        },
      })
    );
    const result = {
      execution: { environment: { workspace_dir: temporaryDirectory } },
      artifacts: { agent_log: 'youbencha.log.json' },
    } as ResultsBundle;
    const runEvaluation = jest.fn(async () => result);
    const executor = new OrchestratorSingleRunExecutor({
      configFiles: new Map([['task', 'testcase.yaml']]),
      orchestrator: { runEvaluation },
    });

    const execution = await executor.execute(
      {
        cellId: 'a'.repeat(64),
        testcaseId: 'task',
        variantName: 'fake',
        repetition: 0,
        configHash: 'b'.repeat(64),
        config: {} as TestCaseConfig,
      },
      {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
      }
    );

    expect(runEvaluation).toHaveBeenCalledWith({}, 'testcase.yaml', {
      workspaceRunId: `experiment-experiment-${'a'.repeat(64)}-1-attempt`,
    });
    expect(execution).toMatchObject({
      result,
      resultPath: path.join(artifacts, 'results.json'),
      tokenCount: 5,
      costUsd: 0.01,
      usageQuality: 'estimated',
      tokenQuality: 'measured',
      costQuality: 'estimated',
    });
  });

  test('fails before orchestration when cancelled or source mapping is missing', async () => {
    const runEvaluation = jest.fn();
    const executor = new OrchestratorSingleRunExecutor({
      configFiles: new Map(),
      orchestrator: { runEvaluation },
    });
    const cell = {
      cellId: 'a'.repeat(64),
      testcaseId: 'missing',
      variantName: 'fake',
      repetition: 0,
      configHash: 'b'.repeat(64),
      config: {} as TestCaseConfig,
    };
    await expect(
      executor.execute(cell, {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
      })
    ).rejects.toThrow('No source configuration');
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      executor.execute(cell, {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
        signal: controller.signal,
      })
    ).rejects.toThrow('stop');
    expect(runEvaluation).not.toHaveBeenCalled();
  });
});
