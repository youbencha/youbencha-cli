/**
 * Database Post-Evaluator
 * 
 * Exports evaluation results to a database or file.
 * MVP: Appends results to a JSON Lines (JSONL) file for time-series analysis.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PostEvaluator, PostEvaluationContext } from './base.js';
import { PostEvaluationResult, DatabaseConfig } from '../schemas/post-evaluator.schema.js';
import * as logger from '../lib/logger.js';

/**
 * Database Post-Evaluator implementation
 */
export class DatabasePostEvaluator implements PostEvaluator {
  readonly name = 'database';
  readonly description = 'Exports evaluation results to a database or file';

  /**
   * Check if database export is available
   */
  async checkPreconditions(context: PostEvaluationContext): Promise<boolean> {
    const config = context.config as DatabaseConfig;
    
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(path.resolve(config.output_path));
      await fs.mkdir(outputDir, { recursive: true });
      return true;
    } catch (error) {
      logger.warn(`Cannot create output directory: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Execute database export
   */
  async execute(context: PostEvaluationContext): Promise<PostEvaluationResult> {
    const startTime = Date.now();
    const config = context.config as DatabaseConfig;

    try {
      const outputPath = path.resolve(config.output_path);

      // Prepare data to export
      const exportData = config.include_full_bundle
        ? context.resultsBundle
        : this.extractSummary(context.resultsBundle);

      // Add timestamp for time-series tracking
      const enrichedData = {
        ...exportData,
        exported_at: new Date().toISOString(),
      };

      if (config.type === 'json-file') {
        await this.writeJsonLine(outputPath, enrichedData, config.append);
      }

      const duration = Date.now() - startTime;
      return {
        post_evaluator: this.name,
        status: 'success',
        message: `Successfully exported results to ${outputPath}`,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        metadata: {
          output_path: outputPath,
          type: config.type,
          append: config.append,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        post_evaluator: this.name,
        status: 'failed',
        message: 'Failed to export results',
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack_trace: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Write a line to JSON Lines file
   */
  private async writeJsonLine(
    filePath: string,
    data: unknown,
    append: boolean
  ): Promise<void> {
    const jsonLine = JSON.stringify(data) + '\n';
    
    if (append) {
      await fs.appendFile(filePath, jsonLine, 'utf-8');
    } else {
      await fs.writeFile(filePath, jsonLine, 'utf-8');
    }
  }

  /**
   * Extract summary from results bundle
   */
  private extractSummary(bundle: any): any {
    return {
      version: bundle.version,
      test_case: {
        name: bundle.test_case.name,
        description: bundle.test_case.description,
        repo: bundle.test_case.repo,
        branch: bundle.test_case.branch,
        commit: bundle.test_case.commit,
      },
      execution: {
        started_at: bundle.execution.started_at,
        completed_at: bundle.execution.completed_at,
        duration_ms: bundle.execution.duration_ms,
        youbencha_version: bundle.execution.youbencha_version,
      },
      agent: {
        type: bundle.agent.type,
        status: bundle.agent.status,
      },
      summary: bundle.summary,
      evaluators: bundle.evaluators.map((e: any) => ({
        evaluator: e.evaluator,
        status: e.status,
        metrics: e.metrics,
      })),
    };
  }
}
