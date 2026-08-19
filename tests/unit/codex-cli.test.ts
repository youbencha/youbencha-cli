import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCodexCommand,
  CodexCLIAdapter,
} from '../../src/adapters/codex-cli.js';
import type { AgentExecutionContext } from '../../src/adapters/base.js';
import type {
  CliProcessRequest,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

describe('CodexCLIAdapter', () => {
  let root: string;
  let context: AgentExecutionContext;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'youbencha-codex-test-'));
    const repoDir = path.join(root, 'repo');
    const artifactsDir = path.join(root, 'artifacts');
    await Promise.all([
      mkdir(repoDir, { recursive: true }),
      mkdir(artifactsDir, { recursive: true }),
    ]);
    context = {
      workspaceDir: repoDir,
      repoDir,
      artifactsDir,
      config: { prompt: 'Do the work.' },
      timeout: 5_000,
      env: {},
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds the verified argument order and keeps prompt out of argv', () => {
    context.config = {
      prompt: 'super secret prompt',
      model: 'gpt-5.4',
      profile: 'benchmark',
      reasoning_effort: 'high',
      ignore_rules: true,
      search: true,
    };
    const command = buildCodexCommand(context);

    expect(command.args).toEqual([
      '--ask-for-approval',
      'never',
      '--search',
      'exec',
      '--json',
      '--ephemeral',
      '--color',
      'never',
      '--sandbox',
      'workspace-write',
      '--ignore-user-config',
      '-C',
      context.repoDir,
      '--ignore-rules',
      '--profile',
      'benchmark',
      '--model',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="high"',
      '-',
    ]);
    expect(command.args.join(' ')).not.toContain('super secret prompt');
    expect(command.args).not.toContain('--skip-git-repo-check');
  });

  it('rejects interactive approval, unsafe sandbox, and agent_name', () => {
    expect(() =>
      buildCodexCommand({
        ...context,
        config: { prompt: 'x', approval_policy: 'on-request' },
      })
    ).toThrow('approval_policy');
    expect(() =>
      buildCodexCommand({
        ...context,
        config: { prompt: 'x', sandbox: 'danger-full-access' },
      })
    ).toThrow('sandbox');
    expect(() =>
      buildCodexCommand({
        ...context,
        config: { prompt: 'x', agent_name: 'worker' },
      })
    ).toThrow('agent_name');
  });

  it('passes the prompt through stdin, preserves artifacts, and redacts errors', async () => {
    const requests: CliProcessRequest[] = [];
    const secret = 'test-"secret\\value';
    context.env = { CODEX_API_KEY: secret };
    const runProcess = async (
      request: CliProcessRequest
    ): Promise<CliProcessResult> => {
      requests.push(request);
      await writeFile(
        request.stdoutArtifactPath,
        [
          '{"type":"thread.started","thread_id":"thread-1"}',
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'tool-1',
              type: 'mcp_tool_call',
              server: 'docs',
              tool: 'search',
              arguments: { credential: secret },
            },
          }),
          JSON.stringify({
            type: 'error',
            message: `credential ${secret}`,
          }),
          '{"type":"turn.failed","error":{"message":"model failed"}}',
        ].join('\n'),
        'utf8'
      );
      await writeFile(request.stderrArtifactPath, `auth ${secret}`, 'utf8');
      return result({ exitCode: 1, stderr: `auth ${secret}` });
    };
    const adapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => ({
        path: path.join(root, 'codex.exe'),
        kind: 'native',
      }),
      runProcess,
    });

    const execution = await adapter.execute(context);
    expect(requests).toHaveLength(1);
    expect(requests[0].stdin).toBe('Do the work.');
    expect(requests[0].args).not.toContain('Do the work.');
    expect(requests[0].maxArtifactOutputBytes).toBeGreaterThan(0);
    expect(requests[0].artifactRedactions).toContain(secret);
    expect(requests[0].args).not.toContain('--output-last-message');
    expect(execution.status).toBe('failed');
    expect(JSON.stringify(execution.errors)).not.toContain(secret);
    expect(JSON.stringify(execution.telemetry)).not.toContain(secret);
    expect(execution.output).not.toContain(secret);
    expect(execution.output).not.toContain('auth');
    const logs = path.join(context.artifactsDir, 'codex-cli-logs');
    const artifactNames = await (
      await import('node:fs/promises')
    ).readdir(logs);
    const artifactContents = await Promise.all(
      artifactNames.map((name) => readFile(path.join(logs, name), 'utf8'))
    );
    expect(artifactContents.join('\n')).toContain('thread.started');
    expect(artifactContents.join('\n')).toContain('[REDACTED]');
    for (const content of artifactContents) {
      expect(content).not.toContain(secret);
    }
  });

  it('diagnoses environment auth without an AI call', async () => {
    const calls: string[][] = [];
    const adapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => ({
        path: path.join(root, 'codex.exe'),
        kind: 'native',
      }),
      runProcess: async (
        request: CliProcessRequest
      ): Promise<CliProcessResult> => {
        calls.push(request.args);
        if (request.args[0] === '--version') {
          return result({ stdout: 'codex-cli 0.146.0-alpha.3' });
        }
        if (request.args[0] === '--help') {
          return result({ stdout: '--ask-for-approval --search' });
        }
        if (request.args[0] === 'exec') {
          return result({
            stdout:
              '--json --ephemeral --color --sandbox --ignore-user-config --output-last-message -C',
          });
        }
        return result({ exitCode: 1, stderr: 'status unavailable' });
      },
    });

    const diagnosis = await adapter.diagnoseAvailability({
      PATH: process.env.PATH,
      CODEX_API_KEY: 'present-but-never-returned',
    });
    expect(diagnosis).toEqual(
      expect.objectContaining({
        installed: true,
        authenticated: true,
        version: '0.146.0-alpha.3',
      })
    );
    expect(JSON.stringify(diagnosis)).not.toContain(
      'present-but-never-returned'
    );
    expect(calls).not.toContainEqual(expect.arrayContaining(['exec', '-']));
  });

  it('uses collision-resistant artifacts for concurrent executions', async () => {
    const adapter = new CodexCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => ({
        path: path.join(root, 'codex.exe'),
        kind: 'native',
      }),
      runProcess: async (
        request: CliProcessRequest
      ): Promise<CliProcessResult> => {
        await Promise.all([
          writeFile(
            request.stdoutArtifactPath,
            [
              '{"type":"thread.started","thread_id":"thread-concurrent"}',
              '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
              '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
            ].join('\n'),
            'utf8'
          ),
          writeFile(request.stderrArtifactPath, '', 'utf8'),
        ]);
        return result();
      },
    });

    const executions = await Promise.all([
      adapter.execute(context),
      adapter.execute(context),
    ]);

    expect(executions.map((execution) => execution.status)).toEqual([
      'success',
      'success',
    ]);
    const names = await readdir(
      path.join(context.artifactsDir, 'codex-cli-logs')
    );
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });
});

function result(overrides: Partial<CliProcessResult> = {}): CliProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutArtifactBytes: 0,
    stderrArtifactBytes: 0,
    stdoutArtifactTruncated: false,
    stderrArtifactTruncated: false,
    timedOut: false,
    ...overrides,
  };
}
