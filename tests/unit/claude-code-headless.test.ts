import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';
import type {
  CliProcessRequest,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

interface ClaudeArgsBuilder {
  buildClaudeArgs(context: AgentExecutionContext): string[];
}

interface ClaudeDiagnosticsReader {
  capabilityDiagnostics(config: Record<string, unknown>): string[];
}

describe('ClaudeCodeAdapter headless command', () => {
  let workspaceDir: string;
  let adapter: ClaudeCodeAdapter;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'claude-headless-unit-')
    );
    adapter = new ClaudeCodeAdapter();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  function buildArgs(
    config: Record<string, unknown>,
    prepareAgent?: string
  ): Promise<string[]> {
    const run = async (): Promise<string[]> => {
      if (prepareAgent) {
        const agentsDir = path.join(workspaceDir, '.claude', 'agents');
        await fs.mkdir(agentsDir, { recursive: true });
        await fs.writeFile(
          path.join(agentsDir, `${prepareAgent}.md`),
          `---\nname: ${prepareAgent}\n---\nAgent instructions`
        );
      }

      const context: AgentExecutionContext = {
        workspaceDir,
        repoDir: workspaceDir,
        artifactsDir: path.join(workspaceDir, 'artifacts'),
        config,
        timeout: 1000,
        env: {},
      };
      return (adapter as unknown as ClaudeArgsBuilder).buildClaudeArgs(context);
    };

    return run();
  }

  it('uses the structured, verbose, non-persistent command shape', async () => {
    const args = await buildArgs({ prompt: 'Keep this prompt unchanged.' });

    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      'Keep this prompt unchanged.',
    ]);
  });

  it('passes a discovered named agent exactly once without rewriting the prompt', async () => {
    const prompt = 'Review the implementation.';
    const args = await buildArgs(
      { prompt, agent_name: 'code-reviewer' },
      'code-reviewer'
    );

    expect(args.filter((argument) => argument === '--agent')).toHaveLength(1);
    expect(args).toContain('code-reviewer');
    expect(args.at(-1)).toBe(prompt);
    expect(args.join(' ')).not.toContain('Use the "code-reviewer" agent');
  });

  it.each(['Uppercase', 'bad_name', '../escape', 'contains spaces'])(
    'rejects unsupported agent name %s',
    async (agentName) => {
      await expect(
        buildArgs({ prompt: 'test', agent_name: agentName })
      ).rejects.toThrow(/agent_name.*lowercase/i);
    }
  );

  it('rejects a named agent that was not discovered', async () => {
    await expect(
      buildArgs({ prompt: 'test', agent_name: 'missing-agent' })
    ).rejects.toThrow(/was not discovered/);
  });

  it('forwards documented limit, model, settings, and tool flags', async () => {
    const args = await buildArgs({
      prompt: 'test',
      model: 'claude-opus-4-1',
      fallback_model: 'claude-sonnet-4-5',
      max_turns: 8,
      max_budget_usd: 2.5,
      effort: 'high',
      setting_sources: ['project', 'local'],
      tools: ['Read', 'Edit'],
      allowed_tools: ['Bash(git status:*)', 'Read'],
      disallowed_tools: ['WebFetch'],
      permission_mode: 'dontAsk',
    });

    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--model',
      'claude-opus-4-1',
      '--permission-mode',
      'dontAsk',
      '--tools',
      'Read,Edit',
      '--allowedTools',
      'Bash(git status:*),Read',
      '--disallowedTools',
      'WebFetch',
      '--max-turns',
      '8',
      '--max-budget-usd',
      '2.5',
      '--effort',
      'high',
      '--fallback-model',
      'claude-sonnet-4-5',
      '--setting-sources',
      'project,local',
      'test',
    ]);
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it.each(['auto', 'manual'])(
    'forwards current permission mode %s',
    async (permissionMode) => {
      const args = await buildArgs({
        prompt: 'test',
        permission_mode: permissionMode,
      });

      expect(args).toContain('--permission-mode');
      expect(args).toContain(permissionMode);
      expect(args).not.toContain('--dangerously-skip-permissions');
    }
  );

  it.each(['xhigh', 'ultracode'])(
    'accepts version-dependent effort level %s before capability probing',
    async (effort) => {
      const args = await buildArgs({ prompt: 'test', effort });

      expect(args).toContain('--effort');
      expect(args).toContain(effort);
    }
  );

  it('uses dontAsk when permission bypass is explicitly disabled', async () => {
    const args = await buildArgs({
      prompt: 'test',
      dangerously_skip_permissions: false,
    });

    expect(args).toContain('--permission-mode');
    expect(args).toContain('dontAsk');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('rejects contradictory permission configuration', async () => {
    await expect(
      buildArgs({
        prompt: 'test',
        permission_mode: 'dontAsk',
        dangerously_skip_permissions: true,
      })
    ).rejects.toThrow(/cannot be combined/);
  });

  it.each([
    ['max_tokens', 4096],
    ['temperature', 0.2],
  ])('rejects deprecated API-only option %s', async (key, value) => {
    await expect(buildArgs({ prompt: 'test', [key]: value })).rejects.toThrow(
      /not documented Claude Code CLI flags/
    );
  });

  it.each([
    [{ max_turns: 0 }, /max_turns.*positive integer/],
    [{ max_budget_usd: -1 }, /max_budget_usd.*positive/],
    [{ effort: 'extreme' }, /Unsupported Claude Code "effort"/],
    [
      { setting_sources: ['environment'] },
      /Unsupported Claude Code setting source/,
    ],
    [{ tools: [''] }, /tools.*non-empty strings/],
  ])(
    'rejects invalid documented option %#',
    async (extraConfig, expectedError) => {
      await expect(
        buildArgs({ prompt: 'test', ...extraConfig })
      ).rejects.toThrow(expectedError as RegExp);
    }
  );
});

