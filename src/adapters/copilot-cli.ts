/**
 * GitHub Copilot CLI adapter.
 *
 * Runs Copilot in non-interactive JSONL mode, preserves the raw event stream,
 * and exposes only the final assistant response through result.output.
 */

import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import {
  AgentAdapter,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentExecutionTelemetry,
  normalizeExecutionProvenance,
} from './base.js';
import {
  classifyCopilotError,
  CopilotEventParser,
  parseCopilotEventStream,
} from './copilot-cli-events.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import {
  CliProcessResult,
  ResolvedExecutable,
  resolveCliExecutable,
  runCliProcess,
} from '../lib/cli-process.js';
import * as logger from '../lib/logger.js';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;
const MAX_ARTIFACT_OUTPUT_BYTES = 64 * 1024 * 1024;
const COPILOT_LOG_LEVELS = new Set([
  'none',
  'error',
  'warning',
  'info',
  'debug',
  'all',
  'default',
]);

type ResolveExecutable = typeof resolveCliExecutable;
type RunProcess = typeof runCliProcess;

export interface CopilotCLIAdapterDependencies {
  resolveExecutable?: ResolveExecutable;
  runProcess?: RunProcess;
}

export interface BuiltCopilotCommand {
  command: 'copilot';
  args: string[];
  effectiveConfig: Record<string, unknown>;
}

/**
 * Construct the stable, cross-platform Copilot argument array.
 *
 * Executable resolution and Windows npm-shim handling belong to the shared
 * process boundary; this function never creates a shell command string.
 */
export function buildCopilotCommand(
  context: AgentExecutionContext
): BuiltCopilotCommand {
  const prompt = requiredString(context.config.prompt, 'prompt');
  const agent =
    optionalString(context.config.agent_name, 'agent_name') ??
    optionalString(context.config.agent, 'agent');
  const model = optionalString(context.config.model, 'model');
  const reasoningEffort = optionalString(
    context.config.reasoning_effort,
    'reasoning_effort'
  );
  const maxAiCredits = optionalNonNegativeInteger(
    context.config.max_ai_credits,
    'max_ai_credits'
  );
  const logLevel = optionalString(context.config.log_level, 'log_level');
  if (logLevel && !COPILOT_LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `log_level must be one of: ${[...COPILOT_LOG_LEVELS].join(', ')}`
    );
  }

  // Defaults preserve the adapter's existing permission behavior. Users can
  // now disable either bypass explicitly; `--no-ask-user` then makes denied
  // actions fail instead of blocking for input.
  const allowAllTools = optionalBoolean(
    context.config.allow_all_tools,
    'allow_all_tools',
    true
  );
  const allowAllPaths = optionalBoolean(
    context.config.allow_all_paths,
    'allow_all_paths',
    true
  );
  const legacyTextOutput = optionalBoolean(
    context.config.legacy_text_output,
    'legacy_text_output',
    false
  );
  const outputFormat = legacyTextOutput ? 'text' : 'json';

  const args = [
    '--prompt',
    prompt,
    '--output-format',
    outputFormat,
    '--no-ask-user',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    '-C',
    context.workspaceDir,
  ];

  if (model) {
    args.push('--model', model);
  }
  if (agent) {
    args.push('--agent', agent);
  }
  if (reasoningEffort) {
    args.push('--reasoning-effort', reasoningEffort);
  }
  if (maxAiCredits !== undefined) {
    args.push('--max-ai-credits', String(maxAiCredits));
  }
  if (allowAllTools) {
    args.push('--allow-all-tools');
  }
  if (allowAllPaths) {
    args.push('--allow-all-paths');
  }
  if (logLevel) {
    args.push('--log-level', logLevel);
  }

  const copilotLogsDir = path.join(context.artifactsDir, 'copilot-logs');
  args.push('--log-dir', copilotLogsDir);

  return {
    command: 'copilot',
    args,
    effectiveConfig: {
      output_format: outputFormat,
      ask_user: false,
      color: false,
      remote: false,
      remote_export: false,
      workspace: context.workspaceDir,
      allow_all_tools: allowAllTools,
      allow_all_paths: allowAllPaths,
      legacy_text_output: legacyTextOutput,
      ...(model ? { model } : {}),
      ...(agent ? { agent } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(maxAiCredits !== undefined ? { max_ai_credits: maxAiCredits } : {}),
      ...(logLevel ? { log_level: logLevel } : {}),
    },
  };
}

