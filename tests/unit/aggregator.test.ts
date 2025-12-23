/**
 * Unit tests for the Results Aggregator
 */

import { Aggregator } from '../../src/analysis/aggregator';
import { ExportedResultsBundle } from '../../src/analysis/schemas/analysis.schema';

/**
 * Create a mock ExportedResultsBundle for testing
 */
function createMockBundle(
  overrides: Partial<{
    testCaseName: string;
    agentType: string;
    status: 'passed' | 'failed' | 'partial';
    agentStatus: 'success' | 'failed' | 'timeout';
    durationMs: number;
    exportedAt: string;
    evaluators: Array<{
      evaluator: string;
      status: 'passed' | 'failed' | 'skipped';
      metrics?: Record<string, unknown>;
      durationMs?: number;
    }>;
  }> = {}
): ExportedResultsBundle {
  const defaults = {
    testCaseName: 'Test Case 1',
    agentType: 'copilot-cli',
    status: 'passed' as const,
    agentStatus: 'success' as const,
    durationMs: 30000,
    exportedAt: '2025-11-30T10:00:00Z',
    evaluators: [
      {
        evaluator: 'git-diff',
        status: 'passed' as const,
        metrics: { files_changed: 3, lines_added: 50, lines_removed: 10 },
        durationMs: 500,
      },
    ],
  };

  const config = { ...defaults, ...overrides };
  const evalResults = config.evaluators.map((e) => ({
    evaluator: e.evaluator,
    status: e.status,
    metrics: e.metrics || {},
    message: e.status === 'passed' ? 'Passed' : 'Failed',
    duration_ms: e.durationMs || 500,
    timestamp: config.exportedAt,
  }));

  const passed = evalResults.filter((e) => e.status === 'passed').length;
  const failed = evalResults.filter((e) => e.status === 'failed').length;
  const skipped = evalResults.filter((e) => e.status === 'skipped').length;

  return {
    version: '1.0.0',
    test_case: {
      name: config.testCaseName,
      description: 'Test description',
      config_file: 'testcase.yaml',
      config_hash: 'abc123',
      repo: 'https://github.com/test/repo',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: config.exportedAt,
      completed_at: config.exportedAt,
      duration_ms: config.durationMs,
      youbencha_version: '0.1.1',
      environment: {
        os: 'Linux',
        node_version: '20.0.0',
        workspace_dir: '/tmp/workspace',
      },
    },
    agent: {
      type: config.agentType,
      youbencha_log_path: 'youbencha.log.json',
      status: config.agentStatus,
      exit_code: config.agentStatus === 'success' ? 0 : 1,
    },
    evaluators: evalResults,
    summary: {
      total_evaluators: evalResults.length,
      passed,
      failed,
      skipped,
      overall_status: config.status,
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
    exported_at: config.exportedAt,
  };
}

describe('Aggregator', () => {
  let aggregator: Aggregator;

  beforeEach(() => {
    aggregator = new Aggregator();
  });

  describe('analyze', () => {
    it('should generate complete analysis result', () => {
      const records = [
        createMockBundle(),
        createMockBundle({ status: 'failed', exportedAt: '2025-11-30T11:00:00Z' }),
      ];

      const result = aggregator.analyze(
        records,
        './results-history.jsonl',
        {},
        '0.1.1'
      );

      expect(result.metadata.source_file).toBe('./results-history.jsonl');
      expect(result.metadata.total_records).toBe(2);
      expect(result.summary.total_runs).toBe(2);
      expect(result.by_test_case).toHaveLength(1);
      expect(result.by_agent).toHaveLength(1);
      expect(result.by_evaluator).toHaveLength(1);
    });

    it('should handle empty records array', () => {
      const result = aggregator.analyze(
        [],
        './results-history.jsonl',
        {},
        '0.1.1'
      );

      expect(result.metadata.total_records).toBe(0);
      expect(result.summary.total_runs).toBe(0);
      expect(result.summary.pass_rate).toBe(0);
      expect(result.by_test_case).toHaveLength(0);
    });

    it('should include filters in metadata', () => {
      const records = [createMockBundle()];
      const filters = { testCase: 'Test*', agent: 'copilot-cli' };

      const result = aggregator.analyze(
        records,
        './results-history.jsonl',
        filters,
        '0.1.1'
      );

      expect(result.metadata.filters_applied).toEqual(filters);
    });
  });

  describe('overall summary', () => {
    it('should calculate correct pass rate', () => {
      const records = [
        createMockBundle({ status: 'passed' }),
        createMockBundle({ status: 'passed', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ status: 'failed', exportedAt: '2025-11-30T12:00:00Z' }),
        createMockBundle({ status: 'partial', exportedAt: '2025-11-30T13:00:00Z' }),
      ];

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      expect(result.summary.total_runs).toBe(4);
      expect(result.summary.passed_runs).toBe(2);
      expect(result.summary.failed_runs).toBe(1);
      expect(result.summary.partial_runs).toBe(1);
      expect(result.summary.pass_rate).toBe(0.5);
    });

    it('should calculate correct evaluator stats', () => {
      const records = [
        createMockBundle({
          evaluators: [
            { evaluator: 'git-diff', status: 'passed' },
            { evaluator: 'expected-diff', status: 'failed' },
          ],
        }),
        createMockBundle({
          evaluators: [
            { evaluator: 'git-diff', status: 'passed' },
            { evaluator: 'expected-diff', status: 'skipped' },
          ],
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      expect(result.summary.evaluator_stats.total_evaluations).toBe(4);
      expect(result.summary.evaluator_stats.passed).toBe(2);
      expect(result.summary.evaluator_stats.failed).toBe(1);
      expect(result.summary.evaluator_stats.skipped).toBe(1);
      expect(result.summary.evaluator_stats.pass_rate).toBe(0.5);
    });

    it('should calculate correct agent stats', () => {
      const records = [
        createMockBundle({ agentStatus: 'success' }),
        createMockBundle({ agentStatus: 'success', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ agentStatus: 'failed', exportedAt: '2025-11-30T12:00:00Z' }),
        createMockBundle({ agentStatus: 'timeout', exportedAt: '2025-11-30T13:00:00Z' }),
      ];

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      expect(result.summary.agent_stats.successful_executions).toBe(2);
      expect(result.summary.agent_stats.failed_executions).toBe(1);
      expect(result.summary.agent_stats.timeout_executions).toBe(1);
      expect(result.summary.agent_stats.success_rate).toBe(0.5);
    });
  });

  describe('analyzeByTestCase', () => {
    it('should group records by test case name', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A' }),
        createMockBundle({ testCaseName: 'Test A', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Test B', exportedAt: '2025-11-30T12:00:00Z' }),
      ];

      const result = aggregator.analyzeByTestCase(records);

      expect(result).toHaveLength(2);
      expect(result.find((tc) => tc.name === 'Test A')?.run_count).toBe(2);
      expect(result.find((tc) => tc.name === 'Test B')?.run_count).toBe(1);
    });

    it('should calculate correct pass rates per test case', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', status: 'passed' }),
        createMockBundle({
          testCaseName: 'Test A',
          status: 'failed',
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.overall_pass_rate).toBe(0.5);
    });

    it('should track agents used per test case', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', agentType: 'copilot-cli' }),
        createMockBundle({
          testCaseName: 'Test A',
          agentType: 'claude-code',
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.agents_used).toHaveLength(2);
      expect(testA?.agents_used.find((a) => a.type === 'copilot-cli')).toBeDefined();
      expect(testA?.agents_used.find((a) => a.type === 'claude-code')).toBeDefined();
    });

    it('should identify improving trend', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T10:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T12:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T13:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T14:00:00Z' }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.recent_trend).toBe('improving');
    });

    it('should identify degrading trend', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T10:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T12:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T13:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T14:00:00Z' }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.recent_trend).toBe('degrading');
    });

    it('should identify stable trend', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T10:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', status: 'passed', exportedAt: '2025-11-30T12:00:00Z' }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.recent_trend).toBe('stable');
    });

    it('should return insufficient_data for few runs', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', status: 'passed' }),
        createMockBundle({ testCaseName: 'Test A', status: 'failed', exportedAt: '2025-11-30T11:00:00Z' }),
      ];

      const result = aggregator.analyzeByTestCase(records);
      const testA = result.find((tc) => tc.name === 'Test A');

      expect(testA?.recent_trend).toBe('insufficient_data');
    });
  });

  describe('analyzeByAgent', () => {
    it('should group records by agent type', () => {
      const records = [
        createMockBundle({ agentType: 'copilot-cli' }),
        createMockBundle({ agentType: 'copilot-cli', exportedAt: '2025-11-30T11:00:00Z' }),
        createMockBundle({ agentType: 'claude-code', exportedAt: '2025-11-30T12:00:00Z' }),
      ];

      const result = aggregator.analyzeByAgent(records);

      expect(result).toHaveLength(2);
      expect(result.find((a) => a.type === 'copilot-cli')?.run_count).toBe(2);
      expect(result.find((a) => a.type === 'claude-code')?.run_count).toBe(1);
    });

    it('should calculate correct success rate', () => {
      const records = [
        createMockBundle({ agentType: 'copilot-cli', agentStatus: 'success' }),
        createMockBundle({
          agentType: 'copilot-cli',
          agentStatus: 'failed',
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByAgent(records);
      const copilot = result.find((a) => a.type === 'copilot-cli');

      expect(copilot?.success_rate).toBe(0.5);
    });

    it('should track timeout count', () => {
      const records = [
        createMockBundle({ agentType: 'copilot-cli', agentStatus: 'timeout' }),
        createMockBundle({
          agentType: 'copilot-cli',
          agentStatus: 'timeout',
          exportedAt: '2025-11-30T11:00:00Z',
        }),
        createMockBundle({
          agentType: 'copilot-cli',
          agentStatus: 'success',
          exportedAt: '2025-11-30T12:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByAgent(records);
      const copilot = result.find((a) => a.type === 'copilot-cli');

      expect(copilot?.timeout_count).toBe(2);
    });
  });

  describe('analyzeByEvaluator', () => {
    it('should group results by evaluator', () => {
      const records = [
        createMockBundle({
          evaluators: [
            { evaluator: 'git-diff', status: 'passed' },
            { evaluator: 'expected-diff', status: 'passed' },
          ],
        }),
        createMockBundle({
          evaluators: [
            { evaluator: 'git-diff', status: 'passed' },
          ],
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByEvaluator(records);

      expect(result).toHaveLength(2);
      expect(result.find((e) => e.name === 'git-diff')?.run_count).toBe(2);
      expect(result.find((e) => e.name === 'expected-diff')?.run_count).toBe(1);
    });

    it('should calculate pass/fail/skip counts', () => {
      const records = [
        createMockBundle({
          evaluators: [{ evaluator: 'git-diff', status: 'passed' }],
        }),
        createMockBundle({
          evaluators: [{ evaluator: 'git-diff', status: 'failed' }],
          exportedAt: '2025-11-30T11:00:00Z',
        }),
        createMockBundle({
          evaluators: [{ evaluator: 'git-diff', status: 'skipped' }],
          exportedAt: '2025-11-30T12:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByEvaluator(records);
      const gitDiff = result.find((e) => e.name === 'git-diff');

      expect(gitDiff?.passed).toBe(1);
      expect(gitDiff?.failed).toBe(1);
      expect(gitDiff?.skipped).toBe(1);
      expect(gitDiff?.pass_rate).toBeCloseTo(0.333, 2);
      expect(gitDiff?.skip_rate).toBeCloseTo(0.333, 2);
    });

    it('should aggregate metrics for git-diff', () => {
      const records = [
        createMockBundle({
          evaluators: [
            {
              evaluator: 'git-diff',
              status: 'passed',
              metrics: { files_changed: 5, lines_added: 100, lines_removed: 20 },
            },
          ],
        }),
        createMockBundle({
          evaluators: [
            {
              evaluator: 'git-diff',
              status: 'passed',
              metrics: { files_changed: 3, lines_added: 50, lines_removed: 10 },
            },
          ],
          exportedAt: '2025-11-30T11:00:00Z',
        }),
      ];

      const result = aggregator.analyzeByEvaluator(records);
      const gitDiff = result.find((e) => e.name === 'git-diff');

      expect(gitDiff?.metrics_summary.git_diff?.avg_files_changed).toBe(4);
      expect(gitDiff?.metrics_summary.git_diff?.avg_lines_added).toBe(75);
      expect(gitDiff?.metrics_summary.git_diff?.avg_lines_removed).toBe(15);
      expect(gitDiff?.metrics_summary.git_diff?.max_files_changed).toBe(5);
    });
  });

  describe('analyzeTrends', () => {
    it('should compute daily aggregates', () => {
      const records = [
        createMockBundle({ status: 'passed', exportedAt: '2025-11-28T10:00:00Z' }),
        createMockBundle({ status: 'failed', exportedAt: '2025-11-28T11:00:00Z' }),
        createMockBundle({ status: 'passed', exportedAt: '2025-11-29T10:00:00Z' }),
        createMockBundle({ status: 'passed', exportedAt: '2025-11-30T10:00:00Z' }),
      ];

      const result = aggregator.analyzeTrends(records);

      expect(result.aggregates.daily).toHaveLength(3);

      const nov28 = result.aggregates.daily.find((d) => d.date === '2025-11-28');
      expect(nov28?.run_count).toBe(2);
      expect(nov28?.pass_rate).toBe(0.5);

      const nov29 = result.aggregates.daily.find((d) => d.date === '2025-11-29');
      expect(nov29?.run_count).toBe(1);
      expect(nov29?.pass_rate).toBe(1);
    });

    it('should compute per-test-case trends', () => {
      const records = [
        createMockBundle({ testCaseName: 'Test A', exportedAt: '2025-11-28T10:00:00Z' }),
        createMockBundle({ testCaseName: 'Test B', exportedAt: '2025-11-28T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Test A', exportedAt: '2025-11-29T10:00:00Z' }),
      ];

      const result = aggregator.analyzeTrends(records);

      expect(result.test_case_trends['Test A']).toHaveLength(2);
      expect(result.test_case_trends['Test B']).toHaveLength(1);
    });
  });

  describe('generateInsights', () => {
    it('should flag low pass rate test cases', () => {
      const records = [
        createMockBundle({ testCaseName: 'Bad Test', status: 'failed', exportedAt: '2025-11-28T10:00:00Z' }),
        createMockBundle({ testCaseName: 'Bad Test', status: 'failed', exportedAt: '2025-11-28T11:00:00Z' }),
        createMockBundle({ testCaseName: 'Bad Test', status: 'failed', exportedAt: '2025-11-28T12:00:00Z' }),
      ];

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      const insight = result.insights.find(
        (i) => i.context.test_case === 'Bad Test' && i.type === 'recommendation'
      );
      expect(insight).toBeDefined();
      expect(insight?.severity).toBe('critical');
    });

    it('should flag high skip rate evaluators', () => {
      const records = [
        createMockBundle({
          evaluators: [{ evaluator: 'agentic-judge', status: 'skipped' }],
          exportedAt: '2025-11-28T10:00:00Z',
        }),
        createMockBundle({
          evaluators: [{ evaluator: 'agentic-judge', status: 'skipped' }],
          exportedAt: '2025-11-28T11:00:00Z',
        }),
        createMockBundle({
          evaluators: [{ evaluator: 'agentic-judge', status: 'skipped' }],
          exportedAt: '2025-11-28T12:00:00Z',
        }),
      ];

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      const insight = result.insights.find(
        (i) => i.context.evaluator === 'agentic-judge' && i.type === 'anomaly'
      );
      expect(insight).toBeDefined();
      expect(insight?.severity).toBe('warning');
    });

    it('should highlight consistent success', () => {
      const records = Array.from({ length: 6 }, (_, i) =>
        createMockBundle({
          testCaseName: 'Great Test',
          status: 'passed',
          exportedAt: `2025-11-${28 + Math.floor(i / 2)}T${10 + (i % 2)}:00:00Z`,
        })
      );

      const result = aggregator.analyze(records, './test.jsonl', {}, '0.1.1');

      const insight = result.insights.find(
        (i) => i.context.test_case === 'Great Test' && i.type === 'improvement'
      );
      expect(insight).toBeDefined();
      expect(insight?.severity).toBe('info');
    });
  });
});
