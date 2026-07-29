/**
 * Suite Configuration Schema (DEPRECATED)
 *
 * @deprecated Use testcase.schema.ts instead. This compatibility schema keeps
 * the legacy top-level shape while deriving supported agent types from the
 * active agent registry.
 */

import { z } from 'zod';
import { agentConfigSchema as activeAgentConfigSchema } from './agent-config/index.js';

/**
 * Legacy agent shape. Configuration remains permissive for backward
 * compatibility, but its discriminator is validated by the active registry.
 */
const legacyCopilotAgentConfigSchema = z.object({
  type: z.literal('copilot-cli'),
  agent_name: z.string().optional(),
  model: z.string().min(1).optional(),
  config: z.record(z.any()).optional(),
});

const agentConfigSchema = z.union([
  activeAgentConfigSchema,
  legacyCopilotAgentConfigSchema,
]);

const evaluatorConfigSchema = z.object({
  name: z.string(),
  config: z.record(z.any()).optional(),
});

export const suiteConfigSchema = z
  .object({
    repo: z
      .string()
      .min(1, 'Repository URL is required')
      .refine(
        (url) => {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return false;
          }

          try {
            const parsed = new URL(url);
            const hostname = parsed.hostname
              .toLowerCase()
              .replace(/^\[|\]$/g, '');
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
          message:
            'Repository must be a valid HTTP(S) URL to a public repository',
        }
      ),
    branch: z.string().optional(),
    commit: z.string().optional(),
    agent: agentConfigSchema,
    expected_source: z.literal('branch').optional(),
    expected: z.string().optional(),
    evaluators: z
      .array(evaluatorConfigSchema)
      .min(1, 'At least one evaluator is required'),
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
  .refine((data) => !data.expected_source || Boolean(data.expected), {
    message:
      'When expected_source is provided, expected value must also be provided',
    path: ['expected'],
  });

export type SuiteConfig = z.infer<typeof suiteConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
