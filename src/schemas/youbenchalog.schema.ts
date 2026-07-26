/**
 * youBencha Log Schema
 *
 * Zod schema for normalized agent execution logs.
 * Ensures consistent log format across all agent adapters.
 *
 * Version: 1.0.0
 */

import { z } from 'zod';

/**
 * Tool call schema for assistant messages
 */
const toolCallSchema = z.object({
  id: z.string(),
  type: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.string(), // JSON string
  }),
});

/**
 * Message schema with role-based validation
 */
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  timestamp: z.string(), // ISO 8601 format
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

/**
 * Error schema
 */
const errorSchema = z.object({
  message: z.string(),
  timestamp: z.string(), // ISO 8601 format
  stack_trace: z.string().optional(),
});

/**
 * Agent metadata schema
 */
const agentSchema = z.object({
  name: z.string(),
  version: z.string(),
  adapter_version: z.string(),
});

/**
 * Model information schema
 */
const modelSchema = z.object({
  name: z.string(),
  provider: z.string(),
  parameters: z.record(z.any()), // Flexible parameters object
});

/**
 * Execution metadata schema
 */
const executionSchema = z.object({
  started_at: z.string(), // ISO 8601 format
  completed_at: z.string(), // ISO 8601 format
  duration_ms: z.number().nonnegative(),
  exit_code: z.number(),
  status: z.enum(['success', 'failed', 'timeout']),
});

/**
 * Resource usage schema
 */
const usageSchema = z.object({
  prompt_tokens: z.number().nonnegative(),
  cached_prompt_tokens: z.number().nonnegative().optional(),
  completion_tokens: z.number().nonnegative(),
  reasoning_tokens: z.number().nonnegative().optional(),
  total_tokens: z.number().nonnegative(),
  cost_usd: z.number().nonnegative().optional(),
  credits: z.number().nonnegative().optional(),
  estimated_cost_usd: z.number().nonnegative().optional(),
  measurement_source: z
    .enum(['measured', 'estimated', 'unavailable'])
    .optional(),
});

/**
 * Environment context schema
 */
const environmentSchema = z.object({
  os: z.string(),
  node_version: z.string(),
  youbencha_version: z.string(),
  working_directory: z.string(),
});

/**
 * Reproducibility metadata for a headless agent invocation.
 *
 * Optional so existing version 1.0.0 logs remain valid.
 */
const provenanceSchema = z.object({
  cli_version: z.string().optional(),
  adapter_version: z.string().optional(),
  resolved_executable: z.string().optional(),
  configured_model: z.string().optional(),
  reported_model: z.string().optional(),
  session_id: z.string().optional(),
  headless: z.boolean().optional(),
  session_persistence: z.boolean().optional(),
  structured_output_format: z.string().optional(),
  usage_source: z.enum(['measured', 'estimated', 'unavailable']).optional(),
  legacy_parser_used: z.boolean().optional(),
  effective_config: z.record(z.unknown()).optional(),
  diagnostics: z.array(z.string()).optional(),
});

/**
 * Complete youBencha Log schema
 */
export const youBenchaLogSchema = z.object({
  version: z.literal('1.0.0'), // MVP version locked to 1.0.0
  agent: agentSchema,
  model: modelSchema,
  execution: executionSchema,
  messages: z.array(messageSchema),
  usage: usageSchema,
  errors: z.array(errorSchema),
  environment: environmentSchema,
  provenance: provenanceSchema.optional(),
});

/**
 * Inferred TypeScript type from schema
 */
export type YouBenchaLog = z.infer<typeof youBenchaLogSchema>;

/**
 * Helper type for messages
 */
export type Message = z.infer<typeof messageSchema>;

/**
 * Helper type for tool calls
 */
export type ToolCall = z.infer<typeof toolCallSchema>;

/**
 * Helper type for errors
 */
export type LogError = z.infer<typeof errorSchema>;
