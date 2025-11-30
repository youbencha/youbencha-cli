/**
 * Results Aggregator
 *
 * Aggregates JSONL history records into analysis structures.
 * Provides methods to analyze data by test case, agent, evaluator, and time.
 */

import {
  ExportedResultsBundle,
  AnalysisResult,
  OverallSummary,
  TestCaseAnalysis,
  AgentAnalysis,
  EvaluatorAnalysis,
  TrendAnalysis,
  Insight,
  AggregatorOptions,
  TrendDataPoint,
  DailyAggregate,
  WeeklyAggregate,
  AssertionSummary,
  EvaluatorMetricsSummary,
} from './schemas/analysis.schema.js';

/**
 * Default threshold values for insight generation
 */
const DEFAULT_THRESHOLDS = {
  regressionDelta: 0.2, // 20% drop flagged as regression
  lowPassRateThreshold: 0.5, // Below 50% flagged
  highSkipRateThreshold: 0.5, // Above 50% skips flagged
};

/**
 * Aggregator for computing analysis statistics from results bundles
 */
export class Aggregator {
  /**
   * Generate full analysis from records
   *
   * @param records - Array of results bundles
   * @param options - Aggregation options
   * @param sourceFile - Source file path for metadata
   * @param filtersApplied - Description of filters applied
   * @param youbenchaVersion - Version of youBencha
   * @returns Complete analysis result
   */
  analyze(
    records: ExportedResultsBundle[],
    sourceFile: string,
    filtersApplied: Record<string, string>,
    youbenchaVersion: string,
    options?: AggregatorOptions
  ): AnalysisResult {
    // Sort records by timestamp
    const sortedRecords = [...records].sort(
      (a, b) => new Date(a.exported_at).getTime() - new Date(b.exported_at).getTime()
    );

    const metadata = {
      source_file: sourceFile,
      total_records: records.length,
      date_range: this.getDateRange(sortedRecords),
      filters_applied: filtersApplied,
      generated_at: new Date().toISOString(),
      youbencha_version: youbenchaVersion,
    };

    const summary = this.computeOverallSummary(sortedRecords);
    const byTestCase = this.analyzeByTestCase(sortedRecords);
    const byAgent = this.analyzeByAgent(sortedRecords);
    const byEvaluator = this.analyzeByEvaluator(sortedRecords);
    const trends = this.analyzeTrends(sortedRecords, options?.trendGranularity);
    const insights = this.generateInsights(
      sortedRecords,
      byTestCase,
      byAgent,
      byEvaluator,
      options?.insightThresholds
    );

    return {
      metadata,
      summary,
      by_test_case: byTestCase,
      by_agent: byAgent,
      by_evaluator: byEvaluator,
      trends,
      insights,
    };
  }

  /**
   * Get date range from records
   */
  private getDateRange(
    sortedRecords: ExportedResultsBundle[]
  ): { earliest: string; latest: string } {
    if (sortedRecords.length === 0) {
      const now = new Date().toISOString();
      return { earliest: now, latest: now };
    }
    return {
      earliest: sortedRecords[0].exported_at,
      latest: sortedRecords[sortedRecords.length - 1].exported_at,
    };
  }

