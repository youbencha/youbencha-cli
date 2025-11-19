/**
 * Git Diff Evaluator
 * 
 * Evaluates agent changes by analyzing git diff statistics.
 * Measures files changed, lines added/removed, and change entropy.
 * Supports threshold-based assertions for all metrics.
 */

import { simpleGit, DiffResult, SimpleGit, DiffResultTextFile } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Evaluator, EvaluationContext } from './base.js';
import { EvaluationResult, EvaluationArtifact } from '../schemas/result.schema.js';

/**
 * File-level diff metrics
 */
interface FileDiffMetrics {
  path: string;
  additions: number;
  deletions: number;
  changes: number;
}

/**
 * Assertions configuration for GitDiffEvaluator
 */
interface GitDiffAssertions {
  max_files_changed?: number;
  max_lines_added?: number;
  max_lines_removed?: number;
  max_total_changes?: number;
  min_change_entropy?: number;
  max_change_entropy?: number;
}

/**
 * Configuration for GitDiffEvaluator
 */
interface GitDiffConfig {
  assertions?: GitDiffAssertions;
  base_commit?: string;
}

/**
 * GitDiffEvaluator analyzes code changes using git diff
 */
export class GitDiffEvaluator implements Evaluator {
  readonly name = 'git-diff';
  readonly description = 'Measures the scope of changes: how many files were modified, lines added/removed, and how changes are distributed. Supports assertions via max_files_changed, max_lines_added, max_lines_removed, max_total_changes, and min/max_change_entropy thresholds.';
  readonly requiresExpectedReference = false;

