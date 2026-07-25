import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { CopilotCLIAdapter } from '../../src/adapters/copilot-cli.js';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
} from '../../src/adapters/base.js';
import { experimentRunCommand } from '../../src/cli/commands/experiment.js';
import { WorkspaceManager } from '../../src/core/workspace.js';
import { GitDiffEvaluator } from '../../src/evaluators/git-diff.js';

const execFileAsync = promisify(execFile);

interface CloneBoundary {
  cloneRepository(
    repoUrl: string,
    targetDir: string,
    branch?: string,
    commit?: string,
    timeout?: number
  ): Promise<string>;
}

describe('experiment production execution flow', () => {
  let temporaryDirectory: string;
  let sourceRepository: string;
  let sourceCommit: string;

  beforeEach(async () => {
    process.exitCode = undefined;
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-production-')
    );
    sourceRepository = path.join(temporaryDirectory, 'source');
    await fs.mkdir(sourceRepository);
    await execFileAsync('git', ['init', '-b', 'main'], {
      cwd: sourceRepository,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: sourceRepository,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: sourceRepository,
    });
    await fs.writeFile(path.join(sourceRepository, 'README.md'), '# fixture\n');
    await execFileAsync('git', ['add', 'README.md'], {
      cwd: sourceRepository,
    });
    await execFileAsync('git', ['commit', '-m', 'fixture'], {
      cwd: sourceRepository,
    });
    sourceCommit = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: sourceRepository,
      })
    ).stdout.trim();

    jest
      .spyOn(
        WorkspaceManager.prototype as unknown as CloneBoundary,
        'cloneRepository'
      )
      .mockImplementation(async (_repoUrl, targetDir) => {
        await fs.cp(sourceRepository, targetDir, { recursive: true });
        return sourceCommit;
      });
    jest
      .spyOn(CopilotCLIAdapter.prototype, 'checkAvailability')
      .mockResolvedValue(true);
    // Keep the test hermetic at the evaluator's external Git-process boundary.
    jest.spyOn(GitDiffEvaluator.prototype, 'evaluate').mockResolvedValue({
      evaluator: 'git-diff',
      status: 'passed',
      metrics: {
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
        total_changes: 0,
      },
      message: 'No changes',
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    process.exitCode = undefined;
    jest.restoreAllMocks();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('runs concurrent real Orchestrator attempts into isolated, redacted durable artifacts', async () => {
    const workspaceDirectories: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const bothAgentsStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    jest
      .spyOn(CopilotCLIAdapter.prototype, 'execute')
      .mockImplementation(
        async (
          context: AgentExecutionContext
        ): Promise<AgentExecutionResult> => {
          workspaceDirectories.push(context.workspaceDir);
          if (workspaceDirectories.length === 1) {
            await bothAgentsStarted;
          } else {
            releaseFirst?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
          }
          const timestamp = new Date().toISOString();
          return {
            exitCode: 0,
            status: 'success',
            output: 'mock agent completed',
            startedAt: timestamp,
            completedAt: timestamp,
            durationMs: 1,
            errors: [],
          };
        }
      );

    const secretUrl =
      'https://repo-user:repo-password@example.com/repository.git?token=query-secret';
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.json'),
      JSON.stringify({
        name: 'task',
        description: 'fixture',
        repo: secretUrl,
        branch: 'main',
        agent: { type: 'copilot-cli', config: { prompt: 'work' } },
        evaluators: [{ name: 'git-diff' }],
        workspace_dir: path.join(temporaryDirectory, 'workspaces'),
      })
    );
    const experimentFile = path.join(temporaryDirectory, 'experiment.json');
    await fs.writeFile(
      experimentFile,
      JSON.stringify({
        version: 1,
        name: 'production-flow',
        testcases: [{ id: 'task', file: './task.json' }],
        variants: [{ name: 'default', agent: { type: 'copilot-cli' } }],
        repetitions: 2,
        execution: { max_concurrent: 2 },
      })
    );

    const output: string[] = [];
    const errors: string[] = [];
    await experimentRunCommand(
      experimentFile,
      {},
      {
        cwd: temporaryDirectory,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
      }
    );

    expect(errors).toEqual([]);
    expect(process.exitCode).toBe(0);
    expect(workspaceDirectories).toHaveLength(2);
    expect(new Set(workspaceDirectories).size).toBe(2);
    workspaceDirectories.forEach((workspace) =>
      expect(workspace).toContain(`${path.sep}experiment-`)
    );

    const experimentId = /Experiment ([^:]+):/.exec(output[0])?.[1];
    expect(experimentId).toBeDefined();
    const resultDirectory = path.join(
      temporaryDirectory,
      'results',
      'experiments',
      experimentId!
    );
    const state = JSON.parse(
      await fs.readFile(path.join(resultDirectory, 'state.json'), 'utf8')
    ) as { cells: Array<{ result_path?: string }> };
    const attemptFiles = state.cells.flatMap((cell) =>
      cell.result_path === undefined ? [] : [cell.result_path]
    );
    expect(attemptFiles).toHaveLength(2);
    const durableArtifacts = await Promise.all(
      attemptFiles.map((file) =>
        fs.readFile(path.join(resultDirectory, file), 'utf8')
      )
    );
    const serialized = [
      ...durableArtifacts,
      await fs.readFile(path.join(resultDirectory, 'results.json'), 'utf8'),
    ].join('\n');
    expect(serialized).not.toContain('repo-user');
    expect(serialized).not.toContain('repo-password');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).toContain('%5BREDACTED%5D');
  }, 120_000);
});