  /**
   * Compute overall summary statistics
   */
  private computeOverallSummary(records: ExportedResultsBundle[]): OverallSummary {
    const total = records.length;
    let passed = 0;
    let failed = 0;
    let partial = 0;
    let totalDuration = 0;

    let totalEvaluations = 0;
    let evalPassed = 0;
    let evalFailed = 0;
    let evalSkipped = 0;

    let agentSuccess = 0;
    let agentFailed = 0;
    let agentTimeout = 0;

    for (const record of records) {
      // Overall status
      if (record.summary.overall_status === 'passed') passed++;
      else if (record.summary.overall_status === 'failed') failed++;
      else partial++;

      // Duration
      totalDuration += record.execution.duration_ms;

      // Evaluator stats
      for (const evaluator of record.evaluators) {
        totalEvaluations++;
        if (evaluator.status === 'passed') evalPassed++;
        else if (evaluator.status === 'failed') evalFailed++;
        else evalSkipped++;
      }

      // Agent stats
      if (record.agent.status === 'success') agentSuccess++;
      else if (record.agent.status === 'failed') agentFailed++;
      else agentTimeout++;
    }

    const totalAgents = agentSuccess + agentFailed + agentTimeout;

    return {
      total_runs: total,
      passed_runs: passed,
      failed_runs: failed,
      partial_runs: partial,
      pass_rate: total > 0 ? passed / total : 0,
      avg_duration_ms: total > 0 ? totalDuration / total : 0,
      total_duration_ms: totalDuration,
      evaluator_stats: {
        total_evaluations: totalEvaluations,
        passed: evalPassed,
        failed: evalFailed,
        skipped: evalSkipped,
        pass_rate: totalEvaluations > 0 ? evalPassed / totalEvaluations : 0,
      },
      agent_stats: {
        successful_executions: agentSuccess,
        failed_executions: agentFailed,
        timeout_executions: agentTimeout,
        success_rate: totalAgents > 0 ? agentSuccess / totalAgents : 0,
      },
    };
  }

  /**
   * Analyze records by test case
   */
  analyzeByTestCase(records: ExportedResultsBundle[]): TestCaseAnalysis[] {
    // Group by test case name
    const byTestCase = new Map<string, ExportedResultsBundle[]>();
    for (const record of records) {
      const name = record.test_case.name;
      if (!byTestCase.has(name)) {
        byTestCase.set(name, []);
      }
      byTestCase.get(name)!.push(record);
    }

    const results: TestCaseAnalysis[] = [];
    for (const [name, testRecords] of byTestCase) {
      // Sort by timestamp
      const sorted = [...testRecords].sort(
        (a, b) => new Date(a.exported_at).getTime() - new Date(b.exported_at).getTime()
      );

      const passed = sorted.filter((r) => r.summary.overall_status === 'passed').length;
      const lastRecord = sorted[sorted.length - 1];

      // Compute duration stats
      const durations = sorted.map((r) => r.execution.duration_ms);
      const totalDuration = durations.reduce((a, b) => a + b, 0);

      // Aggregate evaluator stats
      let evalTotal = 0;
      let evalPassed = 0;
      for (const record of sorted) {
        for (const evaluator of record.evaluators) {
          evalTotal++;
          if (evaluator.status === 'passed') evalPassed++;
        }
      }

      // Agent breakdown
      const agentStats = new Map<
        string,
        { runs: number; passed: number; duration: number }
      >();
      for (const record of sorted) {
        const type = record.agent.type;
        if (!agentStats.has(type)) {
          agentStats.set(type, { runs: 0, passed: 0, duration: 0 });
        }
        const stat = agentStats.get(type)!;
        stat.runs++;
        if (record.summary.overall_status === 'passed') stat.passed++;
        stat.duration += record.execution.duration_ms;
      }

      // Evaluator breakdown
      const evaluatorStats = new Map<
        string,
        { runs: number; passed: number; duration: number }
      >();
      for (const record of sorted) {
        for (const evaluator of record.evaluators) {
          if (!evaluatorStats.has(evaluator.evaluator)) {
            evaluatorStats.set(evaluator.evaluator, { runs: 0, passed: 0, duration: 0 });
          }
          const stat = evaluatorStats.get(evaluator.evaluator)!;
          stat.runs++;
          if (evaluator.status === 'passed') stat.passed++;
          stat.duration += evaluator.duration_ms;
        }
      }

      // Compute trend from last 5 runs
      const recentTrend = this.computeRecentTrend(sorted);

      results.push({
        name,
        description: lastRecord.test_case.description,
        repo: lastRecord.test_case.repo,
        run_count: sorted.length,
        overall_pass_rate: sorted.length > 0 ? passed / sorted.length : 0,
        evaluator_pass_rate: evalTotal > 0 ? evalPassed / evalTotal : 0,
        avg_duration_ms: sorted.length > 0 ? totalDuration / sorted.length : 0,
        min_duration_ms: Math.min(...durations),
        max_duration_ms: Math.max(...durations),
        agents_used: Array.from(agentStats.entries()).map(([type, stat]) => ({
          type,
          run_count: stat.runs,
          pass_rate: stat.runs > 0 ? stat.passed / stat.runs : 0,
          avg_duration_ms: stat.runs > 0 ? stat.duration / stat.runs : 0,
        })),
        evaluators: Array.from(evaluatorStats.entries()).map(([evalName, stat]) => ({
          name: evalName,
          run_count: stat.runs,
          pass_rate: stat.runs > 0 ? stat.passed / stat.runs : 0,
          avg_duration_ms: stat.runs > 0 ? stat.duration / stat.runs : 0,
        })),
        recent_trend: recentTrend,
        last_run: {
          timestamp: lastRecord.exported_at,
          status: lastRecord.summary.overall_status,
          duration_ms: lastRecord.execution.duration_ms,
        },
      });
    }

    // Sort by run count descending
    results.sort((a, b) => b.run_count - a.run_count);
    return results;
  }

