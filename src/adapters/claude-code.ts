/**
 * Claude Code Adapter
 *
 * Integrates Claude Code CLI as an agent for youBencha evaluations.
 * Handles execution, output capture, and log normalization.
 */

import { createReadStream, readFileSync, existsSync } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createInterface } from 'node:readline';
import {
  AgentAdapter,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentExecutionTelemetry,
  normalizeExecutionProvenance,
} from './base.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import { stripAnsiCodes, isPathSafe } from '../lib/shell-utils.js';
import * as logger from '../lib/logger.js';
import {
  ClaudeStreamParser,
  ClaudeStreamParseResult,
  parseClaudeStream,
} from './claude-code-events.js';
import {
  CliProcessResult,
  ResolvedExecutable,
  resolveCliExecutable,
  runCliProcess,
} from '../lib/cli-process.js';

// Maximum output size in bytes (10MB)
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;
const MAX_ARTIFACT_OUTPUT_BYTES = 64 * 1024 * 1024;
const CLAUDE_AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CLAUDE_PERMISSION_MODES = new Set([
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan',
]);
const CLAUDE_EFFORT_LEVELS = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
]);
const CLAUDE_SETTING_SOURCES = new Set(['user', 'project', 'local']);

type ResolveExecutable = typeof resolveCliExecutable;
type RunProcess = typeof runCliProcess;

export interface ClaudeCodeAdapterDependencies {
  resolveExecutable?: ResolveExecutable;
  runProcess?: RunProcess;
}

interface ClaudeCliCapabilities {
  permissionModes: Set<string>;
  effortLevels: Set<string>;
}

function quotedChoices(value: string): Set<string> {
  return new Set([...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

function parseClaudeCapabilities(helpOutput: string): ClaudeCliCapabilities {
  const permissionSection = helpOutput.match(
    /--permission-mode[\s\S]{0,400}?\(choices:\s*([^)]+)\)/
  )?.[1];
  const effortSection = helpOutput.match(
    /--effort[\s\S]{0,250}?\((low,\s*medium[^)]+)\)/
  )?.[1];

  return {
    permissionModes: permissionSection
      ? quotedChoices(permissionSection)
      : new Set(),
    effortLevels: new Set(
      effortSection ? effortSection.split(',').map((value) => value.trim()) : []
    ),
  };
}

function optionalStringList(
  config: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(
      `Claude Code "${key}" must be an array of non-empty strings`
    );
  }
  return value as string[];
}

function positiveNumber(
  config: Record<string, unknown>,
  key: string,
  integer: boolean
): number | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `Claude Code "${key}" must be a positive${integer ? ' integer' : ''}`
    );
  }
  return value;
}

function serializeClaudeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function parseClaudeEventArtifact(
  artifactPath: string,
  maxRetainedBytes: number
): Promise<ClaudeStreamParseResult> {
  const parser = new ClaudeStreamParser({
    retainEvents: false,
    maxRetainedBytes,
  });
  const lines = createInterface({
    input: createReadStream(artifactPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    parser.acceptLine(line);
  }
  return parser.finish();
}

function detectClaudeVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/)?.[1];
}

function isVersionBefore(version: string, requiredVersion: string): boolean {
  const parse = (value: string): number[] =>
    value
      .split('-', 1)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10));
  const current = parse(version);
  const required = parse(requiredVersion);
  for (let index = 0; index < 3; index += 1) {
    if ((current[index] ?? 0) !== (required[index] ?? 0)) {
      return (current[index] ?? 0) < (required[index] ?? 0);
    }
  }
  return false;
}

function parseClaudeAuthentication(output: string): boolean {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        value.loggedIn === true ||
        value.authenticated === true ||
        value.status === 'authenticated'
      ) {
        return true;
      }
    } catch {
      // A non-JSON diagnostic line does not override a valid later result.
    }
  }
  return false;
}

