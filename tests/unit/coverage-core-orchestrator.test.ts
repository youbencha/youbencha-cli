import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Orchestrator } from '../../src/core/orchestrator.js';
import type { Workspace } from '../../src/core/workspace.js';
import type {
  AgentAdapter,
  AgentExecutionResult,
} from '../../src/adapters/base.js';
import type { Evaluator, EvaluationResult } from '../../src/evaluators/base.js';
import type { PreExecution } from '../../src/pre-execution/base.js';
import type { PostEvaluation } from '../../src/post-evaluation/base.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { TestCaseConfig } from '../../src/schemas/testcase.schema.js';
import type { EvalConfig } from '../../src/schemas/eval.schema.js';
import type { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';
import { ScriptPreExecution } from '../../src/pre-execution/script.js';
import { WebhookPostEvaluation } from '../../src/post-evaluation/webhook.js';
import { DatabasePostEvaluation } from '../../src/post-evaluation/database.js';
import { ScriptPostEvaluation } from '../../src/post-evaluation/script.js';
import { CopilotCLIAdapter } from '../../src/adapters/copilot-cli.js';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { CodexCLIAdapter } from '../../src/adapters/codex-cli.js';

const copyMock = jest.fn();
jest.mock('fs-extra', () => ({
  __esModule: true,
  default: { copy: copyMock },
}));

interface OrchestratorInternals {
  options: Record<string, unknown>;
  workspaceManager: {
    createWorkspace: jest.Mock;
    cleanup: jest.Mock;
  };
  setupWorkspace(config: unknown, runId?: string): Promise<Workspace>;
  runPreExecutions(config: unknown, workspace: Workspace): Promise<unknown[]>;
  executeAgent(
    config: unknown,
    workspace: Workspace,
    configDirectory: string
  ): Promise<{
    agentLog: YouBenchaLog;
    agentExecution: ResultsBundle['agent'];
  }>;
  runEvaluators(
    config: unknown,
    workspace: Workspace,
    log: YouBenchaLog,
    configDirectory: string
  ): Promise<EvaluationResult[]>;
  runEvaluatorsForEvalOnly(
    config: EvalConfig,
    modifiedDirectory: string,
    expectedDirectory: string | undefined,
    artifactsDirectory: string,
    log: YouBenchaLog
  ): Promise<EvaluationResult[]>;
  buildResultsBundle(
    config: unknown,
    configFile: string,
    workspace: Workspace,
    execution: ResultsBundle['agent'],
    logPath: string,
    evaluations: EvaluationResult[],
    startedAt: string
  ): Promise<ResultsBundle>;
  buildResultsBundleForEvalOnly(
    config: EvalConfig,
    configFile: string,
    modifiedDirectory: string,
    expectedDirectory: string | undefined,
    runDirectory: string,
    artifactsDirectory: string,
    logPath: string,
    evaluations: EvaluationResult[],
    startedAt: string
  ): Promise<ResultsBundle>;
  runPostEvaluations(
    config: unknown,
    result: ResultsBundle,
    resultPath: string,
    workspace: Workspace
  ): Promise<unknown[]>;
  runPostEvaluationsForEvalOnly(
    config: EvalConfig,
    result: ResultsBundle,
    resultPath: string,
    workspace: Pick<Workspace, 'paths'>
  ): Promise<unknown[]>;
  calculateSummary(results: EvaluationResult[]): ResultsBundle['summary'];
  generateConfigHash(config: TestCaseConfig): string;
  getAgentAdapter(type: string): AgentAdapter;
  getEvaluator(name: string): Evaluator | null;
  getPreExecution(name: string): PreExecution | null;
  getPostEvaluation(name: string): PostEvaluation | null;
}

const internals = (orchestrator: Orchestrator): OrchestratorInternals =>
  orchestrator as unknown as OrchestratorInternals;

const timestamp = '2026-07-29T00:00:00.000Z';

function workspace(root: string): Workspace {
  const runDirectory = path.join(root, 'run');
  return {
    runId: 'run',
    paths: {
      root,
      runDir: runDirectory,
      modifiedDir: path.join(runDirectory, 'source-modified'),
      expectedDir: path.join(runDirectory, 'source-expected'),
      artifactsDir: path.join(runDirectory, 'artifacts'),
      evaluatorArtifactsDir: path.join(runDirectory, 'artifacts', 'evaluators'),
      lockFile: path.join(runDirectory, '.lock'),
    },
    repo: 'https://example.com/repo.git',
    branch: 'main',
    modifiedCommit: 'commit',
    expectedBranch: 'expected',
    expectedCommit: 'expected-commit',
    createdAt: timestamp,
  };
}

function log(
  measurementSource: YouBenchaLog['usage']['measurement_source'] = 'unavailable',
  usage: Partial<YouBenchaLog['usage']> = {}
): YouBenchaLog {
  return {
    version: '1.0.0',
    agent: { name: 'agent', version: '1', adapter_version: '1' },
    model: { name: 'model', provider: 'provider', parameters: {} },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 0,
      status: 'success',
      exit_code: 0,
    },
    messages: [],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      measurement_source: measurementSource,
      ...usage,
    },
    errors: [],
    environment: {
      os: 'test',
      node_version: '20',
      youbencha_version: '1',
      working_directory: '/workspace',
    },
  };
}

