/**
 * Eval Configuration Schema
 * 
 * Schema for eval-only configurations that run evaluators on existing directories
 * without executing an agent.
 */

import { z } from 'zod';
import { postEvaluationConfigSchema } from './post-evaluation.schema.js';

/**
 * Evaluator configuration schema for eval command
 * Same as testcase but without file references (must be inline)
 */
const evalEvaluatorConfigSchema = z.object({
  name: z.string(),
  config: z.record(z.any()).optional(), // Evaluator-specific configuration
});

/**
 * Eval Configuration schema with validation rules
 * 
 * This is a simplified configuration for running evaluators only,
 * without agent execution. Used by the `yb eval` command.
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

  // Directory to evaluate (must exist)
  directory: z
    .string()
    .min(1, 'Directory path is required'),

  // Expected reference directory (optional, for expected-diff evaluator)
  expected_directory: z.string().optional(),

  // Evaluators configuration (must be inline, no file references)
  evaluators: z
    .array(evalEvaluatorConfigSchema)
    .min(1, 'At least one evaluator is required'),

  // Post-evaluations configuration (optional)
  post_evaluation: z.array(postEvaluationConfigSchema).optional(),

  // Output configuration (optional)
  output_dir: z.string().optional(), // Where to save results (default: .youbencha-eval)
});

/**
 * Inferred TypeScript type from schema
 */
export type EvalConfig = z.infer<typeof evalConfigSchema>;

/**
 * Helper type for evaluator configuration
 */
export type EvalEvaluatorConfig = z.infer<typeof evalEvaluatorConfigSchema>;
