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
            const hostname = parsed.hostname.toLowerCase();
            
            // Prevent localhost/internal network access
            // Block localhost and loopback addresses
            if (
              hostname === 'localhost' ||
              hostname === '127.0.0.1' ||
              hostname === '0.0.0.0' ||
              hostname === '::1' ||
              hostname.startsWith('127.') ||
              hostname === '[::1]'
            ) {
              return false;
            }
            
            // Block private IPv4 ranges (RFC 1918)
            // 10.0.0.0/8
            if (hostname.startsWith('10.')) {
              return false;
            }
            // 172.16.0.0/12
            if (hostname.startsWith('172.')) {
              const secondOctet = parseInt(hostname.split('.')[1], 10);
              if (secondOctet >= 16 && secondOctet <= 31) {
                return false;
              }
            }
            // 192.168.0.0/16
            if (hostname.startsWith('192.168.')) {
              return false;
            }
            
            // Block link-local addresses
            // 169.254.0.0/16 (IPv4 link-local)
            if (hostname.startsWith('169.254.')) {
              return false;
            }
            
            // Block IPv6 private and link-local addresses
            if (hostname.includes(':')) {
              // fe80::/10 (link-local)
              if (hostname.startsWith('fe80:') || hostname.startsWith('[fe80:')) {
                return false;
              }
              // fc00::/7 (unique local)
              if (hostname.startsWith('fc') || hostname.startsWith('[fc') ||
                  hostname.startsWith('fd') || hostname.startsWith('[fd')) {
                return false;
              }
            }
            
            // Block .local domains (mDNS)
            if (hostname.endsWith('.local')) {
              return false;
            }
            
            return true;
          } catch {
            return false;
          }
        },
        {
          message: 'Repository must be a valid HTTP(S) URL to a public repository (private networks not allowed)',
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
