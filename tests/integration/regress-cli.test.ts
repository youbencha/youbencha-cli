import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { SingleRunExecutor } from '../../src/experiments/index.js';
import {
  baselinePromoteCommand,
  baselineShowCommand,
} from '../../src/cli/commands/baseline.js';
import { regressCommand } from '../../src/cli/commands/regress.js';

function bundle(workspace: string): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'task',
      description: 'fixture',
      config_file: 'task.yaml',
      config_hash: 'a'.repeat(64),
      repo: 'https://github.com/example/project.git',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.000Z',
      duration_ms: 1000,
      youbencha_version: 'test',
      environment: {
        os: 'test',
        node_version: '20',
        workspace_dir: workspace,
      },
    },
    agent: {
      type: 'codex-cli',
      youbencha_log_path: 'youbencha.log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

describe('regression CLI', () => {
  let temporaryDirectory: string;
  let suiteFile: string;

  beforeEach(async () => {
    process.exitCode = undefined;
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-regress-cli-')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.yaml'),
      [
        'version: 2',
        'kind: task',
        'name: Task',
        'description: Regression task',
        'repo: https://github.com/example/project.git',
        'task:',
        '  prompt: Make a change',
        'evaluators:',
        '  - name: git-diff',
      ].join('\n')
    );
    suiteFile = path.join(temporaryDirectory, 'suite.yaml');
    await fs.writeFile(
      suiteFile,
      [
        'version: 2',
        'name: regression',
        'suite:',
        '  tasks:',
        '    - id: task',
        '      file: ./task.yaml',
        'profiles:',
        '  smoke:',
        '    tasks: [task]',
        '    targets: [candidate]',
        '    repetitions: 1',
        '    comparisons: []',
        '    rules: []',
        'targets:',
        '  - id: candidate',
        '    agent:',
        '      type: codex-cli',
        '      model: test-model',
        '      config: {}',
        '    harness:',
        "      exact_version: '1.0.0'",
        'execution:',
        '  provider:',
        '    type: host-trusted',
        'regression:',
        '  default_candidate_target: candidate',
      ].join('\n')
    );
  });

  afterEach(async () => {
    process.exitCode = undefined;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('plans one selected smoke cell without invoking an executor', async () => {
    let calls = 0;
    const output: string[] = [];
    await regressCommand(
      suiteFile,
      { profile: 'smoke', plan: true },
      {
        cwd: temporaryDirectory,
        executor: {
          execute: async () => {
            calls += 1;
            throw new Error('must not execute');
          },
        },
        stdout: (message) => output.push(message),
      }
    );
    expect(calls).toBe(0);
    expect(JSON.parse(output[0]) as unknown).toMatchObject({
      cellCount: 1,
      selection: {
        profile: 'smoke',
        targetIds: ['candidate'],
        taskIds: ['task'],
      },
    });
  });

  test('runs, persists v2 results, promotes, and resolves a baseline channel', async () => {
    const output: string[] = [];
    const executor: SingleRunExecutor = {
      execute: async () => ({
        result: bundle(path.join(temporaryDirectory, 'missing-workspace')),
        resultPath: 'unused',
        usageQuality: 'unavailable',
      }),
    };
    await regressCommand(
      suiteFile,
      { profile: 'smoke' },
      {
        cwd: temporaryDirectory,
        executor,
        stdout: (message) => output.push(message),
      }
    );
    expect(process.exitCode).toBe(0);
    const experimentId = /Regression ([^:]+):/.exec(output[0])?.[1];
    expect(experimentId).toBeDefined();
    const result = JSON.parse(
      await fs.readFile(
        path.join(
          temporaryDirectory,
          'results',
          'experiments',
          experimentId!,
          'results.json'
        ),
        'utf8'
      )
    ) as { experiment_version: number };
    expect(result.experiment_version).toBe(2);

    await baselinePromoteCommand(
      experimentId!,
      { channel: 'production', target: 'candidate' },
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
      }
    );
    await baselineShowCommand(
      'production',
      { json: true },
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
      }
    );
    expect(output.join('\n')).toContain(
      'Promoted candidate to baseline channel production'
    );
    expect(output.join('\n')).toContain('"target": "candidate"');
  });
});
