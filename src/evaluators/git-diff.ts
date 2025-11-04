/**
 * Git Diff Evaluator
 * 
 * Evaluates agent changes by analyzing git diff statistics.
 * Measures files changed, lines added/removed, and change entropy.
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
 * GitDiffEvaluator analyzes code changes using git diff
 */
export class GitDiffEvaluator implements Evaluator {
  readonly name = 'git-diff';
  readonly description = 'Analyzes code changes using git diff statistics (files changed, lines added/removed, change entropy)';
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
      
      // Get base commit (default to HEAD)
      const baseCommit = (context.config.base_commit as string) || 'HEAD';
      
      // Get diff summary
      const diffSummary = await git.diffSummary([baseCommit]);
      
      // Get detailed diff
      const diff = await git.diff([baseCommit]);
      
      // Calculate file-level metrics
      const fileMetrics = this.calculateFileMetrics(diffSummary);
      
      // Calculate change entropy
      const entropy = this.calculateEntropy(fileMetrics);
      
      // Save diff as artifact
      const artifacts = await this.saveDiffArtifact(context.artifactsDir, diff);
      
      // Get current commit hash
      const log = await git.log({ maxCount: 1 });
      const currentCommit = log.latest?.hash || 'unknown';
      
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      return {
        evaluator: this.name,
        status: 'passed',
        metrics: {
          files_changed: diffSummary.files.length,
          lines_added: diffSummary.insertions,
          lines_removed: diffSummary.deletions,
          change_entropy: entropy,
          changed_files: fileMetrics,
          base_commit: baseCommit,
          current_commit: currentCommit,
        },
        message: `Analyzed ${diffSummary.files.length} changed files (+${diffSummary.insertions}/-${diffSummary.deletions} lines)`,
        duration_ms: durationMs,
        timestamp: completedAt,
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
