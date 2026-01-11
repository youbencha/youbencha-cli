/**
 * Contract tests for Analysis schemas
 *
 * These tests define the contract for analysis results.
 */

import {
  analysisResultSchema,
  AnalysisResult,
  overallSummarySchema,
  OverallSummary,
  testCaseAnalysisSchema,
  TestCaseAnalysis,
  agentAnalysisSchema,
  AgentAnalysis,
  evaluatorAnalysisSchema,
  EvaluatorAnalysis,
  insightSchema,
  Insight,
  exportedResultsBundleSchema,
  ExportedResultsBundle,
  analysisFilterSchema,
  AnalysisFilter,
} from '../../src/analysis/schemas/analysis.schema';

describe('ExportedResultsBundle Schema Contract', () => {
  describe('Valid ExportedResultsBundle', () => {
    it('should validate a complete exported bundle', () => {
      const validBundle: ExportedResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case Name',
          description: 'Test case description',
          config_file: 'testcase.yaml',
          config_hash: 'abc123def456',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123def456',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Windows_NT',
            node_version: '20.10.0',
            workspace_dir: '.youbencha-workspace/run-20251104-100000',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [
          {
            evaluator: 'git-diff',
            status: 'passed',
            metrics: { files_changed: 5 },
            message: 'Git diff analysis completed',
            duration_ms: 1500,
            timestamp: '2025-11-04T10:05:00.000Z',
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
          agent_log: 'artifacts/youbencha.log.json',
          reports: ['artifacts/report.md'],
          evaluator_artifacts: [],
        },
        exported_at: '2025-11-04T10:15:00.000Z',
      };

      const result = exportedResultsBundleSchema.safeParse(validBundle);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exported_at).toBe('2025-11-04T10:15:00.000Z');
      }
    });

    it('should reject bundle without exported_at', () => {
      const invalidBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test',
          description: 'Test description',
          config_file: 'testcase.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
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
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: [],
          evaluator_artifacts: [],
        },
        // Missing exported_at
      };

      const result = exportedResultsBundleSchema.safeParse(invalidBundle);
      expect(result.success).toBe(false);
    });
  });
});

describe('OverallSummary Schema Contract', () => {
  it('should validate a complete summary', () => {
    const validSummary: OverallSummary = {
      total_runs: 100,
      passed_runs: 75,
      failed_runs: 20,
      partial_runs: 5,
      pass_rate: 0.75,
      avg_duration_ms: 45000,
      total_duration_ms: 4500000,
      evaluator_stats: {
        total_evaluations: 300,
        passed: 250,
        failed: 30,
        skipped: 20,
        pass_rate: 0.833,
      },
      agent_stats: {
        successful_executions: 95,
        failed_executions: 3,
        timeout_executions: 2,
        success_rate: 0.95,
      },
    };

    const result = overallSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
  });

  it('should reject pass_rate greater than 1', () => {
    const invalidSummary = {
      total_runs: 10,
      passed_runs: 10,
      failed_runs: 0,
      partial_runs: 0,
      pass_rate: 1.5, // Invalid
      avg_duration_ms: 1000,
      total_duration_ms: 10000,
      evaluator_stats: {
        total_evaluations: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        pass_rate: 1.0,
      },
      agent_stats: {
        successful_executions: 10,
        failed_executions: 0,
        timeout_executions: 0,
        success_rate: 1.0,
      },
    };

    const result = overallSummarySchema.safeParse(invalidSummary);
    expect(result.success).toBe(false);
  });
});

