import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve('.');
const cliFile = path.join(repositoryRoot, 'dist', 'cli', 'index.js');

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  cwd: string,
  arguments_: readonly string[]
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [cliFile, ...arguments_],
      {
        cwd,
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 30_000,
        windowsHide: true,
      }
    );
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function storedResult(
  id: string,
  passRate: number | undefined
): ExperimentResult {
  const hash = 'a'.repeat(64);
  const now = '2026-07-25T12:00:00.000Z';
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: id,
    definition_hash: hash,
    started_at: now,
    completed_at: now,
    final_status: 'passed',
    exit_code: 0,
    effective_configuration: {
      definition: {
        version: 1,
        name: id,
        testcases: [{ id: 'task', file: './task.json' }],
        variants: [
          { name: 'default', agent: { type: 'copilot-cli' as const } },
        ],
        repetitions: 1,
        execution: {
          max_concurrent: 1,
          retry: { max_attempts: 1, on: [], backoff_ms: 0 },
        },
        regression: {
          max_pass_rate_drop: 0.1,
          zero_baseline_behavior: 'partial' as const,
        },
      },
    },
    sources: [],
    provenance: {
      youbencha_version: 'test',
      agent_cli_versions: {},
      requested_models: {},
      resolved_models: {},
    },
    cells: [],
    aggregates: [
      {
        scope: 'experiment',
        metrics: {
          ...(passRate === undefined
            ? {}
            : {
                overall_pass_rate: {
                  sample_size: 1,
                  value: passRate,
                  quality: 'measured' as const,
                },
              }),
        },
      },
    ],
    comparisons: [],
    artifacts: {},
    warnings: [],
  };
}

describe('experiment CLI process integration', () => {
  let temporaryDirectory: string;

  jest.setTimeout(30_000);

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-process-')
    );
  });

  afterEach(async () => {
    if (temporaryDirectory !== undefined) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('registers experiment commands and prints help through Commander', async () => {
    const result = await runCli(temporaryDirectory, ['experiment', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Plan, run, compare, and report');
    expect(result.stdout).toContain('validate');
    expect(result.stdout).toContain('plan');
    expect(result.stdout).toContain('run');
    expect(result.stdout).toContain('compare');
    expect(result.stdout).toContain('approve');
    expect(result.stdout).toContain('report');
  });

  test('returns process exit 0 on a valid plan and exit 1 on invalid input', async () => {
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.json'),
      JSON.stringify({
        name: 'task',
        description: 'fixture',
        repo: 'https://example.com/repository.git',
        agent: { type: 'copilot-cli', config: { prompt: 'work' } },
        evaluators: [{ name: 'git-diff' }],
      })
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'experiment.json'),
      JSON.stringify({
        version: 1,
        name: 'fixture',
        testcases: [{ id: 'task', file: './task.json' }],
        variants: [{ name: 'default', agent: { type: 'copilot-cli' } }],
      })
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'invalid.json'),
      JSON.stringify({ version: 1 })
    );

    const passed = await runCli(temporaryDirectory, [
      'experiment',
      'plan',
      'experiment.json',
      '--json',
    ]);
    const failed = await runCli(temporaryDirectory, [
      'experiment',
      'validate',
      'invalid.json',
    ]);

    expect(passed.exitCode).toBe(0);
    expect(passed.stderr).toBe('');
    expect(passed.stdout).toContain('"cellCount": 1');
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('invalid experiment definition');
  });

  test('maps failed and partial stored-result comparisons to exits 2 and 3', async () => {
    const baseline = path.join(temporaryDirectory, 'baseline.json');
    const failed = path.join(temporaryDirectory, 'failed.json');
    const partial = path.join(temporaryDirectory, 'partial.json');
    await fs.writeFile(baseline, JSON.stringify(storedResult('baseline', 1)));
    await fs.writeFile(failed, JSON.stringify(storedResult('failed', 0.5)));
    await fs.writeFile(
      partial,
      JSON.stringify(storedResult('partial', undefined))
    );

    const failedResult = await runCli(temporaryDirectory, [
      'experiment',
      'compare',
      failed,
      '--baseline',
      baseline,
    ]);
    const partialResult = await runCli(temporaryDirectory, [
      'experiment',
      'compare',
      partial,
      '--baseline',
      baseline,
    ]);

    expect(failedResult.exitCode).toBe(2);
    expect(failedResult.stderr).toBe('');
    expect(failedResult.stdout).toContain(
      'Comparison with baseline.json: failed'
    );
    expect(partialResult.exitCode).toBe(3);
    expect(partialResult.stderr).toBe('');
    expect(partialResult.stdout).toContain(
      'Comparison with baseline.json: partial'
    );
  });
});
