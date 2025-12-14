/**
 * Configuration Schema
 * 
 * Defines the schema for youBencha configuration files (.youbencharc, .youbencha.yaml)
 * that can be placed at project or user level.
 */

import { z } from 'zod';

/**
 * Configuration schema for youBencha
 */
export const configSchema = z.object({
  /**
   * Default workspace directory for evaluation runs
   * Can be absolute path or relative to project root
   * Defaults to .youbencha-workspace if not specified
   */
  workspace_dir: z.string().optional(),
  
  /**
   * Default output directory for eval-only runs
   * Can be absolute path or relative to project root
   * Defaults to .youbencha-eval if not specified
   */
  output_dir: z.string().optional(),
  
  /**
   * Default timeout for operations in milliseconds
   * Applies to git operations, agent execution, etc.
   */
  timeout_ms: z.number().int().positive().optional(),
  
  /**
   * Default log level (debug, info, warn, error)
   */
  log_level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  
  /**
   * Whether to keep workspace after evaluation by default
   * Can be overridden by --delete-workspace flag
   */
  keep_workspace: z.boolean().optional(),
  
  /**
   * Environment variables for substitution in configuration files
   * These variables can be referenced using ${VAR_NAME} syntax
   */
  variables: z.record(z.string(), z.string()).optional(),
  
  /**
   * Default agent configuration
   */
  agent: z.object({
    /**
     * Default timeout for agent execution in milliseconds
     */
    timeout_ms: z.number().int().positive().optional(),
    
    /**
     * Default model for agents that support model selection
     */
    model: z.string().optional(),
  }).optional(),
  
  /**
   * Default evaluator configuration
   */
  evaluators: z.object({
    /**
     * Maximum number of concurrent evaluators
     */
    max_concurrent: z.number().int().positive().optional(),
  }).optional(),
}).strict();

/**
 * Configuration type inferred from schema
 */
export type Config = z.infer<typeof configSchema>;

/**
 * Default configuration values
 */
export const defaultConfig: Config = {
  workspace_dir: '.youbencha-workspace',
  output_dir: '.youbencha-eval',
  timeout_ms: 300000, // 5 minutes
  log_level: 'info',
  keep_workspace: true,
  variables: {},
  agent: {
    timeout_ms: 600000, // 10 minutes
  },
  evaluators: {
    max_concurrent: 4,
  },
};
