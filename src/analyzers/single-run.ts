/**
 * Single Run Analyzer
 * 
 * Analyzes a single evaluation run and generates insights and recommendations.
 * Examines overall performance, evaluator results, and identifies improvement opportunities.
 */

import {
  ResultsBundle,
  EvaluationResult,
} from '../schemas/result.schema.js';
import {
  SingleRunAnalysis,
  Recommendation,
  PerformanceInsight,
  CostAnalysis,
} from '../schemas/analytics.schema.js';

/**
 * Analysis thresholds and configuration
 * These can be made configurable in future versions
 */
const ANALYSIS_CONFIG = {
  SLOW_EVALUATOR_THRESHOLD_MS: 30000, // 30 seconds
  SIMILARITY_MARGIN_WARNING: 0.05, // 5% margin
  LARGE_CHANGE_FILE_COUNT: 20, // Files changed threshold
  LONG_EXECUTION_MINUTES: 10, // Minutes
  FAST_EXECUTION_SECONDS: 60, // 1 minute
} as const;

/**
 * Analyze a single evaluation run
 * 
 * @param bundle - Results bundle to analyze
 * @param sourcePath - Path to the source results.json file
 * @returns Single run analysis with insights and recommendations
 */
export async function analyzeSingleRun(
  bundle: ResultsBundle,
  sourcePath: string
): Promise<SingleRunAnalysis> {
  const insights: PerformanceInsight[] = [];
  const recommendations: Recommendation[] = [];
  
  // Generate insights from overall status
  insights.push(...analyzeOverallStatus(bundle));
  
  // Analyze individual evaluators
  insights.push(...analyzeEvaluators(bundle.evaluators));
  
  // Analyze agent execution
  insights.push(...analyzeAgentExecution(bundle));
  
  // Analyze execution time
  insights.push(...analyzeExecutionTime(bundle));
  
  // Generate recommendations based on insights
  recommendations.push(...generateRecommendations(bundle, insights));
  
  // Calculate performance metrics
  const metrics = calculateMetrics(bundle);
  
  // Extract cost analysis if available (from youBencha log)
  const costAnalysis = await extractCostAnalysis(bundle);
  
  return {
    version: '1.0.0',
    analyzed_at: new Date().toISOString(),
    source_results: sourcePath,
    results: bundle,
    insights,
    recommendations,
    cost_analysis: costAnalysis,
    metrics,
  };
}

/**
 * Analyze overall evaluation status
 */
function analyzeOverallStatus(bundle: ResultsBundle): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];
  
  if (bundle.summary.overall_status === 'passed') {
    insights.push({
      type: 'success',
      category: 'Overall Performance',
      message: `All evaluators passed successfully (${bundle.summary.passed}/${bundle.summary.total_evaluators})`,
    });
  } else if (bundle.summary.overall_status === 'failed') {
    insights.push({
      type: 'error',
      category: 'Overall Performance',
      message: `Evaluation failed: ${bundle.summary.failed} of ${bundle.summary.total_evaluators} evaluators failed`,
    });
  } else {
    insights.push({
      type: 'warning',
      category: 'Overall Performance',
      message: `Partial success: ${bundle.summary.passed} passed, ${bundle.summary.failed} failed, ${bundle.summary.skipped} skipped`,
    });
  }
  
  return insights;
}

/**
 * Analyze individual evaluator results
 */