function maxOutputBytes(config: Record<string, unknown>): number {
  const value = config.max_output_bytes;
  if (value === undefined) {
    return MAX_OUTPUT_SIZE;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      'Claude Code "max_output_bytes" must be a positive integer'
    );
  }
  return value;
}

function stderrPreview(result: CliProcessResult): string {
  const error = classifyClaudeError(result.stderr);
  return error ? `: ${error}` : '';
}

function classifyClaudeError(stderr: string): string | undefined {
  if (/auth|log[ -]?in|api key|oauth/i.test(stderr)) {
    return 'authentication failed; run "claude auth status --json" and configure ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN for headless use';
  }
  if (/permission|denied|not allowed/i.test(stderr)) {
    return 'a required action was denied by the configured permission policy';
  }
  if (/budget|max[_ -]?budget|spend/i.test(stderr)) {
    return 'the configured Claude budget was exhausted';
  }
  return undefined;
}

function redactHome(executablePath: string): string {
  const home = os.homedir();
  const relative = path.relative(home, executablePath);
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return path.join('<home>', relative);
  }
  return executablePath;
}

function redactSecretValues(
  value: string,
  environment: NodeJS.ProcessEnv
): string {
  let redacted = value;
  for (const [key, secret] of Object.entries(environment)) {
    if (
      secret &&
      secret.length >= 4 &&
      /(token|secret|password|api[_-]?key|authorization)/i.test(key)
    ) {
      redacted = redacted.split(secret).join('[REDACTED]');
    }
  }
  return redacted;
}

/** Pure adapter helpers exposed for deterministic conformance tests. */
export const claudeCodeTesting = {
  quotedChoices,
  parseClaudeCapabilities,
  optionalStringList,
  positiveNumber,
  serializeClaudeValue,
  parseClaudeEventArtifact,
  detectClaudeVersion,
  isVersionBefore,
  parseClaudeAuthentication,
  maxOutputBytes,
  stderrPreview,
  classifyClaudeError,
  redactHome,
  redactSecretValues,
};

