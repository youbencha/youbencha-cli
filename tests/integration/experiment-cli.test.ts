import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { SingleRunExecutor } from '../../src/experiments/index.js';
import {
  experimentApproveCommand,
  experimentCompareCommand,
  experimentPlanCommand,
  experimentReportCommand,
  experimentRunCommand,
  experimentValidateCommand,
} from '../../src/cli/commands/experiment.js';

function bundle(
  status: 'passed' | 'failed' | 'partial' = 'passed'
): ResultsBundle {
  const failed = status === 'failed' ? 1 : 0;
  const skipped = status === 'partial' ? 1 : 0;
  return {
    version: '1.0.0',
    test_case: {
      name: 'local task',
      description: 'fixture',
      config_file: 'testcase.json',
      config_hash: 'a'.repeat(64),
      repo: 'https://example.com/repository.git',
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
        workspace_dir: path.join(os.tmpdir(), 'missing-workspace'),
      },
    },
    agent: {
      type: 'fake',
      youbencha_log_path: 'youbencha.log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [],
    summary: {
      total_evaluators: 1,
      passed: status === 'passed' ? 1 : 0,
      failed,
      skipped,
      overall_status: status,
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

describe('experiment CLI integration', () => {
  let temporaryDirectory: string;
  let experimentFile: string;

  beforeEach(async () => {
    process.exitCode = undefined;
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-cli-')
    );
    const testcaseFile = path.join(temporaryDirectory, 'testcase.json');
    await fs.writeFile(
      testcaseFile,
      JSON.stringify({
        name: 'local task',
        description: 'fixture',
        repo: 'https://user:repo-password@example.com/repository.git?token=query-secret',
        agent: {
          type: 'copilot-cli',
          config: { prompt: 'Do work', max_ai_credits: 1 },
        },
        evaluators: [{ name: 'git-diff' }],
      })
    );
    experimentFile = path.join(temporaryDirectory, 'experiment.json');
    await fs.writeFile(
      experimentFile,
      JSON.stringify({
        version: 1,
        name: 'fixture experiment',
        testcases: [{ id: 'task', file: './testcase.json' }],
        variants: [{ name: 'fake', agent: { type: 'copilot-cli' } }],
        repetitions: 1,
        execution: { max_concurrent: 1, retry: { max_attempts: 1 } },
        regression: { min_pass_rate: 1 },
      })
    );
  });

  afterEach(async () => {
    process.exitCode = undefined;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('validate and plan never invoke an executor', async () => {
    let calls = 0;
    const output: string[] = [];
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        throw new Error('must not execute');
      },
    };
    await experimentValidateCommand(experimentFile, {
      cwd: temporaryDirectory,
      executor,
      stdout: (message) => output.push(message),
    });
    await experimentPlanCommand(
      experimentFile,
      { json: true },
      {
        cwd: temporaryDirectory,
        executor,
        stdout: (message) => output.push(message),
      }
    );
    expect(calls).toBe(0);
    expect(output.join('\n')).toContain('Valid experiment');
    expect(output.join('\n')).toContain('"cellCount": 1');
    expect(output.join('\n')).not.toContain('repo-password');
    expect(output.join('\n')).not.toContain('query-secret');
  });

  test.each([
    ['passed', 0],
    ['failed', 2],
    ['partial', 3],
  ] as const)(
    'run writes all reports and maps %s to exit %i',
    async (status, exitCode) => {
      if (status === 'partial') {
        const definition = JSON.parse(
          await fs.readFile(experimentFile, 'utf8')
        ) as { regression: { min_pass_rate: number } };
        definition.regression.min_pass_rate = 0;
        await fs.writeFile(experimentFile, JSON.stringify(definition));
      }
      const output: string[] = [];
      const executor: SingleRunExecutor = {
        execute: async () => ({
          result: bundle(status),
          resultPath: 'unused',
          usageQuality: 'unavailable',
        }),
      };
      await experimentRunCommand(
        experimentFile,
        {},
        {
          cwd: temporaryDirectory,
          executor,
          stdout: (message) => output.push(message),
        }
      );
      expect(process.exitCode).toBe(exitCode);
      const id = /Experiment ([^:]+):/.exec(output[0])?.[1];
      expect(id).toBeDefined();
      const directory = path.join(
        temporaryDirectory,
        'results',
        'experiments',
        id!
      );
      await expect(
        fs.access(path.join(directory, 'results.json'))
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(directory, 'report.md'))
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(directory, 'junit.xml'))
      ).resolves.toBeUndefined();
    }
  );

  test('infrastructure failure exits 1 and resume reuses completed cells', async () => {
    let calls = 0;
    const firstOutput: string[] = [];
    const executor: SingleRunExecutor = {
      execute: async () => {
        calls += 1;
        return {
          result: bundle(),
          resultPath: 'unused',
          usageQuality: 'unavailable',
        };
      },
    };
    await experimentRunCommand(
      experimentFile,
      {},
      {
        cwd: temporaryDirectory,
        executor,
        stdout: (message) => firstOutput.push(message),
      }
    );
    const id = /Experiment ([^:]+):/.exec(firstOutput[0])?.[1];
    process.exitCode = undefined;
    await experimentRunCommand(
      experimentFile,
      { resume: id },
      {
        cwd: temporaryDirectory,
        executor,
        stdout: () => undefined,
      }
    );
    expect(calls).toBe(1);
    expect(process.exitCode).toBe(0);

    process.exitCode = undefined;
    await experimentRunCommand(
      experimentFile,
      {},
      {
        cwd: temporaryDirectory,
        executor: {
          execute: async () => {
            throw new Error('offline');
          },
        },
        stdout: () => undefined,
      }
    );
    expect(process.exitCode).toBe(1);
  });

  test('approves, compares, and renders a stored experiment result', async () => {
    const output: string[] = [];
    await experimentRunCommand(
      experimentFile,
      {},
      {
        cwd: temporaryDirectory,
        executor: {
          execute: async () => ({
            result: bundle(),
            resultPath: 'unused',
            usageQuality: 'unavailable',
          }),
        },
        stdout: (message) => output.push(message),
      }
    );
    const id = /Experiment ([^:]+):/.exec(output[0])?.[1];
    expect(id).toBeDefined();
    process.exitCode = undefined;
    await experimentApproveCommand(
      id!,
      { name: 'stable' },
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
      }
    );
    await experimentCompareCommand(
      id!,
      { baseline: 'stable' },
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
      }
    );
    await experimentReportCommand(
      id!,
      { format: 'junit' },
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
      }
    );
    expect(process.exitCode).toBe(0);
    expect(output.join('\n')).toContain('Approved baseline stable');
    expect(output.join('\n')).toContain('Comparison with stable: passed');
    expect(output.join('\n')).toContain('junit.xml');
  });
});
