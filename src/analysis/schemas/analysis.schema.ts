/**
 * Analysis Schema
 *
 * Zod schemas for analysis results and filters.
 * Defines the structure for aggregated analysis output from JSONL history.
 */

import { z } from 'zod';

/**
 * Analysis filter schema for filtering JSONL records
 */
export const analysisFilterSchema = z.object({
  testCase: z.union([z.string(), z.instanceof(RegExp)]).optional(),
  agent: z.string().optional(),
  evaluator: z.string().optional(),
  since: z.date().optional(),
  until: z.date().optional(),
  limit: z.number().positive().optional(),
  status: z.array(z.enum(['passed', 'failed', 'partial'])).optional(),
});

export type AnalysisFilter = z.infer<typeof analysisFilterSchema>;

/**
 * Overall summary statistics schema
 */
export const overallSummarySchema = z.object({
  total_runs: z.number().nonnegative(),
  passed_runs: z.number().nonnegative(),
  failed_runs: z.number().nonnegative(),
  partial_runs: z.number().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  avg_duration_ms: z.number().nonnegative(),
  total_duration_ms: z.number().nonnegative(),

  evaluator_stats: z.object({
    total_evaluations: z.number().nonnegative(),
    passed: z.number().nonnegative(),
    failed: z.number().nonnegative(),
    skipped: z.number().nonnegative(),
    pass_rate: z.number().min(0).max(1),
  }),

  agent_stats: z.object({
    successful_executions: z.number().nonnegative(),
    failed_executions: z.number().nonnegative(),
    timeout_executions: z.number().nonnegative(),
    success_rate: z.number().min(0).max(1),
  }),
});

export type OverallSummary = z.infer<typeof overallSummarySchema>;

/**
 * Test case analysis schema
 */
export const testCaseAnalysisSchema = z.object({
  name: z.string(),
  description: z.string(),
  repo: z.string(),
  run_count: z.number().nonnegative(),

  /** Pass rates */
  overall_pass_rate: z.number().min(0).max(1),
  evaluator_pass_rate: z.number().min(0).max(1),

  /** Performance */
  avg_duration_ms: z.number().nonnegative(),
  min_duration_ms: z.number().nonnegative(),
  max_duration_ms: z.number().nonnegative(),

  /** Agent breakdown for this test case */
  agents_used: z.array(
    z.object({
      type: z.string(),
      run_count: z.number().nonnegative(),
      pass_rate: z.number().min(0).max(1),
      avg_duration_ms: z.number().nonnegative(),
    })
  ),

  /** Evaluator breakdown for this test case */
  evaluators: z.array(
    z.object({
      name: z.string(),
      run_count: z.number().nonnegative(),
      pass_rate: z.number().min(0).max(1),
      avg_duration_ms: z.number().nonnegative(),
    })
  ),

  /** Recent trend (last 5 runs) */
  recent_trend: z.enum(['improving', 'stable', 'degrading', 'insufficient_data']),

  /** Last run details */
  last_run: z.object({
    timestamp: z.string(),
    status: z.enum(['passed', 'failed', 'partial']),
    duration_ms: z.number().nonnegative(),
  }),
});

export type TestCaseAnalysis = z.infer<typeof testCaseAnalysisSchema>;

/**
 * Agent analysis schema
 */
export const agentAnalysisSchema = z.object({
  type: z.string(),
  run_count: z.number().nonnegative(),

  /** Execution stats */
  success_rate: z.number().min(0).max(1),
  timeout_count: z.number().nonnegative(),
  avg_exit_code: z.number(),

  /** Performance */
  avg_duration_ms: z.number().nonnegative(),
  min_duration_ms: z.number().nonnegative(),
  max_duration_ms: z.number().nonnegative(),

  /** Which test cases used this agent */
  test_cases: z.array(
    z.object({
      name: z.string(),
      run_count: z.number().nonnegative(),
      pass_rate: z.number().min(0).max(1),
    })
  ),

  /** Evaluator performance with this agent */
  evaluator_performance: z.array(
    z.object({
      evaluator: z.string(),
      run_count: z.number().nonnegative(),
      pass_rate: z.number().min(0).max(1),
    })
  ),
});

export type AgentAnalysis = z.infer<typeof agentAnalysisSchema>;

/**
 * Assertion summary schema (for agentic evaluators)
 */
