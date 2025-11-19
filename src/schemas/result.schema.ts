/**
 * Results Schema
 * 
 * Zod schemas for evaluation results and results bundles.
 * Defines output format for evaluators and complete evaluation runs.
 */

import { z } from 'zod';

/**
 * Artifact schema for evaluator outputs
 */
const artifactSchema = z.object({
  type: z.string(),
  path: z.string(),
  description: z.string(),
});

/**
 * Error schema for evaluation results
 */
const evaluationErrorSchema = z.object({
  message: z.string(),
  stack_trace: z.string().optional(),
});

/**
 * Evaluation Result schema - output from a single evaluator
 */
export const evaluationResultSchema = z.object({
  evaluator: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  metrics: z.record(z.any()), // Evaluator-specific metrics
  message: z.string(),
  duration_ms: z.number().nonnegative(),
  timestamp: z.string(), // ISO 8601 format
  assertions: z.record(z.any()).optional(), // Configured assertions/thresholds for this evaluator
  artifacts: z.array(artifactSchema).optional(),
  error: evaluationErrorSchema.optional(),
});

/**
 * Test case metadata schema for results bundle
 */
const testCaseMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  config_file: z.string(),
  config_hash: z.string(),
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
  expected_branch: z.string().optional(),
});

/**
 * Execution metadata schema for results bundle
 */
const executionMetadataSchema = z.object({
  started_at: z.string(), // ISO 8601 format
  completed_at: z.string(), // ISO 8601 format
  duration_ms: z.number().nonnegative(),
  youbencha_version: z.string(),
  environment: z.object({
    os: z.string(),
    node_version: z.string(),
    workspace_dir: z.string(),
  }),
});

/**
 * Agent execution metadata schema for results bundle
 */
const agentExecutionSchema = z.object({
  type: z.string(),
  youbencha_log_path: z.string(),
  status: z.enum(['success', 'failed', 'timeout']),
  exit_code: z.number(),
});

/**
 * Summary statistics schema for results bundle
 */
const summarySchema = z.object({
  total_evaluators: z.number().nonnegative(),
  passed: z.number().nonnegative(),
  failed: z.number().nonnegative(),
  skipped: z.number().nonnegative(),
  overall_status: z.enum(['passed', 'failed', 'partial']),
});

/**
 * Artifacts manifest schema for results bundle
 */
const artifactsManifestSchema = z.object({
  agent_log: z.string(),
  reports: z.array(z.string()),
  evaluator_artifacts: z.array(z.string()),
});

/**
 * Results Bundle schema - complete evaluation output
 */
export const resultsBundleSchema = z.object({
  version: z.literal('1.0.0'), // MVP version locked to 1.0.0
  test_case: testCaseMetadataSchema,
  execution: executionMetadataSchema,
  agent: agentExecutionSchema,
  evaluators: z.array(evaluationResultSchema),
  summary: summarySchema,
  artifacts: artifactsManifestSchema,
});

/**
 * Inferred TypeScript types
 */
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type ResultsBundle = z.infer<typeof resultsBundleSchema>;
export type EvaluationArtifact = z.infer<typeof artifactSchema>;
export type TestCaseMetadata = z.infer<typeof testCaseMetadataSchema>;
export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>;
export type AgentExecution = z.infer<typeof agentExecutionSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type ArtifactsManifest = z.infer<typeof artifactsManifestSchema>;

// Legacy type exports for backward compatibility
export type SuiteMetadata = TestCaseMetadata;
