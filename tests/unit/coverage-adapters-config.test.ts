import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AgentExecutionContext } from '../../src/adapters/base.js';
import {
  buildCodexCommand,
  CodexCLIAdapter,
} from '../../src/adapters/codex-cli.js';
import {
  buildCopilotCommand,
  CopilotCLIAdapter,
} from '../../src/adapters/copilot-cli.js';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import type {
  CliProcessRequest,
  CliProcessResult,
  ResolvedExecutable,
} from '../../src/lib/cli-process.js';

interface ClaudePrivate {
  buildClaudeArgs(context: AgentExecutionContext): string[];
  capabilityDiagnostics(config: Record<string, unknown>): string[];
}

function context(config: Record<string, unknown>): AgentExecutionContext {
  return {
    workspaceDir: process.cwd(),
    repoDir: process.cwd(),
    artifactsDir: path.join(process.cwd(), 'artifacts'),
    config,
    timeout: 1000,
    env: {},
  };
}

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

describe('adapter configuration edge coverage', () => {
  test('Codex command validates every typed option and false branch', () => {
    const minimal = buildCodexCommand(
      context({
        prompt: 'test',
        ephemeral: false,
        ignore_user_config: false,
        ignore_rules: false,
        search: false,
      })
    );
    expect(minimal.args).not.toContain('--ephemeral');
    expect(minimal.args).not.toContain('--ignore-user-config');
    expect(minimal.args).not.toContain('--ignore-rules');
    expect(minimal.args).not.toContain('--search');

    for (const [key, value] of [
      ['sandbox', 1],
      ['approval_policy', false],
      ['model', ''],
      ['profile', 1],
      ['reasoning_effort', 'extreme'],
      ['ephemeral', 'yes'],
      ['ignore_user_config', 1],
      ['ignore_rules', null],
      ['search', []],
    ] as const) {
      expect(() =>
        buildCodexCommand(context({ prompt: 'test', [key]: value }))
      ).toThrow();
    }
  });

  test('Copilot command validates optional values and timeout boundaries', () => {
    for (const [key, value] of [
      ['prompt', 1],
      ['model', ''],
      ['agent_name', 1],
      ['reasoning_effort', false],
      ['max_ai_credits', 1.5],
      ['allow_all_tools', 'yes'],
      ['allow_all_paths', []],
      ['legacy_text_output', 1],
    ] as const) {
      expect(() =>
        buildCopilotCommand(context({ prompt: 'test', [key]: value }))
      ).toThrow();
    }
  });

  test('Claude command rejects malformed documented option types', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-claude-config-'));
    const adapter = new ClaudeCodeAdapter() as unknown as ClaudePrivate;
    const build = (config: Record<string, unknown>): string[] =>
      adapter.buildClaudeArgs({
        ...context(config),
        workspaceDir: root,
        repoDir: root,
        artifactsDir: path.join(root, 'artifacts'),
      });
    try {
      for (const [key, value] of [
        ['agent_name', 1],
        ['permission_mode', 1],
        ['permission_mode', 'invalid'],
        ['dangerously_skip_permissions', 'yes'],
        ['tools', 'Read'],
        ['tools', ['Read', 1]],
        ['allowed_tools', [1]],
        ['disallowed_tools', ['']],
        ['max_turns', 1.5],
        ['max_budget_usd', 0],
        ['fallback_model', ''],
        ['fallback_model', 1],
        ['setting_sources', 'project'],
      ] as const) {
        expect(() => build({ prompt: 'test', [key]: value })).toThrow();
      }
      expect(
        adapter.capabilityDiagnostics({
          max_budget_usd: 1,
          permission_mode: 'manual',
        })
      ).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('availability probes cover missing binaries and failed subprocesses', async () => {
    const missingCodex = new CodexCLIAdapter({
      resolveExecutable: async () => undefined,
    });
    await expect(missingCodex.checkAvailability()).resolves.toBe(false);

    const executable: ResolvedExecutable = {
      path: path.join(process.cwd(), 'fake-cli'),
      kind: 'native',
    };
    const failedClaude = new ClaudeCodeAdapter({
      resolveExecutable: async () => executable,
      runProcess: async () => processResult({ exitCode: 1 }),
    });
    await expect(failedClaude.checkAvailability()).resolves.toBe(false);

    const throwingClaude = new ClaudeCodeAdapter({
      resolveExecutable: async () => executable,
      runProcess: async () => {
        throw new Error('probe failed');
      },
    });
    await expect(throwingClaude.checkAvailability()).resolves.toBe(false);

    const failedCopilot = new CopilotCLIAdapter({
      resolveExecutable: async () => executable,
      runProcess: async (_request: CliProcessRequest) =>
        processResult({ timedOut: true }),
    });
    await expect(failedCopilot.checkAvailability()).resolves.toBe(false);
  });
});
