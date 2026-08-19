#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import {
  e2bCellManifestSchema,
  e2bRunnerPhaseSchema,
  type E2BCellManifest,
} from './schemas.js';
import {
  buildArtifactPackage,
  isolatePhaseEnvironment,
  LinuxSandboxProcessBoundary,
  PhaseOrchestrator,
  type PhaseExecutionContext,
  type PhaseOperations,
  type ProcessBoundary,
} from './phase-orchestrator.js';
import {
  E2B_CELL_MANIFEST_PATH,
  E2B_OUTPUT_ARCHIVE_PATH,
  E2B_OUTPUT_MANIFEST_PATH,
} from './runner-protocol.js';
import {
  agentConfigSchema,
  testCaseConfigSchema,
  type TestCaseConfig,
} from '../schemas/testcase.schema.js';
import { WorkspaceManager } from '../core/workspace.js';
import { ScriptPreExecution } from '../pre-execution/script.js';
import { CopilotCLIAdapter } from '../adapters/copilot-cli.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { CodexCLIAdapter } from '../adapters/codex-cli.js';
import type { AgentAdapter, AgentExecutionContext } from '../adapters/base.js';
import { GitDiffEvaluator } from '../evaluators/git-diff.js';
import { ExpectedDiffEvaluator } from '../evaluators/expected-diff.js';
import { AgenticJudgeEvaluator } from '../evaluators/agentic-judge.js';
import type { EvaluationContext, Evaluator } from '../evaluators/base.js';
import { WebhookPostEvaluation } from '../post-evaluation/webhook.js';
import { DatabasePostEvaluation } from '../post-evaluation/database.js';
import { ScriptPostEvaluation } from '../post-evaluation/script.js';
import type {
  PostEvaluation,
  PostEvaluationContext,
} from '../post-evaluation/base.js';
import {
  getArtifactManifest,
  saveResultsBundle,
  saveYouBenchaLog,
} from '../core/storage.js';
import {
  resultsBundleSchema,
  type EvaluationResult,
  type ResultsBundle,
} from '../schemas/result.schema.js';
import { youBenchaLogSchema } from '../schemas/youbenchalog.schema.js';
import { resolvePromptValue } from '../lib/prompt-loader.js';
import {
  resolveEvaluatorConfigs,
  validateEvaluatorNames,
} from '../lib/evaluator-loader.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { detectEnvironment } from '../core/env.js';
import { stableHash } from '../experiments/identity.js';

const RUNNER_STATE_DIRECTORY = '/work/state';
const RUNNER_OUTPUT_DIRECTORY = path.dirname(E2B_OUTPUT_MANIFEST_PATH);
const RUNNER_WORKSPACE_DIRECTORY = '/work/workspace';
const RUNTIME_STATE_FILE = 'runtime-state.json';

const workspaceSchema = z
  .object({
    runId: z.string().min(1),
    paths: z
      .object({
        root: z.string().min(1),
        runDir: z.string().min(1),
        modifiedDir: z.string().min(1),
        expectedDir: z.string().min(1).optional(),
        artifactsDir: z.string().min(1),
        evaluatorArtifactsDir: z.string().min(1),
        lockFile: z.string().min(1),
      })
      .strict(),
    repo: z.string().min(1),
    branch: z.string().optional(),
    modifiedCommit: z.string().min(1),
    expectedBranch: z.string().optional(),
    expectedCommit: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

const runtimeStateSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    started_at: z.string().datetime(),
    workspace: workspaceSchema,
    agent: z
      .object({
        log_path: z.string().min(1),
        status: z.enum(['success', 'failed', 'timeout']),
        exit_code: z.number().int(),
      })
      .strict()
      .optional(),
    evaluation_results_path: z.string().min(1).optional(),
    results_path: z.string().min(1).optional(),
  })
  .strict();

type RuntimeState = z.infer<typeof runtimeStateSchema>;

export interface SandboxPhaseOperationsOptions {
  workspaceRoot?: string;
  now?: () => Date;
  maxConcurrentEvaluators?: number;
  adapterFactory?: (type: string) => AgentAdapter;
  evaluatorFactory?: (name: string) => Evaluator | undefined;
  postEvaluatorFactory?: (name: string) => PostEvaluation | undefined;
  workspaceManagerFactory?: (
    workspaceRoot: string,
    timeout: number
  ) => Pick<WorkspaceManager, 'createWorkspace'>;
  preExecutionFactory?: () => Pick<
    ScriptPreExecution,
    'checkPreconditions' | 'execute'
  >;
  artifactPackageBuilder?: typeof buildArtifactPackage;
}

