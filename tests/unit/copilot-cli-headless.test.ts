import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCopilotCommand,
  CopilotCLIAdapter,
} from '../../src/adapters/copilot-cli.js';
import type { AgentExecutionContext } from '../../src/adapters/base.js';
import type {
  CliProcessRequest,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';
import { copilotCliConfigSchema } from '../../src/schemas/agent-config/copilot-cli.js';

const workspaceDir = path.join('workspaces', 'project with spaces');
const context: AgentExecutionContext = {
  workspaceDir,
  repoDir: path.join(workspaceDir, 'src-modified'),
  artifactsDir: path.join(workspaceDir, 'artifacts'),
  config: {
    prompt: "Fix the parser without asking questions. Don't rewrite history.",
    model: 'gpt-5.4',
    agent_name: 'reviewer',
    reasoning_effort: 'high',
    max_ai_credits: 3,
  },
  timeout: 30_000,
  env: {},
};

const executable: ResolvedExecutable = {
  path: 'C:\\npm\\copilot.cmd',
  kind: 'cmd',
};

describe('Copilot headless command', () => {
  it('uses a direct argument array with deterministic headless flags', () => {
    const built = buildCopilotCommand(context);

    expect(built.command).toBe('copilot');
    expect(built.args).toEqual([
      '--prompt',
      context.config.prompt,
      '--output-format',
      'json',
      '--no-ask-user',
      '--no-color',
      '--no-remote',
      '--no-remote-export',
      '-C',
      workspaceDir,
      '--model',
      'gpt-5.4',
      '--agent',
      'reviewer',
      '--reasoning-effort',
      'high',
      '--max-ai-credits',
      '3',
      '--allow-all-tools',
      '--allow-all-paths',
      '--log-dir',
      path.join(workspaceDir, 'artifacts', 'copilot-logs'),
    ]);
    expect(built.args.join(' ')).not.toContain('powershell');
    expect(built.effectiveConfig).toMatchObject({
      ask_user: false,
      remote: false,
      remote_export: false,
      allow_all_tools: true,
      allow_all_paths: true,
    });
  });

  it('does not enable all logging by default', () => {
    const built = buildCopilotCommand({
      ...context,
      config: { prompt: 'test' },
    });

    expect(built.args).not.toContain('--log-level');
    expect(built.args).not.toContain('all');
  });

  it('supports explicit log and permission configuration', () => {
    const built = buildCopilotCommand({
      ...context,
      config: {
        prompt: 'test',
        log_level: 'warning',
        allow_all_tools: false,
        allow_all_paths: false,
      },
    });

    expect(built.args).toContain('--log-level');
    expect(built.args).toContain('warning');
    expect(built.args).not.toContain('--allow-all-tools');
    expect(built.args).not.toContain('--allow-all-paths');
    expect(built.effectiveConfig).toMatchObject({
      log_level: 'warning',
      allow_all_tools: false,
      allow_all_paths: false,
    });
  });

  it('supports the current default log level', () => {
    const config = copilotCliConfigSchema.parse({
      prompt: 'test',
      log_level: 'default',
    });
    const built = buildCopilotCommand({ ...context, config });

    expect(built.args).toEqual(
      expect.arrayContaining(['--log-level', 'default'])
    );
    expect(built.effectiveConfig).toMatchObject({ log_level: 'default' });
  });

  it('requests text only for explicit legacy compatibility', () => {
    const built = buildCopilotCommand({
      ...context,
      config: { prompt: 'test', legacy_text_output: true },
    });

    expect(built.args).toEqual(
      expect.arrayContaining(['--output-format', 'text'])
    );
    expect(built.effectiveConfig).toMatchObject({
      output_format: 'text',
      legacy_text_output: true,
    });
  });

  it('rejects invalid resource and logging values', () => {
    expect(() =>
      buildCopilotCommand({
        ...context,
        config: { prompt: 'test', max_ai_credits: -1 },
      })
    ).toThrow('max_ai_credits must be a non-negative integer');
    expect(() =>
      buildCopilotCommand({
        ...context,
        config: { prompt: 'test', log_level: 'everything' },
      })
    ).toThrow('log_level must be one of');
  });
});

describe('Copilot adapter process integration', () => {
  it('probes the resolved executable without checking authentication', async () => {
    const requests: CliProcessRequest[] = [];
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        requests.push(request);
        return processResult({
          stdout: 'GitHub Copilot CLI 1.0.75.',
          exitCode: 0,
        });
      },
    });

    await expect(adapter.checkAvailability()).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].args).toEqual(['--version']);
  });

  it('returns only the final response and preserves structured telemetry', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-headless-')
    );
    let capturedRequest: CliProcessRequest | undefined;
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        capturedRequest = request;
        const lines = [
          jsonEvent('session.start', {
            sessionId: 'session-1',
            copilotVersion: '1.0.75',
            selectedModel: 'gpt-5.4',
          }),
          jsonEvent('assistant.message', {
            messageId: 'message-1',
            content: 'Finished successfully.',
          }),
          jsonEvent('tool.execution_complete', {
            toolCallId: 'tool-1',
            success: true,
            result: { content: 'x'.repeat(20_000) },
          }),
          jsonEvent('assistant.usage', {
            model: 'gpt-5.4',
            inputTokens: 10,
            outputTokens: 4,
          }),
          JSON.stringify({
            type: 'result',
            sessionId: 'session-1',
            exitCode: 0,
            usage: { premiumRequests: 1 },
          }),
        ].join('\n');
        await writeFile(request.stdoutArtifactPath, lines, 'utf8');
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({ stdout: lines, exitCode: 0 });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: { ...context.config, max_output_bytes: 128 },
      });

      expect(result.status).toBe('success');
      expect(result.output).toBe('Finished successfully.');
      expect(result.telemetry).toMatchObject({
        cliVersion: '1.0.75',
        model: 'gpt-5.4',
        sessionId: 'session-1',
        finalResponse: 'Finished successfully.',
        usage: {
          promptTokens: 10,
          completionTokens: 4,
          totalTokens: 14,
          source: 'measured',
        },
        headlessMode: true,
        structuredOutputFormat: 'jsonl',
      });
      expect(result.telemetry?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.stringContaining('retained content was truncated'),
        ])
      );
      expect(capturedRequest?.maxCapturedOutputBytes).toBe(128);
      expect(capturedRequest?.maxArtifactOutputBytes).toBe(64 * 1024 * 1024);
      expect(capturedRequest?.args).toContain('--no-ask-user');
      expect(capturedRequest?.args).toContain('-C');
      expect(result.telemetry?.eventsArtifactPath).toBeDefined();
      const rawArtifact = await readFile(
        result.telemetry?.eventsArtifactPath as string,
        'utf8'
      );
      expect(rawArtifact).toContain('x'.repeat(20_000));
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('fails when the durable event artifact reaches its safety limit', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-artifact-limit-')
    );
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        const lines = [
          jsonEvent('assistant.message', {
            messageId: 'message-1',
            content: 'Result before the quota boundary.',
          }),
          JSON.stringify({ type: 'result', exitCode: 0 }),
        ].join('\n');
        await writeFile(request.stdoutArtifactPath, lines, 'utf8');
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          stdout: lines,
          exitCode: 0,
          stdoutArtifactTruncated: true,
        });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
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
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('rejects arbitrary non-JSON output even when Copilot exits zero', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-non-json-')
    );
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await writeFile(
          request.stdoutArtifactPath,
          'unexpected plain output',
          'utf8'
        );
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          stdout: 'unexpected plain output',
          exitCode: 0,
        });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.telemetry?.legacyParserUsed).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('did not emit valid JSONL output'),
          }),
        ])
      );
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('fails on structured errors even when a tiny retention budget drops details', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-tiny-error-budget-')
    );
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        const lines = [
          jsonEvent('session.error', { message: 'x' }),
          jsonEvent('assistant.message', {
            messageId: 'message-1',
            content: 'x',
          }),
          JSON.stringify({ type: 'result', exitCode: 0 }),
        ].join('\n');
        await writeFile(request.stdoutArtifactPath, lines, 'utf8');
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({ stdout: lines, exitCode: 0 });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: { ...context.config, max_output_bytes: 1 },
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.telemetry?.finalResponse).toBe('x');
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('1 structured error event'),
          }),
        ])
      );
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('accepts plain text only when legacy compatibility is explicit', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-legacy-text-')
    );
    let requestArgs: string[] = [];
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        requestArgs = request.args;
        await writeFile(request.stdoutArtifactPath, 'legacy response', 'utf8');
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({ stdout: 'legacy response', exitCode: 0 });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        config: {
          ...context.config,
          legacy_text_output: true,
        },
      });

      expect(result.status).toBe('success');
      expect(result.output).toBe('legacy response');
      expect(result.telemetry).toMatchObject({
        legacyParserUsed: true,
        structuredOutputFormat: 'text',
      });
      expect(requestArgs).toEqual(
        expect.arrayContaining(['--output-format', 'text'])
      );
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  });

  it('redacts secret environment values from process errors', async () => {
    const testDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-redaction-')
    );
    const secret = 'copilot-secret-value';
    const adapter = new CopilotCLIAdapter({
      resolveExecutable: async (): Promise<ResolvedExecutable> => executable,
      runProcess: async (request): Promise<CliProcessResult> => {
        await writeFile(request.stdoutArtifactPath, '', 'utf8');
        await writeFile(request.stderrArtifactPath, '', 'utf8');
        return processResult({
          error: new Error(`spawn failed with ${secret}`),
        });
      },
    });

    try {
      const result = await adapter.execute({
        ...context,
        workspaceDir: testDirectory,
        artifactsDir: path.join(testDirectory, 'artifacts'),
        env: { COPILOT_GITHUB_TOKEN: secret },
      });

      expect(result.status).toBe('failed');
      expect(JSON.stringify(result.errors)).not.toContain(secret);
      expect(JSON.stringify(result.errors)).toContain('[REDACTED]');
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
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

function jsonEvent(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    id: `${type}-id`,
    timestamp: '2026-07-25T12:00:00.000Z',
    parentId: null,
    type,
    data,
  });
}
