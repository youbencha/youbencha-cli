/**
 * Suite Configuration Schema (DEPRECATED)
 * 
 * @deprecated Use testcase.schema.ts instead. This file is kept for backward compatibility.
 * The terminology has been updated from "suite" to "test case" to be more developer-friendly.
 * 
 * This schema is re-exported from testcase.schema.ts and will be removed in a future version.
 */

import { z } from 'zod';

/**
 * Valid model names for copilot-cli
 */
const copilotModelSchema = z.enum([
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-haiku-4.5',
  'gpt-5',
  'gpt-5.1',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex',
  'gemini-3-pro-preview',
]);

/**
 * Agent configuration schema
 */
const agentConfigSchema = z.object({
  type: z.literal('copilot-cli'), // MVP: only copilot-cli supported
  agent_name: z.string().optional(), // Optional agent name (e.g., for copilot-cli agents in .github/agents/)
  model: copilotModelSchema.optional(), // Optional model name (e.g., 'gpt-5.1', 'claude-sonnet-4.5')
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
    workspace_name: z
      .string()
      .min(1, 'Workspace name cannot be empty')
      .max(100, 'Workspace name exceeds maximum length of 100 characters')
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
        'Workspace name must start with alphanumeric and contain only letters, numbers, dots, underscores, and hyphens'
      )
      .optional(),
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
 * @deprecated Use TestCaseConfig from testcase.schema.ts instead
 */
export type SuiteConfig = z.infer<typeof suiteConfigSchema>;

/**
 * Helper type for agent configuration
 * @deprecated Use AgentConfig from testcase.schema.ts instead
 */
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Helper type for evaluator configuration
 * @deprecated Use EvaluatorConfig from testcase.schema.ts instead
 */
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
