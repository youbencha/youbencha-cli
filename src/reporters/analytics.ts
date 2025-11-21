/**
 * Analytics Reporter
 * 
 * Generates enhanced reports with insights and recommendations from analysis results.
 * Creates structured reports focused on strategic insights rather than just data.
 * 
 * Note: This is a specialized reporter that works with SingleRunAnalysis,
 * not the standard ResultsBundle format.
 */

import { SingleRunAnalysis } from '../schemas/analytics.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Analytics Reporter
 * 
 * Generates formatted Markdown reports with insights and recommendations.
 */
export class AnalyticsReporter {
  readonly name = 'analytics';
  readonly extension = '.md';

  /**
   * Generate analytics report from single run analysis
   * 
   * @param analysis - Single run analysis results
   * @returns Promise resolving to formatted Markdown string
   */
  async generate(analysis: SingleRunAnalysis): Promise<string> {
    const sections: string[] = [];

    // Title
    sections.push('# youBencha Analytics Report');
    sections.push('');
    sections.push(`**Analysis Date:** ${new Date(analysis.analyzed_at).toLocaleString()}`);
    sections.push(`**Source:** \`${analysis.source_results}\``);
    sections.push('');

    // Executive Summary
    sections.push(this.generateExecutiveSummary(analysis));
    sections.push('');

    // Key Insights
    sections.push(this.generateInsights(analysis));
    sections.push('');

    // Recommendations
    sections.push(this.generateRecommendations(analysis));
    sections.push('');

    // Performance Metrics
    sections.push(this.generateMetrics(analysis));
    sections.push('');

    // Cost Analysis (if available)
    if (analysis.cost_analysis) {
      sections.push(this.generateCostAnalysis(analysis));
      sections.push('');
    }

    // Detailed Results Summary
    sections.push(this.generateDetailedSummary(analysis));
    sections.push('');

    return sections.join('\n');
  }

