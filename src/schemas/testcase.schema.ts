/**
 * Test Case Configuration Schema
 * 
 * Zod schema for test case configuration.
 * Defines what to test and how to evaluate the results.
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
 * Assertion configuration schema
 * Assertions define expected outcomes that can be evaluated as pass/fail
 */
const assertionConfigSchema = z.object({
  name: z.string(),
  config: z.record(z.any()).optional(), // Assertion-specific configuration
});

/**
 * Test Case Configuration schema with validation rules
 */
export const testCaseConfigSchema = z
  .object({
    // Test case metadata
    name: z
      .string()
      .min(1, 'Test case name is required')
      .max(200, 'Test case name exceeds maximum length of 200 characters'),
    description: z
      .string()
      .min(1, 'Test case description is required')
      .max(1000, 'Test case description exceeds maximum length of 1000 characters'),

    // Repository configuration (test data)
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

    // Assertions configuration (evaluators)
    assertions: z
      .array(assertionConfigSchema)
      .min(1, 'At least one assertion is required'),

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
export type TestCaseConfig = z.infer<typeof testCaseConfigSchema>;

/**
 * Helper type for agent configuration
 */
export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Helper type for assertion configuration
 */
export type AssertionConfig = z.infer<typeof assertionConfigSchema>;

// Legacy exports for backward compatibility during transition
export const suiteConfigSchema = testCaseConfigSchema;
export type SuiteConfig = TestCaseConfig;
export type EvaluatorConfig = AssertionConfig;
