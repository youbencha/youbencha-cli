/**
 * Base Agent Adapter Interface
 * 
 * Defines the contract that all agent adapters must implement.
 * Enables pluggable integration of different coding agents.
 */

import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';

/**
 * Context provided to agent adapter for execution
 */
export interface AgentExecutionContext {
  /** Path to workspace directory where agent should operate */
  workspaceDir: string;

  /** Path to the cloned repository (src-modified/) */
  repoDir: string;

  /** Path to artifacts directory for logs and outputs */
  artifactsDir: string;

  /** Agent-specific configuration from suite config */
  config: Record<string, any>;

  /** Timeout in milliseconds (0 = no timeout) */
  timeout: number;

  /** Environment variables to pass to agent */
  env: Record<string, string>;
}

/**
 * Result of agent execution
 */
export interface AgentExecutionResult {
  /** Exit code from agent process */
  exitCode: number;

  /** Execution status */
  status: 'success' | 'failed' | 'timeout';

  /** Combined stdout and stderr */
  output: string;

  /** Execution start timestamp (ISO 8601) */
  startedAt: string;

  /** Execution completion timestamp (ISO 8601) */
  completedAt: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Any errors encountered */
  errors: Array<{
    message: string;
    timestamp: string;
    stackTrace?: string;
  }>;
}

/**
 * AgentAdapter interface for integrating coding agents with youBencha
 * 
 * Each agent (GitHub Copilot CLI, Claude Code, etc.) implements this interface
 * to enable evaluation within youBencha framework.
 */
export interface AgentAdapter {
  /**
   * Unique identifier for this adapter
   * Example: 'copilot-cli', 'claude-code', 'aider'
   */
  readonly name: string;

  /**
   * Adapter version (semver)
   * Example: '1.0.0'
   */
  readonly version: string;

  /**
   * Check if the agent is installed and accessible
   * Should verify CLI availability, authentication, etc.
   * 
   * @returns Promise resolving to true if agent is ready, false otherwise
   * @throws Error with descriptive message if agent cannot be used
   */
  checkAvailability(): Promise<boolean>;

  /**
   * Execute the agent with the given configuration
   * 
   * @param context - Execution context with workspace and configuration
   * @returns Promise resolving to execution result with logs
   * @throws Error if execution fails fatally
   */
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;

  /**
   * Transform agent-specific output to youBencha Log format
   * 
   * @param rawOutput - Raw stdout/stderr from agent
   * @param result - Execution result metadata
   * @returns youBencha Log object conforming to schema
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog;
}