export function createRunnerAgentAdapter(type: string): AgentAdapter {
  switch (type) {
    case 'copilot-cli':
      return new CopilotCLIAdapter();
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex-cli':
      return new CodexCLIAdapter();
    default:
      throw new Error(`Unknown agent adapter type: ${type}`);
  }
}

export function createRunnerEvaluator(name: string): Evaluator | undefined {
  switch (name) {
    case 'git-diff':
      return new GitDiffEvaluator();
    case 'expected-diff':
      return new ExpectedDiffEvaluator();
    case 'agentic-judge':
      return new AgenticJudgeEvaluator();
    default:
      if (
        name.startsWith('agentic-judge-') ||
        name.startsWith('agentic-judge:')
      ) {
        return new AgenticJudgeEvaluator(name);
      }
      return undefined;
  }
}

export function createRunnerPostEvaluator(
  name: string
): PostEvaluation | undefined {
  switch (name) {
    case 'webhook':
      return new WebhookPostEvaluation();
    case 'database':
      return new DatabasePostEvaluation();
    case 'script':
      return new ScriptPostEvaluation();
    default:
      return undefined;
  }
}

function compileTestCase(manifest: E2BCellManifest): TestCaseConfig {
  const task = { ...manifest.task };
  if ('agent' in task) {
    throw new Error('Runner task data must not contain an agent');
  }
  const agent = agentConfigSchema.parse({
    type: manifest.target.agent_type,
    ...(manifest.target.requested_model === undefined
      ? {}
      : { model: manifest.target.requested_model }),
    config: manifest.target.config,
  });
  return testCaseConfigSchema.parse({ ...task, agent });
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
  });
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertRuntimePaths(state: RuntimeState, workspaceRoot: string): void {
  for (const value of [
    state.workspace.paths.root,
    state.workspace.paths.runDir,
    state.workspace.paths.modifiedDir,
    state.workspace.paths.artifactsDir,
    state.workspace.paths.evaluatorArtifactsDir,
    state.workspace.paths.lockFile,
    state.workspace.paths.expectedDir,
  ]) {
    if (value !== undefined && !isWithin(workspaceRoot, value)) {
      throw new Error('Persisted runner workspace path escapes its root');
    }
  }
}

function runtimeStatePath(context: PhaseExecutionContext): string {
  return path.join(context.stateDirectory, RUNTIME_STATE_FILE);
}

async function loadRuntimeState(
  context: PhaseExecutionContext,
  workspaceRoot: string
): Promise<RuntimeState> {
  const state = runtimeStateSchema.parse(
    JSON.parse(await fs.readFile(runtimeStatePath(context), 'utf8'))
  );
  if (state.manifest_hash !== stableHash(context.manifest)) {
    throw new Error('Runtime state does not match the selected cell manifest');
  }
  assertRuntimePaths(state, workspaceRoot);
  return state;
}

function partitionArtifacts(artifacts: readonly string[]): {
  agent: string[];
  evaluator: string[];
} {
  const agentDirectories = new Set([
    'claude-code-logs',
    'codex-cli-logs',
    'copilot-logs',
  ]);
  const agent: string[] = [];
  const evaluatorArtifacts: string[] = [];
  for (const artifact of artifacts) {
    const first = artifact.split(/[\\/]/)[0];
    if (agentDirectories.has(first)) agent.push(artifact);
    else if (artifact !== 'youbencha.log.json' && artifact !== 'results.json') {
      evaluatorArtifacts.push(artifact);
    }
  }
  return { agent, evaluator: evaluatorArtifacts };
}

function definedEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

function phaseSecretValues(context: PhaseExecutionContext): string[] {
  const phases =
    context.phase === 'prepare'
      ? new Set(['source', 'prepare'])
      : new Set([context.phase]);
  return context.manifest.secret_references
    .filter((reference) => reference.phases.some((phase) => phases.has(phase)))
    .map((reference) => context.environment[reference.inject_as])
    .filter((value): value is string => value !== undefined && value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return secrets.reduce(
      (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
      value
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        redactValue(child, secrets),
      ])
    );
  }
  return value;
}