/**
 * Claude Code adapter implementation
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly version = '2.0.0';

  private readonly resolveExecutable: ResolveExecutable;
  private readonly runProcess: RunProcess;
  private executable: ResolvedExecutable | undefined;
  private cliVersion: string | undefined;
  private cliCapabilities: ClaudeCliCapabilities | undefined;

  constructor(dependencies: ClaudeCodeAdapterDependencies = {}) {
    this.resolveExecutable =
      dependencies.resolveExecutable ?? resolveCliExecutable;
    this.runProcess = dependencies.runProcess ?? runCliProcess;
  }

  /**
   * Check if Claude Code CLI is available and authenticated
   */
  async checkAvailability(): Promise<boolean> {
    const executable = await this.resolveExecutable('claude', {
      env: process.env,
    });
    if (!executable) {
      return false;
    }

    const probeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-claude-probe-')
    );
    try {
      const versionResult = await this.runProcess({
        executable,
        args: ['--version'],
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: VERSION_PROBE_TIMEOUT_MS,
        maxCapturedOutputBytes: 16 * 1024,
        stdoutArtifactPath: path.join(probeDir, 'version-stdout.log'),
        stderrArtifactPath: path.join(probeDir, 'version-stderr.log'),
      });
      if (
        versionResult.error ||
        versionResult.timedOut ||
        versionResult.exitCode !== 0
      ) {
        return false;
      }

      this.executable = executable;
      this.cliVersion = detectClaudeVersion(
        `${versionResult.stdout}\n${versionResult.stderr}`
      );

      const helpResult = await this.runProcess({
        executable,
        args: ['--help'],
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: VERSION_PROBE_TIMEOUT_MS,
        maxCapturedOutputBytes: 64 * 1024,
        stdoutArtifactPath: path.join(probeDir, 'help-stdout.log'),
        stderrArtifactPath: path.join(probeDir, 'help-stderr.log'),
      });
      if (
        !helpResult.error &&
        !helpResult.timedOut &&
        helpResult.exitCode === 0
      ) {
        this.cliCapabilities = parseClaudeCapabilities(
          `${helpResult.stdout}\n${helpResult.stderr}`
        );
      }

      const authResult = await this.runProcess({
        executable,
        args: ['auth', 'status', '--json'],
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: VERSION_PROBE_TIMEOUT_MS,
        maxCapturedOutputBytes: 16 * 1024,
        stdoutArtifactPath: path.join(probeDir, 'auth-stdout.log'),
        stderrArtifactPath: path.join(probeDir, 'auth-stderr.log'),
      });
      if (
        !authResult.error &&
        !authResult.timedOut &&
        authResult.exitCode === 0 &&
        parseClaudeAuthentication(`${authResult.stdout}\n${authResult.stderr}`)
      ) {
        return true;
      }

      return Boolean(
        process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
      );
    } catch {
      return false;
    } finally {
      await fs.rm(probeDir, { recursive: true, force: true });
    }
  }

  /**
   * Execute Claude Code CLI with given context
   */
  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    let output = '';
    let exitCode = 1;
    let status: AgentExecutionResult['status'] = 'failed';
    let telemetry: AgentExecutionTelemetry | undefined;
    const errors: AgentExecutionResult['errors'] = [];

    try {
      const claudeLogsDir = path.join(context.artifactsDir, 'claude-code-logs');
      await fs.mkdir(claudeLogsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const eventsArtifactPath = path.join(
        claudeLogsDir,
        `events-${timestamp}.jsonl`
      );
      const stderrArtifactPath = path.join(
        claudeLogsDir,
        `stderr-${timestamp}.log`
      );

      const builtCommand = this.buildClaudeCommand(context);
      const environment = { ...process.env, ...context.env };
      const executable =
        this.executable ??
        (await this.resolveExecutable(builtCommand.command, {
          env: environment,
        }));
      if (!executable) {
        throw new Error(
          'Claude Code CLI is not installed or is not available on PATH.'
        );
      }

      logger.debug(
        `Claude Code CLI executable: ${redactHome(executable.path)}`
      );
      logger.debug(`Claude Code working directory: ${context.workspaceDir}`);
      logger.debug(
        `Claude Code prompt length: ${(context.config.prompt as string)?.length || 0} chars`
      );
      logger.debug(`Claude Code event log: ${eventsArtifactPath}`);

      const retainedOutputLimit = maxOutputBytes(context.config);
      const processResult = await this.runProcess({
        executable,
        args: builtCommand.args,
        cwd: context.workspaceDir,
        env: environment,
        timeoutMs: context.timeout > 0 ? context.timeout : MAX_NODE_TIMEOUT_MS,
        maxCapturedOutputBytes: retainedOutputLimit,
        maxArtifactOutputBytes: MAX_ARTIFACT_OUTPUT_BYTES,
        stdoutArtifactPath: eventsArtifactPath,
        stderrArtifactPath,
      });
      const stream = await parseClaudeEventArtifact(
        eventsArtifactPath,
        retainedOutputLimit
      );
      output = stream.finalResponse ?? '';
      exitCode = processResult.exitCode ?? 1;
      const cachedPromptTokens =
        stream.usage.cacheCreationInputTokens !== undefined ||
        stream.usage.cacheReadInputTokens !== undefined
          ? (stream.usage.cacheCreationInputTokens ?? 0) +
            (stream.usage.cacheReadInputTokens ?? 0)
          : undefined;
      telemetry = {
        cliVersion: stream.init?.claudeCodeVersion ?? this.cliVersion,
        model: stream.model,
        provider: 'Anthropic',
        sessionId: stream.sessionId,
        finalResponse: stream.finalResponse,
        usage: {
          promptTokens: stream.usage.inputTokens,
          cachedPromptTokens,
          completionTokens: stream.usage.outputTokens,
          totalTokens: stream.usage.totalTokens,
          costUsd: stream.usage.costUsd,
          source: stream.usage.source,
        },
        messages: this.parseMessages(stream, '', {
          exitCode,
          status: 'success',
          output,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - new Date(startedAt).getTime(),
          errors: [],
        }),
        eventsArtifactPath,
        resolvedExecutable: redactHome(executable.path),
        configuredModel:
          typeof context.config.model === 'string'
            ? context.config.model
            : undefined,
        headlessMode: true,
        sessionPersistence: false,
        structuredOutputFormat: 'stream-json',
        legacyParserUsed: false,
        effectiveConfig: {
          permission_mode:
            context.config.permission_mode ??
            (context.config.dangerously_skip_permissions === false
              ? 'dontAsk'
              : 'bypassPermissions'),
          max_turns: context.config.max_turns,
          max_budget_usd: context.config.max_budget_usd,
          effort: context.config.effort,
          fallback_model: context.config.fallback_model,
          setting_sources: context.config.setting_sources,
          tools: context.config.tools,
          allowed_tools: context.config.allowed_tools,
          disallowed_tools: context.config.disallowed_tools,
          max_output_bytes: retainedOutputLimit,
          max_artifact_output_bytes: MAX_ARTIFACT_OUTPUT_BYTES,
          timeout_ms: context.timeout,
        },
        diagnostics: [
          ...stream.diagnostics,
          ...this.capabilityDiagnostics(context.config),
          ...(processResult.stdoutTruncated
            ? [
                processResult.stdoutArtifactTruncated
                  ? 'Captured stdout preview and the quota-bounded event artifact were truncated.'
                  : 'Captured stdout preview was truncated; the event artifact was parsed.',
              ]
            : []),
          ...(processResult.stderrTruncated
            ? ['Captured stderr preview was truncated.']
            : []),
          ...(processResult.stdoutArtifactTruncated
            ? [
                `Claude event artifact reached its ${MAX_ARTIFACT_OUTPUT_BYTES}-byte limit and is incomplete.`,
              ]
            : []),
          ...(processResult.stderrArtifactTruncated
            ? [
                `Claude stderr artifact reached its ${MAX_ARTIFACT_OUTPUT_BYTES}-byte limit and is incomplete.`,
              ]
            : []),
        ],
      };

      if (processResult.error) {
        errors.push({
          message: redactSecretValues(processResult.error.message, environment),
          timestamp: new Date().toISOString(),
          stackTrace: processResult.error.stack
            ? redactSecretValues(processResult.error.stack, environment)
            : undefined,
        });
      }

      if (processResult.timedOut) {
        status = 'timeout';
        errors.push({
          message: `Execution timed out after ${context.timeout}ms`,
          timestamp: new Date().toISOString(),
        });
      } else if (processResult.error) {
        status = 'failed';
        exitCode = 1;
      } else if (exitCode !== 0) {
        status = 'failed';
        errors.push({
          message: `Claude Code exited with code ${exitCode}${stderrPreview(processResult)}`,
          timestamp: new Date().toISOString(),
        });
      } else if (processResult.stdoutArtifactTruncated) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message: `Claude Code event artifact exceeded the ${MAX_ARTIFACT_OUTPUT_BYTES}-byte safety limit; the structured result is incomplete.`,
          timestamp: new Date().toISOString(),
        });
      } else if (stream.malformedTerminal || !stream.terminal) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message: stream.malformedTerminal
            ? 'Claude Code returned a malformed terminal result event'
            : 'Claude Code stream ended without a terminal result event',
          timestamp: new Date().toISOString(),
        });
      } else if (stream.terminal.isError) {
        status = 'failed';
        exitCode = 1;
        const terminalErrors =
          stream.errors.length > 0
            ? stream.errors
            : [
                `Claude Code failed with result subtype "${stream.terminal.subtype ?? 'unknown'}"`,
              ];
        for (const message of terminalErrors) {
          errors.push({
            message: redactSecretValues(message, environment),
            timestamp: new Date().toISOString(),
          });
        }
      } else if (stream.errorEventCount > 0) {
        status = 'failed';
        exitCode = 1;
        const structuredErrors =
          stream.errors.length > 0
            ? stream.errors
            : [
                `Claude Code reported ${stream.errorEventCount} structured error event${stream.errorEventCount === 1 ? '' : 's'}`,
              ];
        for (const message of structuredErrors) {
          errors.push({
            message: redactSecretValues(message, environment),
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        status = 'success';
      }

      output =
        stream.finalResponse ||
        processResult.stderr.trim() ||
        processResult.stdout.trim();
    } catch (error) {
      status = 'failed';
      exitCode = 1;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      errors.push({
        message: errorMessage,
        timestamp: new Date().toISOString(),
        stackTrace,
      });

      output = errorMessage;
    }

    const completedAt = new Date().toISOString();
    const durationMs =
      new Date(completedAt).getTime() - new Date(startedAt).getTime();

    return {
      exitCode,
      status,
      output,
      startedAt,
      completedAt,
      durationMs,
      errors,
      telemetry,
    };
  }

  /**
   * Transform Claude Code output to youBencha Log format
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    // Strip ANSI codes for parsing
    const cleanOutput = stripAnsiCodes(rawOutput);

    const stream = parseClaudeStream(cleanOutput);

    // Parse Claude output to extract messages and measured tool calls.
    const messages =
      result.telemetry?.messages ??
      this.parseMessages(stream, cleanOutput, result);

    // Build environment context
    const environment = {
      os: `${os.platform()}-${os.arch()}`,
      node_version: process.version,
      youbencha_version: this.getYouBenchaVersion(),
      working_directory: process.cwd(),
    };

    // Detect model and version from output
    const model =
      result.telemetry?.model ?? stream.model ?? this.parseModel(cleanOutput);
    const version =
      result.telemetry?.cliVersion ?? this.parseVersion(cleanOutput);
    const measuredUsage = result.telemetry?.usage;
    const streamUsage = stream.usage;

    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version: version,
        adapter_version: this.version,
      },
      model: {
        name: model,
        provider: 'Anthropic',
        parameters: result.telemetry?.effectiveConfig ?? {},
      },
      execution: {
        started_at: result.startedAt,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        exit_code: result.exitCode,
        status: result.status,
      },
      messages,
      usage: {
        prompt_tokens:
          measuredUsage?.promptTokens ?? streamUsage.inputTokens ?? 0,
        cached_prompt_tokens:
          measuredUsage?.cachedPromptTokens ??
          (streamUsage.cacheCreationInputTokens !== undefined ||
          streamUsage.cacheReadInputTokens !== undefined
            ? (streamUsage.cacheCreationInputTokens ?? 0) +
              (streamUsage.cacheReadInputTokens ?? 0)
            : undefined),
        completion_tokens:
          measuredUsage?.completionTokens ?? streamUsage.outputTokens ?? 0,
        reasoning_tokens: measuredUsage?.reasoningTokens,
        total_tokens:
          measuredUsage?.totalTokens ?? streamUsage.totalTokens ?? 0,
        cost_usd: measuredUsage?.costUsd ?? streamUsage.costUsd,
        measurement_source: measuredUsage?.source ?? streamUsage.source,
      },
      errors: result.errors.map((err) => ({
        message: err.message,
        timestamp: err.timestamp,
        stack_trace: err.stackTrace,
      })),
      environment,
      provenance: normalizeExecutionProvenance(result.telemetry, this.version),
    };
  }

  /**
   * Build Claude Code command with proper platform handling
   */
  private buildClaudeCommand(context: AgentExecutionContext): {
    command: 'claude';
    args: string[];
  } {
    return {
      command: 'claude',
      args: this.buildClaudeArgs(context),
    };
  }

  /**
   * Build the platform-independent Claude argument array.
   */
  private buildClaudeArgs(context: AgentExecutionContext): string[] {
    let prompt: string | undefined;

    // Handle prompt_file vs prompt
    const promptFile = context.config.prompt_file as string | undefined;
    const inlinePrompt = context.config.prompt as string | undefined;

    // Validate mutual exclusivity
    if (promptFile && inlinePrompt) {
      throw new Error(
        'Cannot specify both "prompt" and "prompt_file". Please use only one.'
      );
    }

    if (promptFile) {
      // Validate path safety
      if (!isPathSafe(promptFile)) {
        throw new Error(
          `Invalid prompt_file path "${promptFile}". Path must be relative and not contain path traversal.`
        );
      }

      // Resolve path relative to workspace
      const resolvedPath = path.resolve(context.workspaceDir, promptFile);

      // Check file exists
      if (!existsSync(resolvedPath)) {
        throw new Error(
          `Prompt file not found: ${promptFile}. Expected at ${resolvedPath}`
        );
      }

      // Read prompt content
      prompt = readFileSync(resolvedPath, 'utf-8');
    } else {
      prompt = inlinePrompt;
    }

    if (!prompt) {
      throw new Error(
        'One of "prompt" or "prompt_file" is required in agent config'
      );
    }

    if (
      context.config.max_tokens !== undefined ||
      context.config.temperature !== undefined
    ) {
      const unsupported = [
        context.config.max_tokens !== undefined ? '"max_tokens"' : undefined,
        context.config.temperature !== undefined ? '"temperature"' : undefined,
      ].filter((value): value is string => value !== undefined);
      throw new Error(
        `Unsupported Claude Code configuration: ${unsupported.join(
          ' and '
        )}. These are API parameters, not documented Claude Code CLI flags; use "max_turns" and/or "max_budget_usd" instead.`
      );
    }

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
    ];

    // Add model if specified
    const model = context.config.model as string | undefined;
    if (model) {
      args.push('--model', model);
    }

    const agentName = context.config.agent_name as string | undefined;
    if (agentName !== undefined) {
      if (
        typeof agentName !== 'string' ||
        !CLAUDE_AGENT_NAME_PATTERN.test(agentName)
      ) {
        throw new Error(
          'Claude Code "agent_name" must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (maximum 64 characters)'
        );
      }

      const agentPath = path.join(
        context.workspaceDir,
        '.claude',
        'agents',
        `${agentName}.md`
      );
      if (!existsSync(agentPath)) {
        throw new Error(
          `Claude Code agent "${agentName}" was not discovered at ${agentPath}`
        );
      }
      args.push('--agent', agentName);
    }

    // Add system_prompt if specified (replaces default system prompt)
    const systemPrompt = context.config.system_prompt as string | undefined;
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add append_system_prompt if specified
    const appendSystemPrompt = context.config.append_system_prompt as
      | string
      | undefined;
    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }

    const permissionMode = context.config.permission_mode as string | undefined;
    if (
      permissionMode !== undefined &&
      (typeof permissionMode !== 'string' ||
        !CLAUDE_PERMISSION_MODES.has(permissionMode))
    ) {
      throw new Error(
        `Unsupported Claude Code "permission_mode": ${String(
          permissionMode
        )}. Expected one of: ${[...CLAUDE_PERMISSION_MODES].join(', ')}`
      );
    }

    const dangerousSkip = context.config.dangerously_skip_permissions;
    if (dangerousSkip !== undefined && typeof dangerousSkip !== 'boolean') {
      throw new Error(
        'Claude Code "dangerously_skip_permissions" must be a boolean'
      );
    }
    if (permissionMode && dangerousSkip === true) {
      throw new Error(
        'Claude Code "permission_mode" cannot be combined with "dangerously_skip_permissions"'
      );
    }

    if (permissionMode) {
      this.assertAdvertisedCapability(
        'permission mode',
        permissionMode,
        this.cliCapabilities?.permissionModes
      );
      args.push('--permission-mode', permissionMode);
    } else if (dangerousSkip !== false) {
      // Preserve the adapter's established permission behavior while ensuring
      // an explicit permission mode never receives a contradictory bypass flag.
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'dontAsk');
    }

    const tools = optionalStringList(context.config, 'tools');
    if (tools && tools.length > 0) {
      args.push('--tools', tools.join(','));
    }

    const allowedTools = optionalStringList(context.config, 'allowed_tools');
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    const disallowedTools = optionalStringList(
      context.config,
      'disallowed_tools'
    );
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowedTools', disallowedTools.join(','));
    }

    const maxTurns = positiveNumber(context.config, 'max_turns', true);
    if (maxTurns !== undefined) {
      args.push('--max-turns', String(maxTurns));
    }

    const maxBudgetUsd = positiveNumber(
      context.config,
      'max_budget_usd',
      false
    );
    if (maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', String(maxBudgetUsd));
    }

    const effort = context.config.effort;
    if (
      effort !== undefined &&
      (typeof effort !== 'string' || !CLAUDE_EFFORT_LEVELS.has(effort))
    ) {
      throw new Error(
        `Unsupported Claude Code "effort": ${String(
          effort
        )}. Expected one of: ${[...CLAUDE_EFFORT_LEVELS].join(', ')}`
      );
    }
    if (typeof effort === 'string') {
      this.assertAdvertisedCapability(
        'effort level',
        effort,
        this.cliCapabilities?.effortLevels
      );
      args.push('--effort', effort);
    }

    const fallbackModel = context.config.fallback_model;
    if (
      fallbackModel !== undefined &&
      (typeof fallbackModel !== 'string' || fallbackModel.length === 0)
    ) {
      throw new Error(
        'Claude Code "fallback_model" must be a non-empty string'
      );
    }
    if (typeof fallbackModel === 'string') {
      args.push('--fallback-model', fallbackModel);
    }

    const settingSources = optionalStringList(
      context.config,
      'setting_sources'
    );
    if (settingSources) {
      const unsupportedSource = settingSources.find(
        (source) => !CLAUDE_SETTING_SOURCES.has(source)
      );
      if (unsupportedSource) {
        throw new Error(
          `Unsupported Claude Code setting source "${unsupportedSource}". Expected one of: ${[
            ...CLAUDE_SETTING_SOURCES,
          ].join(', ')}`
        );
      }
      args.push('--setting-sources', settingSources.join(','));
    }

    // The prompt remains unchanged and is the final positional argument.
    args.push(prompt);
    return args;
  }

  private assertAdvertisedCapability(
    label: string,
    value: string,
    supportedValues: Set<string> | undefined
  ): void {
    if (
      supportedValues &&
      supportedValues.size > 0 &&
      !supportedValues.has(value)
    ) {
      throw new Error(
        `Claude Code ${this.cliVersion ?? 'installed version'} does not advertise ${label} "${value}". Update Claude Code or select one of: ${[
          ...supportedValues,
        ].join(', ')}`
      );
    }
  }

  private capabilityDiagnostics(config: Record<string, unknown>): string[] {
    const diagnostics: string[] = [];
    if (config.max_budget_usd !== undefined) {
      if (this.cliVersion && isVersionBefore(this.cliVersion, '2.1.217')) {
        diagnostics.push(
          `Claude Code ${this.cliVersion} supports --max-budget-usd, but full subagent budget enforcement requires Claude Code >=2.1.217`
        );
      } else if (!this.cliVersion) {
        diagnostics.push(
          'Claude Code version was unavailable; full subagent max_budget_usd enforcement requires Claude Code >=2.1.217'
        );
      }
    }

    if (
      !this.cliCapabilities &&
      (config.permission_mode !== undefined || config.effort !== undefined)
    ) {
      diagnostics.push(
        `Claude Code ${this.cliVersion ?? 'version unknown'} capability metadata was unavailable; version-dependent permission and effort options were passed through`
      );
    }
    return diagnostics;
  }

  /**
   * Parse Claude Code output into messages array
   */
  private parseMessages(
    stream: ClaudeStreamParseResult,
    rawOutput: string,
    result: AgentExecutionResult
  ): YouBenchaLog['messages'] {
    const messages: YouBenchaLog['messages'] = [];

    const capabilities = [
      stream.init?.model ? `model=${stream.init.model}` : undefined,
      stream.init?.tools.length
        ? `tools=${stream.init.tools.join(',')}`
        : undefined,
      stream.init?.agents.length
        ? `agents=${stream.init.agents.join(',')}`
        : undefined,
      stream.init?.skills.length
        ? `skills=${stream.init.skills.join(',')}`
        : undefined,
    ].filter((value): value is string => value !== undefined);

    messages.push({
      role: 'system',
      content:
        capabilities.length > 0
          ? `Claude Code CLI started (${capabilities.join('; ')})`
          : 'Claude Code CLI started',
      timestamp: result.startedAt,
    });

    const toolCalls = stream.toolEvents
      .filter((event) => event.kind === 'tool_use')
      .map((event, index) => ({
        id: event.id ?? `claude_tool_${index}`,
        type: 'function',
        function: {
          name: event.name ?? 'unknown',
          arguments: serializeClaudeValue(event.input),
        },
      }));

    if (stream.assistantMessages.length > 0 || toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content:
          stream.assistantMessages.join('\n') ||
          stream.finalResponse ||
          'Claude Code invoked tools',
        timestamp: result.completedAt,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }

    for (const event of stream.toolEvents) {
      if (event.kind === 'tool_result') {
        messages.push({
          role: 'tool',
          content: serializeClaudeValue(event.content),
          timestamp: result.completedAt,
          tool_call_id: event.id,
        });
      }
    }

    if (messages.length === 1) {
      messages.push({
        role: 'assistant',
        content:
          stream.finalResponse ||
          rawOutput ||
          stream.errors.join('\n') ||
          'No output captured',
        timestamp: result.completedAt,
      });
    }

    return messages;
  }

  /**
   * Parse model name from Claude Code output
   */
  parseModel(rawOutput: string): string {
    // Try to detect model from output
    const modelMatch = rawOutput.match(/[Mm]odel:\s*(claude-[\w\-.]+)/);
    if (modelMatch) {
      return modelMatch[1];
    }

    // Look for model mentions in the output
    const mentionMatch = rawOutput.match(
      /(claude-(?:sonnet|opus|haiku)-[\d.-]+)/i
    );
    if (mentionMatch) {
      return mentionMatch[1];
    }

    return 'unknown';
  }

  /**
   * Parse Claude Code version from output
   */
  parseVersion(rawOutput: string): string {
    // Try to detect version from output
    const versionMatch = rawOutput.match(
      /[Vv]ersion[:\s]+([0-9]+\.[0-9]+\.[0-9]+)/
    );
    if (versionMatch) {
      return versionMatch[1];
    }

    // Look for claude code version pattern
    const claudeVersionMatch = rawOutput.match(
      /claude[_\s-]?code[_\s]?v?([0-9]+\.[0-9]+\.[0-9]+)/i
    );
    if (claudeVersionMatch) {
      return claudeVersionMatch[1];
    }

    return 'unknown';
  }

  /**
   * Get youBencha version from package.json
   */
  private getYouBenchaVersion(): string {
    try {
      // Try to read version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8')
      ) as { version?: string };
      return packageJson.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
}