function analyzeEvaluators(evaluators: EvaluationResult[]): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];
  
  // Find slowest evaluator
  if (evaluators.length > 0) {
    const slowest = evaluators.reduce((prev, current) =>
      current.duration_ms > prev.duration_ms ? current : prev
    );
    
    if (slowest.duration_ms > ANALYSIS_CONFIG.SLOW_EVALUATOR_THRESHOLD_MS) {
      insights.push({
        type: 'warning',
        category: 'Performance',
        message: `Slowest evaluator: ${slowest.evaluator} took ${(slowest.duration_ms / 1000).toFixed(1)}s`,
        metric_value: slowest.duration_ms,
      });
    }
  }
  
  // Analyze expected-diff evaluator
  const expectedDiff = evaluators.find(e => e.evaluator === 'expected-diff');
  if (expectedDiff) {
    if (expectedDiff.status === 'failed' && expectedDiff.metrics.aggregate_similarity !== undefined) {
      const similarity = expectedDiff.metrics.aggregate_similarity as number;
      const threshold = expectedDiff.metrics.threshold as number;
      
      insights.push({
        type: 'error',
        category: 'Quality',
        message: `Similarity below threshold: ${(similarity * 100).toFixed(1)}% vs ${(threshold * 100).toFixed(0)}% required`,
        metric_value: similarity,
        reference_value: threshold,
      });
    } else if (expectedDiff.status === 'passed' && expectedDiff.metrics.aggregate_similarity !== undefined) {
      const similarity = expectedDiff.metrics.aggregate_similarity as number;
      const threshold = expectedDiff.metrics.threshold as number;
      const margin = similarity - threshold;
      
      if (margin < ANALYSIS_CONFIG.SIMILARITY_MARGIN_WARNING) {
        insights.push({
          type: 'warning',
          category: 'Quality',
          message: `Similarity close to threshold: ${(similarity * 100).toFixed(1)}% (only ${(margin * 100).toFixed(1)}% above minimum)`,
          metric_value: similarity,
          reference_value: threshold,
        });
      } else {
        insights.push({
          type: 'success',
          category: 'Quality',
          message: `High similarity achieved: ${(similarity * 100).toFixed(1)}% (${(margin * 100).toFixed(1)}% above threshold)`,
          metric_value: similarity,
          reference_value: threshold,
        });
      }
    }
  }
  
  // Analyze git-diff evaluator
  const gitDiff = evaluators.find(e => e.evaluator === 'git-diff');
  if (gitDiff && gitDiff.status === 'passed') {
    const filesChanged = gitDiff.metrics.files_changed as number || 0;
    const linesAdded = gitDiff.metrics.lines_added as number || 0;
    const linesRemoved = gitDiff.metrics.lines_removed as number || 0;
    
    if (filesChanged > ANALYSIS_CONFIG.LARGE_CHANGE_FILE_COUNT) {
      insights.push({
        type: 'info',
        category: 'Scope',
        message: `Large change: ${filesChanged} files modified, +${linesAdded}/-${linesRemoved} lines`,
        metric_value: filesChanged,
      });
    }
  }
  
  // Check for skipped evaluators
  const skipped = evaluators.filter(e => e.status === 'skipped');
  if (skipped.length > 0) {
    insights.push({
      type: 'warning',
      category: 'Coverage',
      message: `${skipped.length} evaluator(s) skipped: ${skipped.map(e => e.evaluator).join(', ')}`,
    });
  }
  
  return insights;
}

/**
 * Analyze agent execution
 */
function analyzeAgentExecution(bundle: ResultsBundle): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];
  
  if (bundle.agent.status === 'failed') {
    insights.push({
      type: 'error',
      category: 'Agent Execution',
      message: `Agent execution failed with exit code ${bundle.agent.exit_code}`,
    });
  } else if (bundle.agent.status === 'timeout') {
    insights.push({
      type: 'error',
      category: 'Agent Execution',
      message: 'Agent execution timed out',
    });
  } else {
    insights.push({
      type: 'success',
      category: 'Agent Execution',
      message: `Agent (${bundle.agent.type}) completed successfully`,
    });
  }
  
  return insights;
}

/**
 * Analyze execution time
 */
function analyzeExecutionTime(bundle: ResultsBundle): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];
  const durationMinutes = bundle.execution.duration_ms / 1000 / 60;
  
  if (durationMinutes > ANALYSIS_CONFIG.LONG_EXECUTION_MINUTES) {
    insights.push({
      type: 'warning',
      category: 'Performance',
      message: `Long execution time: ${durationMinutes.toFixed(1)} minutes`,
      metric_value: bundle.execution.duration_ms,
    });
  } else if (bundle.execution.duration_ms / 1000 < ANALYSIS_CONFIG.FAST_EXECUTION_SECONDS) {
    insights.push({
      type: 'success',
      category: 'Performance',
      message: `Fast execution: ${(bundle.execution.duration_ms / 1000).toFixed(1)} seconds`,
      metric_value: bundle.execution.duration_ms,
    });
  }
  
  return insights;
}

/**
 * Generate recommendations based on insights
 */
