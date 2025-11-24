/**
 * Markdown Reporter
 * 
 * Generates human-readable Markdown reports from evaluation results.
 * Creates structured reports with summary, execution details, and evaluator results.
 */

import { Reporter } from './base.js';
import { ResultsBundle, EvaluationResult } from '../schemas/result.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * File similarity data structure used in expected-diff evaluator metrics
 */
interface FileSimilarity {
  similarity: number;
  status: string;
  path: string;
}

/**
 * Markdown Reporter implementation
 * 
 * Generates formatted Markdown reports with tables and sections.
 */
export class MarkdownReporter implements Reporter {
  readonly name = 'markdown';
  readonly extension = '.md';

  /**
   * Generate Markdown report from results bundle
   * 
   * @param bundle - Complete evaluation results
   * @param options - Reporter-specific options (unused for Markdown)
   * @returns Promise resolving to formatted Markdown string
   */
  async generate(
    bundle: ResultsBundle,
    _options?: Record<string, unknown>
  ): Promise<string> {
    const sections: string[] = [];

    // Title
    sections.push('# youBencha Evaluation Report');
    sections.push('');

    // Summary
    sections.push(this.generateSummary(bundle));
    sections.push('');

    // Test Case Configuration
    sections.push(this.generateTestCaseConfig(bundle));
    sections.push('');

    // Execution Details
    sections.push(this.generateExecutionDetails(bundle));
    sections.push('');

    // Agent Execution
    sections.push(this.generateAgentExecution(bundle));
    sections.push('');

    // Evaluator Results
    sections.push(this.generateEvaluatorResults(bundle));
    sections.push('');

    // Artifacts
    sections.push(this.generateArtifacts(bundle));
    sections.push('');

    return sections.join('\n');
  }

