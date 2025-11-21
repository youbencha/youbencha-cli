/**
 * Base Pre-Execution Interface
 * 
 * Defines the contract that all pre-executions must implement.
 * Pre-executions run after workspace setup but before agent execution.
 */

import { PreExecutionResult } from '../schemas/pre-execution.schema.js';

/**
 * Context provided to pre-execution for execution
 */
export interface PreExecutionContext {
  /** Path to the workspace directory where agent will work */
  workspaceDir: string;

  /** Path to repository directory (same as workspaceDir for now) */
  repoDir: string;

  /** Path to artifacts directory for storing outputs */
  artifactsDir: string;

  /** Test case name for reference */
  testCaseName: string;

  /** Repository URL */
  repoUrl: string;

  /** Branch being tested */
  branch?: string;

  /** Pre-execution specific configuration */
  config: Record<string, unknown>;
}

/**
 * Pre-Executor interface for running hooks before agent execution
 * 
 * Each pre-execution (script, etc.) implements this interface 
 * to enable pluggable pre-execution actions.
 */
export interface PreExecution {
  /**
   * Unique identifier for this pre-execution
   * Example: 'script'
   */
  readonly name: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Check if pre-execution can run in current environment
   * Example: checking for required tools, permissions, etc.
   * 
   * @returns Promise resolving to true if pre-execution can run
   */
  checkPreconditions(context: PreExecutionContext): Promise<boolean>;

  /**
   * Execute the pre-execution action
   * 
   * @param context - Pre-execution context with workspace info and config
   * @returns Promise resolving to pre-execution result
   * @throws Error only for fatal errors; use PreExecutionResult.status='failed' for recoverable issues
   */
  execute(context: PreExecutionContext): Promise<PreExecutionResult>;
}