  /**
   * Compute recent trend from last 5 runs
   */
  private computeRecentTrend(
    sorted: ExportedResultsBundle[]
  ): 'improving' | 'stable' | 'degrading' | 'insufficient_data' {
    if (sorted.length < 3) {
      return 'insufficient_data';
    }

    const recent = sorted.slice(-5);
    const passRates: number[] = [];

    for (let i = 0; i < recent.length; i++) {
      const passed = recent[i].summary.overall_status === 'passed' ? 1 : 0;
      passRates.push(passed);
    }

    // Calculate simple trend: compare first half to second half
    const midpoint = Math.floor(passRates.length / 2);
    const firstHalf = passRates.slice(0, midpoint);
    const secondHalf = passRates.slice(midpoint);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const delta = secondAvg - firstAvg;
    if (delta > 0.2) return 'improving';
    if (delta < -0.2) return 'degrading';
    return 'stable';
  }

  /**
   * Analyze records by agent
   */
  analyzeByAgent(records: ExportedResultsBundle[]): AgentAnalysis[] {
    // Group by agent type
    const byAgent = new Map<string, ExportedResultsBundle[]>();
    for (const record of records) {
      const type = record.agent.type;
      if (!byAgent.has(type)) {
        byAgent.set(type, []);
      }
      byAgent.get(type)!.push(record);
    }

    const results: AgentAnalysis[] = [];
    for (const [type, agentRecords] of byAgent) {
      const durations = agentRecords.map((r) => r.execution.duration_ms);
      const totalDuration = durations.reduce((a, b) => a + b, 0);

      let successCount = 0;
      let timeoutCount = 0;
      let totalExitCode = 0;

      for (const record of agentRecords) {
        if (record.agent.status === 'success') successCount++;
        if (record.agent.status === 'timeout') timeoutCount++;
        totalExitCode += record.agent.exit_code;
      }

      // Test case breakdown
      const testCaseStats = new Map<string, { runs: number; passed: number }>();
      for (const record of agentRecords) {
        const name = record.test_case.name;
        if (!testCaseStats.has(name)) {
          testCaseStats.set(name, { runs: 0, passed: 0 });
        }
        const stat = testCaseStats.get(name)!;
        stat.runs++;
        if (record.summary.overall_status === 'passed') stat.passed++;
      }

      // Evaluator performance breakdown
      const evaluatorStats = new Map<string, { runs: number; passed: number }>();
      for (const record of agentRecords) {
        for (const evaluator of record.evaluators) {
          if (!evaluatorStats.has(evaluator.evaluator)) {
            evaluatorStats.set(evaluator.evaluator, { runs: 0, passed: 0 });
          }
          const stat = evaluatorStats.get(evaluator.evaluator)!;
          stat.runs++;
          if (evaluator.status === 'passed') stat.passed++;
        }
      }

      results.push({
        type,
        run_count: agentRecords.length,
        success_rate: agentRecords.length > 0 ? successCount / agentRecords.length : 0,
        timeout_count: timeoutCount,
        avg_exit_code: agentRecords.length > 0 ? totalExitCode / agentRecords.length : 0,
        avg_duration_ms: agentRecords.length > 0 ? totalDuration / agentRecords.length : 0,
        min_duration_ms: Math.min(...durations),
        max_duration_ms: Math.max(...durations),
        test_cases: Array.from(testCaseStats.entries()).map(([name, stat]) => ({
          name,
          run_count: stat.runs,
          pass_rate: stat.runs > 0 ? stat.passed / stat.runs : 0,
        })),
        evaluator_performance: Array.from(evaluatorStats.entries()).map(
          ([evalName, stat]) => ({
            evaluator: evalName,
            run_count: stat.runs,
            pass_rate: stat.runs > 0 ? stat.passed / stat.runs : 0,
          })
        ),
      });
    }

    // Sort by run count descending
    results.sort((a, b) => b.run_count - a.run_count);
    return results;
  }

