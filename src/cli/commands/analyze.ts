/**
 * Analyze Command
 * 
 * Analyzes evaluation results and generates insights and recommendations.
 * Supports single-run analysis with strategic recommendations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { resultsBundleSchema, ResultsBundle } from '../../schemas/result.schema.js';
import { analyzeSingleRun } from '../../analyzers/single-run.js';
import { AnalyticsReporter } from '../../reporters/analytics.js';
import * as logger from '../../lib/logger.js';

/**
 * Options for analyze command
 */
interface AnalyzeCommandOptions {
  from: string;
  output?: string;
  format?: string;
}

/**
 * Analyze command handler
 * 
 * Loads results bundle, performs analysis, and generates enhanced report
 * with insights and recommendations.
 */
export async function analyzeCommand(options: AnalyzeCommandOptions): Promise<void> {
  try {
    logger.info(`Analyzing results from ${options.from}`);
    logger.info('');

    // Load results bundle
    const resultsContent = await fs.readFile(options.from, 'utf-8');
    const resultsData = JSON.parse(resultsContent);

    // Validate results bundle
    let resultsBundle: ResultsBundle;
    try {
      resultsBundle = resultsBundleSchema.parse(resultsData);
    } catch (error) {
      logger.error('Invalid results bundle format:');
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }

    // Perform analysis
    logger.info('🔍 Analyzing evaluation results...');
    const analysis = await analyzeSingleRun(resultsBundle, options.from);

    // Log quick summary to console
    logger.info('');
    logger.info('Analysis Complete:');
    logger.info(`  ├─ Insights: ${analysis.insights.length}`);
    logger.info(`  ├─ Recommendations: ${analysis.recommendations.length}`);
    logger.info(`  └─ Success Rate: ${(analysis.metrics.evaluator_pass_rate * 100).toFixed(1)}%`);
    logger.info('');

    // Generate report
    const reporter = new AnalyticsReporter();

    // Determine output path
    let outputPath: string;
    if (options.output) {
      outputPath = options.output;
    } else {
      // Default: write to same directory as results.json
      const resultsDir = path.dirname(options.from);
      outputPath = path.join(resultsDir, `analysis${reporter.extension}`);
    }

    logger.info('📊 Generating analytics report...');
    await reporter.writeToFile(analysis, outputPath);

    // Display high-priority recommendations in console
    const highPriorityRecs = analysis.recommendations.filter(r => r.priority === 'high');
    if (highPriorityRecs.length > 0) {
      logger.info('');
      logger.info('🔴 High Priority Recommendations:');
      for (const rec of highPriorityRecs) {
        logger.info(`  • ${rec.title}`);
        logger.info(`    ${rec.action}`);
      }
    }

    // Report success
    logger.info('');
    logger.info('✅ Analysis complete');
    logger.info(`  Report: ${outputPath}`);
    logger.info('');

    // Show quick insights summary
    const errors = analysis.insights.filter(i => i.type === 'error');
    const warnings = analysis.insights.filter(i => i.type === 'warning');
    const successes = analysis.insights.filter(i => i.type === 'success');

    if (errors.length > 0 || warnings.length > 0) {
      logger.info('Quick Summary:');
      if (errors.length > 0) {
        logger.info(`  ❌ ${errors.length} issue(s) found`);
      }
      if (warnings.length > 0) {
        logger.info(`  ⚠️  ${warnings.length} warning(s)`);
      }
      if (successes.length > 0) {
        logger.info(`  ✅ ${successes.length} success(es)`);
      }
      logger.info('');
      logger.info('See full report for detailed recommendations.');
      logger.info('');
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Analysis failed:');
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}