describe('ClaudeCodeAdapter shared process integration', () => {
  const executable: ResolvedExecutable = {
    path: 'C:\\npm\\claude.cmd',
    kind: 'cmd',
  };

  it('checks version and structured authentication without an agent turn', async () => {
    const requests: CliProcessRequest[] = [];
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        requests.push(request);
        const command = request.args[0];
        return processResult({
          exitCode: 0,
          stdout:
            command === '--version'
              ? '2.1.212 (Claude Code)'
              : command === '--help'
                ? '--permission-mode <mode> (choices: "acceptEdits", "auto", "manual", "dontAsk", "plan")\n--effort <level> (low, medium, high, xhigh, max)'
                : JSON.stringify({
                    loggedIn: true,
                    authMethod: 'oauth',
                  }),
        });
      },
    });

    await expect(adapter.checkAvailability()).resolves.toBe(true);
    expect(requests.map((request) => request.args)).toEqual([
      ['--version'],
      ['--help'],
      ['auth', 'status', '--json'],
    ]);
  });

  it('gates an effort level not advertised by the installed CLI', async () => {
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> =>
        processResult({
          exitCode: 0,
          stdout:
            request.args[0] === '--version'
              ? '2.1.212 (Claude Code)'
              : request.args[0] === '--help'
                ? '--permission-mode <mode> (choices: "acceptEdits", "auto", "manual", "dontAsk", "plan")\n--effort <level> (low, medium, high, xhigh, max)'
                : JSON.stringify({ loggedIn: true }),
        }),
    });
    await expect(adapter.checkAvailability()).resolves.toBe(true);

    const context: AgentExecutionContext = {
      workspaceDir: process.cwd(),
      repoDir: process.cwd(),
      artifactsDir: process.cwd(),
      config: { prompt: 'test', effort: 'ultracode' },
      timeout: 1000,
      env: {},
    };

    expect(() =>
      (adapter as unknown as ClaudeArgsBuilder).buildClaudeArgs(context)
    ).toThrow(/does not advertise effort level "ultracode"/);
  });

  it('reports the subagent budget enforcement version caveat', async () => {
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> =>
        processResult({
          exitCode: 0,
          stdout:
            request.args[0] === '--version'
              ? '2.1.212 (Claude Code)'
              : request.args[0] === '--help'
                ? '--permission-mode <mode> (choices: "acceptEdits", "auto", "manual", "dontAsk", "plan")\n--effort <level> (low, medium, high, xhigh, max)'
                : JSON.stringify({ loggedIn: true }),
        }),
    });
    await expect(adapter.checkAvailability()).resolves.toBe(true);

    const diagnostics = (
      adapter as unknown as ClaudeDiagnosticsReader
    ).capabilityDiagnostics({ max_budget_usd: 2 });

    expect(diagnostics).toEqual([
      'Claude Code 2.1.212 supports --max-budget-usd, but full subagent budget enforcement requires Claude Code >=2.1.217',
    ]);
  });

  it('returns the final response and parses the complete event artifact', async () => {
    const testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-process-')
    );
    let capturedRequest: CliProcessRequest | undefined;
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        capturedRequest = request;
        const events = [
          {
            type: 'system',
            subtype: 'init',
            session_id: 'session-1',
            model: 'claude-sonnet',
            claude_code_version: '2.1.212',
            tools: ['Read'],
          },
          {
            type: 'assistant',
            message: {
              model: 'claude-sonnet',
              content: [{ type: 'text', text: 'Working.'.repeat(100) }],
              usage: { input_tokens: 10, output_tokens: 2 },
            },
          },
          {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Finished successfully.',
            session_id: 'session-1',
            total_cost_usd: 0.01,
            usage: { input_tokens: 10, output_tokens: 4 },
          },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n');
        await fs.mkdir(path.dirname(request.stdoutArtifactPath), {
          recursive: true,
        });
        await fs.writeFile(request.stdoutArtifactPath, events, 'utf8');
        await fs.writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          exitCode: 0,
          stdout: events.slice(0, 20),
          stdoutBytes: Buffer.byteLength(events),
          stdoutTruncated: true,
        });
      },
    });

    try {
      const result = await adapter.execute({
        workspaceDir: testDirectory,
        repoDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: {
          prompt: 'Do the task.',
          permission_mode: 'dontAsk',
          max_output_bytes: 256,
        },
        timeout: 30_000,
        env: {},
      });

      expect(result.status).toBe('success');
      expect(result.output).toBe('Finished successfully.');
      expect(result.telemetry).toMatchObject({
        cliVersion: '2.1.212',
        model: 'claude-sonnet',
        sessionId: 'session-1',
        finalResponse: 'Finished successfully.',
        usage: {
          promptTokens: 10,
          completionTokens: 4,
          totalTokens: 14,
          costUsd: 0.01,
          source: 'measured',
        },
        headlessMode: true,
        sessionPersistence: false,
        structuredOutputFormat: 'stream-json',
      });
      expect(capturedRequest?.maxCapturedOutputBytes).toBe(256);
      expect(capturedRequest?.maxArtifactOutputBytes).toBe(64 * 1024 * 1024);
      expect(capturedRequest?.args).toContain('--no-session-persistence');
      expect(result.telemetry?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Retained Claude event content was truncated at 256 bytes'
          ),
        ])
      );
      await expect(
        fs.readFile(result.telemetry?.eventsArtifactPath ?? '', 'utf8')
      ).resolves.toContain('Finished successfully.');
    } finally {
      await fs.rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('fails when the durable event artifact reaches its safety limit', async () => {
    const testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-artifact-limit-')
    );
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await fs.mkdir(path.dirname(request.stdoutArtifactPath), {
          recursive: true,
        });
        await fs.writeFile(
          request.stdoutArtifactPath,
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Result before the quota boundary.',
          }),
          'utf8'
        );
        await fs.writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          exitCode: 0,
          stdoutArtifactTruncated: true,
        });
      },
    });

    try {
      const result = await adapter.execute({
        workspaceDir: testDirectory,
        repoDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: { prompt: 'Do the task.' },
        timeout: 30_000,
        env: {},
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('structured result is incomplete'),
          }),
        ])
      );
      expect(result.telemetry?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.stringContaining('event artifact reached its'),
        ])
      );
    } finally {
      await fs.rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('fails a zero-exit stream with a structurally malformed result event', async () => {
    const testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-malformed-result-')
    );
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await fs.mkdir(path.dirname(request.stdoutArtifactPath), {
          recursive: true,
        });
        await fs.writeFile(
          request.stdoutArtifactPath,
          JSON.stringify({ type: 'result' }),
          'utf8'
        );
        await fs.writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({ exitCode: 0 });
      },
    });

    try {
      const result = await adapter.execute({
        workspaceDir: testDirectory,
        repoDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: { prompt: 'Do the task.' },
        timeout: 30_000,
        env: {},
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Claude Code returned a malformed terminal result event',
          }),
        ])
      );
    } finally {
      await fs.rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('fails a nominal success after a structured error at a tiny retention bound', async () => {
    const testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-tiny-error-')
    );
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await fs.mkdir(path.dirname(request.stdoutArtifactPath), {
          recursive: true,
        });
        await fs.writeFile(
          request.stdoutArtifactPath,
          [
            JSON.stringify({
              type: 'error',
              error: { message: 'provider failure' },
            }),
            JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'nominal success',
            }),
          ].join('\n'),
          'utf8'
        );
        await fs.writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({ exitCode: 0 });
      },
    });

    try {
      const result = await adapter.execute({
        workspaceDir: testDirectory,
        repoDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: { prompt: 'Do the task.', max_output_bytes: 1 },
        timeout: 30_000,
        env: {},
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Claude Code reported 1 structured error event',
          }),
        ])
      );
    } finally {
      await fs.rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('redacts secret environment values from process errors', async () => {
    const testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-redaction-')
    );
    const secret = 'claude-secret-value';
    const adapter = new ClaudeCodeAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await fs.mkdir(path.dirname(request.stdoutArtifactPath), {
          recursive: true,
        });
        await fs.writeFile(request.stdoutArtifactPath, '', 'utf8');
        await fs.writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          error: new Error(`spawn failed with ${secret}`),
        });
      },
    });

    try {
      const result = await adapter.execute({
        workspaceDir: testDirectory,
        repoDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: {
          prompt: 'Do the task.',
          permission_mode: 'dontAsk',
        },
        timeout: 30_000,
        env: { ANTHROPIC_API_KEY: secret },
      });

      expect(result.status).toBe('failed');
      expect(JSON.stringify(result.errors)).not.toContain(secret);
      expect(JSON.stringify(result.errors)).toContain('[REDACTED]');
    } finally {
      await fs.rm(testDirectory, { recursive: true, force: true });
    }
  });
});

function processResult(
  overrides: Partial<CliProcessResult> = {}
): CliProcessResult {
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
