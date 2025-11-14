/**
 * Base Evaluator Interface
 * 
 * Defines the contract that all evaluators must implement.
 * Enables pluggable evaluation of agent outputs.
 */

import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import { SuiteConfig } from '../schemas/suite.schema.js';
import { EvaluationResult } from '../schemas/result.schema.js';

/**
 * Context provided to evaluator for evaluation
 */
export interface EvaluationContext {
  /** Path to modified source directory (where agent made changes) */
  modifiedDir: string;

  /** Path to expected reference directory (if configured) */
  expectedDir?: string;

  /** Path to artifacts directory where evaluator can write outputs */
  artifactsDir: string;

  /** youBencha Log from agent execution */
  agentLog: YouBenchaLog;

  /** Evaluator-specific configuration from suite config */
  config: Record<string, unknown>;

  /** Suite configuration for context */
  suiteConfig: SuiteConfig;

  /** Optional custom identifier for this evaluator instance (for multiple instances of same evaluator) */
  evaluatorId?: string;
}

/**
 * Evaluator interface for analyzing agent outputs
 * 
 * Each evaluator (git-diff, expected-diff, agentic-judge, etc.) implements
 * this interface to enable pluggable evaluation.
 */
export interface Evaluator {
  /**
   * Unique identifier for this evaluator
   * Example: 'git-diff', 'expected-diff', 'agentic-judge'
   */
  readonly name: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Whether this evaluator requires expected reference
   * If true, will be skipped if no expected reference configured
   */
  readonly requiresExpectedReference: boolean;

  /**
   * Check if evaluator can run in current environment
   * Example: checking for required tools, API keys, etc.
   * 
   * @returns Promise resolving to true if evaluator can run
   */
  checkPreconditions(context: EvaluationContext): Promise<boolean>;

  /**
   * Run the evaluation
   * 
   * @param context - Evaluation context with workspace paths and config
   * @returns Promise resolving to evaluation result
   * @throws Error only for fatal errors; use EvaluationResult.status='skipped' for recoverable issues
   */
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}