export const assertionSummarySchema = z.object({
  assertion_name: z.string(),
  total_evaluations: z.number().nonnegative(),
  passed: z.number().nonnegative(),
  partial: z.number().nonnegative(),
  failed: z.number().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  avg_score: z.number().min(0).max(1),
});

export type AssertionSummary = z.infer<typeof assertionSummarySchema>;

/**
 * Evaluator metrics summary schema
 */
export const evaluatorMetricsSummarySchema = z.object({
  /** git-diff specific */
  git_diff: z
    .object({
      avg_files_changed: z.number().nonnegative(),
      avg_lines_added: z.number().nonnegative(),
      avg_lines_removed: z.number().nonnegative(),
      avg_change_entropy: z.number().nonnegative().optional(),
      max_files_changed: z.number().nonnegative(),
      max_lines_changed: z.number().nonnegative(),
    })
    .optional(),

  /** expected-diff specific */
  expected_diff: z
    .object({
      avg_aggregate_similarity: z.number().min(0).max(1),
      min_similarity: z.number().min(0).max(1),
      max_similarity: z.number().min(0).max(1),
      threshold_met_rate: z.number().min(0).max(1),
    })
    .optional(),

  /** agentic-judge specific */
  agentic_judge: z
    .object({
      avg_evaluation_duration_ms: z.number().nonnegative(),
      assertion_pass_rates: z.record(z.number().min(0).max(1)),
    })
    .optional(),

  /** Generic metrics for unknown evaluators */
  generic: z
    .record(
      z.object({
        avg: z.number(),
        min: z.number(),
        max: z.number(),
        count: z.number().nonnegative(),
      })
    )
    .optional(),
});

export type EvaluatorMetricsSummary = z.infer<typeof evaluatorMetricsSummarySchema>;

/**
 * Evaluator analysis schema
 */
export const evaluatorAnalysisSchema = z.object({
  name: z.string(),
  run_count: z.number().nonnegative(),

  /** Pass/fail stats */
  passed: z.number().nonnegative(),
  failed: z.number().nonnegative(),
  skipped: z.number().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  skip_rate: z.number().min(0).max(1),

  /** Performance */
  avg_duration_ms: z.number().nonnegative(),
  min_duration_ms: z.number().nonnegative(),
  max_duration_ms: z.number().nonnegative(),

  /** Metrics aggregation (evaluator-specific) */
  metrics_summary: evaluatorMetricsSummarySchema,

  /** Assertion tracking (for agentic evaluators) */
  assertions: z.array(assertionSummarySchema).optional(),

  /** Common failure reasons */
  failure_patterns: z.array(
    z.object({
      pattern: z.string(),
      count: z.number().nonnegative(),
      example_message: z.string(),
    })
  ),
});

export type EvaluatorAnalysis = z.infer<typeof evaluatorAnalysisSchema>;

/**
 * Trend data point schema
 */
export const trendDataPointSchema = z.object({
  timestamp: z.string(),
  value: z.number(),
  test_case: z.string().optional(),
  agent: z.string().optional(),
});

export type TrendDataPoint = z.infer<typeof trendDataPointSchema>;

/**
 * Daily aggregate schema
 */
export const dailyAggregateSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  run_count: z.number().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  avg_duration_ms: z.number().nonnegative(),
});

export type DailyAggregate = z.infer<typeof dailyAggregateSchema>;

/**
 * Weekly aggregate schema
 */
export const weeklyAggregateSchema = z.object({
  week_start: z.string(), // YYYY-MM-DD (Monday)
  run_count: z.number().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  avg_duration_ms: z.number().nonnegative(),
});

export type WeeklyAggregate = z.infer<typeof weeklyAggregateSchema>;

/**
 * Trend analysis schema
 */
export const trendAnalysisSchema = z.object({
  /** Overall pass rate trend */
  pass_rate_trend: z.array(trendDataPointSchema),

  /** Duration trend */
  duration_trend: z.array(trendDataPointSchema),

  /** Per-test-case trends */
  test_case_trends: z.record(z.array(trendDataPointSchema)),

  /** Weekly/daily aggregates */
  aggregates: z.object({
    daily: z.array(dailyAggregateSchema),
    weekly: z.array(weeklyAggregateSchema).optional(),
  }),
});

export type TrendAnalysis = z.infer<typeof trendAnalysisSchema>;

/**
 * Insight schema
 */