describe('TestCaseAnalysis Schema Contract', () => {
  it('should validate a complete test case analysis', () => {
    const validAnalysis: TestCaseAnalysis = {
      name: 'Add README comment',
      description: 'Tests README modification',
      repo: 'https://github.com/example/repo',
      run_count: 20,
      overall_pass_rate: 0.95,
      evaluator_pass_rate: 0.98,
      avg_duration_ms: 35200,
      min_duration_ms: 28000,
      max_duration_ms: 55000,
      agents_used: [
        {
          type: 'copilot-cli',
          run_count: 15,
          pass_rate: 1.0,
          avg_duration_ms: 32000,
        },
        {
          type: 'claude-code',
          run_count: 5,
          pass_rate: 0.8,
          avg_duration_ms: 45000,
        },
      ],
      evaluators: [
        {
          name: 'git-diff',
          run_count: 20,
          pass_rate: 1.0,
          avg_duration_ms: 500,
        },
        {
          name: 'agentic-judge',
          run_count: 20,
          pass_rate: 0.95,
          avg_duration_ms: 18000,
        },
      ],
      recent_trend: 'stable',
      last_run: {
        timestamp: '2025-11-30T10:00:00Z',
        status: 'passed',
        duration_ms: 34000,
      },
    };

    const result = testCaseAnalysisSchema.safeParse(validAnalysis);
    expect(result.success).toBe(true);
  });

  it('should validate all trend values', () => {
    const trends = ['improving', 'stable', 'degrading', 'insufficient_data'] as const;

    for (const trend of trends) {
      const analysis: TestCaseAnalysis = {
        name: 'Test',
        description: 'Test',
        repo: 'https://github.com/test/test',
        run_count: 1,
        overall_pass_rate: 1.0,
        evaluator_pass_rate: 1.0,
        avg_duration_ms: 1000,
        min_duration_ms: 1000,
        max_duration_ms: 1000,
        agents_used: [],
        evaluators: [],
        recent_trend: trend,
        last_run: {
          timestamp: '2025-11-30T10:00:00Z',
          status: 'passed',
          duration_ms: 1000,
        },
      };

      const result = testCaseAnalysisSchema.safeParse(analysis);
      expect(result.success).toBe(true);
    }
  });
});

describe('AgentAnalysis Schema Contract', () => {
  it('should validate a complete agent analysis', () => {
    const validAnalysis: AgentAnalysis = {
      type: 'copilot-cli',
      run_count: 50,
      success_rate: 0.96,
      timeout_count: 2,
      avg_exit_code: 0.1,
      avg_duration_ms: 42000,
      min_duration_ms: 25000,
      max_duration_ms: 180000,
      test_cases: [
        {
          name: 'Test A',
          run_count: 30,
          pass_rate: 1.0,
        },
        {
          name: 'Test B',
          run_count: 20,
          pass_rate: 0.9,
        },
      ],
      evaluator_performance: [
        {
          evaluator: 'git-diff',
          run_count: 50,
          pass_rate: 0.98,
        },
      ],
    };

    const result = agentAnalysisSchema.safeParse(validAnalysis);
    expect(result.success).toBe(true);
  });
});

describe('EvaluatorAnalysis Schema Contract', () => {
  it('should validate a complete evaluator analysis', () => {
    const validAnalysis: EvaluatorAnalysis = {
      name: 'git-diff',
      run_count: 100,
      passed: 95,
      failed: 3,
      skipped: 2,
      pass_rate: 0.95,
      skip_rate: 0.02,
      avg_duration_ms: 450,
      min_duration_ms: 200,
      max_duration_ms: 1200,
      metrics_summary: {
        git_diff: {
          avg_files_changed: 4.5,
          avg_lines_added: 85.3,
          avg_lines_removed: 12.1,
          max_files_changed: 25,
          max_lines_changed: 500,
        },
      },
      failure_patterns: [
        {
          pattern: 'No changes detected',
          count: 2,
          example_message: 'No changes detected in repository',
        },
      ],
    };

    const result = evaluatorAnalysisSchema.safeParse(validAnalysis);
    expect(result.success).toBe(true);
  });

  it('should validate evaluator with assertions', () => {
    const validAnalysis: EvaluatorAnalysis = {
      name: 'agentic-judge',
      run_count: 50,
      passed: 45,
      failed: 5,
      skipped: 0,
      pass_rate: 0.9,
      skip_rate: 0.0,
      avg_duration_ms: 18000,
      min_duration_ms: 12000,
      max_duration_ms: 35000,
      metrics_summary: {},
      assertions: [
        {
          assertion_name: 'code_quality',
          total_evaluations: 50,
          passed: 45,
          partial: 3,
          failed: 2,
          pass_rate: 0.9,
          avg_score: 0.85,
        },
      ],
      failure_patterns: [],
    };

    const result = evaluatorAnalysisSchema.safeParse(validAnalysis);
    expect(result.success).toBe(true);
  });
});

