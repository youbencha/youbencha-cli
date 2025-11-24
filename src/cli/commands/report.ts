/**
 * Report Command
 * 
 * Generates reports from evaluation results.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { resultsBundleSchema, ResultsBundle } from '../../schemas/result.schema.js';
import { JsonReporter } from '../../reporters/json.js';
import { MarkdownReporter } from '../../reporters/markdown.js';
import { Reporter } from '../../reporters/base.js';
import * as logger from '../../lib/logger.js';

/**
 * Options for report command
 */
interface ReportCommandOptions {
  from: string;
  format?: string;
  output?: string;
}

/**
 * Report command handler
 * 
 * Loads results bundle and generates report in specified format.
 */
export async function reportCommand(options: ReportCommandOptions): Promise<void> {
  try {
    // Load results bundle
    logger.info(`Loading results from ${options.from}`);
    const resultsContent = await fs.readFile(options.from, 'utf-8');
    const resultsData: unknown = JSON.parse(resultsContent);

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

    // Select reporter based on format
    const format = options.format || 'markdown';
    let reporter: Reporter;

    switch (format) {
      case 'json':
        reporter = new JsonReporter();
        break;
      case 'markdown':
      case 'md':
        reporter = new MarkdownReporter();
        break;
      default:
        logger.error(`Unknown report format: ${format}`);
        logger.error('Supported formats: json, markdown');
        process.exit(1);
    }

    // Determine output path
    let outputPath: string;
    if (options.output) {
      outputPath = options.output;
    } else {
      // Default: write to artifacts directory next to results.json
      const resultsDir = path.dirname(options.from);
      outputPath = path.join(resultsDir, `report${reporter.extension}`);
    }

    // Generate and write report
    logger.info(`Generating ${format} report...`);
    await reporter.writeToFile(resultsBundle, outputPath);

    // Report success
    logger.info('');
    logger.info('✅ Report generated successfully');
    logger.info(`  Output: ${outputPath}`);
    logger.info('');

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Report generation failed:');
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}