export class CopilotCLIAdapter implements AgentAdapter {
  readonly name = 'copilot-cli';
  readonly version = '2.0.0';

  private readonly resolveExecutable: ResolveExecutable;
  private readonly runProcess: RunProcess;
  private executable: ResolvedExecutable | undefined;
  private cliVersion: string | undefined;

  constructor(dependencies: CopilotCLIAdapterDependencies = {}) {
    this.resolveExecutable =
      dependencies.resolveExecutable ?? resolveCliExecutable;
    this.runProcess = dependencies.runProcess ?? runCliProcess;
  }

  /**
   * Check installation only. Copilot has no side-effect-free authentication
   * probe, so availability must never spend an AI request.
   */
  async checkAvailability(): Promise<boolean> {
    const executable = await this.resolveExecutable('copilot', {
      env: process.env,
    });
    if (!executable) {
      return false;
    }

    const probeDir = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-copilot-probe-')
    );
    try {
      const result = await this.runProcess({
        executable,
        args: ['--version'],
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: VERSION_PROBE_TIMEOUT_MS,
        maxCapturedOutputBytes: 16 * 1024,
        stdoutArtifactPath: path.join(probeDir, 'stdout.log'),
        stderrArtifactPath: path.join(probeDir, 'stderr.log'),
      });
      if (result.error || result.timedOut || result.exitCode !== 0) {
        return false;
      }

      this.executable = executable;
      this.cliVersion = detectCopilotVersion(
        `${result.stdout}\n${result.stderr}`
      );
      return true;
    } catch {
      return false;
    } finally {
      await rm(probeDir, { recursive: true, force: true });
    }
  }

  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    let exitCode = 1;
    let status: AgentExecutionResult['status'] = 'failed';
    let output = '';
    let telemetry: AgentExecutionTelemetry | undefined;
    const errors: AgentExecutionResult['errors'] = [];

    try {
      const copilotLogsDir = path.join(context.artifactsDir, 'copilot-logs');
      await mkdir(copilotLogsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const eventsArtifactPath = path.join(
        copilotLogsDir,
        `events-${timestamp}.jsonl`
      );
      const stderrArtifactPath = path.join(
        copilotLogsDir,
        `stderr-${timestamp}.log`
      );
      const builtCommand = buildCopilotCommand(context);
      const environment = { ...process.env, ...context.env };
      const retainedOutputLimit = maxOutputBytes(context.config);
      const executable =
        this.executable ??
        (await this.resolveExecutable(builtCommand.command, {
          env: environment,
        }));
      if (!executable) {
        throw new Error(
          'GitHub Copilot CLI is not installed or is not available on PATH.'
        );
      }

      logger.debug(`Copilot CLI executable: ${redactHome(executable.path)}`);
      logger.debug(`Copilot CLI working directory: ${context.workspaceDir}`);
      logger.debug(
        `Copilot CLI prompt length: ${requiredString(context.config.prompt, 'prompt').length} chars`
      );
      logger.debug(`Copilot CLI event log: ${eventsArtifactPath}`);

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

      exitCode = processResult.exitCode ?? 1;
      const parsed = await parseCopilotEventArtifact(
        eventsArtifactPath,
        startedAt,
        retainedOutputLimit,
        optionalBoolean(
          context.config.legacy_text_output,
          'legacy_text_output',
          false
        )
      );
      telemetry = {
        ...parsed.telemetry,
        cliVersion: parsed.telemetry.cliVersion ?? this.cliVersion,
        eventsArtifactPath,
        resolvedExecutable: redactHome(executable.path),
        configuredModel: optionalString(context.config.model, 'model'),
        headlessMode: true,
        effectiveConfig: {
          ...builtCommand.effectiveConfig,
          max_output_bytes: retainedOutputLimit,
          max_artifact_output_bytes: MAX_ARTIFACT_OUTPUT_BYTES,
          timeout_ms: context.timeout,
        },
        diagnostics: [
          ...(parsed.telemetry.diagnostics ?? []),
          ...(processResult.stdoutTruncated
            ? [
                processResult.stdoutArtifactTruncated
                  ? `Captured stdout preview and the quota-bounded event artifact were truncated after retaining ${processResult.stdout.length} preview bytes.`
                  : `Captured stdout preview was truncated after ${processResult.stdout.length} bytes; the event artifact was parsed.`,
              ]
            : []),
          ...(processResult.stderrTruncated
            ? [
                `Captured stderr preview was truncated after ${processResult.stderr.length} bytes.`,
              ]
            : []),
          ...(processResult.stdoutArtifactTruncated
            ? [
                `Copilot event artifact reached its ${MAX_ARTIFACT_OUTPUT_BYTES}-byte limit and is incomplete.`,
              ]
            : []),
          ...(processResult.stderrArtifactTruncated
            ? [
                `Copilot stderr artifact reached its ${MAX_ARTIFACT_OUTPUT_BYTES}-byte limit and is incomplete.`,
              ]
            : []),
        ],
      };

      for (const structuredError of parsed.errors) {
        errors.push({
          message: redactSecretValues(
            `[${structuredError.category}] ${structuredError.message}`,
            environment
          ),
          timestamp: new Date().toISOString(),
        });
      }
      if (parsed.errorEventCount > 0 && parsed.errors.length === 0) {
        errors.push({
          message: `Copilot reported ${parsed.errorEventCount} structured error event(s); details were omitted by the parser retention limit.`,
          timestamp: new Date().toISOString(),
        });
      }
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
          message: `Copilot CLI exited with code ${exitCode}${stderrPreview(processResult)}`,
          timestamp: new Date().toISOString(),
        });
      } else if (processResult.stdoutArtifactTruncated) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message: `Copilot event artifact exceeded the ${MAX_ARTIFACT_OUTPUT_BYTES}-byte safety limit; the structured result is incomplete.`,
          timestamp: new Date().toISOString(),
        });
      } else if (parsed.malformedTerminalEvent) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message: 'Copilot emitted a malformed terminal JSONL event.',
          timestamp: new Date().toISOString(),
        });
      } else if (
        parsed.structured &&
        (!parsed.terminalEventSeen || !parsed.telemetry.finalResponse)
      ) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message:
            'Copilot JSONL stream ended before a terminal event and final assistant response were received.',
          timestamp: new Date().toISOString(),
        });
      } else if (!parsed.structured && !parsed.telemetry.legacyParserUsed) {
        status = 'failed';
        exitCode = 1;
        errors.push({
          message:
            'Copilot exited successfully but did not emit valid JSONL output. Plain-text output is rejected unless legacy_text_output is explicitly enabled.',
          timestamp: new Date().toISOString(),
        });
      } else if (parsed.errorEventCount > 0) {
        status = 'failed';
        exitCode = 1;
      } else {
        status = 'success';
      }

      output =
        parsed.telemetry.finalResponse ||
        processResult.stdout.trim() ||
        processResult.stderr.trim();
    } catch (error) {
      const executionError =
        error instanceof Error ? error : new Error(String(error));
      errors.push({
        message: executionError.message,
        timestamp: new Date().toISOString(),
        stackTrace: executionError.stack,
      });
      output = executionError.message;
    }

    const completedAt = new Date().toISOString();
    return {
      exitCode,
      status,
      output,
      startedAt,
      completedAt,
      durationMs:
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      errors,
      telemetry,
    };
  }

  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    const fallback = result.telemetry
      ? undefined
      : parseCopilotEventStream(rawOutput, {
          defaultTimestamp: result.completedAt,
        });
    const telemetry = result.telemetry ?? fallback?.telemetry;
    const usage = telemetry?.usage ?? { source: 'unavailable' as const };
    const messages =
      telemetry?.messages && telemetry.messages.length > 0
        ? telemetry.messages
        : [
            {
              role: 'assistant' as const,
              content: rawOutput || 'No output captured',
              timestamp: result.completedAt,
            },
          ];

    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version:
          telemetry?.cliVersion ?? detectCopilotVersion(rawOutput) ?? 'unknown',
        adapter_version: this.version,
      },
      model: {
        name: telemetry?.model ?? 'unknown',
        provider: 'GitHub',
        parameters: telemetry?.effectiveConfig ?? {},
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
        prompt_tokens: usage.promptTokens ?? 0,
        cached_prompt_tokens: usage.cachedPromptTokens,
        completion_tokens: usage.completionTokens ?? 0,
        reasoning_tokens: usage.reasoningTokens,
        total_tokens:
          usage.totalTokens ??
          (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
        cost_usd: usage.costUsd,
        credits: usage.credits,
        measurement_source: usage.source,
      },
      errors: result.errors.map((error) => ({
        message: error.message,
        timestamp: error.timestamp,
        stack_trace: error.stackTrace,
      })),
      environment: {
        os: `${os.platform()}-${os.arch()}`,
        node_version: process.version,
        youbencha_version: this.getYouBenchaVersion(),
        working_directory: process.cwd(),
      },
      provenance: normalizeExecutionProvenance(result.telemetry, this.version),
    };
  }

  private getYouBenchaVersion(): string {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        version?: string;
      };
      return packageJson.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

