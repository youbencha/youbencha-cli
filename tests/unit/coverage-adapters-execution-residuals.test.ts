import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentExecutionContext } from '../../src/adapters/base.js';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import {
  buildCopilotCommand,
  CopilotCLIAdapter,
} from '../../src/adapters/copilot-cli.js';
import type {
  CliProcessOptions,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

function context(
  root: string,
  config: Record<string, unknown>
): AgentExecutionContext {
  return {
    workspaceDir: root,
    repoDir: root,
    artifactsDir: path.join(root, 'artifacts'),
    config,
    timeout: 10,
    env: {},
  };
}

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

const executable: ResolvedExecutable = { path: 'adapter-cli', kind: 'native' };

describe('adapter execution residual coverage', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-adapter-execution-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('covers every Copilot execution terminal and normalization fallback', async () => {
    const completeCommand = buildCopilotCommand(
      context(root, {
        prompt: 'work',
        model: 'model',
        agent: 'agent',
        reasoning_effort: 'high',
        max_ai_credits: 0,
        log_level: 'debug',
        legacy_text_output: true,
      })
    );
    expect(completeCommand.args).toEqual(
      expect.arrayContaining([
        '--agent',
        'agent',
        '--reasoning-effort',
        'high',
        '--max-ai-credits',
        '0',
        '--log-level',
        'debug',
      ])
    );
    expect(() =>
      buildCopilotCommand(context(root, { prompt: 'work', log_level: 'nope' }))
    ).toThrow('log_level');

    const missing = new CopilotCLIAdapter({
      resolveExecutable: async () => undefined,
    });
    await expect(
      missing.execute(context(root, { prompt: 'work' }))
    ).resolves.toMatchObject({ status: 'failed', exitCode: 1 });

    const scenarios: Array<{
      artifact: string;
      process: Partial<CliProcessResult>;
      config?: Record<string, unknown>;
      status: 'success' | 'failed' | 'timeout';
    }> = [
      {
        artifact: `${JSON.stringify({
          type: 'assistant.message',
          data: { messageId: 'm', content: 'done' },
        })}\n${JSON.stringify({ type: 'result', exitCode: 0 })}`,
        process: {
          exitCode: null,
          stdoutTruncated: true,
          stdoutArtifactTruncated: true,
          stderrTruncated: true,
          stderrArtifactTruncated: true,
        },
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'result', exitCode: 0 }),
        process: { timedOut: true },
        status: 'timeout',
      },
      {
        artifact: JSON.stringify({ type: 'result', exitCode: 0 }),
        process: {
          error: Object.assign(new Error('process error'), { stack: '' }),
        },
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'result', exitCode: 2 }),
        process: { exitCode: 2, stderr: 'other failure' },
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'result', exitCode: 0 }),
        process: { stdoutArtifactTruncated: true },
        status: 'failed',
      },
      {
        artifact: `${JSON.stringify({
          type: 'assistant.message',
          data: { messageId: 'm', content: 'done' },
        })}\n${JSON.stringify({ type: 'result', exitCode: 0 })}`,
        process: { stdoutTruncated: true },
        status: 'success',
      },
      {
        artifact: '{"type":"result"',
        process: {},
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'session.start', data: {} }),
        process: {},
        status: 'failed',
      },
      {
        artifact: 'plain output',
        process: {},
        status: 'failed',
      },
      {
        artifact:
          `${JSON.stringify({ type: 'error', data: { message: 'bad credentials' } })}\n` +
          `${JSON.stringify({
            type: 'assistant.message',
            data: { messageId: 'm', content: 'done' },
          })}\n${JSON.stringify({ type: 'result', exitCode: 0 })}`,
        process: {},
        status: 'failed',
      },
      {
        artifact:
          `${JSON.stringify({ type: 'error', data: { message: 'omitted' } })}\n` +
          `${JSON.stringify({
            type: 'assistant.message',
            data: { messageId: 'm', content: 'done' },
          })}\n${JSON.stringify({ type: 'result', exitCode: 0 })}`,
        process: {},
        config: { max_output_bytes: 1 },
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'result', exitCode: 0 }),
        process: { error: new Error('process error with stack') },
        status: 'failed',
      },
    ];

    for (const scenario of scenarios) {
      const adapter = new CopilotCLIAdapter({
        resolveExecutable: async () => executable,
        runProcess: async (options: CliProcessOptions) => {
          await fs.writeFile(options.stdoutArtifactPath, scenario.artifact);
          return result(scenario.process);
        },
      });
      await expect(
        adapter.execute(
          context(root, {
            prompt: 'work',
            model: 'model',
            max_output_bytes: 128,
            ...(scenario.config ?? {}),
          })
        )
      ).resolves.toMatchObject({ status: scenario.status });
    }

    const timeoutFallback = new CopilotCLIAdapter({
      resolveExecutable: async () => executable,
      runProcess: async (options: CliProcessOptions) => {
        await fs.writeFile(
          options.stdoutArtifactPath,
          JSON.stringify({ type: 'result', exitCode: 0 })
        );
        return result({ timedOut: true });
      },
    });
    const zeroTimeoutContext = context(root, { prompt: 'work' });
    zeroTimeoutContext.timeout = 0;
    await timeoutFallback.execute(zeroTimeoutContext);

    const nonError = new CopilotCLIAdapter({
      resolveExecutable: async () => {
        throw 'resolution failed';
      },
    });
    await expect(
      nonError.execute(context(root, { prompt: 'work' }))
    ).resolves.toMatchObject({ output: 'resolution failed' });

    const adapter = new CopilotCLIAdapter();
    const startedAt = '2026-01-01T00:00:00.000Z';
    const completedAt = '2026-01-01T00:00:01.000Z';
    const fallbackLog = adapter.normalizeLog('Copilot CLI v1.2.3', {
      exitCode: 0,
      status: 'success',
      output: '',
      startedAt,
      completedAt,
      durationMs: 1000,
      errors: [],
    });
    expect(fallbackLog.agent.version).toBe('1.2.3');

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const telemetryLog = adapter.normalizeLog('', {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [{ message: 'error', timestamp: completedAt }],
        telemetry: {
          provider: 'GitHub Copilot',
          messages: [
            {
              role: 'assistant',
              content: 'telemetry message',
              timestamp: completedAt,
            },
          ],
          usage: { source: 'measured', promptTokens: 1, completionTokens: 2 },
          diagnostics: [],
        },
      });
      expect(telemetryLog.environment.youbencha_version).toBe('unknown');
      expect(telemetryLog.messages[0]?.content).toBe('telemetry message');

      await fs.writeFile(path.join(root, 'package.json'), '{}');
      const unknownVersionLog = adapter.normalizeLog('', {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
        telemetry: {
          provider: 'GitHub Copilot',
          messages: [],
          usage: { source: 'unavailable' },
          diagnostics: [],
        },
      });
      expect(unknownVersionLog.environment.youbencha_version).toBe('unknown');

      const missingUsageLog = adapter.normalizeLog('', {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
        telemetry: {
          provider: 'GitHub Copilot',
          messages: [],
          diagnostics: [],
        },
      });
      expect(missingUsageLog.usage.measurement_source).toBe('unavailable');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('covers every Claude execution terminal and normalization fallback', async () => {
    const missing = new ClaudeCodeAdapter({
      resolveExecutable: async () => undefined,
    });
    await expect(
      missing.execute(context(root, { prompt: 'work' }))
    ).resolves.toMatchObject({ status: 'failed' });
    for (const config of [
      { prompt_file: 'missing.md' },
      { prompt: 'work', max_tokens: 1 },
      { prompt: 'work', temperature: 0.5 },
      { prompt: 'work', max_tokens: 1, temperature: 0.5 },
      { prompt: 'work', agent_name: 'Invalid' },
      { prompt: 'work', agent_name: 'missing' },
      {
        prompt: 'work',
        permission_mode: 'auto',
        dangerously_skip_permissions: true,
      },
      { prompt: 'work', effort: 'impossible' },
      { prompt: 'work', setting_sources: ['impossible'] },
    ]) {
      await expect(
        missing.execute(context(root, config))
      ).resolves.toMatchObject({ status: 'failed' });
    }

    const successArtifact = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'session',
        model: 'claude-model',
        tools: ['Read'],
        agents: ['agent'],
        skills: ['skill'],
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'done' },
            {
              type: 'tool_use',
              id: 'tool',
              name: 'Read',
              input: { file: 'a' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool',
              content: 'result',
            },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');

    const scenarios: Array<{
      artifact: string;
      process: Partial<CliProcessResult>;
      config?: Record<string, unknown>;
      status: 'success' | 'failed' | 'timeout';
    }> = [
      {
        artifact: successArtifact,
        process: {
          exitCode: null,
          stdoutTruncated: true,
          stdoutArtifactTruncated: true,
          stderrTruncated: true,
          stderrArtifactTruncated: true,
        },
        status: 'failed',
      },
      {
        artifact: successArtifact,
        process: {
          stdoutTruncated: true,
        },
        status: 'success',
      },
      {
        artifact: successArtifact,
        process: {
          stdoutArtifactTruncated: true,
        },
        status: 'failed',
      },
      {
        artifact: successArtifact,
        process: { timedOut: true },
        status: 'timeout',
      },
      {
        artifact: successArtifact,
        process: {
          error: Object.assign(new Error('process error'), { stack: '' }),
        },
        status: 'failed',
      },
      {
        artifact: successArtifact,
        process: {
          error: new Error('process error with stack'),
        },
        status: 'failed',
      },
      {
        artifact: successArtifact,
        process: { exitCode: 2, stderr: 'permission denied' },
        status: 'failed',
      },
      {
        artifact: '{"type":"result"',
        process: {},
        status: 'failed',
      },
      {
        artifact: JSON.stringify({ type: 'system', subtype: 'init' }),
        process: {},
        status: 'failed',
      },
      {
        artifact: JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'terminal failure',
        }),
        process: {},
        status: 'failed',
      },
      {
        artifact: JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
        }),
        process: {},
        config: { max_output_bytes: 1 },
        status: 'failed',
      },
      {
        artifact:
          `${JSON.stringify({ type: 'error', message: 'structured one' })}\n` +
          successArtifact,
        process: {},
        status: 'failed',
      },
      {
        artifact:
          `${JSON.stringify({ type: 'error', message: 'one' })}\n` +
          `${JSON.stringify({ type: 'error', message: 'two' })}\n` +
          successArtifact,
        process: {},
        config: { max_output_bytes: 1 },
        status: 'failed',
      },
      {
        artifact:
          `${JSON.stringify({ type: 'error', message: 'one' })}\n` +
          successArtifact,
        process: {},
        config: { max_output_bytes: 1 },
        status: 'failed',
      },
      {
        artifact: [
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'done' }],
              usage: { cache_creation_input_tokens: 2 },
            },
          }),
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'done',
          }),
        ].join('\n'),
        process: {},
        status: 'success',
      },
      {
        artifact: [
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'done' }],
              usage: { cache_read_input_tokens: 3 },
            },
          }),
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'done',
          }),
        ].join('\n'),
        process: {},
        status: 'success',
      },
      {
        artifact: successArtifact,
        process: {},
        status: 'success',
      },
    ];

    for (const scenario of scenarios) {
      const adapter = new ClaudeCodeAdapter({
        resolveExecutable: async () => executable,
        runProcess: async (options: CliProcessOptions) => {
          await fs.writeFile(options.stdoutArtifactPath, scenario.artifact);
          return result(scenario.process);
        },
      });
      await expect(
        adapter.execute(
          context(root, {
            prompt: 'work',
            model: 'model',
            ...(scenario.config ?? {}),
          })
        )
      ).resolves.toMatchObject({ status: scenario.status });
    }

    const zeroTimeout = new ClaudeCodeAdapter({
      resolveExecutable: async () => executable,
      runProcess: async (options: CliProcessOptions) => {
        await fs.writeFile(options.stdoutArtifactPath, successArtifact);
        return result();
      },
    });
    const zeroContext = context(root, { prompt: 'work' });
    zeroContext.timeout = 0;
    await zeroTimeout.execute(zeroContext);

    const promptFile = path.join(root, 'prompt.md');
    await fs.writeFile(promptFile, 'prompt from file');
    const promptFileAdapter = new ClaudeCodeAdapter({
      resolveExecutable: async () => executable,
      runProcess: async (options: CliProcessOptions) => {
        await fs.writeFile(options.stdoutArtifactPath, successArtifact);
        return result();
      },
    });
    await promptFileAdapter.execute(
      context(root, {
        prompt_file: 'prompt.md',
        system_prompt: 'system',
        append_system_prompt: 'append',
        permission_mode: 'auto',
      })
    );
    await promptFileAdapter.execute(
      context(root, {
        prompt: 'work',
        dangerously_skip_permissions: false,
      })
    );
    await fs.mkdir(path.join(root, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.claude', 'agents', 'worker.md'),
      'worker'
    );
    Object.assign(promptFileAdapter, {
      cliVersion: '2.1.216',
      cliCapabilities: {
        permissionModes: new Set(['auto']),
        effortLevels: new Set(['high']),
      },
    });
    await promptFileAdapter.execute(
      context(root, {
        prompt: 'work',
        agent_name: 'worker',
        permission_mode: 'auto',
        tools: ['Read'],
        allowed_tools: ['Write'],
        disallowed_tools: ['Bash'],
        max_turns: 2,
        max_budget_usd: 1,
        effort: 'high',
        fallback_model: 'fallback',
        setting_sources: ['user', 'project', 'local'],
      })
    );
    Object.assign(promptFileAdapter, {
      cliVersion: undefined,
      cliCapabilities: undefined,
    });
    await promptFileAdapter.execute(
      context(root, { prompt: 'work', max_budget_usd: 1 })
    );

    const nonError = new ClaudeCodeAdapter({
      resolveExecutable: async () => {
        throw 'resolution failed';
      },
    });
    await expect(
      nonError.execute(context(root, { prompt: 'work' }))
    ).resolves.toMatchObject({ output: 'resolution failed' });

    const adapter = new ClaudeCodeAdapter();
    const startedAt = '2026-01-01T00:00:00.000Z';
    const completedAt = '2026-01-01T00:00:01.000Z';
    const normalized = adapter.normalizeLog(successArtifact, {
      exitCode: 0,
      status: 'success',
      output: 'done',
      startedAt,
      completedAt,
      durationMs: 1000,
      errors: [],
    });
    expect(normalized.messages.some((message) => message.role === 'tool')).toBe(
      true
    );

    const cacheLog = adapter.normalizeLog(
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                input: {},
              },
            ],
            usage: {
              cache_creation_input_tokens: 2,
              cache_read_input_tokens: 3,
            },
          },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'final',
        }),
      ].join('\n'),
      {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
      }
    );
    expect(cacheLog.usage.cached_prompt_tokens).toBe(5);
    expect(cacheLog.messages[1]?.tool_calls?.[0]?.id).toContain('claude_tool');
    expect(cacheLog.messages[1]?.tool_calls?.[0]?.function.name).toBe(
      'unknown'
    );

    for (const usage of [
      { cache_creation_input_tokens: 2 },
      { cache_read_input_tokens: 3 },
    ]) {
      const oneSidedCacheLog = adapter.normalizeLog(
        [
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'cached' }],
              usage,
            },
          }),
          JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'cached',
          }),
        ].join('\n'),
        {
          exitCode: 0,
          status: 'success',
          output: '',
          startedAt,
          completedAt,
          durationMs: 1000,
          errors: [],
        }
      );
      expect(oneSidedCacheLog.usage.cached_prompt_tokens).toBeGreaterThan(0);
      expect(oneSidedCacheLog.messages[1]?.tool_calls).toBeUndefined();
    }

    const toolOnlyLog = adapter.normalizeLog(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: {} }],
        },
      }),
      {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
      }
    );
    expect(toolOnlyLog.messages[1]?.content).toBe('Claude Code invoked tools');

    const finalOnlyToolLog = adapter.normalizeLog(
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tool', name: 'Read', input: {} },
            ],
          },
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'terminal only',
        }),
      ].join('\n'),
      {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
      }
    );
    expect(finalOnlyToolLog.messages[1]?.content).toBe('terminal only');

    const capabilityAdapter = new ClaudeCodeAdapter();
    Object.assign(capabilityAdapter, {
      cliCapabilities: { permissionModes: new Set(['auto']) },
      cliVersion: undefined,
    });
    await expect(
      capabilityAdapter.execute(
        context(root, { prompt: 'work', permission_mode: 'manual' })
      )
    ).resolves.toMatchObject({
      output: expect.stringContaining('installed version'),
    });

    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'key';
    try {
      let probe = 0;
      const availability = new ClaudeCodeAdapter({
        resolveExecutable: async () => executable,
        runProcess: async () => {
          probe += 1;
          if (probe === 1) return result({ stdout: 'claude 1.2.3' });
          if (probe === 2) return result({ stdout: '--help' });
          return result({ stdout: '{"loggedIn":false}' });
        },
      });
      await expect(availability.checkAvailability()).resolves.toBe(true);
    } finally {
      if (previousAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropic;
      }
      if (previousOauth === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauth;
      }
    }

    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth';
    try {
      let probe = 0;
      const authenticated = new ClaudeCodeAdapter({
        resolveExecutable: async () => executable,
        runProcess: async () => {
          probe += 1;
          if (probe === 1) return result({ stdout: 'claude 1.2.3' });
          if (probe === 2) return result({ stdout: '--help' });
          return result({ stdout: '{"loggedIn":false}' });
        },
      });
      await expect(authenticated.checkAvailability()).resolves.toBe(true);
    } finally {
      if (previousAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropic;
      }
      if (previousOauth === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauth;
      }
    }

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      let probe = 0;
      const persistedAuthentication = new ClaudeCodeAdapter({
        resolveExecutable: async () => executable,
        runProcess: async () => {
          probe += 1;
          if (probe === 1) return result({ stdout: 'claude 1.2.3' });
          if (probe === 2) return result({ stdout: '--help' });
          return result({ stdout: '{"loggedIn":true}' });
        },
      });
      await expect(persistedAuthentication.checkAvailability()).resolves.toBe(
        true
      );
    } finally {
      if (previousAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousAnthropic;
      }
      if (previousOauth === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauth;
      }
    }

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const fallback = adapter.normalizeLog('', {
        exitCode: 0,
        status: 'success',
        output: '',
        startedAt,
        completedAt,
        durationMs: 1000,
        errors: [],
      });
      expect(fallback.environment.youbencha_version).toBe('1.0.0');
      await fs.writeFile(path.join(root, 'package.json'), '{}');
      expect(
        adapter.normalizeLog('', {
          exitCode: 0,
          status: 'success',
          output: '',
          startedAt,
          completedAt,
          durationMs: 1000,
          errors: [],
        }).environment.youbencha_version
      ).toBe('1.0.0');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
