/**
 * Schemas Index
 *
 * Central export point for all Zod schemas and inferred TypeScript types.
 */

// youBencha Log schema and types
export {
  youBenchaLogSchema,
  type YouBenchaLog,
  type Message,
  type ToolCall,
  type LogError,
} from './youbenchalog.schema.js';

// Test Case Configuration schema and types
export {
  agentConfigSchema,
  testCaseConfigSchema,
  type TestCaseConfig,
  type AgentConfig,
  type EvaluatorConfig,
  // Legacy exports for backward compatibility
  suiteConfigSchema,
  type SuiteConfig,
  type AssertionConfig,
} from './testcase.schema.js';
export {
  claudeCodeAgentConfigSchema,
  claudeCodeConfigSchema,
  copilotCliAgentConfigSchema,
  copilotCliConfigSchema,
  type ClaudeCodeConfig,
  type CopilotCliConfig,
} from './agent-config/index.js';

export {
  experimentDefinitionSchema,
  experimentTestCaseSchema,
  experimentVariantSchema,
  retryReasonSchema,
  type ExperimentDefinition,
  type ExperimentTestCase,
  type ExperimentVariant,
  type RetryReason,
} from './experiment.schema.js';

export {
  measurementQualitySchema,
  experimentCellStatusSchema,
  experimentFinalStatusSchema,
  experimentAttemptSchema,
  experimentCellResultSchema,
  aggregateMetricSchema,
  experimentAggregateSchema,
  experimentAggregatesSchema,
  experimentComparisonFindingSchema,
  experimentResultSchema,
  experimentStateSchema,
  type ExperimentResult,
  type ExperimentState,
  type ExperimentCellResult,
  type ExperimentCellStatus,
  type ExperimentAttempt,
  type MeasurementQuality,
} from './experiment-result.schema.js';

// Evaluator Definition schema and types
export {
  evaluatorDefinitionSchema,
  type EvaluatorDefinition,
} from './evaluator-definition.schema.js';
export {
  gitDiffEvaluatorConfigSchema,
  expectedDiffEvaluatorConfigSchema,
  agenticJudgeEvaluatorConfigSchema,
  parseEvaluatorConfig,
} from './evaluator-config.schema.js';

// Results schema and types
export {
  evaluationResultSchema,
  resultsBundleSchema,
  type EvaluationResult,
  type ResultsBundle,
  type EvaluationArtifact,
  type TestCaseMetadata,
  type ExecutionMetadata,
  type AgentExecution,
  type Summary,
  type ArtifactsManifest,
  // Legacy type for backward compatibility
  type SuiteMetadata,
} from './result.schema.js';

// Post-Evaluator schema and types
export {
  postEvaluationConfigSchema,
  postEvaluationResultSchema,
  type PostEvaluationConfig,
  type WebhookConfig,
  type DatabaseConfig,
  type ScriptConfig,
  type PostEvaluationResult,
} from './post-evaluation.schema.js';

// Pre-Execution schema and types
export {
  preExecutionConfigSchema,
  preExecutionResultSchema,
  type PreExecutionConfig,
  type PreExecutionResult,
} from './pre-execution.schema.js';

// Configuration schema and types
export { configSchema, defaultConfig, type Config } from './config.schema.js';