export const insightSchema = z.object({
  type: z.enum(['regression', 'improvement', 'anomaly', 'recommendation']),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  description: z.string(),
  context: z.object({
    test_case: z.string().optional(),
    agent: z.string().optional(),
    evaluator: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  data: z.record(z.unknown()).optional(),
});

export type Insight = z.infer<typeof insightSchema>;

/**
 * Analysis result metadata schema
 */
export const analysisMetadataSchema = z.object({
  source_file: z.string(),
  total_records: z.number().nonnegative(),
  date_range: z.object({
    earliest: z.string(),
    latest: z.string(),
  }),
  filters_applied: z.record(z.string()),
  generated_at: z.string(),
  youbencha_version: z.string(),
});

export type AnalysisMetadata = z.infer<typeof analysisMetadataSchema>;

/**
 * Complete analysis result schema
 */
export const analysisResultSchema = z.object({
  /** Analysis metadata */
  metadata: analysisMetadataSchema,

  /** High-level summary statistics */
  summary: overallSummarySchema,

  /** Per-test-case breakdown */
  by_test_case: z.array(testCaseAnalysisSchema),

  /** Per-agent breakdown */
  by_agent: z.array(agentAnalysisSchema),

  /** Per-evaluator breakdown */
  by_evaluator: z.array(evaluatorAnalysisSchema),

  /** Time-series trends */
  trends: trendAnalysisSchema,

  /** Notable events (regressions, improvements, anomalies) */
  insights: z.array(insightSchema),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/**
 * Exported ResultsBundle with exported_at timestamp
 */
export const exportedResultsBundleSchema = z.object({
  version: z.literal('1.0.0'),
  test_case: z.object({
    name: z.string(),
    description: z.string(),
    config_file: z.string(),
    config_hash: z.string(),
    repo: z.string(),
    branch: z.string(),
    commit: z.string(),
    expected_branch: z.string().optional(),
  }),
  execution: z.object({
    started_at: z.string(),
    completed_at: z.string(),
    duration_ms: z.number().nonnegative(),
    youbencha_version: z.string(),
    environment: z.object({
      os: z.string(),
      node_version: z.string(),
      workspace_dir: z.string(),
    }),
  }),
  agent: z.object({
    type: z.string(),
    youbencha_log_path: z.string(),
    status: z.enum(['success', 'failed', 'timeout']),
    exit_code: z.number(),
  }),
  evaluators: z.array(
    z.object({
      evaluator: z.string(),
      status: z.enum(['passed', 'failed', 'skipped']),
      metrics: z.record(z.any()),
      message: z.string(),
      duration_ms: z.number().nonnegative(),
      timestamp: z.string(),
      assertions: z.record(z.any()).optional(),
      artifacts: z
        .array(
          z.object({
            type: z.string(),
            path: z.string(),
            description: z.string(),
          })
        )
        .optional(),
      error: z
        .object({
          message: z.string(),
          stack_trace: z.string().optional(),
        })
        .optional(),
    })
  ),
  summary: z.object({
    total_evaluators: z.number().nonnegative(),
    passed: z.number().nonnegative(),
    failed: z.number().nonnegative(),
    skipped: z.number().nonnegative(),
    overall_status: z.enum(['passed', 'failed', 'partial']),
  }),
  artifacts: z.object({
    agent_log: z.string(),
    reports: z.array(z.string()),
    evaluator_artifacts: z.array(z.string()),
  }),
  exported_at: z.string(),
});

export type ExportedResultsBundle = z.infer<typeof exportedResultsBundleSchema>;

/**
 * Aggregator options schema
 */
export const aggregatorOptionsSchema = z.object({
  includeRawRecords: z.boolean().optional(),
  trendGranularity: z.enum(['hourly', 'daily', 'weekly']).optional(),
  insightThresholds: z
    .object({
      regressionDelta: z.number().min(0).max(1).optional(),
      lowPassRateThreshold: z.number().min(0).max(1).optional(),
      highSkipRateThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type AggregatorOptions = z.infer<typeof aggregatorOptionsSchema>;

/**
 * Reporter options schema
 */
export const reporterOptionsSchema = z.object({
  view: z.enum(['summary', 'trends', 'comparison', 'failures', 'assertions']).optional(),
  verbose: z.boolean().optional(),
  colorize: z.boolean().optional(),
});

export type ReporterOptions = z.infer<typeof reporterOptionsSchema>;
