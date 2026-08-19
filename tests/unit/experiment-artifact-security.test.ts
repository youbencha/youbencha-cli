import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import { sanitizeExperimentResultsBundle } from '../../src/experiments/artifact-security.js';

function productionResult(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'authenticated-repository',
      description: 'production-shaped result',
      config_file: 'C:\\Users\\alice\\private\\testcase.yaml',
      config_hash: 'a'.repeat(64),
      repo: 'https://build-user:repo-password@example.test/org/repo.git?access_token=query-secret&ref=main#private-fragment',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: '2026-07-25T00:00:00.000Z',
      completed_at: '2026-07-25T00:00:01.000Z',
      duration_ms: 1000,
      youbencha_version: '0.1.5-beta',
      environment: {
        os: 'win32',
        node_version: 'v20.19.0',
        workspace_dir: 'C:\\Users\\alice\\private\\workspace',
      },
    },
    agent: {
      type: 'copilot-cli',
      youbencha_log_path: 'agent.log',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [
      {
        evaluator: 'custom',
        status: 'passed',
        metrics: {
          nested: {
            authorization: 'Bearer evaluator-secret',
            headers: { 'x-api-key': 'header-secret' },
            safe: 'preserved',
          },
        },
        message: 'complete',
        duration_ms: 1,
        timestamp: '2026-07-25T00:00:01.000Z',
      },
    ],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'agent.log',
      reports: ['report.md'],
      evaluator_artifacts: [],
    },
  };
}

describe('experiment artifact security', () => {
  it('deep-copies and removes authenticated URLs, secrets, and absolute paths', () => {
    const input = productionResult();
    const sanitized = sanitizeExperimentResultsBundle(input);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).not.toBe(input);
    expect(sanitized.evaluators[0]).not.toBe(input.evaluators[0]);
    expect(serialized).not.toContain('build-user');
    expect(serialized).not.toContain('repo-password');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('private-fragment');
    expect(serialized).not.toContain('evaluator-secret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('Users\\\\alice\\\\private');
    expect(sanitized.test_case.repo).toContain('example.test/org/repo.git');
    expect(sanitized.test_case.repo).toContain('ref=main');
    expect(sanitized.test_case.config_file).toBe(
      '<absolute-path>/testcase.yaml'
    );
    expect(
      (sanitized.evaluators[0].metrics.nested as Record<string, unknown>).safe
    ).toBe('preserved');

    expect(input.test_case.repo).toContain('repo-password');
    expect(input.execution.environment.workspace_dir).toBe(
      'C:\\Users\\alice\\private\\workspace'
    );
  });
});
