/**
 * Analytics Schema
 * 
 * Zod schemas for analytics, aggregation, and recommendations.
 * Supports multi-run analysis and strategic insights.
 */

import { z } from 'zod';
import { resultsBundleSchema } from './result.schema.js';

/**
 * Recommendation schema - actionable insights from analysis
 */
export const recommendationSchema = z.object({
  category: z.enum(['performance', 'cost', 'quality', 'configuration', 'evaluator']),
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  description: z.string(),
  action: z.string(), // What to do
  impact: z.string().optional(), // Expected improvement
});

/**
 * Performance insight schema - observations about performance
 */
export const performanceInsightSchema = z.object({
  type: z.enum(['success', 'warning', 'error', 'info']),
  category: z.string(),
  message: z.string(),
  metric_value: z.any().optional(),
  reference_value: z.any().optional(),
});

/**
 * Cost analysis schema - breakdown of execution costs
 */
export const costAnalysisSchema = z.object({
  total_tokens: z.number().nonnegative().optional(),
  prompt_tokens: z.number().nonnegative().optional(),
  completion_tokens: z.number().nonnegative().optional(),
  estimated_cost_usd: z.number().nonnegative().optional(),
  model: z.string().optional(),
  cost_per_1k_tokens: z.number().nonnegative().optional(),
});

/**
 * Single run analysis schema - enhanced insights for one run
 */
export const singleRunAnalysisSchema = z.object({
  version: z.literal('1.0.0'),
  analyzed_at: z.string(), // ISO 8601
  source_results: z.string(), // Path to original results.json
  
  // Original results bundle
  results: resultsBundleSchema,
  
  // Analysis outputs
  insights: z.array(performanceInsightSchema),
  recommendations: z.array(recommendationSchema),
  cost_analysis: costAnalysisSchema.optional(),
  
  // Performance metrics
  metrics: z.object({
    success_rate: z.number().min(0).max(1), // 0-1
    avg_evaluator_duration_ms: z.number().nonnegative(),
    total_duration_ms: z.number().nonnegative(),
    evaluator_pass_rate: z.number().min(0).max(1),
  }),
});

/**
 * Trend data point schema - single measurement in a time series
 */
export const trendDataPointSchema = z.object({
  timestamp: z.string(), // ISO 8601
  run_id: z.string(),
  metric_value: z.number(),
  config_hash: z.string(),
});

/**
 * Trend analysis schema - time-series insights
 */
export const trendAnalysisSchema = z.object({
  metric_name: z.string(),
  data_points: z.array(trendDataPointSchema),
  trend_direction: z.enum(['improving', 'stable', 'degrading']),
  change_rate: z.number(), // Rate of change
  confidence: z.enum(['high', 'medium', 'low']),
});

/**
 * Comparison entry schema - one run in a comparison
 */
export const comparisonEntrySchema = z.object({
  run_id: z.string(),
  config_hash: z.string(),
  agent_type: z.string(),
  timestamp: z.string(),
  metrics: z.record(z.any()),
  overall_status: z.enum(['passed', 'failed', 'partial']),
});

/**
 * Comparison analysis schema - side-by-side comparison
 */
export const comparisonAnalysisSchema = z.object({
  comparison_type: z.enum(['by_config', 'by_agent', 'by_time']),
  entries: z.array(comparisonEntrySchema),
  best_performer: z.string().optional(), // run_id of best
  insights: z.array(performanceInsightSchema),
  recommendations: z.array(recommendationSchema),
});

/**
 * Aggregated summary schema - high-level stats across runs
 */
export const aggregatedSummarySchema = z.object({
  total_runs: z.number().nonnegative(),
  successful_runs: z.number().nonnegative(),
  failed_runs: z.number().nonnegative(),
  partial_runs: z.number().nonnegative(),
  avg_duration_ms: z.number().nonnegative(),
  total_cost_usd: z.number().nonnegative().optional(),
  date_range: z.object({
    earliest: z.string(),
    latest: z.string(),
  }).optional(),
});

/**
 * Aggregated results schema - collection of multiple runs
 */
export const aggregatedResultsSchema = z.object({
  version: z.literal('1.0.0'),
  aggregated_at: z.string(), // ISO 8601
  aggregation_type: z.enum(['task', 'config', 'agent', 'time-series', 'mixed']),
  
  // Source data
  runs: z.array(resultsBundleSchema),
  
  // Aggregated insights
  summary: aggregatedSummarySchema,
  trends: z.array(trendAnalysisSchema).optional(),
  comparison: comparisonAnalysisSchema.optional(),
  recommendations: z.array(recommendationSchema),
});

/**
 * Inferred TypeScript types
 */
export type Recommendation = z.infer<typeof recommendationSchema>;
export type PerformanceInsight = z.infer<typeof performanceInsightSchema>;
export type CostAnalysis = z.infer<typeof costAnalysisSchema>;
export type SingleRunAnalysis = z.infer<typeof singleRunAnalysisSchema>;
export type TrendDataPoint = z.infer<typeof trendDataPointSchema>;
export type TrendAnalysis = z.infer<typeof trendAnalysisSchema>;
export type ComparisonEntry = z.infer<typeof comparisonEntrySchema>;
export type ComparisonAnalysis = z.infer<typeof comparisonAnalysisSchema>;
export type AggregatedSummary = z.infer<typeof aggregatedSummarySchema>;
export type AggregatedResults = z.infer<typeof aggregatedResultsSchema>;