function redactBuffer(contents: Buffer, secrets: readonly string[]): Buffer {
  let output = contents;
  for (const secret of secrets) {
    const needle = Buffer.from(secret);
    const replacement = Buffer.from('[REDACTED]');
    const pieces: Buffer[] = [];
    let offset = 0;
    let found = output.indexOf(needle, offset);
    if (found < 0) continue;
    while (found >= 0) {
      pieces.push(output.subarray(offset, found), replacement);
      offset = found + needle.length;
      found = output.indexOf(needle, offset);
    }
    pieces.push(output.subarray(offset));
    output = Buffer.concat(pieces);
  }
  return output;
}

/** Pure runner helpers exposed for deterministic conformance tests. */
export const runnerCliTesting = {
  compileTestCase,
  isWithin,
  assertRuntimePaths,
  runtimeStatePath,
  loadRuntimeState,
  partitionArtifacts,
  definedEnvironment,
  phaseSecretValues,
  redactValue,
  redactBuffer,
};

export async function redactRunnerArtifactFiles(
  directory: string,
  secrets: readonly string[]
): Promise<void> {
  if (secrets.length === 0) return;
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error('Artifact links are forbidden during redaction');
      }
      if (stat.isDirectory()) {
        await visit(absolute);
      } else if (stat.isFile()) {
        const original = await fs.readFile(absolute);
        const redacted = redactBuffer(original, secrets);
        if (!redacted.equals(original)) await fs.writeFile(absolute, redacted);
      }
    }
  }
  await visit(directory);
}

/**
 * Concrete sandbox runtime that reuses the current adapter/evaluator/hook
 * contracts while keeping their credential-bearing work in separate processes.
 */
export class SandboxPhaseOperations implements PhaseOperations {
  private readonly workspaceRoot: string;
  private readonly now: () => Date;
  private readonly maxConcurrentEvaluators: number;
  private readonly adapterFactory: (type: string) => AgentAdapter;
  private readonly evaluatorFactory: (name: string) => Evaluator | undefined;
  private readonly postEvaluatorFactory: (
    name: string
  ) => PostEvaluation | undefined;
  private readonly workspaceManagerFactory: (
    workspaceRoot: string,
    timeout: number
  ) => Pick<WorkspaceManager, 'createWorkspace'>;
  private readonly preExecutionFactory: () => Pick<
    ScriptPreExecution,
    'checkPreconditions' | 'execute'
  >;
  private readonly artifactPackageBuilder: typeof buildArtifactPackage;

  constructor(options: SandboxPhaseOperationsOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? RUNNER_WORKSPACE_DIRECTORY;
    this.now = options.now ?? ((): Date => new Date());
    this.maxConcurrentEvaluators = options.maxConcurrentEvaluators ?? 4;
    this.adapterFactory = options.adapterFactory ?? createRunnerAgentAdapter;
    this.evaluatorFactory = options.evaluatorFactory ?? createRunnerEvaluator;
    this.postEvaluatorFactory =
      options.postEvaluatorFactory ?? createRunnerPostEvaluator;
    this.workspaceManagerFactory =
      options.workspaceManagerFactory ??
      ((workspaceRoot, timeout): WorkspaceManager =>
        new WorkspaceManager(workspaceRoot, timeout));
    this.preExecutionFactory =
      options.preExecutionFactory ??
      ((): ScriptPreExecution => new ScriptPreExecution());
    this.artifactPackageBuilder =
      options.artifactPackageBuilder ?? buildArtifactPackage;
  }