  /**
   * Analyze records by evaluator
   */
  analyzeByEvaluator(records: ExportedResultsBundle[]): EvaluatorAnalysis[] {
    // Collect all evaluator results
    interface EvaluatorData {
      runs: number;
      passed: number;
      failed: number;
      skipped: number;
      durations: number[];
      messages: string[];
      metricsCollections: Record<string, unknown>[];
      assertionData: Map<string, { scores: number[] }>;
    }

    const byEvaluator = new Map<string, EvaluatorData>();

    for (const record of records) {
      for (const evaluator of record.evaluators) {
        const name = evaluator.evaluator;
        if (!byEvaluator.has(name)) {
          byEvaluator.set(name, {
            runs: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            durations: [],
            messages: [],
            metricsCollections: [],
            assertionData: new Map(),
          });
        }

        const data = byEvaluator.get(name)!;
        data.runs++;
        if (evaluator.status === 'passed') data.passed++;
        else if (evaluator.status === 'failed') data.failed++;
        else data.skipped++;

        data.durations.push(evaluator.duration_ms);

        // Collect failure messages
        if (evaluator.status === 'failed') {
          data.messages.push(evaluator.message);
        }

        // Collect metrics
        if (evaluator.metrics) {
          data.metricsCollections.push(evaluator.metrics);
        }

        // Collect assertion data
        if (evaluator.assertions) {
          for (const [assertionName, value] of Object.entries(evaluator.assertions)) {
            if (typeof value === 'number') {
              if (!data.assertionData.has(assertionName)) {
                data.assertionData.set(assertionName, { scores: [] });
              }
              data.assertionData.get(assertionName)!.scores.push(value);
            }
          }
        }
      }
    }

    const results: EvaluatorAnalysis[] = [];
    for (const [name, data] of byEvaluator) {
      const totalDuration = data.durations.reduce((a, b) => a + b, 0);

      // Compute failure patterns
      const failurePatterns = this.computeFailurePatterns(data.messages);

      // Compute metrics summary
      const metricsSummary = this.computeMetricsSummary(name, data.metricsCollections);

      // Compute assertion summaries
      const assertions: AssertionSummary[] = [];
      for (const [assertionName, assertionInfo] of data.assertionData) {
        const scores = assertionInfo.scores;
        const passed = scores.filter((s) => s === 1).length;
        const failed = scores.filter((s) => s === 0).length;
        const partial = scores.filter((s) => s > 0 && s < 1).length;
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

        assertions.push({
          assertion_name: assertionName,
          total_evaluations: scores.length,
          passed,
          partial,
          failed,
          pass_rate: scores.length > 0 ? passed / scores.length : 0,
          avg_score: avgScore,
        });
      }

      results.push({
        name,
        run_count: data.runs,
        passed: data.passed,
        failed: data.failed,
        skipped: data.skipped,
        pass_rate: data.runs > 0 ? data.passed / data.runs : 0,
        skip_rate: data.runs > 0 ? data.skipped / data.runs : 0,
        avg_duration_ms: data.runs > 0 ? totalDuration / data.runs : 0,
        min_duration_ms: data.durations.length > 0 ? Math.min(...data.durations) : 0,
        max_duration_ms: data.durations.length > 0 ? Math.max(...data.durations) : 0,
        metrics_summary: metricsSummary,
        assertions: assertions.length > 0 ? assertions : undefined,
        failure_patterns: failurePatterns,
      });
    }

    // Sort by run count descending
    results.sort((a, b) => b.run_count - a.run_count);
    return results;
  }

