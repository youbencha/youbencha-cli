/**
 * CLI Table Analysis Reporter
 *
 * Outputs analysis results as formatted CLI tables.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AnalysisReporter } from './base.js';
import {
  AnalysisResult,
  ReporterOptions,
  TestCaseAnalysis,
  AgentAnalysis,
  EvaluatorAnalysis,
  Insight,
} from '../schemas/analysis.schema.js';

/**
 * CLI Table Reporter implementation for analysis results
 */
export class AnalysisTableReporter implements AnalysisReporter {
  readonly name = 'table';
  readonly extension = '.txt';

  /**
   * Generate table output from analysis result
   *
   * @param analysis - Analysis result to format
   * @param options - Reporter options
   * @returns Formatted table string
   */
  async generate(analysis: AnalysisResult, options?: ReporterOptions): Promise<string> {
    const lines: string[] = [];
    const view = options?.view || 'summary';

    // Header
    lines.push(this.generateHeader(analysis));

    // View-specific content
    switch (view) {
      case 'summary':
        lines.push(this.generateSummarySection(analysis));
        lines.push(this.generateTestCaseSection(analysis.by_test_case));
        lines.push(this.generateAgentSection(analysis.by_agent));
        lines.push(this.generateEvaluatorSection(analysis.by_evaluator));
        lines.push(this.generateInsightsSection(analysis.insights));
        break;
      case 'trends':
        lines.push(this.generateTrendsSection(analysis));
        break;
      case 'failures':
        lines.push(this.generateFailuresSection(analysis));
        break;
      case 'assertions':
        lines.push(this.generateAssertionsSection(analysis));
        break;
      case 'comparison':
        lines.push(this.generateComparisonSection(analysis));
        break;
    }

    // Footer
    lines.push(this.generateFooter());

    return lines.join('\n');
  }