  async prepare(context: PhaseExecutionContext): Promise<void> {
    const config = compileTestCase(context.manifest);
    const manager = this.workspaceManagerFactory(
      this.workspaceRoot,
      context.manifest.deadlines.phases_ms.prepare
    );
    const workspace = await manager.createWorkspace({
      repo: config.repo,
      branch: config.branch,
      commit: config.commit,
      expectedBranch: config.expected,
      workspaceRoot: this.workspaceRoot,
      runId: context.manifest.attempt_id,
      timeout: Math.min(
        config.timeout ?? context.manifest.deadlines.phases_ms.prepare,
        context.manifest.deadlines.phases_ms.prepare
      ),
    });

    for (const item of config.pre_execution ?? []) {
      const hook = this.preExecutionFactory();
      const hookContext = {
        workspaceDir: workspace.paths.modifiedDir,
        repoDir: workspace.paths.modifiedDir,
        artifactsDir: workspace.paths.artifactsDir,
        testCaseName: config.name,
        repoUrl: config.repo,
        branch: config.branch ?? workspace.branch,
        config: item.config,
      };
      if (!(await hook.checkPreconditions(hookContext))) {
        throw new Error('Pre-execution hook preconditions were not met');
      }
      const result = await hook.execute(hookContext);
      if (result.status !== 'success') {
        throw new Error(`Pre-execution failed: ${result.message}`);
      }
    }
    await redactRunnerArtifactFiles(
      workspace.paths.artifactsDir,
      phaseSecretValues(context)
    );

    const state: RuntimeState = {
      schema_version: '1.0.0',
      manifest_hash: stableHash(context.manifest),
      started_at: this.now().toISOString(),
      workspace,
    };
    await writeJson(runtimeStatePath(context), state);
  }

  async agent(context: PhaseExecutionContext): Promise<void> {
    const config = compileTestCase(context.manifest);
    const state = await loadRuntimeState(context, this.workspaceRoot);
    const adapter = this.adapterFactory(config.agent.type);
    if (!(await adapter.checkAvailability())) {
      throw new Error(
        `Agent ${config.agent.type} is not available or authenticated`
      );
    }
    const configDirectory = path.dirname(context.manifestPath);
    const prompt = resolvePromptValue(
      typeof config.agent.config?.prompt === 'string'
        ? config.agent.config.prompt
        : undefined,
      typeof config.agent.config?.prompt_file === 'string'
        ? config.agent.config.prompt_file
        : undefined,
      configDirectory
    );
    const executionContext: AgentExecutionContext = {
      workspaceDir: state.workspace.paths.modifiedDir,
      repoDir: state.workspace.paths.modifiedDir,
      artifactsDir: state.workspace.paths.artifactsDir,
      config: {
        ...config.agent.config,
        prompt,
        prompt_file: undefined,
        agent_name: config.agent.agent_name,
        model: config.agent.model,
      },
      timeout: Math.min(
        config.timeout ?? context.manifest.deadlines.phases_ms.agent,
        context.manifest.deadlines.phases_ms.agent
      ),
      env: definedEnvironment(context.environment),
    };
    const result = await adapter.execute(executionContext);
    const log = youBenchaLogSchema.parse(
      redactValue(
        adapter.normalizeLog(result.output, result),
        phaseSecretValues(context)
      )
    );
    const logPath = await saveYouBenchaLog(
      log,
      state.workspace.paths.artifactsDir
    );
    await redactRunnerArtifactFiles(
      state.workspace.paths.artifactsDir,
      phaseSecretValues(context)
    );
    await writeJson(runtimeStatePath(context), {
      ...state,
      agent: {
        log_path: logPath,
        status: result.status,
        exit_code: result.exitCode,
      },
    });
  }