  /**
   * Compute failure patterns from messages
   */
  private computeFailurePatterns(
    messages: string[]
  ): Array<{ pattern: string; count: number; example_message: string }> {
    // Simple pattern extraction: group similar messages
    const patterns = new Map<string, { count: number; example: string }>();

    for (const message of messages) {
      // Simplify message to pattern (remove numbers, hashes, etc.)
      const pattern = message
        .replace(/\d+/g, 'N')
        .replace(/[a-f0-9]{7,}/gi, 'HASH')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

      if (!patterns.has(pattern)) {
        patterns.set(pattern, { count: 0, example: message });
      }
      patterns.get(pattern)!.count++;
    }

    return Array.from(patterns.entries())
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        example_message: data.example,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 patterns
  }

  /**
   * Compute metrics summary for specific evaluator type
   */
  private computeMetricsSummary(
    evaluatorName: string,
    metricsCollections: Record<string, unknown>[]
  ): EvaluatorMetricsSummary {
    const summary: EvaluatorMetricsSummary = {};

    if (metricsCollections.length === 0) {
      return summary;
    }

    // git-diff specific
    if (evaluatorName === 'git-diff') {
      const filesChanged: number[] = [];
      const linesAdded: number[] = [];
      const linesRemoved: number[] = [];

      for (const metrics of metricsCollections) {
        if (typeof metrics.files_changed === 'number') filesChanged.push(metrics.files_changed);
        if (typeof metrics.lines_added === 'number') linesAdded.push(metrics.lines_added);
        if (typeof metrics.lines_removed === 'number') linesRemoved.push(metrics.lines_removed);
      }

      if (filesChanged.length > 0) {
        summary.git_diff = {
          avg_files_changed: this.average(filesChanged),
          avg_lines_added: this.average(linesAdded),
          avg_lines_removed: this.average(linesRemoved),
          max_files_changed: Math.max(...filesChanged),
          max_lines_changed: Math.max(...linesAdded.map((a, i) => a + (linesRemoved[i] || 0))),
        };
      }
    }

    // expected-diff specific
    if (evaluatorName === 'expected-diff') {
      const similarities: number[] = [];
      let thresholdMet = 0;

      for (const metrics of metricsCollections) {
        if (typeof metrics.aggregate_similarity === 'number') {
          similarities.push(metrics.aggregate_similarity);
          if (typeof metrics.threshold === 'number' && metrics.aggregate_similarity >= metrics.threshold) {
            thresholdMet++;
          }
        }
      }

      if (similarities.length > 0) {
        summary.expected_diff = {
          avg_aggregate_similarity: this.average(similarities),
          min_similarity: Math.min(...similarities),
          max_similarity: Math.max(...similarities),
          threshold_met_rate: similarities.length > 0 ? thresholdMet / similarities.length : 0,
        };
      }
    }

    // agentic-judge specific (any evaluator starting with agentic-judge)
    if (evaluatorName.startsWith('agentic-judge')) {
      const durations: number[] = [];
      const assertionPassRates: Record<string, number[]> = {};

      for (const metrics of metricsCollections) {
        if (typeof metrics.agent_duration_ms === 'number') {
          durations.push(metrics.agent_duration_ms);
        }
      }

      if (durations.length > 0) {
        summary.agentic_judge = {
          avg_evaluation_duration_ms: this.average(durations),
          assertion_pass_rates: Object.fromEntries(
            Object.entries(assertionPassRates).map(([k, v]) => [k, this.average(v)])
          ),
        };
      }
    }

    return summary;
  }