function evaluation(
  status: EvaluationResult['status'],
  evaluator = 'git-diff'
): EvaluationResult {
  return {
    evaluator,
    status,
    metrics: {},
    message: status,
    duration_ms: 0,
    timestamp,
  };
}

function testCase(overrides: Partial<TestCaseConfig> = {}): TestCaseConfig {
  return {
    name: 'case',
    description: 'description',
    repo: 'https://example.com/repo.git',
    branch: 'main',
    agent: { type: 'copilot-cli', config: { prompt: 'do work' } },
    evaluators: [{ name: 'git-diff', config: {} }],
    ...overrides,
  };
}

function resultBundle(overrides: Partial<ResultsBundle> = {}): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'description',
      config_file: 'case.yaml',
      config_hash: 'hash',
      repo: 'https://example.com/repo.git',
      branch: 'main',
      commit: 'commit',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 0,
      youbencha_version: '1',
      environment: {
        os: 'test',
        node_version: '20',
        workspace_dir: '/workspace',
      },
    },
    agent: {
      type: 'copilot-cli',
      youbencha_log_path: 'youbencha.log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [evaluation('passed')],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
    ...overrides,
  };
}

function adapter(
  available: boolean,
  normalizedLog: YouBenchaLog = log()
): AgentAdapter {
  const execution: AgentExecutionResult = {
    exitCode: 0,
    status: 'success',
    output: 'output',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1000,
    errors: [],
  };
  return {
    name: 'fake',
    version: '1',
    checkAvailability: jest.fn().mockResolvedValue(available),
    execute: jest.fn().mockResolvedValue(execution),
    normalizeLog: jest.fn().mockReturnValue(normalizedLog),
  };
}

