import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  AgentAdapter,
  AgentAvailability,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentExecutionTelemetry,
  normalizeExecutionProvenance,
} from './base.js';
import {
  CodexEventParser,
  CodexEventParseResult,
  parseCodexEventStream,
} from './codex-cli-events.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import {
  CliProcessResult,
  ResolvedExecutable,
  resolveCliExecutable,
  runCliProcess,
} from '../lib/cli-process.js';
import { CODEX_OUTPUT_LIMIT_MAX_BYTES } from '../schemas/agent-config/codex-cli.js';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_CODEX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MIN_CODEX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;
const PROBE_TIMEOUT_MS = 10_000;
const REASONING_EFFORTS = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

type ResolveExecutable = typeof resolveCliExecutable;
type RunProcess = typeof runCliProcess;

export interface CodexCLIAdapterDependencies {
  resolveExecutable?: ResolveExecutable;
  runProcess?: RunProcess;
}

export interface BuiltCodexCommand {
  command: 'codex';
  args: string[];
  effectiveConfig: Record<string, unknown>;
}

/**
 * Build an argv-only command contract. The prompt is deliberately absent and
 * must be supplied to runCliProcess through its stdin field.
 */
export function buildCodexCommand(
  context: AgentExecutionContext
): BuiltCodexCommand {
  if (context.config.agent_name !== undefined) {
    throw new Error(
      'agent_name is not supported by codex-cli; use config.profile for a Codex profile or mention a skill in the prompt'
    );
  }
  const sandbox =
    optionalString(context.config.sandbox, 'sandbox') ?? 'workspace-write';
  if (sandbox !== 'read-only' && sandbox !== 'workspace-write') {
    throw new Error('sandbox must be "read-only" or "workspace-write"');
  }
  const approval =
    optionalString(context.config.approval_policy, 'approval_policy') ??
    'never';
  if (approval !== 'never') {
    throw new Error('approval_policy must be "never" for headless execution');
  }
  const ephemeral = optionalBoolean(
    context.config.ephemeral,
    'ephemeral',
    true
  );
  const ignoreUserConfig = optionalBoolean(
    context.config.ignore_user_config,
    'ignore_user_config',
    true
  );
  const ignoreRules = optionalBoolean(
    context.config.ignore_rules,
    'ignore_rules',
    false
  );
  const search = optionalBoolean(context.config.search, 'search', false);
  const model = optionalString(context.config.model, 'model');
  const profile = optionalString(context.config.profile, 'profile');
  const reasoning = optionalString(
    context.config.reasoning_effort,
    'reasoning_effort'
  );
  if (reasoning && !REASONING_EFFORTS.has(reasoning)) {
    throw new Error(
      `reasoning_effort must be one of: ${[...REASONING_EFFORTS].join(', ')}`
    );
  }

  // In Codex 0.146.0-alpha.3 these are global flags and must precede `exec`.
  const args = ['--ask-for-approval', 'never'];
  if (search) {
    args.push('--search');
  }
  args.push('exec', '--json');
  if (ephemeral) {
    args.push('--ephemeral');
  }
  args.push('--color', 'never', '--sandbox', sandbox);
  if (ignoreUserConfig) {
    args.push('--ignore-user-config');
  }
  args.push('-C', context.repoDir);
  if (ignoreRules) {
    args.push('--ignore-rules');
  }
  if (profile) {
    args.push('--profile', profile);
  }
  if (model) {
    args.push('--model', model);
  }
  if (reasoning) {
    args.push('-c', `model_reasoning_effort="${reasoning}"`);
  }
  args.push('-');

  return {
    command: 'codex',
    args,
    effectiveConfig: {
      sandbox,
      approval_policy: approval,
      ephemeral,
      ignore_user_config: ignoreUserConfig,
      ignore_rules: ignoreRules,
      search,
      search_grants_shell_network: false,
      ...(model ? { model } : {}),
      ...(profile ? { profile } : {}),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    },
  };
}

export class CodexCLIAdapter implements AgentAdapter {
  readonly name = 'codex-cli';
  readonly version = '1.0.0';