  /**
   * Analyze time-series trends
   */
  analyzeTrends(
    records: ExportedResultsBundle[],
    _granularity?: 'hourly' | 'daily' | 'weekly'
  ): TrendAnalysis {
    const passRateTrend: TrendDataPoint[] = [];
    const durationTrend: TrendDataPoint[] = [];
    const testCaseTrends: Record<string, TrendDataPoint[]> = {};

    // Compute running averages for trends
    for (const record of records) {
      const timestamp = record.exported_at;
      const passed = record.summary.overall_status === 'passed' ? 1 : 0;

      passRateTrend.push({ timestamp, value: passed });
      durationTrend.push({ timestamp, value: record.execution.duration_ms });

      // Per-test-case trends
      const testCaseName = record.test_case.name;
      if (!testCaseTrends[testCaseName]) {
        testCaseTrends[testCaseName] = [];
      }
      testCaseTrends[testCaseName].push({
        timestamp,
        value: passed,
        test_case: testCaseName,
      });
    }

    // Compute daily aggregates
    const dailyAggregates = this.computeDailyAggregates(records);

    // Compute weekly aggregates if we have enough data
    let weeklyAggregates: WeeklyAggregate[] | undefined;
    if (dailyAggregates.length >= 7) {
      weeklyAggregates = this.computeWeeklyAggregates(dailyAggregates);
    }

    return {
      pass_rate_trend: passRateTrend,
      duration_trend: durationTrend,
      test_case_trends: testCaseTrends,
      aggregates: {
        daily: dailyAggregates,
        weekly: weeklyAggregates,
      },
    };
  }

