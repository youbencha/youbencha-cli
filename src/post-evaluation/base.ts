/**
 * Base Post-Evaluation Interface
 * 
 * Defines the contract that all post-evaluations must implement.
 * Post-evaluations run after evaluation completes to export or process results.
 */

import { ResultsBundle } from '../schemas/result.schema.js';
import { PostEvaluationResult } from '../schemas/post-evaluation.schema.js';

/**
 * Context provided to post-evaluation for execution
 */
export interface PostEvaluationContext {
  /** Complete evaluation results bundle */
  resultsBundle: ResultsBundle;

  /** Path to results.json file */
  resultsBundlePath: string;

  /** Path to artifacts directory */
  artifactsDir: string;

  /** Path to workspace root directory */
  workspaceDir: string;

  /** Post-evaluation specific configuration */
  config: Record<string, unknown>;
}

/**
 * Post-Evaluator interface for exporting/processing results
 * 
 * Each post-evaluation (webhook, database, script, etc.) implements
 * this interface to enable pluggable post-evaluation actions.
 */
export interface PostEvaluation {
  /**
   * Unique identifier for this post-evaluation
   * Example: 'webhook', 'database', 'script'
   */
  readonly name: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Check if post-evaluation can run in current environment
   * Example: checking for API keys, required tools, network connectivity, etc.
   * 
   * @returns Promise resolving to true if post-evaluation can run
   */
  checkPreconditions(context: PostEvaluationContext): Promise<boolean>;

  /**
   * Execute the post-evaluation action
   * 
   * @param context - Post-evaluation context with results and config
   * @returns Promise resolving to post-evaluation result
   * @throws Error only for fatal errors; use PostEvaluationResult.status='skipped' for recoverable issues
   */
  execute(context: PostEvaluationContext): Promise<PostEvaluationResult>;
}