  /**
   * Check if git is available and directory is a git repository
   */
  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    try {
      // Check if directory exists
      await fs.access(context.modifiedDir);
      
      // Check if it's a git repository by checking for .git directory
      const gitDir = path.join(context.modifiedDir, '.git');
      await fs.access(gitDir);
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Evaluate git changes in the modified directory
   */
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const startedAt = new Date().toISOString();
    
    try {
      // Check preconditions
      const canRun = await this.checkPreconditions(context);
      if (!canRun) {
        return this.createSkippedResult(
          startedAt,
          'Git repository not found or not accessible'
        );
      }

      const git: SimpleGit = simpleGit(context.modifiedDir);
      
      // Extract config
      const config = context.config as GitDiffConfig;
      
      // Get base commit (default to HEAD)
      const baseCommit = config.base_commit || 'HEAD';
      
      // Get diff summary
      const diffSummary = await git.diffSummary([baseCommit]);
      
      // Get detailed diff
      const diff = await git.diff([baseCommit]);
      
      // Calculate file-level metrics
      const fileMetrics = this.calculateFileMetrics(diffSummary);
      
      // Calculate change entropy
      const entropy = this.calculateEntropy(fileMetrics);
      
      // Evaluate against assertions
      const { status, violations } = this.evaluateAssertions(
        diffSummary.files.length,
        diffSummary.insertions,
        diffSummary.deletions,
        entropy,
        config.assertions || {}
      );
      
      // Save diff as artifact
      const artifacts = await this.saveDiffArtifact(context.artifactsDir, diff);
      
      // Get current commit hash
      const log = await git.log({ maxCount: 1 });
      const currentCommit = log.latest?.hash || 'unknown';
      
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Build message with violations if any
      const message = this.buildMessage(
        diffSummary.files.length,
        diffSummary.insertions,
        diffSummary.deletions,
        status,
        violations
      );

      return {
        evaluator: this.name,
        status,
        metrics: {
          files_changed: diffSummary.files.length,
          lines_added: diffSummary.insertions,
          lines_removed: diffSummary.deletions,
          total_changes: diffSummary.insertions + diffSummary.deletions,
          change_entropy: entropy,
          changed_files: fileMetrics,
          base_commit: baseCommit,
          current_commit: currentCommit,
          violations: violations.length > 0 ? violations : undefined,
        },
        message,
        duration_ms: durationMs,
        timestamp: completedAt,
        // Include assertions at top level for transparency
        assertions: config.assertions ? {
          max_files_changed: config.assertions.max_files_changed,
          max_lines_added: config.assertions.max_lines_added,
          max_lines_removed: config.assertions.max_lines_removed,
          max_total_changes: config.assertions.max_total_changes,
          min_change_entropy: config.assertions.min_change_entropy,
          max_change_entropy: config.assertions.max_change_entropy,
        } : undefined,
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
   * Calculate file-level metrics from diff summary
   */
  private calculateFileMetrics(diffSummary: DiffResult): FileDiffMetrics[] {
    return diffSummary.files.map(file => {
      // Handle text files which have insertions/deletions/changes
      const textFile = file as DiffResultTextFile;
      return {
        path: file.file,
        additions: textFile.insertions || 0,
        deletions: textFile.deletions || 0,
        changes: textFile.changes || 0,
      };
    });
  }

  /**
   * Calculate change entropy (distribution of changes across files)
   * 
   * Entropy measures how dispersed changes are:
   * - High entropy: Changes spread across many files
   * - Low entropy: Changes concentrated in few files
   * 
   * Uses Shannon entropy formula: H = -Σ(p_i * log2(p_i))
   * where p_i is the proportion of changes in file i
   */
  private calculateEntropy(fileMetrics: FileDiffMetrics[]): number {
    if (fileMetrics.length === 0) {
      return 0;
    }

    // Calculate total changes
    const totalChanges = fileMetrics.reduce((sum, file) => sum + file.changes, 0);
    
    if (totalChanges === 0) {
      return 0;
    }

    // Calculate Shannon entropy
    let entropy = 0;
    for (const file of fileMetrics) {
      if (file.changes > 0) {
        const proportion = file.changes / totalChanges;
        entropy -= proportion * Math.log2(proportion);
      }
    }

    return entropy;
  }

  /**
   * Evaluate metrics against configured assertions
   */
  private evaluateAssertions(
    filesChanged: number,
    linesAdded: number,
    linesRemoved: number,
    changeEntropy: number,
    assertions: GitDiffAssertions
  ): { status: 'passed' | 'failed'; violations: string[] } {
    const violations: string[] = [];

    // Check max files changed
    if (assertions.max_files_changed !== undefined && filesChanged > assertions.max_files_changed) {
      violations.push(
        `files_changed (${filesChanged}) exceeds max_files_changed (${assertions.max_files_changed})`
      );
    }

    // Check max lines added
    if (assertions.max_lines_added !== undefined && linesAdded > assertions.max_lines_added) {
      violations.push(
        `lines_added (${linesAdded}) exceeds max_lines_added (${assertions.max_lines_added})`
      );
    }

    // Check max lines removed
    if (assertions.max_lines_removed !== undefined && linesRemoved > assertions.max_lines_removed) {
      violations.push(
        `lines_removed (${linesRemoved}) exceeds max_lines_removed (${assertions.max_lines_removed})`
      );
    }

    // Check max total changes
    const totalChanges = linesAdded + linesRemoved;
    if (assertions.max_total_changes !== undefined && totalChanges > assertions.max_total_changes) {
      violations.push(
        `total_changes (${totalChanges}) exceeds max_total_changes (${assertions.max_total_changes})`
      );
    }

    // Check min change entropy
    if (assertions.min_change_entropy !== undefined && changeEntropy < assertions.min_change_entropy) {
      violations.push(
        `change_entropy (${changeEntropy.toFixed(2)}) below min_change_entropy (${assertions.min_change_entropy})`
      );
    }

    // Check max change entropy
    if (assertions.max_change_entropy !== undefined && changeEntropy > assertions.max_change_entropy) {
      violations.push(
        `change_entropy (${changeEntropy.toFixed(2)}) exceeds max_change_entropy (${assertions.max_change_entropy})`
      );
    }

    const status = violations.length === 0 ? 'passed' : 'failed';
    return { status, violations };
  }

  /**
   * Build human-readable message
   */
  private buildMessage(
    filesChanged: number,
    linesAdded: number,
    linesRemoved: number,
    status: 'passed' | 'failed',
    violations: string[]
  ): string {
    const summary = `${filesChanged} changed files (+${linesAdded}/-${linesRemoved} lines)`;

    if (status === 'passed') {
      return `✓ ${summary}`;
    } else {
      return `✗ ${summary} | Violations: ${violations.join('; ')}`;
    }
  }

  /**
   * Save diff patch as artifact
   */
  private async saveDiffArtifact(
    artifactsDir: string,
    diff: string
  ): Promise<EvaluationArtifact[]> {
    if (!diff || diff.trim().length === 0) {
      return [];
    }

    try {
      const artifactPath = 'git-diff.patch';
      const fullPath = path.join(artifactsDir, artifactPath);
      
      // Ensure artifacts directory exists
      await fs.mkdir(artifactsDir, { recursive: true });
      
      // Write diff to file
      await fs.writeFile(fullPath, diff, 'utf-8');
      
      return [
        {
          type: 'diff',
          path: artifactPath,
          description: 'Git diff patch showing all changes',
        },
      ];
    } catch (error) {
      // Don't fail evaluation if artifact saving fails
      console.error('Failed to save diff artifact:', error);
      return [];
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
      metrics: {
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
        change_entropy: 0,
      },
      message,
      duration_ms: durationMs,
      timestamp: completedAt,
    };
  }
}