  private readonly resolveExecutable: ResolveExecutable;
  private readonly runProcess: RunProcess;
  private executable: ResolvedExecutable | undefined;
  private cliVersion: string | undefined;
  private requiredExecSupported: boolean | undefined;
  private globalSearchSupported: boolean | undefined;

  constructor(dependencies: CodexCLIAdapterDependencies = {}) {
    this.resolveExecutable =
      dependencies.resolveExecutable ?? resolveCliExecutable;
    this.runProcess = dependencies.runProcess ?? runCliProcess;
  }

  async checkAvailability(): Promise<boolean> {
    const result = await this.diagnoseAvailability(process.env);
    return (
      result.installed &&
      result.authenticated !== false &&
      this.requiredExecSupported !== false
    );
  }

  async diagnoseAvailability(
    env: Readonly<Record<string, string | undefined>> = process.env
  ): Promise<AgentAvailability> {
    const environment: NodeJS.ProcessEnv = { ...process.env, ...env };
    const executable = await this.resolveExecutable('codex', {
      env: environment,
    });
    if (!executable) {
      return {
        installed: false,
        authenticated: false,
        messages: ['Codex CLI was not found on PATH.'],
      };
    }
    const probeDir = await mkdtemp(
      path.join(os.tmpdir(), 'youbencha-codex-probe-')
    );
    try {
      const versionResult = await this.probe(
        executable,
        ['--version'],
        environment,
        probeDir,
        'version'
      );
      if (
        versionResult.error ||
        versionResult.timedOut ||
        versionResult.exitCode !== 0
      ) {
        return {
          installed: false,
          authenticated: 'unknown',
          executableKind: executable.kind,
          messages: [
            'Codex executable was found but its version probe failed.',
          ],
        };
      }
      this.executable = executable;
      this.cliVersion = detectCodexVersion(
        `${versionResult.stdout}\n${versionResult.stderr}`
      );
      const globalHelpResult = await this.probe(
        executable,
        ['--help'],
        environment,
        probeDir,
        'global-help'
      );
      const globalHelp = `${globalHelpResult.stdout}\n${globalHelpResult.stderr}`;
      const execHelpResult = await this.probe(
        executable,
        ['exec', '--help'],
        environment,
        probeDir,
        'help'
      );
      const execHelp = `${execHelpResult.stdout}\n${execHelpResult.stderr}`;
      const globalHelpSucceeded =
        !globalHelpResult.error &&
        !globalHelpResult.timedOut &&
        globalHelpResult.exitCode === 0;
      const execHelpSucceeded =
        !execHelpResult.error &&
        !execHelpResult.timedOut &&
        execHelpResult.exitCode === 0;
      const missingExecFlags = [
        '--json',
        '--ephemeral',
        '--color',
        '--sandbox',
        '--ignore-user-config',
        '-C',
      ].filter((flag) => execHelpSucceeded && !execHelp.includes(flag));
      const globalApprovalSupported = globalHelpSucceeded
        ? globalHelp.includes('--ask-for-approval')
        : undefined;
      this.globalSearchSupported = globalHelpSucceeded
        ? globalHelp.includes('--search')
        : undefined;
      this.requiredExecSupported =
        globalApprovalSupported === false || missingExecFlags.length > 0
          ? false
          : globalApprovalSupported === true && execHelpSucceeded
            ? true
            : undefined;
      const authResult = await this.probe(
        executable,
        ['login', 'status'],
        environment,
        probeDir,
        'login'
      );
      const envAuth = Boolean(environment.CODEX_API_KEY);
      const loginOutput = `${authResult.stdout}\n${authResult.stderr}`;
      const recognizedUnauthenticated =
        !authResult.error &&
        !authResult.timedOut &&
        /not logged in|not authenticated|logged out/i.test(loginOutput);
      const persistedAuth =
        !authResult.error &&
        !authResult.timedOut &&
        authResult.exitCode === 0 &&
        !recognizedUnauthenticated &&
        /logged in|authenticated|chatgpt|api key/i.test(loginOutput);
      const authenticated: boolean | 'unknown' =
        persistedAuth || envAuth
          ? true
          : recognizedUnauthenticated
            ? false
            : 'unknown';
      return {
        installed: true,
        authenticated,
        version: this.cliVersion,
        executableKind: executable.kind,
        messages: [
          ...(persistedAuth
            ? ['Persisted Codex authentication is available.']
            : envAuth
              ? ['CODEX_API_KEY is available for codex exec.']
              : authenticated === false
                ? ['Codex reported that no persisted login is available.']
                : ['Codex authentication status could not be determined.']),
          ...(globalApprovalSupported === false
            ? [
                'Codex global help did not advertise required --ask-for-approval support.',
              ]
            : globalApprovalSupported === undefined
              ? ['Codex global capability probe was inconclusive.']
              : []),
          ...(!execHelpSucceeded
            ? ['Codex exec capability probe was inconclusive.']
            : []),
          ...(missingExecFlags.length > 0
            ? [
                `Codex exec help did not advertise: ${missingExecFlags.join(', ')}.`,
              ]
            : []),
        ],
      };
    } catch (error) {
      return {
        installed: true,
        authenticated: 'unknown',
        version: this.cliVersion,
        executableKind: executable.kind,
        messages: [
          error instanceof Error
            ? error.message
            : 'Codex availability diagnostics failed.',
        ],
      };
    } finally {
      await rm(probeDir, { recursive: true, force: true });
    }
  }

  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...context.env,
    };
    const secrets = credentialValues(environment);
    let exitCode = 1;
    let status: AgentExecutionResult['status'] = 'failed';
    let output = '';
    let telemetry: AgentExecutionTelemetry | undefined;
    const errors: AgentExecutionResult['errors'] = [];
    try {
      const artifactsRoot = await validatedDirectory(context.artifactsDir);
      await validatedSubdirectory(artifactsRoot, 'codex-cli-logs');
      const timestamp = `${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}-${randomUUID()}`;
      const eventsArtifactPath = validatedChild(
        artifactsRoot,
        path.join('codex-cli-logs', `events-${timestamp}.jsonl`)
      );
      const stderrArtifactPath = validatedChild(
        artifactsRoot,
        path.join('codex-cli-logs', `stderr-${timestamp}.log`)
      );
      const finalArtifactPath = validatedChild(
        artifactsRoot,
        path.join('codex-cli-logs', `final-message-${timestamp}.txt`)
      );
      const metadataArtifactPath = validatedChild(
        artifactsRoot,
        path.join('codex-cli-logs', `execution-metadata-${timestamp}.json`)
      );
      const prompt = await loadPrompt(context);
      const built = buildCodexCommand(context);
      if (
        built.effectiveConfig.search === true &&
        this.globalSearchSupported === false
      ) {
        throw new Error(
          'search=true requires a Codex CLI that advertises the global --search flag'
        );
      }
      if (this.requiredExecSupported === false) {
        throw new Error(
          'Installed Codex CLI does not advertise the required headless exec flags'
        );
      }
      const executable =
        this.executable ??
        (await this.resolveExecutable('codex', { env: environment }));
      if (!executable) {
        throw new Error(
          'Codex CLI is not installed or is not available on PATH.'
        );
      }
      const outputLimit = maxOutputBytes(context.config);
      const artifactLimit = codexArtifactLimit(outputLimit);
      const processResult = await this.runProcess({
        executable,
        args: built.args,
        cwd: context.repoDir,
        env: environment,
        stdin: prompt,
        timeoutMs: context.timeout > 0 ? context.timeout : MAX_NODE_TIMEOUT_MS,
        maxCapturedOutputBytes: outputLimit,
        maxArtifactOutputBytes: artifactLimit,
        artifactRedactions: secrets,
        stdoutArtifactPath: eventsArtifactPath,
        stderrArtifactPath,
      });
      const [eventsSanitization, stderrSanitization] = await Promise.all([
        sanitizeArtifact(eventsArtifactPath, artifactLimit, secrets),
        sanitizeArtifact(stderrArtifactPath, artifactLimit, secrets),
      ]);
      const parsed = await parseCodexArtifact(
        eventsArtifactPath,
        startedAt,
        outputLimit,
        (value) => redactSecrets(value, environment)
      );
      output = redactSecrets(parsed.telemetry.finalResponse ?? '', environment);
      const finalSanitization = await writeSanitizedArtifact(
        finalArtifactPath,
        output,
        outputLimit,
        secrets
      );
      exitCode = processResult.exitCode ?? 1;
      telemetry = {
        ...parsed.telemetry,
        cliVersion: this.cliVersion,
        configuredModel: optionalString(context.config.model, 'model'),
        resolvedExecutable: redactHome(executable.path),
        eventsArtifactPath,
        headlessMode: true,
        sessionPersistence: built.effectiveConfig.ephemeral !== true,
        effectiveConfig: {
          ...built.effectiveConfig,
          output_limit_bytes: outputLimit,
        },
        diagnostics: [
          ...(parsed.telemetry.diagnostics ?? []),
          ...(parsed.contentTruncated
            ? ['Retained structured message content reached its byte limit.']
            : []),
          ...(processResult.stdoutTruncated
            ? [
                'The in-memory stdout preview was truncated; the complete JSONL artifact was parsed.',
              ]
            : []),
          ...(processResult.stderrTruncated
            ? ['The in-memory stderr preview was truncated.']
            : []),
          ...(processResult.stdoutArtifactTruncated ||
          eventsSanitization?.truncated
            ? [
                'The durable Codex JSONL artifact reached its byte quota; structured telemetry may be incomplete.',
              ]
            : []),
          ...(processResult.stderrArtifactTruncated ||
          stderrSanitization?.truncated
            ? ['The durable Codex stderr artifact reached its byte quota.']
            : []),
          ...(finalSanitization?.truncated
            ? [
                'The durable Codex final-message artifact reached its byte quota.',
              ]
            : []),
          ...(eventsSanitization?.redactionCount ||
          stderrSanitization?.redactionCount ||
          finalSanitization.redactionCount ||
          processResult.stdoutArtifactRedactionCount ||
          processResult.stderrArtifactRedactionCount
            ? ['Credential values were redacted from durable Codex artifacts.']
            : []),
        ],
      };
      for (const structuredError of parsed.errors) {
        errors.push({
          message: redactSecrets(structuredError.message, environment),
          timestamp: new Date().toISOString(),
        });
      }
      if (processResult.error) {
        errors.push({
          message: redactSecrets(processResult.error.message, environment),
          timestamp: new Date().toISOString(),
        });
      }
      if (processResult.timedOut) {
        status = 'timeout';
        errors.push({
          message: `Execution timed out after ${context.timeout}ms`,
          timestamp: new Date().toISOString(),
        });
      } else if (processResult.error || exitCode !== 0) {
        status = 'failed';
        if (exitCode !== 0) {
          errors.push({
            message: `Codex CLI exited with code ${exitCode}${stderrPreview(processResult)}`,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (
        parsed.terminal !== 'completed' ||
        parsed.protocolErrorCount > 0 ||
        !parsed.finalMessageObserved
      ) {
        status = 'failed';
        exitCode = 1;
      } else {
        status = 'success';
      }
      const completedAt = new Date().toISOString();
      await writeFile(
        metadataArtifactPath,
        `${JSON.stringify(
          {
            cli_version: this.cliVersion,
            adapter_version: this.version,
            configured_model: optionalString(context.config.model, 'model'),
            reported_model: telemetry.model,
            sandbox: built.effectiveConfig.sandbox,
            approval_policy: 'never',
            ephemeral: built.effectiveConfig.ephemeral,
            ignore_user_config: built.effectiveConfig.ignore_user_config,
            reasoning_effort: built.effectiveConfig.reasoning_effort,
            thread_id: telemetry.sessionId,
            duration_ms:
              new Date(completedAt).getTime() - new Date(startedAt).getTime(),
            exit_code: exitCode,
            stdout_truncated: processResult.stdoutTruncated,
            stderr_truncated: processResult.stderrTruncated,
            artifact_output_limit_bytes: artifactLimit,
            stdout_artifact_bytes:
              eventsSanitization?.outputBytes ??
              processResult.stdoutArtifactBytes,
            stderr_artifact_bytes:
              stderrSanitization?.outputBytes ??
              processResult.stderrArtifactBytes,
            final_message_artifact_bytes: finalSanitization.outputBytes,
            stdout_artifact_truncated:
              processResult.stdoutArtifactTruncated ||
              eventsSanitization?.truncated ||
              false,
            stderr_artifact_truncated:
              processResult.stderrArtifactTruncated ||
              stderrSanitization?.truncated ||
              false,
            final_message_artifact_truncated: finalSanitization.truncated,
            credential_redactions:
              (processResult.stdoutArtifactRedactionCount ?? 0) +
              (processResult.stderrArtifactRedactionCount ?? 0) +
              (eventsSanitization?.redactionCount ?? 0) +
              (stderrSanitization?.redactionCount ?? 0) +
              finalSanitization.redactionCount,
            usage_source: telemetry.usage?.source,
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    } catch (error) {
      const executionError =
        error instanceof Error ? error : new Error(String(error));
      errors.push({
        message: redactSecrets(executionError.message, environment),
        timestamp: new Date().toISOString(),
        stackTrace: executionError.stack
          ? redactSecrets(executionError.stack, environment)
          : undefined,
      });
      output = redactSecrets(executionError.message, environment);
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
      : parseCodexEventStream(rawOutput, {
          defaultTimestamp: result.completedAt,
        });
    const telemetry = result.telemetry ?? fallback?.telemetry;
    const usage = telemetry?.usage ?? { source: 'unavailable' as const };
    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version: telemetry?.cliVersion ?? 'unknown',
        adapter_version: this.version,
      },
      model: {
        name: telemetry?.model ?? telemetry?.configuredModel ?? 'unknown',
        provider: 'OpenAI',
        parameters: telemetry?.effectiveConfig ?? {},
      },
      execution: {
        started_at: result.startedAt,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        exit_code: result.exitCode,
        status: result.status,
      },
      messages:
        telemetry?.messages && telemetry.messages.length > 0
          ? telemetry.messages
          : [
              {
                role: 'assistant',
                content: result.output || 'No output captured',
                timestamp: result.completedAt,
              },
            ],
      usage: {
        prompt_tokens: usage.promptTokens ?? 0,
        cached_prompt_tokens: usage.cachedPromptTokens,
        completion_tokens: usage.completionTokens ?? 0,
        reasoning_tokens: usage.reasoningTokens,
        total_tokens:
          usage.totalTokens ??
          (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
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
        youbencha_version: packageVersion(),
        working_directory: process.cwd(),
      },
      provenance: normalizeExecutionProvenance(telemetry, this.version),
    };
  }

  private probe(
    executable: ResolvedExecutable,
    args: string[],
    env: NodeJS.ProcessEnv,
    directory: string,
    name: string
  ): Promise<CliProcessResult> {
    return this.runProcess({
      executable,
      args,
      cwd: process.cwd(),
      env,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxCapturedOutputBytes: 64 * 1024,
      maxArtifactOutputBytes: 64 * 1024,
      artifactRedactions: credentialValues(env),
      stdoutArtifactPath: path.join(directory, `${name}-stdout.log`),
      stderrArtifactPath: path.join(directory, `${name}-stderr.log`),
    });
  }
}

async function parseCodexArtifact(
  artifactPath: string,
  timestamp: string,
  maxRetainedBytes: number,
  redact: (value: string) => string
): Promise<CodexEventParseResult> {
  const parser = new CodexEventParser({
    defaultTimestamp: timestamp,
    maxRetainedBytes,
    redact,
  });
  const stream = createReadStream(artifactPath, {
    encoding: 'utf8',
    highWaterMark: 64 * 1024,
  });
  for await (const chunk of stream as AsyncIterable<string>) {
    parser.pushChunk(chunk);
  }
  return parser.finish();
}

async function loadPrompt(context: AgentExecutionContext): Promise<string> {
  const direct = optionalString(context.config.prompt, 'prompt');
  const promptFile = optionalString(context.config.prompt_file, 'prompt_file');
  if (direct && promptFile) {
    throw new Error('Configure either prompt or prompt_file, not both');
  }
  if (direct) {
    return direct;
  }
  if (!promptFile) {
    throw new Error('prompt or prompt_file is required in agent config');
  }
  if (path.isAbsolute(promptFile) || promptFile.split(/[\\/]/).includes('..')) {
    throw new Error('prompt_file must be a safe relative path');
  }
  const target = path.resolve(context.repoDir, promptFile);
  const root = await realpath(context.repoDir);
  if (!isWithin(root, target)) {
    throw new Error('prompt_file must resolve within repoDir');
  }
  const resolvedTarget = await realpath(target);
  if (!isWithin(root, resolvedTarget)) {
    throw new Error('prompt_file must resolve within repoDir');
  }
  return await readFile(resolvedTarget, 'utf8');
}

async function validatedDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) {
    throw new Error('artifactsDir must be an absolute path');
  }
  await mkdir(directory, { recursive: true });
  return await realpath(directory);
}

async function validatedSubdirectory(
  root: string,
  relative: string
): Promise<string> {
  const candidate = validatedChild(root, relative);
  await mkdir(candidate, { recursive: true });
  const resolved = await realpath(candidate);
  if (!isWithin(root, resolved)) {
    throw new Error('Artifact directory escaped artifactsDir');
  }
  return resolved;
}

function validatedChild(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (!isWithin(root, target)) {
    throw new Error('Artifact path escaped artifactsDir');
  }
  return target;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
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
  const value = config.output_limit_bytes;
  if (value === undefined) {
    return DEFAULT_MAX_OUTPUT_BYTES;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > CODEX_OUTPUT_LIMIT_MAX_BYTES
  ) {
    throw new Error(
      `output_limit_bytes must be a positive integer no greater than ${CODEX_OUTPUT_LIMIT_MAX_BYTES}`
    );
  }
  return value as number;
}

function codexArtifactLimit(outputLimit: number): number {
  return Math.min(
    MAX_CODEX_ARTIFACT_BYTES,
    Math.max(MIN_CODEX_ARTIFACT_BYTES, outputLimit * 4)
  );
}

function detectCodexVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/)?.[1];
}

function stderrPreview(result: CliProcessResult): string {
  const stderr = result.stderr.trim();
  if (!stderr) {
    return '';
  }
  if (/auth|log[ -]?in|api key|unauthorized|401/i.test(stderr)) {
    return '; authentication failed—run "codex login status" or supply CODEX_API_KEY only to the exec process';
  }
  if (/model|entitlement|not found/i.test(stderr)) {
    return '; the configured model is unavailable';
  }
  if (/sandbox|permission|policy|denied/i.test(stderr)) {
    return '; Codex sandbox or policy denied the operation';
  }
  return '; inspect the retained stderr artifact';
}

function redactSecrets(value: string, environment: NodeJS.ProcessEnv): string {
  let result = value;
  for (const secret of credentialValues(environment)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

function credentialValues(environment: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([key, value]) =>
            Boolean(value) &&
            (value?.length ?? 0) >= 4 &&
            /(token|secret|password|api[_-]?key|authorization)/i.test(key)
        )
        .map(([, value]) => value as string)
    ),
  ].sort((left, right) => right.length - left.length);
}

interface ArtifactSanitization {
  outputBytes: number;
  redactionCount: number;
  truncated: boolean;
}

async function writeSanitizedArtifact(
  filePath: string,
  value: string,
  maxBytes: number,
  secrets: readonly string[]
): Promise<ArtifactSanitization> {
  const redactor = new StreamingSecretRedactor(redactionVariants(secrets));
  const sanitized = `${redactor.push(value)}${redactor.finish()}`;
  const bytes = Buffer.from(sanitized, 'utf8');
  const bounded = bytes.subarray(0, maxBytes);
  await writeFile(filePath, bounded);
  return {
    outputBytes: bounded.length,
    redactionCount: redactor.redactionCount,
    truncated: bounded.length < bytes.length,
  };
}

async function sanitizeArtifact(
  filePath: string,
  maxBytes: number,
  secrets: readonly string[]
): Promise<ArtifactSanitization | undefined> {
  try {
    await access(filePath);
  } catch {
    return undefined;
  }

  const temporaryPath = `${filePath}.sanitized-${randomUUID()}`;
  const input = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const output = createWriteStream(temporaryPath, {
    flags: 'wx',
  });
  const decoder = new StringDecoder('utf8');
  const redactor = new StreamingSecretRedactor(redactionVariants(secrets));
  let outputBytes = 0;
  let truncated = false;

  const writeBounded = async (value: string): Promise<void> => {
    if (!value) {
      return;
    }
    const bytes = Buffer.from(value, 'utf8');
    const remaining = maxBytes - outputBytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const bounded = bytes.subarray(0, remaining);
    outputBytes += bounded.length;
    if (bounded.length < bytes.length) {
      truncated = true;
    }
    if (!output.write(bounded)) {
      await new Promise<void>((resolveDrain, rejectDrain) => {
        output.once('drain', resolveDrain);
        output.once('error', rejectDrain);
      });
    }
  };

  try {
    for await (const chunk of input as AsyncIterable<Buffer>) {
      await writeBounded(redactor.push(decoder.write(chunk)));
    }
    await writeBounded(redactor.push(decoder.end()));
    await writeBounded(redactor.finish());
    output.end();
    await new Promise<void>((resolveClose, rejectClose) => {
      output.once('close', resolveClose);
      output.once('error', rejectClose);
    });
    await rename(temporaryPath, filePath);
    return {
      outputBytes,
      redactionCount: redactor.redactionCount,
      truncated,
    };
  } catch (error) {
    input.destroy();
    output.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

class StreamingSecretRedactor {
  private buffered = '';
  private readonly maxSecretLength: number;
  redactionCount = 0;

  constructor(private readonly secrets: readonly string[]) {
    this.maxSecretLength = Math.max(1, ...secrets.map((value) => value.length));
  }

  push(value: string): string {
    this.buffered += value;
    const safeEnd = Math.max(
      0,
      this.buffered.length - (this.maxSecretLength - 1)
    );
    return this.consume(safeEnd);
  }

  finish(): string {
    return this.consume(this.buffered.length);
  }

  private consume(safeEnd: number): string {
    if (safeEnd <= 0) {
      return '';
    }
    let result = '';
    let cursor = 0;
    while (cursor < safeEnd) {
      let nextIndex = -1;
      let nextSecret: string | undefined;
      for (const secret of this.secrets) {
        const index = this.buffered.indexOf(secret, cursor);
        if (index >= 0 && (nextIndex < 0 || index < nextIndex)) {
          nextIndex = index;
          nextSecret = secret;
        }
      }
      if (nextIndex < 0 || nextIndex >= safeEnd || !nextSecret) {
        result += this.buffered.slice(cursor, safeEnd);
        cursor = safeEnd;
        break;
      }
      result += `${this.buffered.slice(cursor, nextIndex)}[REDACTED]`;
      cursor = nextIndex + nextSecret.length;
      this.redactionCount += 1;
    }
    this.buffered = this.buffered.slice(cursor);
    return result;
  }
}

function redactionVariants(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const escaped = JSON.stringify(value).slice(1, -1);
        return escaped === value ? [value] : [escaped, value];
      })
    ),
  ].sort((left, right) => right.length - left.length);
}

function redactHome(value: string): string {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(value);
  return isWithin(home, resolved)
    ? path.join('<home>', path.relative(home, resolved))
    : resolved;
}

function packageVersion(): string {
  try {
    const value = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { version?: string };
    return value.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
