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
  agent_name: z.string().optional(), // Optional agent name (e.g., for copilot-cli agents in .github/agents/)
  config: z
    .object({
      prompt: z
        .string()
        .min(1, 'Prompt is required')
        .max(50000, 'Prompt exceeds maximum length of 50000 characters')
        .optional(),
    })
    .catchall(z.any()) // Allow other agent-specific config
    .optional(),
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
    repo: z
      .string()
      .min(1, 'Repository URL is required')
      .refine(
        (url) => {
          // Only allow HTTP(S) URLs for security
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return false;
          }
          
          // Validate URL format
          try {
            const parsed = new URL(url);
            // Prevent localhost/internal network access
            const hostname = parsed.hostname.toLowerCase();
            if (
              hostname === 'localhost' ||
              hostname === '127.0.0.1' ||
              hostname === '0.0.0.0' ||
              hostname.startsWith('192.168.') ||
              hostname.startsWith('10.') ||
              hostname.startsWith('172.16.') ||
              hostname === '::1'
            ) {
              return false;
            }
            return true;
          } catch {
            return false;
          }
        },
        {
          message: 'Repository must be a valid HTTP(S) URL to a public repository',
        }
      ),
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
