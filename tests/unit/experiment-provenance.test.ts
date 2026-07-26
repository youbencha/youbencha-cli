import { normalizeExperimentProvenance } from '../../src/experiments/provenance.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { TestCaseConfig } from '../../src/schemas/testcase.schema.js';
import type { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';

const config: TestCaseConfig = {
  name: 'Task',
  description: 'Task description',
  repo: 'https://user:repo-secret@example.com/repo.git?token=query-secret',
  agent: {
    type: 'copilot-cli',
    model: 'requested-model',
    config: {
      prompt: 'Do work',
      api_token: 'do-not-leak',
    },
  },
  evaluators: [{ name: 'git-diff' }],
  workspace_dir: 'C:\\private\\absolute\\workspace',
};

const result: ResultsBundle = {
  version: '1.0.0',
  test_case: {
    name: 'Task',
    description: 'Task description',
    config_file: 'C:\\private\\task.yaml',
    config_hash: 'a'.repeat(64),
    repo: 'https://example.com/repo.git',
    branch: 'main',
    commit: 'abc123',
  },
  execution: {
    started_at: '2026-07-24T12:00:00.000Z',
    completed_at: '2026-07-24T12:01:00.000Z',
    duration_ms: 60_000,
    youbencha_version: '0.1.5-beta',
    environment: {
      os: 'win32',
      node_version: '20',
      workspace_dir: 'C:\\private\\absolute\\workspace',
    },
  },
  agent: {
    type: 'copilot-cli',
    youbencha_log_path: 'C:\\private\\log.json',
    status: 'success',
    exit_code: 0,
  },
  evaluators: [],
  summary: {
    total_evaluators: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    overall_status: 'passed',
  },
  artifacts: { agent_log: '', reports: [], evaluator_artifacts: [] },
};

const log: YouBenchaLog = {
  version: '1.0.0',
  agent: {
    name: 'copilot-cli',
    version: '1.2.3',
    adapter_version: '1',
  },
  model: { name: 'resolved-model', provider: 'provider', parameters: {} },
  execution: {
    started_at: '2026-07-24T12:00:00.000Z',
    completed_at: '2026-07-24T12:01:00.000Z',
    duration_ms: 60_000,
    exit_code: 0,
    status: 'success',
  },
  messages: [],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  errors: [],
  environment: {
    os: 'win32',
    node_version: '20',
    youbencha_version: '0.1.5-beta',
    working_directory: 'C:\\private\\absolute\\workspace',
  },
};

describe('experiment provenance normalization', () => {
  it('captures source, CLI, requested/resolved model, and redacted config by cell', () => {
    const normalized = normalizeExperimentProvenance([
      {
        cellId: 'b'.repeat(64),
        testcaseId: 'task',
        configHash: 'a'.repeat(64),
        config,
        result,
        log,
      },
    ]);
    const serialized = JSON.stringify(normalized);

    expect(normalized.sources).toEqual([
      {
        testcase_id: 'task',
        config_hash: 'a'.repeat(64),
        commit_sha: 'abc123',
      },
    ]);
    expect(normalized.provenance).toMatchObject({
      youbencha_version: '0.1.5-beta',
      agent_cli_versions: { ['b'.repeat(64)]: '1.2.3' },
      requested_models: { ['b'.repeat(64)]: 'requested-model' },
      resolved_models: { ['b'.repeat(64)]: 'resolved-model' },
    });
    expect(serialized).not.toContain('do-not-leak');
    expect(serialized).not.toContain('repo-secret');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('C:\\\\private\\\\absolute');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('<absolute-path>/workspace');
  });

  it('reports missing optional CLI and resolved model provenance', () => {
    const normalized = normalizeExperimentProvenance([
      {
        cellId: 'c'.repeat(64),
        testcaseId: 'task',
        configHash: 'a'.repeat(64),
        config,
        result,
      },
    ]);

    expect(normalized.warnings[0]).toContain('agent CLI version');
    expect(normalized.warnings[0]).toContain('resolved model');
  });

  it('prefers persisted headless provenance over compatibility fields', () => {
    const normalized = normalizeExperimentProvenance([
      {
        cellId: 'd'.repeat(64),
        testcaseId: 'task',
        configHash: 'a'.repeat(64),
        config,
        result,
        log: {
          ...log,
          provenance: {
            cli_version: '2.0.0',
            configured_model: 'persisted-request',
            reported_model: 'persisted-response',
          },
        },
      },
    ]);

    expect(normalized.cells[0]).toMatchObject({
      agent_cli_version: '2.0.0',
      requested_model: 'persisted-request',
      resolved_model: 'persisted-response',
    });
  });

  it('retains every config, commit, and tool version for mixed cells', () => {
    const secondResult: ResultsBundle = {
      ...result,
      test_case: { ...result.test_case, commit: 'def456' },
      execution: {
        ...result.execution,
        youbencha_version: '0.2.0',
      },
    };
    const secondLog: YouBenchaLog = {
      ...log,
      agent: { ...log.agent, version: '2.0.0' },
    };
    const normalized = normalizeExperimentProvenance([
      {
        cellId: 'b'.repeat(64),
        testcaseId: 'task',
        configHash: 'a'.repeat(64),
        config,
        result,
        log,
      },
      {
        cellId: 'c'.repeat(64),
        testcaseId: 'task',
        configHash: 'd'.repeat(64),
        config: {
          ...config,
          agent: { ...config.agent, model: 'other-model' },
        },
        result: secondResult,
        log: secondLog,
      },
    ]);

    expect(normalized.sources).toHaveLength(2);
    expect(normalized.sources.map((source) => source.commit_sha)).toEqual([
      'abc123',
      'def456',
    ]);
    expect(normalized.provenance.youbencha_version).toBe('mixed');
    expect(normalized.provenance.youbencha_versions).toEqual({
      ['b'.repeat(64)]: '0.1.5-beta',
      ['c'.repeat(64)]: '0.2.0',
    });
    expect(normalized.provenance.agent_cli_versions).toEqual({
      ['b'.repeat(64)]: '1.2.3',
      ['c'.repeat(64)]: '2.0.0',
    });
    expect(normalized.provenance.cells).toEqual(normalized.cells);
  });
});