  /**
   * Generate header section
   */
  private generateHeader(analysis: AnalysisResult): string {
    const dateRange =
      analysis.metadata.date_range.earliest.split('T')[0] +
      ' → ' +
      analysis.metadata.date_range.latest.split('T')[0];
    const width = 78;

    const lines: string[] = [];
    lines.push('╔' + '═'.repeat(width) + '╗');
    lines.push('║' + this.center('youBencha Analysis Report', width) + '║');
    lines.push('║' + this.center(`Source: ${analysis.metadata.source_file}`, width) + '║');
    lines.push(
      '║' +
        this.center(
          `Period: ${dateRange} (${analysis.metadata.total_records} runs)`,
          width
        ) +
        '║'
    );
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate overall summary section
   */
  private generateSummarySection(analysis: AnalysisResult): string {
    const s = analysis.summary;
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  OVERALL SUMMARY' + ' '.repeat(width - 19) + '║');
    lines.push('║  ' + '─'.repeat(15) + ' '.repeat(width - 18) + '║');

    const passPercent = (s.pass_rate * 100).toFixed(0);
    const avgDuration = this.formatDuration(s.avg_duration_ms);
    const totalDuration = this.formatDuration(s.total_duration_ms);

    const line1 = `  Total Runs:      ${s.total_runs.toString().padEnd(10)} Pass Rate:     ${passPercent}% (${s.passed_runs}/${s.total_runs})`;
    const line2 = `  Avg Duration:    ${avgDuration.padEnd(10)} Total Time:    ${totalDuration}`;

    lines.push('║' + line1.padEnd(width) + '║');
    lines.push('║' + line2.padEnd(width) + '║');
    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate test case section
   */
  private generateTestCaseSection(testCases: TestCaseAnalysis[]): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  BY TEST CASE' + ' '.repeat(width - 16) + '║');
    lines.push('║  ' + '─'.repeat(13) + ' '.repeat(width - 16) + '║');

    // Table header
    const header = '  Test Case                  │ Runs │ Pass Rate │ Avg Time │ Trend';
    lines.push('║' + header.padEnd(width) + '║');
    lines.push('║  ' + '─'.repeat(70) + ' '.repeat(width - 73) + '║');

    for (const tc of testCases.slice(0, 10)) {
      const name = tc.name.slice(0, 26).padEnd(26);
      const runs = tc.run_count.toString().padStart(4);
      const passRate = this.formatPassRate(tc.overall_pass_rate);
      const avgTime = this.formatDuration(tc.avg_duration_ms).padStart(8);
      const trend = this.formatTrend(tc.recent_trend);

      const row = `  ${name} │${runs}  │ ${passRate} │${avgTime}  │ ${trend}`;
      lines.push('║' + row.padEnd(width) + '║');
    }

    if (testCases.length > 10) {
      lines.push('║' + `  ... and ${testCases.length - 10} more`.padEnd(width) + '║');
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate agent section
   */
  private generateAgentSection(agents: AgentAnalysis[]): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  BY AGENT' + ' '.repeat(width - 12) + '║');
    lines.push('║  ' + '─'.repeat(8) + ' '.repeat(width - 11) + '║');

    // Table header
    const header = '  Agent          │ Runs │ Success │ Avg Time │ Best Test Case';
    lines.push('║' + header.padEnd(width) + '║');
    lines.push('║  ' + '─'.repeat(70) + ' '.repeat(width - 73) + '║');

    for (const agent of agents) {
      const type = agent.type.slice(0, 14).padEnd(14);
      const runs = agent.run_count.toString().padStart(4);
      const successRate = `${(agent.success_rate * 100).toFixed(0)}%`.padStart(5);
      const avgTime = this.formatDuration(agent.avg_duration_ms).padStart(8);

      // Find best test case
      const bestTc = agent.test_cases.reduce(
        (best, tc) => (tc.pass_rate > best.pass_rate ? tc : best),
        { name: 'N/A', pass_rate: 0 }
      );
      const bestName = `${bestTc.name.slice(0, 20)} (${(bestTc.pass_rate * 100).toFixed(0)}%)`;

      const row = `  ${type} │${runs}  │ ${successRate}   │${avgTime}  │ ${bestName}`;
      lines.push('║' + row.slice(0, width).padEnd(width) + '║');
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate evaluator section
   */
  private generateEvaluatorSection(evaluators: EvaluatorAnalysis[]): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  BY EVALUATOR' + ' '.repeat(width - 16) + '║');
    lines.push('║  ' + '─'.repeat(12) + ' '.repeat(width - 15) + '║');

    // Table header
    const header = '  Evaluator                  │ Runs │ Pass │ Skip │ Fail │ Pass Rate';
    lines.push('║' + header.padEnd(width) + '║');
    lines.push('║  ' + '─'.repeat(70) + ' '.repeat(width - 73) + '║');

    for (const ev of evaluators.slice(0, 10)) {
      const name = ev.name.slice(0, 26).padEnd(26);
      const runs = ev.run_count.toString().padStart(4);
      const passed = ev.passed.toString().padStart(4);
      const skipped = ev.skipped.toString().padStart(4);
      const failed = ev.failed.toString().padStart(4);

      let passRateStr: string;
      if (ev.skip_rate > 0.9) {
        passRateStr = `${(ev.pass_rate * 100).toFixed(0)}% (skipped)`;
      } else {
        passRateStr = this.formatPassRate(ev.pass_rate);
      }

      const row = `  ${name} │${runs}  │${passed}  │${skipped}  │${failed}  │ ${passRateStr}`;
      lines.push('║' + row.slice(0, width).padEnd(width) + '║');
    }

    if (evaluators.length > 10) {
      lines.push('║' + `  ... and ${evaluators.length - 10} more`.padEnd(width) + '║');
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate insights section
   */
  private generateInsightsSection(insights: Insight[]): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  🔍 INSIGHTS' + ' '.repeat(width - 15) + '║');
    lines.push('║  ' + '─'.repeat(10) + ' '.repeat(width - 13) + '║');

    if (insights.length === 0) {
      lines.push('║  No notable insights.' + ' '.repeat(width - 24) + '║');
    } else {
      for (const insight of insights.slice(0, 5)) {
        const icon = this.getInsightIcon(insight);
        const title = `${icon}  ${insight.title}`;
        lines.push('║' + `  ${title}`.slice(0, width).padEnd(width) + '║');
      }
    }

    lines.push('║' + ' '.repeat(width) + '║');

    return lines.join('\n');
  }

  /**
   * Generate trends section
   */
  private generateTrendsSection(analysis: AnalysisResult): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  PASS RATE OVER TIME' + ' '.repeat(width - 23) + '║');
    lines.push('║  ' + '─'.repeat(18) + ' '.repeat(width - 21) + '║');

    const header = '  Date        │ Runs │ Pass Rate │ Avg Duration';
    lines.push('║' + header.padEnd(width) + '║');
    lines.push('║  ' + '─'.repeat(50) + ' '.repeat(width - 53) + '║');

    for (const daily of analysis.trends.aggregates.daily.slice(-10)) {
      const date = daily.date.padEnd(12);
      const runs = daily.run_count.toString().padStart(4);
      const passRate = `${(daily.pass_rate * 100).toFixed(0)}%`.padStart(5);
      const duration = this.formatDuration(daily.avg_duration_ms);

      const row = `  ${date} │${runs}  │    ${passRate} │ ${duration}`;
      lines.push('║' + row.padEnd(width) + '║');
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate failures section
   */
  private generateFailuresSection(analysis: AnalysisResult): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  FAILURE ANALYSIS' + ' '.repeat(width - 20) + '║');
    lines.push('║  ' + '─'.repeat(16) + ' '.repeat(width - 19) + '║');

    // Find test cases with low pass rates
    const failingTestCases = analysis.by_test_case
      .filter((tc) => tc.overall_pass_rate < 0.5)
      .slice(0, 5);

    if (failingTestCases.length === 0) {
      lines.push('║  No significant failures detected.' + ' '.repeat(width - 37) + '║');
    } else {
      for (const tc of failingTestCases) {
        lines.push(
          '║' +
            `  ❌ ${tc.name}: ${(tc.overall_pass_rate * 100).toFixed(0)}% pass rate (${tc.run_count} runs)`
              .slice(0, width)
              .padEnd(width) +
            '║'
        );
      }
    }

    // Show common failure patterns
    const allPatterns = analysis.by_evaluator.flatMap((e) => e.failure_patterns);
    if (allPatterns.length > 0) {
      lines.push('║' + ' '.repeat(width) + '║');
      lines.push('║  Common Failure Patterns:' + ' '.repeat(width - 28) + '║');
      for (const pattern of allPatterns.slice(0, 3)) {
        lines.push(
          '║' +
            `    - ${pattern.pattern} (${pattern.count}x)`
              .slice(0, width)
              .padEnd(width) +
            '║'
        );
      }
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate assertions section
   */
  private generateAssertionsSection(analysis: AnalysisResult): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  ASSERTION BREAKDOWN' + ' '.repeat(width - 23) + '║');
    lines.push('║  ' + '─'.repeat(18) + ' '.repeat(width - 21) + '║');

    for (const ev of analysis.by_evaluator) {
      if (ev.assertions && ev.assertions.length > 0) {
        lines.push('║' + ' '.repeat(width) + '║');
        lines.push('║' + `  ${ev.name}`.padEnd(width) + '║');

        const header = '    Assertion              │ Evals │ Pass Rate │ Avg Score';
        lines.push('║' + header.padEnd(width) + '║');
        lines.push('║    ' + '─'.repeat(60) + ' '.repeat(width - 65) + '║');

        for (const assertion of ev.assertions) {
          const name = assertion.assertion_name.slice(0, 22).padEnd(22);
          const evals = assertion.total_evaluations.toString().padStart(5);
          const passRate = `${(assertion.pass_rate * 100).toFixed(0)}%`.padStart(5);
          const avgScore = assertion.avg_score.toFixed(2).padStart(5);

          const row = `    ${name} │${evals}  │    ${passRate} │     ${avgScore}`;
          lines.push('║' + row.padEnd(width) + '║');
        }
      }
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate comparison section
   */
  private generateComparisonSection(analysis: AnalysisResult): string {
    const lines: string[] = [];
    const width = 78;

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('║  AGENT COMPARISON' + ' '.repeat(width - 20) + '║');
    lines.push('║  ' + '─'.repeat(16) + ' '.repeat(width - 19) + '║');

    // Compare agents across test cases
    for (const agent of analysis.by_agent) {
      lines.push('║' + ' '.repeat(width) + '║');
      lines.push(
        '║' +
          `  ${agent.type} (${agent.run_count} runs, ${(agent.success_rate * 100).toFixed(0)}% success)`
            .padEnd(width) +
          '║'
      );

      for (const tc of agent.test_cases.slice(0, 5)) {
        const passBar = this.generateProgressBar(tc.pass_rate, 20);
        const row = `    ${tc.name.slice(0, 25).padEnd(25)} ${passBar} ${(tc.pass_rate * 100).toFixed(0)}%`;
        lines.push('║' + row.padEnd(width) + '║');
      }
    }

    lines.push('║' + ' '.repeat(width) + '║');
    lines.push('╠' + '═'.repeat(width) + '╣');

    return lines.join('\n');
  }

  /**
   * Generate footer
   */
  private generateFooter(): string {
    const width = 78;
    return '╚' + '═'.repeat(width) + '╝';
  }

  /**
   * Center text within width
   */
  private center(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }

  /**
   * Format duration in human-readable form
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Format pass rate with emoji
   */
  private formatPassRate(rate: number): string {
    const percent = (rate * 100).toFixed(0);
    if (rate >= 0.9) return `${percent}% ✅`.padStart(9);
    if (rate >= 0.5) return `${percent}% ⚠️`.padStart(9);
    return `${percent}% ❌`.padStart(9);
  }

  /**
   * Format trend
   */
  private formatTrend(trend: string): string {
    switch (trend) {
      case 'improving':
        return '↗ Improving';
      case 'stable':
        return '→ Stable';
      case 'degrading':
        return '↘ Degrading';
      default:
        return '? Unknown';
    }
  }

  /**
   * Get insight icon
   */
  private getInsightIcon(insight: Insight): string {
    if (insight.severity === 'critical') return '❌';
    if (insight.severity === 'warning') return '⚠️';
    if (insight.type === 'improvement') return '✅';
    return 'ℹ️';
  }

  /**
   * Generate a simple progress bar
   */
  private generateProgressBar(value: number, width: number): string {
    const filled = Math.round(value * width);
    const empty = width - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  /**
   * Write table report to file
   *
   * @param analysis - Analysis result to write
   * @param outputPath - Path where report should be written
   * @param options - Reporter options
   */
  async writeToFile(
    analysis: AnalysisResult,
    outputPath: string,
    options?: ReporterOptions
  ): Promise<void> {
    const content = await this.generate(analysis, options);

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(outputPath, content, 'utf-8');
  }
}
