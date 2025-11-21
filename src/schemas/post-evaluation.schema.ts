/**
 * Post-Evaluation Schema
 * 
 * Zod schemas for post-evaluation configuration and results.
 * Post-evaluations run after evaluation completes to export/process results.
 */

import { z } from 'zod';

/**
 * Webhook post-evaluation configuration schema
 */
const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  include_artifacts: z.boolean().default(false),
  retry_on_failure: z.boolean().default(true),
  timeout_ms: z.number().positive().default(5000),
});

/**
 * Database post-evaluation configuration schema
 */
const databaseConfigSchema = z.object({
  type: z.enum(['json-file']), // MVP: only JSON file export
  output_path: z.string(),
  include_full_bundle: z.boolean().default(true),
  append: z.boolean().default(true), // Append to existing file or overwrite
});

/**
 * Script post-evaluation configuration schema
 */
const scriptConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout_ms: z.number().positive().default(30000),
  working_dir: z.string().optional(),
});

/**
 * Post-evaluation configuration schema
 * Supports webhook, database, and script types
 */
export const postEvaluationConfigSchema = z.object({
  name: z.enum(['webhook', 'database', 'script']),
  config: z.union([webhookConfigSchema, databaseConfigSchema, scriptConfigSchema]),
});

/**
 * Post-evaluation result schema
 */
export const postEvaluationResultSchema = z.object({
  post_evaluator: z.string(),
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
export type PostEvaluationConfig = z.infer<typeof postEvaluationConfigSchema>;
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type ScriptConfig = z.infer<typeof scriptConfigSchema>;
export type PostEvaluationResult = z.infer<typeof postEvaluationResultSchema>;