describe('Insight Schema Contract', () => {
  it('should validate regression insight', () => {
    const insight: Insight = {
      type: 'regression',
      severity: 'warning',
      title: 'Pass rate dropped',
      description: 'Pass rate dropped from 90% to 70% in the last week',
      context: {
        test_case: 'Add README comment',
        timestamp: '2025-11-30T10:00:00Z',
      },
      data: {
        old_rate: 0.9,
        new_rate: 0.7,
      },
    };

    const result = insightSchema.safeParse(insight);
    expect(result.success).toBe(true);
  });

  it('should validate all insight types', () => {
    const types = ['regression', 'improvement', 'anomaly', 'recommendation'] as const;

    for (const type of types) {
      const insight: Insight = {
        type,
        severity: 'info',
        title: 'Test',
        description: 'Test description',
        context: {},
      };

      const result = insightSchema.safeParse(insight);
      expect(result.success).toBe(true);
    }
  });

  it('should validate all severity levels', () => {
    const severities = ['info', 'warning', 'critical'] as const;

    for (const severity of severities) {
      const insight: Insight = {
        type: 'recommendation',
        severity,
        title: 'Test',
        description: 'Test description',
        context: {},
      };

      const result = insightSchema.safeParse(insight);
      expect(result.success).toBe(true);
    }
  });
});

describe('AnalysisFilter Schema Contract', () => {
  it('should validate filter with all fields', () => {
    const filter: AnalysisFilter = {
      testCase: 'Add README*',
      agent: 'copilot-cli',
      evaluator: 'git-diff',
      since: new Date('2025-11-01'),
      until: new Date('2025-11-30'),
      limit: 100,
      status: ['passed', 'failed'],
    };

    const result = analysisFilterSchema.safeParse(filter);
    expect(result.success).toBe(true);
  });

  it('should validate empty filter', () => {
    const filter: AnalysisFilter = {};

    const result = analysisFilterSchema.safeParse(filter);
    expect(result.success).toBe(true);
  });

  it('should validate filter with RegExp', () => {
    const filter = {
      testCase: /^Add .*/,
    };

    const result = analysisFilterSchema.safeParse(filter);
    expect(result.success).toBe(true);
  });
});

describe('AnalysisResult Schema Contract', () => {
  it('should validate a complete analysis result', () => {
    const validResult: AnalysisResult = {
      metadata: {
        source_file: './results-history.jsonl',
        total_records: 100,
        date_range: {
          earliest: '2025-11-01T00:00:00Z',
          latest: '2025-11-30T23:59:59Z',
        },
        filters_applied: {},
        generated_at: '2025-11-30T12:00:00Z',
        youbencha_version: '0.1.1',
      },
      summary: {
        total_runs: 100,
        passed_runs: 75,
        failed_runs: 20,
        partial_runs: 5,
        pass_rate: 0.75,
        avg_duration_ms: 45000,
        total_duration_ms: 4500000,
        evaluator_stats: {
          total_evaluations: 300,
          passed: 250,
          failed: 30,
          skipped: 20,
          pass_rate: 0.833,
        },
        agent_stats: {
          successful_executions: 95,
          failed_executions: 3,
          timeout_executions: 2,
          success_rate: 0.95,
        },
      },
      by_test_case: [],
      by_agent: [],
      by_evaluator: [],
      trends: {
        pass_rate_trend: [],
        duration_trend: [],
        test_case_trends: {},
        aggregates: {
          daily: [],
        },
      },
      insights: [],
    };

    const result = analysisResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });
});
