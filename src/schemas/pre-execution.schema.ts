/**
 * Pre-Execution Schema
 * 
 * Zod schemas for pre-execution configuration and results.
 * Pre-executions run after workspace setup but before agent execution.
 */

import { z } from 'zod';

/**
 * Script pre-execution configuration schema
 */
const scriptConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout_ms: z.number().positive().default(30000),
  working_dir: z.string().optional(),
});

/**
 * Pre-execution configuration schema
 * Currently supports script execution only
 */
export const preExecutionConfigSchema = z.object({
  name: z.enum(['script']),
  config: scriptConfigSchema,
});

/**
 * Pre-execution result schema
 */
export const preExecutionResultSchema = z.object({
  pre_executor: z.string(),
  status: z.enum(['success', 'failed', 'skipped']),
  message: z.string(),
  duration_ms: z.number().nonnegative(),
  timestamp: z.string(), // ISO 8601 format
  metadata: z.record(z.any()).optional(),
  error: z.object({
    message: z.string(),
    stack_trace: z.string().optional(),
  }).optional(),
});

/**
 * Inferred TypeScript types
 */
export type PreExecutionConfig = z.infer<typeof preExecutionConfigSchema>;
export type ScriptConfig = z.infer<typeof scriptConfigSchema>;
export type PreExecutionResult = z.infer<typeof preExecutionResultSchema>;
