/**
 * Suite Configuration Schema
 * 
 * Zod schema for evaluation suite configuration.
 * Defines what to evaluate and how.
 */

import { z } from 'zod';

/**
 * Agent configuration schema
 */
const agentConfigSchema = z.object({
  type: z.literal('copilot-cli'), // MVP: only copilot-cli supported
  config: z.record(z.any()).optional(), // Agent-specific configuration
});

/**
 * Evaluator configuration schema
 */
const evaluatorConfigSchema = z.object({
  name: z.string(),
  config: z.record(z.any()).optional(), // Evaluator-specific configuration
});

/**
 * Suite Configuration schema with validation rules
 */
export const suiteConfigSchema = z
  .object({
    // Repository configuration
    repo: z.string().min(1, 'Repository URL is required'),
    branch: z.string().optional(),
    commit: z.string().optional(),

    // Agent configuration
    agent: agentConfigSchema,

    // Expected reference configuration (optional)
    expected_source: z.literal('branch').optional(), // MVP: only 'branch' supported
    expected: z.string().optional(),

    // Evaluators configuration
    evaluators: z
      .array(evaluatorConfigSchema)
      .min(1, 'At least one evaluator is required'),

    // Execution configuration (optional)
    workspace_dir: z.string().optional(),
    timeout: z.number().positive().optional(),
  })
  .refine(
    (data) => {
      // If expected_source is provided, expected must also be provided
      if (data.expected_source && !data.expected) {
        return false;
      }
      return true;
    },
    {
      message:
        'When expected_source is provided, expected value must also be provided',
      path: ['expected'],
    }
  );

/**
 * Inferred TypeScript type from schema
 */
export type SuiteConfig = z.infer<typeof suiteConfigSchema>;

/**
 * Helper type for agent configuration
 */
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Helper type for evaluator configuration
 */
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