  /**
   * Compute daily aggregates
   */
  private computeDailyAggregates(records: ExportedResultsBundle[]): DailyAggregate[] {
    const byDate = new Map<
      string,
      { runs: number; passed: number; totalDuration: number }
    >();

    for (const record of records) {
      const date = record.exported_at.split('T')[0]; // YYYY-MM-DD
      if (!byDate.has(date)) {
        byDate.set(date, { runs: 0, passed: 0, totalDuration: 0 });
      }
      const data = byDate.get(date)!;
      data.runs++;
      if (record.summary.overall_status === 'passed') data.passed++;
      data.totalDuration += record.execution.duration_ms;
    }

    return Array.from(byDate.entries())
      .map(([date, data]) => ({
        date,
        run_count: data.runs,
        pass_rate: data.runs > 0 ? data.passed / data.runs : 0,
        avg_duration_ms: data.runs > 0 ? data.totalDuration / data.runs : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Compute weekly aggregates from daily data
   */
  private computeWeeklyAggregates(dailyAggregates: DailyAggregate[]): WeeklyAggregate[] {
    const byWeek = new Map<
      string,
      { runs: number; passedTotal: number; durationTotal: number }
    >();

    for (const daily of dailyAggregates) {
      // Get Monday of the week
      const date = new Date(daily.date);
      const dayOfWeek = date.getDay();
      const monday = new Date(date);
      monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const weekStart = monday.toISOString().split('T')[0];

      if (!byWeek.has(weekStart)) {
        byWeek.set(weekStart, { runs: 0, passedTotal: 0, durationTotal: 0 });
      }
      const data = byWeek.get(weekStart)!;
      data.runs += daily.run_count;
      data.passedTotal += daily.run_count * daily.pass_rate;
      data.durationTotal += daily.run_count * daily.avg_duration_ms;
    }

    return Array.from(byWeek.entries())
      .map(([weekStart, data]) => ({
        week_start: weekStart,
        run_count: data.runs,
        pass_rate: data.runs > 0 ? data.passedTotal / data.runs : 0,
        avg_duration_ms: data.runs > 0 ? data.durationTotal / data.runs : 0,
      }))
      .sort((a, b) => a.week_start.localeCompare(b.week_start));
  }

  /**
   * Generate insights from analysis
   */
  generateInsights(
    _records: ExportedResultsBundle[],
    byTestCase: TestCaseAnalysis[],
    _byAgent: AgentAnalysis[],
    byEvaluator: EvaluatorAnalysis[],
    thresholds?: {
      regressionDelta?: number;
      lowPassRateThreshold?: number;
      highSkipRateThreshold?: number;
    }
  ): Insight[] {
    const insights: Insight[] = [];
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

    // Check for low pass rate test cases
    for (const tc of byTestCase) {
      if (tc.run_count >= 3 && tc.overall_pass_rate < t.lowPassRateThreshold) {
        insights.push({
          type: 'recommendation',
          severity: tc.overall_pass_rate < 0.2 ? 'critical' : 'warning',
          title: `"${tc.name}" has ${(tc.overall_pass_rate * 100).toFixed(0)}% pass rate`,
          description: `This test case needs attention with only ${(tc.overall_pass_rate * 100).toFixed(0)}% pass rate across ${tc.run_count} runs.`,
          context: { test_case: tc.name },
          data: { pass_rate: tc.overall_pass_rate, run_count: tc.run_count },
        });
      }

      // Check for consistent success
      if (tc.run_count >= 5 && tc.overall_pass_rate >= 0.95) {
        insights.push({
          type: 'improvement',
          severity: 'info',
          title: `"${tc.name}" maintains ${(tc.overall_pass_rate * 100).toFixed(0)}% pass rate`,
          description: `Excellent consistency across ${tc.run_count} runs.`,
          context: { test_case: tc.name },
          data: { pass_rate: tc.overall_pass_rate, run_count: tc.run_count },
        });
      }

      // Check for degrading trend
      if (tc.recent_trend === 'degrading') {
        insights.push({
          type: 'regression',
          severity: 'warning',
          title: `"${tc.name}" shows degrading trend`,
          description: `Recent runs show declining performance for this test case.`,
          context: { test_case: tc.name },
        });
      }
    }

    // Check for high skip rate evaluators
    for (const ev of byEvaluator) {
      if (ev.run_count >= 3 && ev.skip_rate > t.highSkipRateThreshold) {
        insights.push({
          type: 'anomaly',
          severity: 'warning',
          title: `${ev.name} skipped ${(ev.skip_rate * 100).toFixed(0)}% of the time`,
          description: `This evaluator was skipped in ${ev.skipped} of ${ev.run_count} runs. Check configuration.`,
          context: { evaluator: ev.name },
          data: { skip_rate: ev.skip_rate, skipped: ev.skipped, run_count: ev.run_count },
        });
      }

      // Check for low pass rate evaluators
      if (
        ev.run_count >= 3 &&
        ev.skipped < ev.run_count * 0.5 && // Not mostly skipped
        ev.pass_rate < t.lowPassRateThreshold
      ) {
        insights.push({
          type: 'recommendation',
          severity: 'warning',
          title: `${ev.name} has ${(ev.pass_rate * 100).toFixed(0)}% pass rate`,
          description: `Consider reviewing evaluator criteria or agent performance.`,
          context: { evaluator: ev.name },
          data: { pass_rate: ev.pass_rate, run_count: ev.run_count },
        });
      }
    }

    // Sort insights by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return insights;
  }

  /**
   * Helper to compute average
   */
  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
