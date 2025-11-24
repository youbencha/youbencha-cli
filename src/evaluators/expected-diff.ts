/**
 * Expected Diff Evaluator
 * 
 * Compares agent-modified code against expected reference branch.
 * Calculates file-by-file similarity and aggregate similarity score.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Evaluator, EvaluationContext } from './base.js';
import { EvaluationResult, EvaluationArtifact } from '../schemas/result.schema.js';
import { calculateSimilarity } from '../lib/diff-utils.js';

/**
 * File similarity details
 */
interface FileSimilarity {
  path: string;
  similarity: number;
  status: 'matched' | 'changed' | 'added' | 'removed';
}

/**
 * ExpectedDiffEvaluator compares modified code against expected reference
 */
export class ExpectedDiffEvaluator implements Evaluator {
  readonly name = 'expected-diff';
  readonly description = 'Compares the agent\'s output against a known-good reference (like an ideal implementation). Measures how similar the results are, file by file. Perfect for checking if the agent matched your expectations or followed a reference solution.';
  readonly requiresExpectedReference = true;

  /**
   * Check if both directories exist and are accessible
   */
  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    try {
      // Expected reference is required
      if (!context.expectedDir) {
        return false;
      }

      // Check if both directories exist
      await fs.access(context.modifiedDir);
      await fs.access(context.expectedDir);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Evaluate similarity between modified and expected directories
   */
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const startedAt = new Date().toISOString();

    try {
      // Check preconditions
      const canRun = await this.checkPreconditions(context);
      if (!canRun) {
        return this.createSkippedResult(
          startedAt,
          'Expected reference directory not available or not accessible'
        );
      }

      // Get threshold from config (default: 0.80)
      const threshold = (context.config.threshold as number) || 0.80;

      // Get all files from both directories
      const modifiedFiles = await this.getAllFiles(context.modifiedDir);
      const expectedFiles = await this.getAllFiles(context.expectedDir!);

      // Compare files
      const fileSimilarities = await this.compareFiles(
        context.modifiedDir,
        context.expectedDir!,
        modifiedFiles,
        expectedFiles
      );

      // Calculate aggregate metrics
      const metrics = this.calculateAggregateMetrics(
        fileSimilarities,
        modifiedFiles,
        expectedFiles
      );

      // Determine status based on threshold
      const status = metrics.aggregate_similarity >= threshold ? 'passed' : 'failed';

      // Generate artifacts
      const artifacts = await this.generateArtifacts(
        context.artifactsDir,
        fileSimilarities,
        metrics
      );

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Build message
      const message = this.buildMessage(metrics, threshold, status);

      return {
        evaluator: this.name,
        status,
        metrics: {
          aggregate_similarity: metrics.aggregate_similarity,
          files_matched: metrics.files_matched,
          files_changed: metrics.files_changed,
          files_added: metrics.files_added,
          files_removed: metrics.files_removed,
          file_similarities: fileSimilarities,
        },
        message,
        duration_ms: durationMs,
        timestamp: completedAt,
        assertions: {
          threshold,
        },
        artifacts,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        evaluator: this.name,
        status: 'skipped',
        metrics: {},
        message: `Evaluation skipped: ${errorMessage}`,
        duration_ms: durationMs,
        timestamp: completedAt,
        error: {
          message: errorMessage,
          stack_trace: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Get all files recursively from a directory (excluding .git)
   */
  private async getAllFiles(dir: string, baseDir?: string): Promise<string[]> {
    const base = baseDir || dir;
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === '.git') {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(base, fullPath);

        if (entry.isDirectory()) {
          const subFiles = await this.getAllFiles(fullPath, base);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    } catch (error) {
      // Ignore read errors for individual directories
    }

    return files;
  }

  /**
   * Compare files between modified and expected directories
   */
  private async compareFiles(
    modifiedDir: string,
    expectedDir: string,
    modifiedFiles: string[],
    expectedFiles: string[]
  ): Promise<FileSimilarity[]> {
    const similarities: FileSimilarity[] = [];
    const modifiedSet = new Set(modifiedFiles);
    const expectedSet = new Set(expectedFiles);

    // Compare files that exist in both
    for (const filePath of modifiedFiles) {
      if (expectedSet.has(filePath)) {
        // File exists in both - compare content
        try {
          const modifiedContent = await fs.readFile(
            path.join(modifiedDir, filePath),
            'utf-8'
          );
          const expectedContent = await fs.readFile(
            path.join(expectedDir, filePath),
            'utf-8'
          );

          const similarity = calculateSimilarity(modifiedContent, expectedContent);

          similarities.push({
            path: filePath,
            similarity,
            status: similarity === 1.0 ? 'matched' : 'changed',
          });
        } catch (error) {
          // If file read fails, treat as completely different
          similarities.push({
            path: filePath,
            similarity: 0,
            status: 'changed',
          });
        }
      } else {
        // File only in modified (added)
        similarities.push({
          path: filePath,
          similarity: 0,
          status: 'added',
        });
      }
    }

    // Files only in expected (removed)
    for (const filePath of expectedFiles) {
      if (!modifiedSet.has(filePath)) {
        similarities.push({
          path: filePath,
          similarity: 0,
          status: 'removed',
        });
      }
    }

    return similarities;
  }

  /**
   * Calculate aggregate metrics from file similarities
   */
  private calculateAggregateMetrics(
    fileSimilarities: FileSimilarity[],
    modifiedFiles: string[],
    expectedFiles: string[]
  ): Record<string, unknown> {
    // Count file status categories
    const matched = fileSimilarities.filter(f => f.status === 'matched').length;
    const changed = fileSimilarities.filter(f => f.status === 'changed').length;
    const added = fileSimilarities.filter(f => f.status === 'added').length;
    const removed = fileSimilarities.filter(f => f.status === 'removed').length;

    // Calculate aggregate similarity as weighted average
    // Only include files that exist in both directories
    const comparableFiles = fileSimilarities.filter(
      f => f.status === 'matched' || f.status === 'changed'
    );

    let aggregateSimilarity: number;

    if (comparableFiles.length === 0) {
      // If no comparable files, check if both directories are empty
      if (modifiedFiles.length === 0 && expectedFiles.length === 0) {
        aggregateSimilarity = 1.0; // Both empty = perfect match
      } else {
        aggregateSimilarity = 0.0; // Completely different
      }
    } else {
      // Calculate average similarity of comparable files
      const totalSimilarity = comparableFiles.reduce((sum, f) => sum + f.similarity, 0);
      aggregateSimilarity = totalSimilarity / comparableFiles.length;

      // Apply penalty for added/removed files
      const totalFiles = new Set([...modifiedFiles, ...expectedFiles]).size;
      const structuralPenalty = (added + removed) / totalFiles;
      aggregateSimilarity = Math.max(0, aggregateSimilarity - structuralPenalty);
    }

    return {
      aggregate_similarity: Math.max(0, Math.min(1, aggregateSimilarity)),
      files_matched: matched,
      files_changed: changed,
      files_added: added,
      files_removed: removed,
    };
  }

  /**
   * Generate artifacts for diff report
   */
  private async generateArtifacts(
    artifactsDir: string,
    fileSimilarities: FileSimilarity[],
    metrics: ReturnType<typeof this.calculateAggregateMetrics>
  ): Promise<EvaluationArtifact[]> {
    try {
      // Generate detailed diff report
      const reportPath = 'expected-diff-report.json';
      const fullPath = path.join(artifactsDir, reportPath);

      const report = {
        summary: metrics,
        file_details: fileSimilarities,
        timestamp: new Date().toISOString(),
      };

      await fs.writeFile(fullPath, JSON.stringify(report, null, 2), 'utf-8');

      return [
        {
          type: 'diff-report',
          path: reportPath,
          description: 'Detailed file-by-file similarity comparison',
        },
      ];
    } catch (error) {
      // Don't fail evaluation if artifact saving fails
      console.error('Failed to save diff report artifact:', error);
      return [];
    }
  }

  /**
   * Build human-readable message
   */
  private buildMessage(
    metrics: ReturnType<typeof this.calculateAggregateMetrics>,
    threshold: number,
    status: 'passed' | 'failed'
  ): string {
    const similarityPercent = (metrics.aggregate_similarity * 100).toFixed(1);
    const thresholdPercent = (threshold * 100).toFixed(0);

    const parts = [
      `Similarity: ${similarityPercent}% (threshold: ${thresholdPercent}%)`,
      `Files: ${String(metrics.files_matched)} matched, ${String(metrics.files_changed)} changed`,
    ];

    if ((metrics.files_added as number) > 0) {
      parts.push(`${String(metrics.files_added)} added`);
    }
    if ((metrics.files_removed as number) > 0) {
      parts.push(`${String(metrics.files_removed)} removed`);
    }

    if (status === 'passed') {
      return `✓ ${parts.join(' | ')}`;
    } else {
      return `✗ ${parts.join(' | ')}`;
    }
  }

  /**
   * Create a skipped evaluation result
   */
  private createSkippedResult(startedAt: string, message: string): EvaluationResult {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    return {
      evaluator: this.name,
      status: 'skipped',
      metrics: {},
      message,
      duration_ms: durationMs,
      timestamp: completedAt,
      error: {
        message: 'Expected reference not available',
      },
    };
  }
}
