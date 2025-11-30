/**
 * Analysis Module Index
 *
 * Public exports for the Results Analyzer.
 */

// Schemas
export {
  // Filter and options
  analysisFilterSchema,
  type AnalysisFilter,
  aggregatorOptionsSchema,
  type AggregatorOptions,
  reporterOptionsSchema,
  type ReporterOptions,

  // Result types
  analysisResultSchema,
  type AnalysisResult,
  analysisMetadataSchema,
  type AnalysisMetadata,
  overallSummarySchema,
  type OverallSummary,
  testCaseAnalysisSchema,
  type TestCaseAnalysis,
  agentAnalysisSchema,
  type AgentAnalysis,
  evaluatorAnalysisSchema,
  type EvaluatorAnalysis,
  evaluatorMetricsSummarySchema,
  type EvaluatorMetricsSummary,
  assertionSummarySchema,
  type AssertionSummary,
  trendAnalysisSchema,
  type TrendAnalysis,
  trendDataPointSchema,
  type TrendDataPoint,
  dailyAggregateSchema,
  type DailyAggregate,
  weeklyAggregateSchema,
  type WeeklyAggregate,
  insightSchema,
  type Insight,

  // JSONL types
  exportedResultsBundleSchema,
  type ExportedResultsBundle,
} from './schemas/analysis.schema.js';

// JSONL Reader
export { JSONLReader, JSONLReaderError } from './jsonl-reader.js';

// Aggregator
export { Aggregator } from './aggregator.js';

// Reporters
export { type AnalysisReporter } from './reporters/base.js';
export { AnalysisJsonReporter } from './reporters/json.js';
export { AnalysisTableReporter } from './reporters/table.js';
export { AnalysisMarkdownReporter } from './reporters/markdown.js';