describe('orchestrator coverage edges', () => {
  let temporaryDirectory: string;
  let testWorkspace: Workspace;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-orchestrator-coverage-')
    );
    testWorkspace = workspace(temporaryDirectory);
    await fs.mkdir(testWorkspace.paths.modifiedDir, { recursive: true });
    await fs.mkdir(testWorkspace.paths.expectedDir!, { recursive: true });
    await fs.mkdir(testWorkspace.paths.artifactsDir, { recursive: true });
    copyMock.mockReset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('constructs registries, summaries, and stable hashes', () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    expect(subject.getAgentAdapter('copilot-cli')).toBeInstanceOf(
      CopilotCLIAdapter
    );
    expect(subject.getAgentAdapter('claude-code')).toBeInstanceOf(
      ClaudeCodeAdapter
    );
    expect(subject.getAgentAdapter('codex-cli')).toBeInstanceOf(
      CodexCLIAdapter
    );
    expect(() => subject.getAgentAdapter('unknown')).toThrow('Unknown agent');

    expect(subject.getEvaluator('git-diff')?.name).toBe('git-diff');
    expect(subject.getEvaluator('expected-diff')?.name).toBe('expected-diff');
    expect(subject.getEvaluator('agentic-judge')?.name).toBe('agentic-judge');
    expect(subject.getEvaluator('agentic-judge-custom')?.name).toBe(
      'agentic-judge-custom'
    );
    expect(subject.getEvaluator('agentic-judge:custom')?.name).toBe(
      'agentic-judge:custom'
    );
    expect(subject.getEvaluator('unknown')).toBeNull();

    expect(subject.getPreExecution('script')).toBeInstanceOf(
      ScriptPreExecution
    );
    expect(subject.getPreExecution('unknown')).toBeNull();
    expect(subject.getPostEvaluation('webhook')).toBeInstanceOf(
      WebhookPostEvaluation
    );
    expect(subject.getPostEvaluation('database')).toBeInstanceOf(
      DatabasePostEvaluation
    );
    expect(subject.getPostEvaluation('script')).toBeInstanceOf(
      ScriptPostEvaluation
    );
    expect(subject.getPostEvaluation('unknown')).toBeNull();

    expect(
      subject.calculateSummary([evaluation('passed')]).overall_status
    ).toBe('passed');
    expect(
      subject.calculateSummary([evaluation('failed')]).overall_status
    ).toBe('failed');
    expect(
      subject.calculateSummary([evaluation('passed'), evaluation('skipped')])
        .overall_status
    ).toBe('partial');
    expect(subject.generateConfigHash(testCase())).toMatch(/^[a-f0-9]{16}$/);
  });

  test('sets up workspaces with explicit and default timeouts', async () => {
    const orchestrator = new Orchestrator({ defaultTimeout: 123 });
    const subject = internals(orchestrator);
    const createWorkspace = jest.fn().mockResolvedValue(testWorkspace);
    subject.workspaceManager = {
      createWorkspace,
      cleanup: jest.fn(),
    };
    await expect(
      subject.setupWorkspace(
        {
          ...testCase({ timeout: 5, workspace_name: 'named' }),
          evaluators: [{ name: 'git-diff', config: {} }],
        },
        'run-id'
      )
    ).resolves.toBe(testWorkspace);
    expect(createWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 5, runId: 'run-id' })
    );
    await subject.setupWorkspace({
      ...testCase(),
      evaluators: [{ name: 'git-diff', config: {} }],
    });
    expect(createWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 123 })
    );
  });

  test('runs all pre-execution outcomes and catches Error and string failures', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    expect(
      await subject.runPreExecutions(
        { ...testCase(), evaluators: [], pre_execution: undefined },
        testWorkspace
      )
    ).toEqual([]);
    expect(
      await subject.runPreExecutions(
        { ...testCase(), evaluators: [], pre_execution: [] },
        testWorkspace
      )
    ).toEqual([]);

    const successful: PreExecution = {
      name: 'success',
      description: 'success',
      checkPreconditions: jest.fn().mockResolvedValue(true),
      execute: jest.fn().mockResolvedValue({
        pre_executor: 'success',
        status: 'success',
        message: 'success',
        duration_ms: 0,
        timestamp,
      }),
    };
    const failed: PreExecution = {
      ...successful,
      name: 'failed',
      execute: jest.fn().mockResolvedValue({
        pre_executor: 'failed',
        status: 'failed',
        message: 'failed',
        duration_ms: 0,
        timestamp,
      }),
    };
    const skipped: PreExecution = {
      ...successful,
      name: 'skipped',
      execute: jest.fn().mockResolvedValue({
        pre_executor: 'skipped',
        status: 'skipped',
        message: 'skipped',
        duration_ms: 0,
        timestamp,
      }),
    };
    const precondition: PreExecution = {
      ...successful,
      name: 'precondition',
      checkPreconditions: jest.fn().mockResolvedValue(false),
    };
    const error: PreExecution = {
      ...successful,
      name: 'error',
      checkPreconditions: jest.fn().mockRejectedValue(new Error('broken')),
    };
    const stringError: PreExecution = {
      ...successful,
      name: 'string',
      checkPreconditions: jest.fn().mockRejectedValue('broken string'),
    };
    const implementations = new Map<string, PreExecution | null>([
      ['success', successful],
      ['failed', failed],
      ['skipped', skipped],
      ['precondition', precondition],
      ['error', error],
      ['string', stringError],
      ['unknown', null],
    ]);
    jest
      .spyOn(subject, 'getPreExecution')
      .mockImplementation((name) => implementations.get(name) ?? null);

    const results = await subject.runPreExecutions(
      {
        ...testCase({ branch: undefined }),
        evaluators: [],
        pre_execution: [...implementations.keys()].map((name) => ({
          name,
          config: undefined,
        })),
      },
      testWorkspace
    );
    expect(results).toHaveLength(7);
    expect(
      results.map((entry) => (entry as { status: string }).status)
    ).toEqual(expect.arrayContaining(['success', 'failed', 'skipped']));
  });

  test('executes agents with prompt, copy, availability, and usage variants', async () => {
    const orchestrator = new Orchestrator({
      agentModel: 'default-model',
      agentTimeout: 111,
    });
    const subject = internals(orchestrator);
    copyMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce('copy failed');
    const measured = adapter(
      true,
      log('provider_reported', { cost_usd: 1, credits: 2 })
    );
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValueOnce(measured);
    const executed = await subject.executeAgent(
      {
        ...testCase({
          branch: undefined,
          timeout: undefined,
          agent: {
            type: 'copilot-cli',
            agent_name: 'reviewer',
            config: { prompt: 'inline' },
          },
        }),
        evaluators: [],
      },
      testWorkspace,
      temporaryDirectory
    );
    expect(executed.agentExecution.status).toBe('success');
    expect(measured.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 111,
        config: expect.objectContaining({
          prompt: 'inline',
          model: 'default-model',
        }),
      })
    );

    const estimated = adapter(
      true,
      log('estimated', { estimated_cost_usd: 2 })
    );
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValueOnce(estimated);
    await subject.executeAgent(
      {
        ...testCase({
          agent: {
            type: 'copilot-cli',
            model: 'explicit-model',
            config: {},
          },
          timeout: 5,
        }),
        evaluators: [],
      },
      testWorkspace,
      temporaryDirectory
    );

    const unavailable = adapter(false);
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValueOnce(unavailable);
    await expect(
      subject.executeAgent(
        { ...testCase(), evaluators: [] },
        testWorkspace,
        temporaryDirectory
      )
    ).rejects.toThrow('not available');
  });

  test('covers prompt files, copy error types, legacy usage, and timeout fallbacks', async () => {
    const promptFile = path.join(temporaryDirectory, 'prompt.md');
    await fs.writeFile(promptFile, 'file prompt');
    const orchestrator = new Orchestrator({
      agentTimeout: undefined,
      defaultTimeout: undefined,
    });
    const subject = internals(orchestrator);
    copyMock
      .mockRejectedValueOnce(new Error('github copy failed'))
      .mockResolvedValueOnce(undefined);
    const legacyLog = log('measured');
    legacyLog.usage.measurement_source =
      undefined as unknown as YouBenchaLog['usage']['measurement_source'];
    const legacy = adapter(true, legacyLog);
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValue(legacy);
    await subject.executeAgent(
      {
        ...testCase({
          timeout: undefined,
          agent: {
            type: 'copilot-cli',
            agent_name: 'reviewer',
            config: { prompt_file: 'prompt.md' },
          },
        }),
        evaluators: [],
      },
      testWorkspace,
      temporaryDirectory
    );
    expect(legacy.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 300000,
        config: expect.objectContaining({ prompt: 'file prompt' }),
      })
    );

    const noConfig = adapter(true);
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValue(noConfig);
    await subject.executeAgent(
      {
        ...testCase({
          agent: {
            type: 'copilot-cli',
            config: undefined,
          },
        }),
        evaluators: [],
      },
      testWorkspace,
      temporaryDirectory
    );
    expect(noConfig.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ prompt: undefined }),
      })
    );

    copyMock
      .mockRejectedValueOnce('github string failure')
      .mockRejectedValueOnce(new Error('claude error failure'));
    const bothCopyFailures = adapter(true);
    jest.spyOn(subject, 'getAgentAdapter').mockReturnValue(bothCopyFailures);
    await subject.executeAgent(
      {
        ...testCase({
          agent: {
            type: 'copilot-cli',
            agent_name: 'reviewer',
            config: { prompt: 'prompt' },
          },
        }),
        evaluators: [],
      },
      testWorkspace,
      temporaryDirectory
    );
  });

  test('runs evaluator variants for normal and eval-only workflows', async () => {
    const orchestrator = new Orchestrator({ maxConcurrentEvaluators: 1 });
    const subject = internals(orchestrator);
    const good: Evaluator = {
      name: 'good',
      description: 'good',
      requiresExpectedReference: false,
      checkPreconditions: jest.fn().mockResolvedValue(true),
      evaluate: jest.fn().mockResolvedValue(evaluation('passed', 'good')),
    };
    const error: Evaluator = {
      ...good,
      name: 'error',
      evaluate: jest.fn().mockRejectedValue(new Error('evaluator error')),
    };
    const stringError: Evaluator = {
      ...good,
      name: 'string',
      evaluate: jest.fn().mockRejectedValue('string error'),
    };
    jest.spyOn(subject, 'getEvaluator').mockImplementation((name) => {
      if (name === 'good') return good;
      if (name === 'error') return error;
      if (name === 'string') return stringError;
      return null;
    });

    await fs.writeFile(
      path.join(temporaryDirectory, 'evaluator-prompt.md'),
      'file'
    );
    const config = {
      ...testCase(),
      evaluators: [
        { name: 'unknown', config: undefined },
        { name: 'good', config: { prompt: 'inline' } },
        { name: 'good', config: { prompt_file: 'evaluator-prompt.md' } },
        {
          name: 'good',
          config: { prompt: 'one', prompt_file: 'two.md' },
        },
        { name: 'error', config: {} },
        { name: 'string', config: {} },
      ],
    };
    const normal = await subject.runEvaluators(
      config,
      testWorkspace,
      log(),
      temporaryDirectory
    );
    expect(normal.map((entry) => entry.status)).toEqual([
      'skipped',
      'passed',
      'passed',
      'skipped',
      'skipped',
      'skipped',
    ]);

    const evalOnly = await subject.runEvaluatorsForEvalOnly(
      {
        name: 'eval',
        directory: testWorkspace.paths.modifiedDir,
        evaluators: config.evaluators,
      } as EvalConfig,
      testWorkspace.paths.modifiedDir,
      undefined,
      testWorkspace.paths.artifactsDir,
      log()
    );
    expect(evalOnly.map((entry) => entry.status)).toEqual([
      'skipped',
      'passed',
      'passed',
      'passed',
      'skipped',
      'skipped',
    ]);
  });

  test('uses concurrency and config fallbacks for evaluator execution', async () => {
    const orchestrator = new Orchestrator({
      maxConcurrentEvaluators: undefined,
    });
    const subject = internals(orchestrator);
    const good: Evaluator = {
      name: 'good',
      description: 'good',
      requiresExpectedReference: false,
      checkPreconditions: jest.fn().mockResolvedValue(true),
      evaluate: jest.fn().mockResolvedValue(evaluation('passed', 'good')),
    };
    jest.spyOn(subject, 'getEvaluator').mockReturnValue(good);
    const config = {
      ...testCase(),
      evaluators: [{ name: 'good', config: undefined }],
    };
    expect(
      await subject.runEvaluators(
        config,
        testWorkspace,
        log(),
        temporaryDirectory
      )
    ).toHaveLength(1);
    expect(
      await subject.runEvaluatorsForEvalOnly(
        {
          name: 'eval',
          directory: testWorkspace.paths.modifiedDir,
          evaluators: config.evaluators,
        } as EvalConfig,
        testWorkspace.paths.modifiedDir,
        undefined,
        testWorkspace.paths.artifactsDir,
        log()
      )
    ).toHaveLength(1);
  });

  test('builds normal and eval-only bundles and partitions artifact manifests', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    await fs.mkdir(
      path.join(testWorkspace.paths.artifactsDir, 'codex-cli-logs'),
      { recursive: true }
    );
    await fs.mkdir(
      path.join(testWorkspace.paths.artifactsDir, 'custom-evaluator'),
      { recursive: true }
    );
    await Promise.all([
      fs.writeFile(
        path.join(testWorkspace.paths.artifactsDir, 'youbencha.log.json'),
        '{}'
      ),
      fs.writeFile(
        path.join(
          testWorkspace.paths.artifactsDir,
          'codex-cli-logs',
          'events.jsonl'
        ),
        ''
      ),
      fs.writeFile(
        path.join(
          testWorkspace.paths.artifactsDir,
          'custom-evaluator',
          'result.json'
        ),
        '{}'
      ),
    ]);

    const normal = await subject.buildResultsBundle(
      { ...testCase({ branch: undefined }), evaluators: [] },
      'case.yaml',
      { ...testWorkspace, branch: undefined },
      resultBundle().agent,
      path.join(testWorkspace.paths.artifactsDir, 'youbencha.log.json'),
      [evaluation('skipped')],
      timestamp
    );
    expect(normal.test_case.branch).toBe('unknown');
    expect(normal.artifacts.agent_artifacts).toEqual([
      path.join('codex-cli-logs', 'events.jsonl'),
    ]);
    expect(normal.artifacts.evaluator_artifacts).toEqual([
      path.join('custom-evaluator', 'result.json'),
    ]);

    const evalOnlyWithoutExpected = await subject.buildResultsBundleForEvalOnly(
      {
        name: 'eval',
        directory: testWorkspace.paths.modifiedDir,
        evaluators: [],
      } as EvalConfig,
      'eval.yaml',
      testWorkspace.paths.modifiedDir,
      undefined,
      testWorkspace.paths.runDir,
      testWorkspace.paths.artifactsDir,
      path.join(testWorkspace.paths.artifactsDir, 'youbencha.log.json'),
      [],
      timestamp
    );
    expect(evalOnlyWithoutExpected.test_case.expected_branch).toBeUndefined();
    const evalOnlyWithExpected = await subject.buildResultsBundleForEvalOnly(
      {
        name: 'eval',
        description: 'description',
        directory: testWorkspace.paths.modifiedDir,
        evaluators: [],
      } as EvalConfig,
      'eval.yaml',
      testWorkspace.paths.modifiedDir,
      testWorkspace.paths.expectedDir,
      testWorkspace.paths.runDir,
      testWorkspace.paths.artifactsDir,
      path.join(testWorkspace.paths.artifactsDir, 'youbencha.log.json'),
      [],
      timestamp
    );
    expect(evalOnlyWithExpected.test_case.expected_branch).toBe(
      'eval-only-expected'
    );
  });

  test('runs post-evaluation outcomes and defensive settled rejection handling', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    expect(
      await subject.runPostEvaluations(
        { post_evaluation: undefined },
        resultBundle(),
        'results.json',
        testWorkspace
      )
    ).toEqual([]);
    expect(
      await subject.runPostEvaluations(
        { post_evaluation: [] },
        resultBundle(),
        'results.json',
        testWorkspace
      )
    ).toEqual([]);

    const success: PostEvaluation = {
      name: 'success',
      description: 'success',
      checkPreconditions: jest.fn().mockResolvedValue(true),
      execute: jest.fn().mockResolvedValue({
        post_evaluator: 'success',
        status: 'success',
        message: 'success',
        duration_ms: 0,
        timestamp,
      }),
    };
    const failed: PostEvaluation = {
      ...success,
      name: 'failed',
      execute: jest.fn().mockResolvedValue({
        post_evaluator: 'failed',
        status: 'failed',
        message: 'failed',
        duration_ms: 0,
        timestamp,
      }),
    };
    const skipped: PostEvaluation = {
      ...success,
      name: 'skipped',
      execute: jest.fn().mockResolvedValue({
        post_evaluator: 'skipped',
        status: 'skipped',
        message: 'skipped',
        duration_ms: 0,
        timestamp,
      }),
    };
    const precondition: PostEvaluation = {
      ...success,
      name: 'precondition',
      checkPreconditions: jest.fn().mockResolvedValue(false),
    };
    const error: PostEvaluation = {
      ...success,
      name: 'error',
      checkPreconditions: jest.fn().mockRejectedValue(new Error('error')),
    };
    const stringError: PostEvaluation = {
      ...success,
      name: 'string',
      checkPreconditions: jest.fn().mockRejectedValue('string error'),
    };
    const implementations = new Map<string, PostEvaluation | null>([
      ['success', success],
      ['failed', failed],
      ['skipped', skipped],
      ['precondition', precondition],
      ['error', error],
      ['string', stringError],
      ['unknown', null],
    ]);
    jest
      .spyOn(subject, 'getPostEvaluation')
      .mockImplementation((name) => implementations.get(name) ?? null);
    const config = {
      post_evaluation: [...implementations.keys()].map((name) => ({
        name,
        config: {},
      })),
    };
    const results = await subject.runPostEvaluations(
      config,
      resultBundle(),
      'results.json',
      testWorkspace
    );
    expect(results).toHaveLength(7);

    const allSettled = jest
      .spyOn(Promise, 'allSettled')
      .mockResolvedValueOnce([
        { status: 'rejected', reason: new Error('rejected') },
      ]);
    const rejected = await subject.runPostEvaluations(
      { post_evaluation: [{ name: 'success', config: {} }] },
      resultBundle(),
      'results.json',
      testWorkspace
    );
    expect(rejected[0]).toMatchObject({
      status: 'failed',
      error: { message: 'rejected' },
    });
    allSettled.mockResolvedValueOnce([
      { status: 'rejected', reason: 'string rejected' },
    ]);
    expect(
      (
        await subject.runPostEvaluations(
          { post_evaluation: [{ name: 'success', config: {} }] },
          resultBundle(),
          'results.json',
          testWorkspace
        )
      )[0]
    ).toMatchObject({ error: { message: 'string rejected' } });
  });

  test('reuses post-evaluation logic for eval-only and handles empty config', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    expect(
      await subject.runPostEvaluationsForEvalOnly(
        {
          name: 'eval',
          directory: testWorkspace.paths.modifiedDir,
          evaluators: [],
        } as EvalConfig,
        resultBundle(),
        'results.json',
        testWorkspace
      )
    ).toEqual([]);
    const post = jest
      .spyOn(subject, 'runPostEvaluations')
      .mockResolvedValue([]);
    await subject.runPostEvaluationsForEvalOnly(
      {
        name: 'eval',
        directory: testWorkspace.paths.modifiedDir,
        evaluators: [],
        post_evaluation: [{ name: 'script', config: { command: 'echo' } }],
      } as EvalConfig,
      resultBundle(),
      'results.json',
      testWorkspace
    );
    expect(post).toHaveBeenCalled();
  });

  test('runs public evaluation workflow through hooks, persistence, and cleanup', async () => {
    const orchestrator = new Orchestrator({ keepWorkspace: false });
    const subject = internals(orchestrator);
    subject.workspaceManager = {
      createWorkspace: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(subject, 'setupWorkspace').mockResolvedValue(testWorkspace);
    jest.spyOn(subject, 'runPreExecutions').mockResolvedValue([
      {
        pre_executor: 'script',
        status: 'success',
        message: 'success',
        duration_ms: 0,
        timestamp,
      },
    ]);
    jest.spyOn(subject, 'executeAgent').mockResolvedValue({
      agentLog: log(),
      agentExecution: resultBundle().agent,
    });
    jest
      .spyOn(subject, 'runEvaluators')
      .mockResolvedValue([evaluation('passed')]);
    jest.spyOn(subject, 'buildResultsBundle').mockResolvedValue(resultBundle());
    jest.spyOn(subject, 'runPostEvaluations').mockResolvedValue([]);

    const result = await orchestrator.runEvaluation(
      testCase({
        pre_execution: [{ name: 'script', config: { command: 'echo' } }],
        post_evaluation: [
          { name: 'script', config: { command: 'echo', args: [] } },
        ],
      }),
      path.join(temporaryDirectory, 'case.yaml'),
      { workspaceRunId: 'stable-run' }
    );
    expect(result.version).toBe('1.0.0');
    expect(subject.workspaceManager.cleanup).toHaveBeenCalledWith(
      testWorkspace
    );
  });

  test('public evaluation reports failed pre-hooks and cleanup failures', async () => {
    const orchestrator = new Orchestrator({ keepWorkspace: false });
    const subject = internals(orchestrator);
    subject.workspaceManager = {
      createWorkspace: jest.fn(),
      cleanup: jest.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    jest.spyOn(subject, 'setupWorkspace').mockResolvedValue(testWorkspace);
    jest.spyOn(subject, 'runPreExecutions').mockResolvedValue([
      {
        pre_executor: 'script',
        status: 'failed',
        message: 'pre failed',
        duration_ms: 0,
        timestamp,
      },
    ]);
    await expect(
      orchestrator.runEvaluation(
        testCase({
          pre_execution: [{ name: 'script', config: { command: 'echo' } }],
        }),
        path.join(temporaryDirectory, 'case.yaml')
      )
    ).rejects.toThrow('Pre-execution failed: pre failed');
  });

  test('validates eval-only directories and runs complete public workflow', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    const file = path.join(temporaryDirectory, 'file');
    await fs.writeFile(file, 'file');
    const base = {
      name: 'eval',
      directory: path.join(temporaryDirectory, 'missing'),
      evaluators: [{ name: 'git-diff', config: {} }],
      output_dir: path.join(temporaryDirectory, 'output'),
    } as EvalConfig;
    await expect(
      orchestrator.runEvaluationOnly(base, 'eval.yaml')
    ).rejects.toThrow('Directory does not exist');
    await expect(
      orchestrator.runEvaluationOnly({ ...base, directory: file }, 'eval.yaml')
    ).rejects.toThrow('Directory does not exist');
    await expect(
      orchestrator.runEvaluationOnly(
        {
          ...base,
          directory: testWorkspace.paths.modifiedDir,
          expected_directory: path.join(temporaryDirectory, 'missing-expected'),
        },
        'eval.yaml'
      )
    ).rejects.toThrow('Expected directory does not exist');
    await expect(
      orchestrator.runEvaluationOnly(
        {
          ...base,
          directory: testWorkspace.paths.modifiedDir,
          expected_directory: file,
        },
        'eval.yaml'
      )
    ).rejects.toThrow('Expected directory does not exist');

    const evaluator: Evaluator = {
      name: 'git-diff',
      description: 'fake',
      requiresExpectedReference: false,
      checkPreconditions: jest.fn().mockResolvedValue(true),
      evaluate: jest.fn().mockResolvedValue(evaluation('passed')),
    };
    jest.spyOn(subject, 'getEvaluator').mockReturnValue(evaluator);
    jest.spyOn(subject, 'getPostEvaluation').mockReturnValue(null);
    const result = await orchestrator.runEvaluationOnly(
      {
        ...base,
        directory: testWorkspace.paths.modifiedDir,
        expected_directory: testWorkspace.paths.expectedDir,
        post_evaluation: [{ name: 'unknown', config: {} }],
      },
      'eval.yaml'
    );
    expect(result.agent.type).toBe('manual');
    expect(result.test_case.expected_branch).toBe('eval-only-expected');
  });

  test('eval-only workflow logs and rethrows inner failures', async () => {
    const orchestrator = new Orchestrator();
    const subject = internals(orchestrator);
    jest
      .spyOn(subject, 'runEvaluatorsForEvalOnly')
      .mockRejectedValue(new Error('inner failure'));
    await expect(
      orchestrator.runEvaluationOnly(
        {
          name: 'eval',
          directory: testWorkspace.paths.modifiedDir,
          evaluators: [{ name: 'git-diff', config: {} }],
          output_dir: path.join(temporaryDirectory, 'output'),
        },
        'eval.yaml'
      )
    ).rejects.toThrow('inner failure');
  });

  test('uses the eval-only default output directory', async () => {
    const originalDirectory = process.cwd();
    process.chdir(temporaryDirectory);
    try {
      const orchestrator = new Orchestrator();
      const subject = internals(orchestrator);
      const evaluator: Evaluator = {
        name: 'git-diff',
        description: 'fake',
        requiresExpectedReference: false,
        checkPreconditions: jest.fn().mockResolvedValue(true),
        evaluate: jest.fn().mockResolvedValue(evaluation('passed')),
      };
      jest.spyOn(subject, 'getEvaluator').mockReturnValue(evaluator);
      const result = await orchestrator.runEvaluationOnly(
        {
          name: 'eval',
          directory: testWorkspace.paths.modifiedDir,
          evaluators: [{ name: 'git-diff', config: {} }],
        },
        'eval.yaml'
      );
      expect(result.agent.type).toBe('manual');
      await expect(
        fs.access(path.join(temporaryDirectory, '.youbencha-eval'))
      ).resolves.toBeUndefined();
    } finally {
      process.chdir(originalDirectory);
    }
  });
});
