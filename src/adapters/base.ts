/**
 * Base Agent Adapter Interface
 *
 * Defines the contract that all agent adapters must implement.
 * Enables pluggable integration of different coding agents.
 */

import { Message, YouBenchaLog } from '../schemas/youbenchalog.schema.js';

/**
 * Provider-reported or explicitly estimated resource usage.
 *
 * Optional numeric fields remain absent when the CLI does not report them.
 * The source field prevents unavailable or estimated values from being
 * presented as provider measurements.
 */
export interface AgentExecutionUsage {
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  credits?: number;
  source: 'measured' | 'estimated' | 'unavailable';
}

/**
 * Optional structured execution data emitted by headless agent CLIs.
 */
export interface AgentExecutionTelemetry {
  cliVersion?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  finalResponse?: string;
  usage?: AgentExecutionUsage;
  messages?: Message[];
  eventsArtifactPath?: string;
  resolvedExecutable?: string;
  configuredModel?: string;
  headlessMode?: boolean;
  sessionPersistence?: boolean;
  structuredOutputFormat?: string;
  legacyParserUsed?: boolean;
  effectiveConfig?: Record<string, unknown>;
  diagnostics?: string[];
}

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
  config: Record<string, unknown>;

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

  /** Optional structured metadata reported by the agent CLI */
  telemetry?: AgentExecutionTelemetry;
}

/**
 * Convert transient adapter telemetry into the durable, non-secret provenance
 * stored with a normalized youBencha log.
 */
export function normalizeExecutionProvenance(
  telemetry: AgentExecutionTelemetry | undefined,
  adapterVersion: string
): YouBenchaLog['provenance'] {
  if (!telemetry) {
    return undefined;
  }

  return {
    cli_version: telemetry.cliVersion,
    adapter_version: adapterVersion,
    resolved_executable: telemetry.resolvedExecutable,
    configured_model: telemetry.configuredModel,
    reported_model: telemetry.model,
    session_id: telemetry.sessionId,
    headless: telemetry.headlessMode,
    session_persistence: telemetry.sessionPersistence,
    structured_output_format: telemetry.structuredOutputFormat,
    usage_source: telemetry.usage?.source,
    legacy_parser_used: telemetry.legacyParserUsed,
    effective_config: telemetry.effectiveConfig,
    diagnostics: telemetry.diagnostics,
  };
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
