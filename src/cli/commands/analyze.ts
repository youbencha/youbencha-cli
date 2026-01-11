/**
 * Analyze Command
 *
 * CLI command for analyzing historical evaluation results from JSONL files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { JSONLReader, JSONLReaderError } from '../../analysis/jsonl-reader.js';
import { Aggregator } from '../../analysis/aggregator.js';
import { AnalysisJsonReporter } from '../../analysis/reporters/json.js';
import { AnalysisTableReporter } from '../../analysis/reporters/table.js';
import { AnalysisMarkdownReporter } from '../../analysis/reporters/markdown.js';
import { AnalysisFilter, ReporterOptions, AnalysisReporter } from '../../analysis/index.js';
import * as logger from '../../lib/logger.js';

/**
 * Options for analyze command
 */
export interface AnalyzeCommandOptions {
  from: string;
  format?: 'table' | 'markdown' | 'json';
  output?: string;
  testCase?: string;
  agent?: string;
  evaluator?: string;
  since?: string;
  until?: string;
  last?: number;
  view?: 'summary' | 'trends' | 'comparison' | 'failures' | 'assertions';
  verbose?: boolean;
}

/**
 * Get youbencha version from package.json
 */
async function getVersion(): Promise<string> {
  try {
    // Try to read from package.json relative to the dist directory
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
      version: string;
    };
    return packageJson.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Analyze command handler
 *
 * Reads JSONL history file and generates analysis report.
 */
export async function analyzeCommand(options: AnalyzeCommandOptions): Promise<void> {
  try {
    const fromPath = path.resolve(options.from);

    // Check if file exists
    try {
      await fs.access(fromPath);
    } catch {
      logger.error(
        `No history file found at ${fromPath}. Run evaluations with \`database\` post-evaluator first.`
      );
      process.exit(1);
    }

    logger.info(`Analyzing results from ${fromPath}`);

    // Build filter from options
    const filter: AnalysisFilter = {};
    const filtersApplied: Record<string, string> = {};

    if (options.testCase) {
      filter.testCase = options.testCase;
      filtersApplied.testCase = options.testCase;
    }
    if (options.agent) {
      filter.agent = options.agent;
      filtersApplied.agent = options.agent;
    }
    if (options.evaluator) {
      filter.evaluator = options.evaluator;
      filtersApplied.evaluator = options.evaluator;
    }
    if (options.since) {
      const sinceDate = new Date(options.since);
      if (isNaN(sinceDate.getTime())) {
        logger.error(`Invalid date format for --since: ${options.since}. Use ISO 8601 format.`);
        process.exit(1);
      }
      filter.since = sinceDate;
      filtersApplied.since = options.since;
    }
    if (options.until) {
      const untilDate = new Date(options.until);
      if (isNaN(untilDate.getTime())) {
        logger.error(`Invalid date format for --until: ${options.until}. Use ISO 8601 format.`);
        process.exit(1);
      }
      filter.until = untilDate;
      filtersApplied.until = options.until;
    }

    // Read records
    const reader = new JSONLReader();
    let records;

    if (options.last) {
      logger.info(`Reading last ${options.last} records...`);
      records = await reader.readLast(fromPath, options.last, filter);
      filtersApplied.last = options.last.toString();
    } else if (Object.keys(filter).length > 0) {
      logger.info('Reading filtered records...');
      records = await reader.readFiltered(fromPath, filter);
    } else {
      logger.info('Reading all records...');
      records = await reader.readAll(fromPath);
    }

    if (records.length === 0) {
      logger.info('');
      logger.info('No evaluation records found matching the specified filters.');
      logger.info('');
      process.exit(0);
    }

    logger.info(`Found ${records.length} records`);

    // Aggregate results
    const aggregator = new Aggregator();
    const version = await getVersion();
    const analysis = aggregator.analyze(records, fromPath, filtersApplied, version);

    // Select reporter
    const format = options.format || 'table';
    let reporter: AnalysisReporter;

    switch (format) {
      case 'json':
        reporter = new AnalysisJsonReporter();
        break;
      case 'markdown':
        reporter = new AnalysisMarkdownReporter();
        break;
      case 'table':
      default:
        reporter = new AnalysisTableReporter();
        break;
    }

    // Reporter options
    const reporterOptions: ReporterOptions = {
      view: options.view || 'summary',
      verbose: options.verbose,
    };

    // Generate report
    const report = await reporter.generate(analysis, reporterOptions);

    // Output
    if (options.output) {
      const outputPath = path.resolve(options.output);
      await reporter.writeToFile(analysis, outputPath, reporterOptions);
      logger.info('');
      logger.info('✅ Analysis report generated successfully');
      logger.info(`  Output: ${outputPath}`);
      logger.info('');
    } else {
      // Print to stdout
      console.log('');
      console.log(report);
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof JSONLReaderError) {
      logger.error(error.message);
    } else if (error instanceof Error) {
      logger.error('Analysis failed:');
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}