async function parseCopilotEventArtifact(
  artifactPath: string,
  defaultTimestamp: string,
  maxRetainedBytes: number,
  allowLegacyText: boolean
): Promise<ReturnType<CopilotEventParser['finish']>> {
  const parser = new CopilotEventParser({
    defaultTimestamp,
    maxRetainedBytes,
    allowLegacyText,
  });
  const lines = createInterface({
    input: createReadStream(artifactPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    parser.pushLine(line);
  }
  return parser.finish();
}

function detectCopilotVersion(rawOutput: string): string | undefined {
  return rawOutput.match(
    /(?:GitHub\s+)?Copilot CLI\s+(?:version\s+)?v?([0-9]+(?:\.[0-9]+){1,3}(?:[-+][\w.-]+)?)/i
  )?.[1];
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value, field);
  if (!result) {
    throw new Error(`${field} is required in agent config`);
  }
  return result;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function optionalBoolean(
  value: unknown,
  field: string,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function maxOutputBytes(config: Record<string, unknown>): number {
  const value = config.max_output_bytes;
  if (value === undefined) {
    return DEFAULT_MAX_OUTPUT_BYTES;
  }
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('max_output_bytes must be a positive integer');
  }
  return value as number;
}

function stderrPreview(result: CliProcessResult): string {
  const stderr = result.stderr.trim();
  if (!stderr) {
    return '';
  }

  const category = classifyCopilotError(stderr);
  const message: Record<ReturnType<typeof classifyCopilotError>, string> = {
    'credentials-missing': 'no supported Copilot credentials were available',
    'classic-pat-unsupported':
      'classic GitHub personal access tokens are unsupported; use a supported fine-grained token',
    'credentials-expired-or-insufficient':
      'Copilot credentials expired or have insufficient permissions',
    'organization-policy-denied':
      'Copilot access was denied by organization policy',
    'model-or-entitlement-denied':
      'the selected model or Copilot entitlement is unavailable',
    unknown: 'Copilot reported an execution error; inspect the stderr artifact',
  };
  return `: ${message[category]}`;
}

function redactHome(filePath: string): string {
  const home = os.homedir();
  if (!home) {
    return filePath;
  }
  const normalizedPath = path.resolve(filePath);
  const normalizedHome = path.resolve(home);
  return normalizedPath.toLowerCase().startsWith(normalizedHome.toLowerCase())
    ? `~${normalizedPath.slice(normalizedHome.length)}`
    : normalizedPath;
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