  async evaluate(context: PhaseExecutionContext): Promise<void> {
    const config = compileTestCase(context.manifest);
    const state = await loadRuntimeState(context, this.workspaceRoot);
    if (state.agent === undefined) {
      throw new Error('Agent phase output is unavailable');
    }
    const agentLog = youBenchaLogSchema.parse(
      JSON.parse(await fs.readFile(state.agent.log_path, 'utf8'))
    );
    const configDirectory = path.dirname(context.manifestPath);
    const evaluators = resolveEvaluatorConfigs(
      config.evaluators,
      configDirectory
    );
    validateEvaluatorNames(evaluators);
    const results = await mapWithConcurrency(
      evaluators,
      this.maxConcurrentEvaluators,
      async (item): Promise<EvaluationResult> => {
        const implementation = this.evaluatorFactory(item.name);
        if (implementation === undefined) {
          return {
            evaluator: item.name,
            status: 'skipped',
            metrics: {},
            message: `Unknown evaluator: ${item.name}`,
            duration_ms: 0,
            timestamp: this.now().toISOString(),
          };
        }
        const evaluatorConfig = { ...(item.config ?? {}) };
        const prompt = evaluatorConfig.prompt;
        const promptFile = evaluatorConfig.prompt_file;
        if (typeof prompt === 'string' || typeof promptFile === 'string') {
          evaluatorConfig.prompt = resolvePromptValue(
            typeof prompt === 'string' ? prompt : undefined,
            typeof promptFile === 'string' ? promptFile : undefined,
            configDirectory
          );
          delete evaluatorConfig.prompt_file;
        }
        const evaluationContext: EvaluationContext = {
          modifiedDir: state.workspace.paths.modifiedDir,
          expectedDir: state.workspace.paths.expectedDir,
          artifactsDir: state.workspace.paths.artifactsDir,
          agentLog,
          config: evaluatorConfig,
          testCaseConfig: config,
        };
        try {
          return await implementation.evaluate(evaluationContext);
        } catch (error) {
          return {
            evaluator: item.name,
            status: 'skipped',
            metrics: {},
            message: `Evaluator error: ${
              error instanceof Error ? error.message : String(error)
            }`,
            duration_ms: 0,
            timestamp: this.now().toISOString(),
          };
        }
      }
    );

    const redactedResults = resultsBundleSchema.shape.evaluators.parse(
      redactValue(results, phaseSecretValues(context))
    );
    const evaluationResultsPath = path.join(
      state.workspace.paths.artifactsDir,
      'evaluation-results.json'
    );
    await writeJson(evaluationResultsPath, redactedResults);
    const bundle = await this.buildResultsBundle(
      config,
      state,
      redactedResults,
      context.manifestPath
    );
    const resultsPath = await saveResultsBundle(
      bundle,
      state.workspace.paths.artifactsDir
    );
    await redactRunnerArtifactFiles(
      state.workspace.paths.artifactsDir,
      phaseSecretValues(context)
    );
    await writeJson(runtimeStatePath(context), {
      ...state,
      evaluation_results_path: evaluationResultsPath,
      results_path: resultsPath,
    });
  }