function generateRecommendations(
  bundle: ResultsBundle,
  insights: PerformanceInsight[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  
  // Check for similarity failures
  const similarityError = insights.find(
    i => i.category === 'Quality' && i.type === 'error' && i.message.includes('Similarity')
  );
  
  if (similarityError) {
    recommendations.push({
      category: 'quality',
      priority: 'high',
      title: 'Improve Agent Output Quality',
      description: 'Agent output similarity is below the expected threshold',
      action: 'Review the prompt, increase context, or adjust the expected reference threshold in your suite configuration',
      impact: 'Better alignment with expected results',
    });
  }
  
  // Check for close to threshold
  const similarityWarning = insights.find(
    i => i.category === 'Quality' && i.type === 'warning' && i.message.includes('close to threshold')
  );
  
  if (similarityWarning) {
    recommendations.push({
      category: 'quality',
      priority: 'medium',
      title: 'Quality Near Threshold',
      description: 'Agent output is passing but close to minimum threshold',
      action: 'Consider improving prompts or reviewing threshold settings to ensure consistent quality',
      impact: 'More robust and consistent results',
    });
  }
  
  // Check for performance issues
  const slowEvaluator = insights.find(
    i => i.category === 'Performance' && i.type === 'warning' && i.message.includes('Slowest')
  );
  
  if (slowEvaluator) {
    recommendations.push({
      category: 'performance',
      priority: 'medium',
      title: 'Optimize Slow Evaluator',
      description: 'One or more evaluators are taking significant time',
      action: 'Review evaluator configuration, consider caching, or optimize workspace size',
      impact: 'Faster evaluation cycles',
    });
  }
  
  // Check for skipped evaluators
  const skippedEvaluators = insights.find(
    i => i.category === 'Coverage' && i.type === 'warning'
  );
  
  if (skippedEvaluators) {
    recommendations.push({
      category: 'configuration',
      priority: 'medium',
      title: 'Enable Skipped Evaluators',
      description: 'Some evaluators are being skipped',
      action: 'Review evaluator prerequisites and configuration to enable all evaluators',
      impact: 'More comprehensive evaluation coverage',
    });
  }
  
  // Check for large changes
  const largeChange = insights.find(
    i => i.category === 'Scope' && i.message.includes('Large change')
  );
  
  if (largeChange) {
    recommendations.push({
      category: 'configuration',
      priority: 'low',
      title: 'Consider Breaking Down Large Tasks',
      description: 'The agent is making changes to many files',
      action: 'Consider breaking the task into smaller, more focused evaluations',
      impact: 'Easier debugging and more precise quality assessment',
    });
  }
  
  // Always recommend tracking cost
  if (bundle.agent.status === 'success') {
    recommendations.push({
      category: 'cost',
      priority: 'low',
      title: 'Monitor Agent Costs',
      description: 'Track token usage and costs over time',
      action: 'Review the youBencha log for token usage details and consider implementing cost budgets',
      impact: 'Better cost control and optimization',
    });
  }
  
  // General best practice recommendations
  if (bundle.summary.overall_status === 'passed' && bundle.summary.passed >= 2) {
    recommendations.push({
      category: 'quality',
      priority: 'low',
      title: 'Establish Baseline',
      description: 'This run can serve as a quality baseline',
      action: 'Save this run as a reference for future comparisons and regression testing',
      impact: 'Track performance trends over time',
    });
  }
  
  return recommendations;
}

/**
 * Calculate performance metrics
 */
function calculateMetrics(bundle: ResultsBundle) {
  const totalEvaluators = bundle.summary.total_evaluators;
  const passed = bundle.summary.passed;
  
  const avgEvaluatorDuration = bundle.evaluators.length > 0
    ? bundle.evaluators.reduce((sum, e) => sum + e.duration_ms, 0) / bundle.evaluators.length
    : 0;
  
  return {
    success_rate: bundle.agent.status === 'success' ? 1 : 0,
    avg_evaluator_duration_ms: avgEvaluatorDuration,
    total_duration_ms: bundle.execution.duration_ms,
    evaluator_pass_rate: totalEvaluators > 0 ? passed / totalEvaluators : 0,
  };
}

/**
 * Extract cost analysis from youBencha log
 * 
 * In a real implementation, this would parse the youBencha log file
 * and extract token usage information. For now, returns undefined.
 */
async function extractCostAnalysis(_bundle: ResultsBundle): Promise<CostAnalysis | undefined> {
  // TODO: Implement actual log parsing
  // This would read the youBencha log file and extract:
  // - total_tokens, prompt_tokens, completion_tokens
  // - model information
  // - calculate estimated costs based on model pricing
  
  return undefined;
}
