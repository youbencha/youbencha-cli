import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type {
  AgentAdapter,
  AgentExecutionContext,
  AgentExecutionResult,
} from '../../src/adapters/base.js';
import {
  createRunnerAgentAdapter,
  createRunnerEvaluator,
  createRunnerPostEvaluator,
  SandboxPhaseOperations,
} from '../../src/e2b/runner-cli.js';
import type { PhaseExecutionContext } from '../../src/e2b/phase-orchestrator.js';
import type { E2BCellManifest } from '../../src/e2b/schemas.js';
import { stableHash } from '../../src/experiments/identity.js';
import type { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';

function manifest(): E2BCellManifest {
  return {
    schema_version: '1.0.0',
    experiment_id: 'experiment',
    cell_id: 'a'.repeat(64),
    attempt_id: 'attempt',
    target: {
      id: 'target',
      agent_type: 'codex-cli',
      expected_harness_version: '1',
      adapter_schema_version: '1',
      config: { prompt: 'do work' },
    },
    task: {
      name: 'task',
      description: 'task',
      repo: 'https://example.test/repo.git',
      evaluators: [{ name: 'git-diff' }],
    },
    template: { template_id: 'template', build_id: 'build' },
    required_capabilities: [
      {
        component: 'agent',
        type: 'codex-cli',
        version: '1',
        adapter_schema_version: '1',
      },
    ],
    network: { inbound: 'none', outbound: 'none' },
    deadlines: {
      phases_ms: {
        prepare: 100,
        agent: 100,
        evaluate: 100,
        post_evaluate: 100,
        package: 100,
      },
      collection_grace_ms: 0,
      cleanup_grace_ms: 0,
      sandbox_ttl_ms: 500,
      watchdog_ms: 500,
    },
    artifact_limits: {
      max_files: 10,
      max_file_bytes: 10000,
      max_compressed_bytes: 10000,
      max_uncompressed_bytes: 20000,
    },
    secret_references: [],
  };
}

function result(): AgentExecutionResult {
  return {
    status: 'success',
    exitCode: 0,
    output: 'done',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:00.010Z',
    durationMs: 10,
    errors: [],
  };
}

function log(workspace: string): YouBenchaLog {
  return {
    version: '1.0.0',
    agent: { name: 'codex', version: '1', adapter_version: '1' },
    model: { name: 'model', provider: 'OpenAI', parameters: {} },
    execution: {
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:00.010Z',
      duration_ms: 10,
      exit_code: 0,
      status: 'success',
    },
    messages: [],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      measurement_source: 'unavailable',
    },
    errors: [],
    environment: {
      os: 'test',
      node_version: process.version,
      youbencha_version: 'test',
      working_directory: workspace,
    },
  };
}

describe('SandboxPhaseOperations injected runtime boundaries', () => {
  test('constructs every closed runner implementation', () => {
    expect(createRunnerAgentAdapter('copilot-cli').name).toBe('copilot-cli');
    expect(createRunnerAgentAdapter('claude-code').name).toBe('claude-code');
    expect(createRunnerAgentAdapter('codex-cli').name).toBe('codex-cli');
    expect(() => createRunnerAgentAdapter('unknown')).toThrow(/Unknown/);

    expect(createRunnerEvaluator('git-diff')?.name).toBe('git-diff');
    expect(createRunnerEvaluator('expected-diff')?.name).toBe('expected-diff');
    expect(createRunnerEvaluator('agentic-judge')?.name).toBe('agentic-judge');
    expect(createRunnerEvaluator('agentic-judge-custom')?.name).toBe(
      'agentic-judge-custom'
    );
    expect(createRunnerEvaluator('agentic-judge:custom')?.name).toBe(
      'agentic-judge:custom'
    );
    expect(createRunnerEvaluator('unknown')).toBeUndefined();

    expect(createRunnerPostEvaluator('webhook')?.name).toBe('webhook');
    expect(createRunnerPostEvaluator('database')?.name).toBe('database');
    expect(createRunnerPostEvaluator('script')?.name).toBe('script');
    expect(createRunnerPostEvaluator('unknown')).toBeUndefined();
  });

  test('executes agent and unknown-evaluator phases from persisted state', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'yb-runner-coverage-')
    );
    const workspaceRoot = path.join(root, 'workspace');
    const stateDirectory = path.join(root, 'state');
    const artifactsDir = path.join(workspaceRoot, 'artifacts');
    const modifiedDir = path.join(workspaceRoot, 'modified');
    await Promise.all([
      fs.mkdir(stateDirectory, { recursive: true }),
      fs.mkdir(artifactsDir, { recursive: true }),
      fs.mkdir(modifiedDir, { recursive: true }),
    ]);
    const value = manifest();
    const runtimeState = {
      schema_version: '1.0.0',
      manifest_hash: stableHash(value),
      started_at: '2026-01-01T00:00:00.000Z',
      workspace: {
        runId: 'attempt',
        paths: {
          root: workspaceRoot,
          runDir: workspaceRoot,
          modifiedDir,
          artifactsDir,
          evaluatorArtifactsDir: path.join(artifactsDir, 'evaluators'),
          lockFile: path.join(workspaceRoot, '.lock'),
        },
        repo: 'https://example.test/repo.git',
        modifiedCommit: 'abc',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await fs.writeFile(
      path.join(stateDirectory, 'runtime-state.json'),
      JSON.stringify(runtimeState)
    );
    const adapter: AgentAdapter = {
      name: 'codex-cli',
      version: '1',
      checkAvailability: async (): Promise<boolean> => true,
      execute: async (
        _context: AgentExecutionContext
      ): Promise<AgentExecutionResult> => result(),
      normalizeLog: (): YouBenchaLog => log(workspaceRoot),
    };
    const operations = new SandboxPhaseOperations({
      workspaceRoot,
      now: () => new Date('2026-01-01T00:00:01.000Z'),
      adapterFactory: () => adapter,
      evaluatorFactory: () => undefined,
    });
    const phaseContext = (
      phase: 'agent' | 'evaluate'
    ): PhaseExecutionContext => ({
      phase,
      manifest: value,
      manifestPath: path.join(root, 'cell.json'),
      stateDirectory,
      outputDirectory: path.join(root, 'output'),
      environment: {},
    });
    try {
      await operations.agent(phaseContext('agent'));
      await operations.evaluate(phaseContext('evaluate'));
      const state = JSON.parse(
        await fs.readFile(
          path.join(stateDirectory, 'runtime-state.json'),
          'utf8'
        )
      ) as { results_path?: string };
      expect(state.results_path).toBeDefined();
      await expect(
        fs.readFile(state.results_path ?? '', 'utf8')
      ).resolves.toContain('Unknown evaluator: git-diff');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
