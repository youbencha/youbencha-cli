/**
 * Eval Configuration Schema
 * 
 * Zod schema for eval-only configuration.
 * Used when running evaluations on an existing directory without running an agent.
 */

import { z } from 'zod';
import { postEvaluationConfigSchema } from './post-evaluation.schema.js';

/**
 * Evaluator configuration schema (same as testcase.schema.ts)
 * Evaluators run checks and generate assertions about the code
 * 
 * Supports two modes:
 * 1. Inline configuration: { name: 'evaluator-name', config: {...} }
 * 2. File reference: { file: './path/to/evaluator.yaml' }
 */
const evaluatorConfigSchema = z.union([
  // Mode 1: Inline evaluator configuration
  z.object({
    name: z.string(),
    config: z.record(z.any()).optional(), // Evaluator-specific configuration
  }).strict(),
  // Mode 2: Reference to external evaluator definition file
  z.object({
    file: z.string().min(1, 'Evaluator file path is required'),
  }).strict(),
]);

/**
 * Eval Configuration schema
 * 
 * Used for running evaluations on an existing directory without agent execution.
 */
export const evalConfigSchema = z.object({
  // Eval metadata
  name: z
    .string()
    .min(1, 'Eval name is required')
    .max(200, 'Eval name exceeds maximum length of 200 characters'),
  description: z
    .string()
    .min(1, 'Eval description is required')
    .max(1000, 'Eval description exceeds maximum length of 1000 characters'),

  // Directory configuration
  directory: z
    .string()
    .min(1, 'Directory path is required')
    .describe('Path to directory containing code to evaluate (defaults to current directory)'),
  
  // Optional expected reference directory for comparison
  expected_directory: z
    .string()
    .optional()
    .describe('Optional path to expected reference directory for comparison'),

  // Evaluators configuration
  evaluators: z
    .array(evaluatorConfigSchema)
    .min(1, 'At least one evaluator is required'),

  // Post-evaluations configuration (optional)
  post_evaluation: z.array(postEvaluationConfigSchema).optional(),

  // Output configuration
  output_dir: z
    .string()
    .optional()
    .describe('Directory to store evaluation results (defaults to .youbencha-eval in current directory)'),
  
  // Execution configuration (optional)
  timeout: z.number().positive().optional(),
});

/**
 * Inferred TypeScript type from schema
 */
export type EvalConfig = z.infer<typeof evalConfigSchema>;

/**
 * Helper type for evaluator configuration
 */
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
