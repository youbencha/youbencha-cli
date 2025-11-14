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
  testCaseConfigSchema,
  type TestCaseConfig,
  type AgentConfig,
  type AssertionConfig,
  // Legacy exports for backward compatibility
  suiteConfigSchema,
  type SuiteConfig,
  type EvaluatorConfig,
} from './testcase.schema.js';

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
