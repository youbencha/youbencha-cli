/**
 * Run Command
 * 
 * Executes an evaluation suite from a configuration file.
 */

import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import { Orchestrator } from '../../core/orchestrator.js';
import { suiteConfigSchema, SuiteConfig } from '../../schemas/suite.schema.js';
import { createSpinner } from '../../lib/progress.js';
import * as logger from '../../lib/logger.js';

/**
 * Options for run command
 */
interface RunCommandOptions {
  config: string;
  keepWorkspace?: boolean;
}

/**
 * Run command handler
 * 
 * Loads suite configuration, validates it, and orchestrates evaluation.
 */
export async function runCommand(options: RunCommandOptions): Promise<void> {
  try {
    // Load configuration file
    logger.info(`Loading suite configuration from ${options.config}`);
    const configContent = await fs.readFile(options.config, 'utf-8');
    
    // Parse YAML
    const configData = yaml.parse(configContent);
    
    // Validate against schema
    const spinner = createSpinner('Validating suite configuration...');
    spinner.start();
    let suiteConfig: SuiteConfig;
    try {
      suiteConfig = suiteConfigSchema.parse(configData);
      spinner.succeed('Configuration validated');
    } catch (error) {
      spinner.fail('Configuration validation failed');
      if (error instanceof Error) {
        logger.error('Configuration validation errors:');
        logger.error(error.message);
      }
      process.exit(1);
    }

    // Create orchestrator
    const orchestrator = new Orchestrator({
      keepWorkspace: options.keepWorkspace,
    });

    // Run evaluation
    logger.info('Starting evaluation...');
    const results = await orchestrator.runEvaluation(suiteConfig);

    // Report success
    logger.info('');
    logger.info('✅ Evaluation completed successfully');
    logger.info('');
    logger.info('Results Summary:');
    logger.info(`  Overall Status: ${results.summary.overall_status}`);
    logger.info(`  Total Evaluators: ${results.summary.total_evaluators}`);
    logger.info(`  Passed: ${results.summary.passed}`);
    logger.info(`  Failed: ${results.summary.failed}`);
    logger.info(`  Skipped: ${results.summary.skipped}`);
    logger.info('');
    logger.info(`Results saved to: ${results.execution.environment.workspace_dir}`);
    logger.info('');
    logger.info('Generate report with:');
    logger.info(`  yb report --from ${results.execution.environment.workspace_dir}/artifacts/results.json`);

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Evaluation failed:');
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}
