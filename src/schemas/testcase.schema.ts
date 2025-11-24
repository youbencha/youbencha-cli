/**
 * Test Case Configuration Schema
 * 
 * Zod schema for test case configuration.
 * Defines what to test and how to evaluate the results.
 */

import { z } from 'zod';
import { postEvaluationConfigSchema } from './post-evaluation.schema.js';
import { preExecutionConfigSchema } from './pre-execution.schema.js';

/**
 * Agent configuration schema
 */
const agentConfigSchema = z.object({
  type: z.enum(['copilot-cli', 'codex-cli']), // Supported agent adapters
  agent_name: z.string().optional(), // Optional agent name (e.g., for copilot-cli agents in .github/agents/)
  model: z.enum([
    'claude-sonnet-4.5',
    'claude-sonnet-4',
    'claude-haiku-4.5',
    'gpt-5',
    'gpt-5.1',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex',
    'gpt-4',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'gemini-3-pro-preview',
  ]).optional(), // Optional model name
  config: z
    .object({
      prompt: z
        .string()
        .min(1, 'Prompt is required')
        .max(50000, 'Prompt exceeds maximum length of 50000 characters')
        .optional(),
      prompt_file: z
        .string()
        .min(1, 'Prompt file path is required')
        .optional(),
    })
    .catchall(z.any()) // Allow other agent-specific config
    .refine(
      (data) => {
        // Ensure prompt and prompt_file are mutually exclusive
        if (data.prompt && data.prompt_file) {
          return false;
        }
        return true;
      },
      {
        message: 'Cannot specify both "prompt" and "prompt_file". Please use only one.',
      }
    )
    .optional(),
});

/**
 * Evaluator configuration schema
 * Evaluators run checks and generate assertions about the code
 * 
 * Supports two modes:
 * 1. Inline configuration: { name: 'evaluator-name', config: {...} }
 * 2. File reference: { file: './path/to/evaluator.yaml' }
 * 
 * These modes are mutually exclusive - an evaluator config must have
 * either 'name' or 'file', but not both.
 */
const evaluatorConfigSchema = z.union([
  // Mode 1: Inline evaluator configuration
  z.object({
    name: z.string(),
    config: z.record(z.any()).optional(), // Evaluator-specific configuration
  }).strict(), // Strict mode prevents extra fields like 'file'
  // Mode 2: Reference to external evaluator definition file
  z.object({
    file: z.string().min(1, 'Evaluator file path is required'),
  }).strict(), // Strict mode prevents extra fields like 'name'
]);

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

    // Evaluators configuration
    evaluators: z
      .array(evaluatorConfigSchema)
      .min(1, 'At least one evaluator is required'),

    // Pre-executions configuration (optional)
    pre_execution: z.array(preExecutionConfigSchema).optional(),

    // Post-evaluations configuration (optional)
    post_evaluation: z.array(postEvaluationConfigSchema).optional(),

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
 * Helper type for evaluator configuration
 */
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;

// Legacy exports for backward compatibility during transition
export const suiteConfigSchema = testCaseConfigSchema;
export type SuiteConfig = TestCaseConfig;
export type AssertionConfig = EvaluatorConfig;