  async postEvaluate(context: PhaseExecutionContext): Promise<void> {
    const config = compileTestCase(context.manifest);
    const state = await loadRuntimeState(context, this.workspaceRoot);
    if (state.results_path === undefined) {
      throw new Error('Evaluation results are unavailable');
    }
    const results = resultsBundleSchema.parse(
      JSON.parse(await fs.readFile(state.results_path, 'utf8'))
    );
    const postResults = [];
    for (const item of config.post_evaluation ?? []) {
      const implementation = this.postEvaluatorFactory(item.name);
      if (implementation === undefined) continue;
      const postContext: PostEvaluationContext = {
        resultsBundle: results,
        resultsBundlePath: state.results_path,
        artifactsDir: state.workspace.paths.artifactsDir,
        workspaceDir: state.workspace.paths.runDir,
        config: item.config,
      };
      try {
        if (!(await implementation.checkPreconditions(postContext))) continue;
        postResults.push(await implementation.execute(postContext));
      } catch (error) {
        postResults.push({
          post_evaluator: item.name,
          status: 'failed' as const,
          message: 'Unexpected error during post-evaluation',
          duration_ms: 0,
          timestamp: this.now().toISOString(),
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    const redactedPostResults = redactValue(
      postResults,
      phaseSecretValues(context)
    );
    await writeJson(
      path.join(
        state.workspace.paths.artifactsDir,
        'post-evaluation-results.json'
      ),
      redactedPostResults
    );
    await redactRunnerArtifactFiles(
      state.workspace.paths.artifactsDir,
      phaseSecretValues(context)
    );
  }

  async package(context: PhaseExecutionContext): Promise<void> {
    const state = await loadRuntimeState(context, this.workspaceRoot);
    await this.artifactPackageBuilder({
      manifest: context.manifest,
      artifactsDirectory: state.workspace.paths.artifactsDir,
      outputDirectory: context.outputDirectory,
      environment: definedEnvironment(context.environment),
      redactionApplied: true,
    });
  }

  private async buildResultsBundle(
    config: TestCaseConfig,
    state: RuntimeState,
    evaluations: EvaluationResult[],
    manifestPath: string
  ): Promise<ResultsBundle> {
    if (state.agent === undefined) {
      throw new Error('Agent phase output is unavailable');
    }
    const completedAt = this.now().toISOString();
    const allArtifacts = await getArtifactManifest(
      state.workspace.paths.artifactsDir
    );
    const partitioned = partitionArtifacts(allArtifacts);
    const passed = evaluations.filter(
      (result) => result.status === 'passed'
    ).length;
    const failed = evaluations.filter(
      (result) => result.status === 'failed'
    ).length;
    const skipped = evaluations.length - passed - failed;
    const environment = detectEnvironment();
    return resultsBundleSchema.parse({
      version: '1.0.0',
      test_case: {
        name: config.name,
        description: config.description,
        config_file: path.basename(manifestPath),
        config_hash: stableHash(config).slice(0, 16),
        repo: config.repo,
        branch: config.branch ?? state.workspace.branch ?? 'unknown',
        commit: state.workspace.modifiedCommit,
        expected_branch: state.workspace.expectedBranch,
      },
      execution: {
        started_at: state.started_at,
        completed_at: completedAt,
        duration_ms:
          new Date(completedAt).getTime() -
          new Date(state.started_at).getTime(),
        youbencha_version: environment.youbenchaVersion,
        environment: {
          os: `${environment.os} ${environment.osVersion}`,
          node_version: environment.nodeVersion,
          workspace_dir: state.workspace.paths.runDir,
        },
      },
      agent: {
        type: config.agent.type,
        youbencha_log_path: path.basename(state.agent.log_path),
        status: state.agent.status,
        exit_code: state.agent.exit_code,
      },
      evaluators: evaluations,
      summary: {
        total_evaluators: evaluations.length,
        passed,
        failed,
        skipped,
        overall_status:
          failed > 0
            ? 'failed'
            : passed === evaluations.length
              ? 'passed'
              : 'partial',
      },
      artifacts: {
        agent_log: path.basename(state.agent.log_path),
        agent_artifacts: partitioned.agent,
        reports: [],
        evaluator_artifacts: partitioned.evaluator,
      },
    });
  }
}

export interface RunCellPhaseOptions {
  operations?: PhaseOperations;
  stateDirectory?: string;
  outputDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  processBoundary?: ProcessBoundary;
}

export function createRunnerPhaseOrchestrator(
  options: RunCellPhaseOptions,
  phaseEnvironment: Readonly<Record<string, string>>
): PhaseOrchestrator {
  return new PhaseOrchestrator(
    options.operations ?? new SandboxPhaseOperations(),
    {
      stateDirectory: options.stateDirectory ?? RUNNER_STATE_DIRECTORY,
      outputDirectory: options.outputDirectory ?? RUNNER_OUTPUT_DIRECTORY,
      environment: phaseEnvironment,
      processBoundary:
        options.processBoundary ?? new LinuxSandboxProcessBoundary(),
    }
  );
}

export async function runCellPhase(
  argv: readonly string[],
  options: RunCellPhaseOptions = {}
): Promise<void> {
  if (argv.length !== 2) {
    throw new Error('Usage: run-cell <phase> <cell-manifest>');
  }
  const phase = e2bRunnerPhaseSchema.parse(argv[0]);
  const manifestPath = path.resolve(argv[1]);
  const manifest = e2bCellManifestSchema.parse(
    JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  );
  const phaseEnvironment = isolatePhaseEnvironment(
    manifest,
    phase,
    options.environment ?? process.env
  );
  if (options.environment === undefined) {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, phaseEnvironment);
  }
  const orchestrator = createRunnerPhaseOrchestrator(options, phaseEnvironment);
  await orchestrator.run(phase, manifest, manifestPath);
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return ['runner-cli.js', 'run-cell'].includes(path.basename(entry));
}

export async function runCellPhaseMain(
  argv: readonly string[],
  run: (args: readonly string[]) => Promise<void>,
  writeError: (message: string) => void,
  markFailed: () => void,
  enabled = true
): Promise<void> {
  if (!enabled) return;
  try {
    await run(argv);
  } catch (error) {
    writeError(
      `run-cell failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    markFailed();
  }
}

export function writeRunnerError(message: string): void {
  process.stderr.write(message);
}

export function markRunnerFailed(): void {
  process.exitCode = 1;
}

void runCellPhaseMain(
  process.argv.slice(2),
  runCellPhase,
  writeRunnerError,
  markRunnerFailed,
  isMainModule()
);

export const RUNNER_FIXED_PATHS = {
  manifest: E2B_CELL_MANIFEST_PATH,
  outputManifest: E2B_OUTPUT_MANIFEST_PATH,
  outputArchive: E2B_OUTPUT_ARCHIVE_PATH,
} as const;