  /**
   * Generate summary section
   */
  private generateSummary(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Summary');
    lines.push('');
    
    // Overall status with emoji
    const statusEmoji = bundle.summary.overall_status === 'passed' ? '✅' : 
                       bundle.summary.overall_status === 'failed' ? '❌' : '⚠️';
    lines.push(`**Overall Status:** ${statusEmoji} ${bundle.summary.overall_status}`);
    lines.push('');
    
    // Statistics table
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Evaluators | ${bundle.summary.total_evaluators} |`);
    lines.push(`| Passed | ${bundle.summary.passed} |`);
    lines.push(`| Failed | ${bundle.summary.failed} |`);
    lines.push(`| Skipped | ${bundle.summary.skipped} |`);
    
    return lines.join('\n');
  }

  /**
   * Generate test case configuration section
   */
  private generateTestCaseConfig(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Test Case Configuration');
    lines.push('');
    lines.push(`**Name:** ${bundle.test_case.name}`);
    lines.push(`**Description:** ${bundle.test_case.description}`);
    lines.push('');
    lines.push(`**Repository:** ${bundle.test_case.repo}`);
    lines.push(`**Branch:** ${bundle.test_case.branch}`);
    lines.push(`**Commit:** ${bundle.test_case.commit}`);
    
    if (bundle.test_case.expected_branch) {
      lines.push(`**Expected Branch:** ${bundle.test_case.expected_branch}`);
    }
    
    lines.push(`**Config File:** ${bundle.test_case.config_file}`);
    lines.push(`**Config Hash:** ${bundle.test_case.config_hash}`);
    
    return lines.join('\n');
  }

  /**
   * Generate execution details section
   */
  private generateExecutionDetails(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Execution Details');
    lines.push('');
    
    const durationSec = (bundle.execution.duration_ms / 1000).toFixed(1);
    lines.push(`**Duration:** ${durationSec}s (${bundle.execution.duration_ms}ms)`);
    lines.push(`**Started:** ${bundle.execution.started_at}`);
    lines.push(`**Completed:** ${bundle.execution.completed_at}`);
    lines.push(`**youBencha Version:** ${bundle.execution.youbencha_version}`);
    lines.push('');
    
    lines.push('**Environment:**');
    lines.push(`- OS: ${bundle.execution.environment.os}`);
    lines.push(`- Node.js: ${bundle.execution.environment.node_version}`);
    lines.push(`- Workspace: ${bundle.execution.environment.workspace_dir}`);
    
    return lines.join('\n');
  }

  /**
   * Generate agent execution section
   */
  private generateAgentExecution(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Agent Execution');
    lines.push('');
    
    const statusEmoji = bundle.agent.status === 'success' ? '✅' : 
                       bundle.agent.status === 'failed' ? '❌' : '⏱️';
    
    lines.push(`**Type:** ${bundle.agent.type}`);
    lines.push(`**Status:** ${statusEmoji} ${bundle.agent.status}`);
    lines.push(`**Exit Code:** ${bundle.agent.exit_code}`);
    lines.push(`**Log Path:** ${bundle.agent.youbencha_log_path}`);
    
    return lines.join('\n');
  }

  /**
   * Generate evaluator results section
   */
  private generateEvaluatorResults(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Evaluator Results');
    lines.push('');
    
    if (bundle.evaluators.length === 0) {
      lines.push('No evaluators were run.');
      return lines.join('\n');
    }
    
    for (const evaluator of bundle.evaluators) {
      lines.push(this.generateEvaluatorSection(evaluator));
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Generate individual evaluator section
   */
  private generateEvaluatorSection(evaluator: EvaluationResult): string {
    const lines: string[] = [];
    
    lines.push(`### ${evaluator.evaluator}`);
    lines.push('');
    
    // Status with emoji
    const statusEmoji = evaluator.status === 'passed' ? '✅' : 
                       evaluator.status === 'failed' ? '❌' : '⏭️';
    lines.push(`${statusEmoji} **Status:** ${evaluator.status}`);
    lines.push('');
    
    // Message
    lines.push(`**Message:** ${evaluator.message}`);
    lines.push('');
    
    // Duration
    const durationSec = (evaluator.duration_ms / 1000).toFixed(1);
    lines.push(`**Duration:** ${durationSec}s (${evaluator.duration_ms}ms)`);
    lines.push(`**Timestamp:** ${evaluator.timestamp}`);
    lines.push('');
    
    // Metrics table
    if (Object.keys(evaluator.metrics).length > 0) {
      lines.push('**Metrics:**');
      lines.push('');
      
      // Special handling for expected-diff evaluator
      if (evaluator.evaluator === 'expected-diff') {
        lines.push(...this.generateExpectedDiffMetrics(evaluator.metrics));
      } else {
        lines.push('| Metric | Value |');
        lines.push('|--------|-------|');
        
        for (const [key, value] of Object.entries(evaluator.metrics)) {
          // Skip file_similarities array in generic display
          if (key === 'file_similarities') continue;
          
          const formattedValue = typeof value === 'number' && !Number.isInteger(value)
            ? value.toFixed(2)
            : String(value);
          lines.push(`| ${key} | ${formattedValue} |`);
        }
        
        lines.push('');
      }
    }
    
    // Artifacts
    if (evaluator.artifacts && evaluator.artifacts.length > 0) {
      lines.push('**Artifacts:**');
      lines.push('');
      for (const artifact of evaluator.artifacts) {
        lines.push(`- ${artifact.type}: \`${artifact.path}\``);
        lines.push(`  - ${artifact.description}`);
      }
      lines.push('');
    }
    
    // Error details
    if (evaluator.error) {
      lines.push('**Error:**');
      lines.push('');
      lines.push('```');
      lines.push(evaluator.error.message);
      if (evaluator.error.stack_trace) {
        lines.push('');
        lines.push(evaluator.error.stack_trace);
      }
      lines.push('```');
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Generate enhanced metrics display for expected-diff evaluator
   */
  private generateExpectedDiffMetrics(metrics: Record<string, unknown>): string[] {
    const lines: string[] = [];
    
    // Summary metrics table
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    
    if (typeof metrics.aggregate_similarity === 'number') {
      const similarityPercent = (metrics.aggregate_similarity * 100).toFixed(1);
      lines.push(`| Aggregate Similarity | ${similarityPercent}% |`);
    }
    
    if (typeof metrics.threshold === 'number') {
      const thresholdPercent = (metrics.threshold * 100).toFixed(0);
      lines.push(`| Threshold | ${thresholdPercent}% |`);
    }
    
    lines.push(`| Files Matched | ${String(metrics.files_matched ?? 0)} |`);
    lines.push(`| Files Changed | ${String(metrics.files_changed ?? 0)} |`);
    lines.push(`| Files Added | ${String(metrics.files_added ?? 0)} |`);
    lines.push(`| Files Removed | ${String(metrics.files_removed ?? 0)} |`);
    lines.push('');
    
    // File-level details table (if available)
    if (Array.isArray(metrics.file_similarities) && metrics.file_similarities.length > 0) {
      lines.push('**File-Level Details:**');
      lines.push('');
      lines.push('| File | Similarity | Status |');
      lines.push('|------|------------|--------|');
      
      // Sort by similarity (lowest first) to highlight differences
      const sortedFiles = [...(metrics.file_similarities as FileSimilarity[])]
        .sort((a, b) => a.similarity - b.similarity)
        .slice(0, 20); // Show top 20 most different files
      
      for (const file of sortedFiles) {
        const similarityPercent = (file.similarity * 100).toFixed(1);
        const statusEmoji = file.status === 'matched' ? '✅' : 
                           file.status === 'changed' ? '📝' : 
                           file.status === 'added' ? '➕' : '➖';
        lines.push(`| ${file.path} | ${similarityPercent}% | ${statusEmoji} ${file.status} |`);
      }
      
      if ((metrics.file_similarities as FileSimilarity[]).length > 20) {
        lines.push(`| ... | ... | ... |`);
        lines.push(`| *(${(metrics.file_similarities as FileSimilarity[]).length - 20} more files)* | | |`);
      }
    }
    
    return lines;
  }

  /**
   * Generate artifacts section
   */
  private generateArtifacts(bundle: ResultsBundle): string {
    const lines: string[] = [];
    
    lines.push('## Artifacts');
    lines.push('');
    
    lines.push('**youBencha Log:**');
    lines.push(`- \`${bundle.artifacts.agent_log}\``);
    lines.push('');
    
    if (bundle.artifacts.reports.length > 0) {
      lines.push('**Reports:**');
      for (const report of bundle.artifacts.reports) {
        lines.push(`- \`${report}\``);
      }
      lines.push('');
    }
    
    if (bundle.artifacts.evaluator_artifacts.length > 0) {
      lines.push('**Evaluator Artifacts:**');
      for (const artifact of bundle.artifacts.evaluator_artifacts) {
        lines.push(`- \`${artifact}\``);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Write Markdown report to file
   * 
   * @param bundle - Complete evaluation results
   * @param outputPath - Path where report should be written
   * @param options - Reporter-specific options (unused for Markdown)
   */
  async writeToFile(
    bundle: ResultsBundle,
    outputPath: string,
    _options?: Record<string, unknown>
  ): Promise<void> {
    // Generate Markdown content
    const content = await this.generate(bundle);

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    // Write to file
    await fs.writeFile(outputPath, content, 'utf-8');
  }
}