  /**
   * Generate executive summary section
   */
  private generateExecutiveSummary(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    const { results, metrics } = analysis;
    
    lines.push('## Executive Summary');
    lines.push('');
    
    // Overall status with emoji
    const statusEmoji = results.summary.overall_status === 'passed' ? '✅' : 
                       results.summary.overall_status === 'failed' ? '❌' : '⚠️';
    lines.push(`### ${statusEmoji} ${results.summary.overall_status.toUpperCase()}`);
    lines.push('');
    
    // Quick stats
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Overall Status | ${statusEmoji} ${results.summary.overall_status} |`);
    lines.push(`| Evaluators Passed | ${results.summary.passed}/${results.summary.total_evaluators} |`);
    lines.push(`| Success Rate | ${(metrics.evaluator_pass_rate * 100).toFixed(1)}% |`);
    lines.push(`| Total Duration | ${(metrics.total_duration_ms / 1000).toFixed(1)}s |`);
    lines.push(`| Agent | ${results.agent.type} (${results.agent.status}) |`);
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Generate insights section
   */
  private generateInsights(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    
    lines.push('## Key Insights');
    lines.push('');
    
    if (analysis.insights.length === 0) {
      lines.push('*No specific insights generated for this run.*');
      return lines.join('\n');
    }
    
    // Group insights by type
    const successInsights = analysis.insights.filter(i => i.type === 'success');
    const warningInsights = analysis.insights.filter(i => i.type === 'warning');
    const errorInsights = analysis.insights.filter(i => i.type === 'error');
    const infoInsights = analysis.insights.filter(i => i.type === 'info');
    
    if (successInsights.length > 0) {
      lines.push('### ✅ Successes');
      lines.push('');
      for (const insight of successInsights) {
        lines.push(`- **${insight.category}:** ${insight.message}`);
      }
      lines.push('');
    }
    
    if (errorInsights.length > 0) {
      lines.push('### ❌ Issues');
      lines.push('');
      for (const insight of errorInsights) {
        lines.push(`- **${insight.category}:** ${insight.message}`);
        if (insight.metric_value !== undefined && insight.reference_value !== undefined) {
          lines.push(`  - Actual: ${insight.metric_value}, Expected: ${insight.reference_value}`);
        }
      }
      lines.push('');
    }
    
    if (warningInsights.length > 0) {
      lines.push('### ⚠️ Warnings');
      lines.push('');
      for (const insight of warningInsights) {
        lines.push(`- **${insight.category}:** ${insight.message}`);
      }
      lines.push('');
    }
    
    if (infoInsights.length > 0) {
      lines.push('### ℹ️ Observations');
      lines.push('');
      for (const insight of infoInsights) {
        lines.push(`- **${insight.category}:** ${insight.message}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Generate recommendations section
   */
  private generateRecommendations(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    
    lines.push('## Strategic Recommendations');
    lines.push('');
    
    if (analysis.recommendations.length === 0) {
      lines.push('*No specific recommendations for this run.*');
      return lines.join('\n');
    }
    
    // Group by priority
    const highPriority = analysis.recommendations.filter(r => r.priority === 'high');
    const mediumPriority = analysis.recommendations.filter(r => r.priority === 'medium');
    const lowPriority = analysis.recommendations.filter(r => r.priority === 'low');
    
    if (highPriority.length > 0) {
      lines.push('### 🔴 High Priority');
      lines.push('');
      for (const rec of highPriority) {
        lines.push(`#### ${rec.title}`);
        lines.push('');
        lines.push(`**Category:** ${rec.category}`);
        lines.push(`**Description:** ${rec.description}`);
        lines.push('');
        lines.push(`**Recommended Action:**`);
        lines.push(`${rec.action}`);
        if (rec.impact) {
          lines.push('');
          lines.push(`**Expected Impact:** ${rec.impact}`);
        }
        lines.push('');
      }
    }
    
    if (mediumPriority.length > 0) {
      lines.push('### 🟡 Medium Priority');
      lines.push('');
      for (const rec of mediumPriority) {
        lines.push(`#### ${rec.title}`);
        lines.push('');
        lines.push(`**Description:** ${rec.description}`);
        lines.push(`**Action:** ${rec.action}`);
        if (rec.impact) {
          lines.push(`**Impact:** ${rec.impact}`);
        }
        lines.push('');
      }
    }
    
    if (lowPriority.length > 0) {
      lines.push('### 🟢 Low Priority / Best Practices');
      lines.push('');
      for (const rec of lowPriority) {
        lines.push(`- **${rec.title}:** ${rec.description} — ${rec.action}`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Generate metrics section
   */
  private generateMetrics(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    const { metrics, results } = analysis;
    
    lines.push('## Performance Metrics');
    lines.push('');
    
    lines.push('### Overall Performance');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Agent Success Rate | ${(metrics.success_rate * 100).toFixed(0)}% |`);
    lines.push(`| Evaluator Pass Rate | ${(metrics.evaluator_pass_rate * 100).toFixed(1)}% |`);
    lines.push(`| Total Duration | ${(metrics.total_duration_ms / 1000).toFixed(1)}s |`);
    lines.push(`| Avg Evaluator Duration | ${(metrics.avg_evaluator_duration_ms / 1000).toFixed(1)}s |`);
    lines.push('');
    
    lines.push('### Evaluator Breakdown');
    lines.push('');
    lines.push('| Evaluator | Status | Duration | Key Metrics |');
    lines.push('|-----------|--------|----------|-------------|');
    
    for (const evaluator of results.evaluators) {
      const statusEmoji = evaluator.status === 'passed' ? '✅' : 
                         evaluator.status === 'failed' ? '❌' : '⏭️';
      const duration = (evaluator.duration_ms / 1000).toFixed(1);
      
      // Extract key metrics
      const keyMetrics: string[] = [];
      if (evaluator.metrics.aggregate_similarity !== undefined) {
        keyMetrics.push(`Similarity: ${(evaluator.metrics.aggregate_similarity as number * 100).toFixed(1)}%`);
      }
      if (evaluator.metrics.files_changed !== undefined) {
        keyMetrics.push(`Files: ${evaluator.metrics.files_changed}`);
      }
      if (evaluator.metrics.lines_added !== undefined) {
        keyMetrics.push(`+${evaluator.metrics.lines_added}`);
      }
      if (evaluator.metrics.lines_removed !== undefined) {
        keyMetrics.push(`-${evaluator.metrics.lines_removed}`);
      }
      
      const metricsStr = keyMetrics.length > 0 ? keyMetrics.join(', ') : '-';
      
      lines.push(`| ${evaluator.evaluator} | ${statusEmoji} ${evaluator.status} | ${duration}s | ${metricsStr} |`);
    }
    
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Generate cost analysis section
   */
  private generateCostAnalysis(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    const cost = analysis.cost_analysis!;
    
    lines.push('## Cost Analysis');
    lines.push('');
    
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    
    if (cost.model) {
      lines.push(`| Model | ${cost.model} |`);
    }
    if (cost.total_tokens !== undefined) {
      lines.push(`| Total Tokens | ${cost.total_tokens.toLocaleString()} |`);
    }
    if (cost.prompt_tokens !== undefined) {
      lines.push(`| Prompt Tokens | ${cost.prompt_tokens.toLocaleString()} |`);
    }
    if (cost.completion_tokens !== undefined) {
      lines.push(`| Completion Tokens | ${cost.completion_tokens.toLocaleString()} |`);
    }
    if (cost.estimated_cost_usd !== undefined) {
      lines.push(`| Estimated Cost | $${cost.estimated_cost_usd.toFixed(4)} |`);
    }
    if (cost.cost_per_1k_tokens !== undefined) {
      lines.push(`| Cost per 1K Tokens | $${cost.cost_per_1k_tokens.toFixed(4)} |`);
    }
    
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Generate detailed summary section
   */
  private generateDetailedSummary(analysis: SingleRunAnalysis): string {
    const lines: string[] = [];
    const { results } = analysis;
    
    lines.push('## Detailed Results');
    lines.push('');
    
    lines.push('### Test Case Information');
    lines.push('');
    lines.push(`**Name:** ${results.test_case.name}`);
    lines.push(`**Description:** ${results.test_case.description}`);
    lines.push(`**Repository:** ${results.test_case.repo}`);
    lines.push(`**Branch:** ${results.test_case.branch}`);
    lines.push(`**Commit:** ${results.test_case.commit}`);
    if (results.test_case.expected_branch) {
      lines.push(`**Expected Branch:** ${results.test_case.expected_branch}`);
    }
    lines.push('');
    
    lines.push('### Execution Environment');
    lines.push('');
    lines.push(`**OS:** ${results.execution.environment.os}`);
    lines.push(`**Node.js:** ${results.execution.environment.node_version}`);
    lines.push(`**youBencha Version:** ${results.execution.youbencha_version}`);
    lines.push(`**Started:** ${results.execution.started_at}`);
    lines.push(`**Completed:** ${results.execution.completed_at}`);
    lines.push('');
    
    lines.push('---');
    lines.push('');
    lines.push(`*For complete results, see: \`${analysis.source_results}\`*`);
    
    return lines.join('\n');
  }

  /**
   * Write analytics report to file
   * 
   * @param analysis - Single run analysis results
   * @param outputPath - Path where report should be written
   */
  async writeToFile(
    analysis: SingleRunAnalysis,
    outputPath: string
  ): Promise<void> {
    // Generate Markdown content
    const content = await this.generate(analysis);

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    // Write to file
    await fs.writeFile(outputPath, content, 'utf-8');
  }
}
