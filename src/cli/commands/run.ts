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
    
    // Validate file size before reading
    const configStats = await fs.stat(options.config);
    const maxConfigSize = 1024 * 1024; // 1MB
    
    if (configStats.size > maxConfigSize) {
      logger.error(`Configuration file too large: ${configStats.size} bytes (max: ${maxConfigSize})`);
      process.exit(1);
    }
    
    const configContent = await fs.readFile(options.config, 'utf-8');
    
    // Parse YAML with protection against YAML bombs
    let configData;
    try {
      configData = yaml.parse(configContent, {
        maxAliasCount: 100,  // Limit alias expansion to prevent DoS
        strict: true,         // Strict parsing mode
      });
    } catch (error) {
      logger.error('Failed to parse YAML configuration:');
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    
    // Validate depth of parsed config to prevent deeply nested objects
    const maxDepth = 10;
    const depth = getObjectDepth(configData);
    if (depth > maxDepth) {
      logger.error(`Configuration structure too deep: ${depth} levels (max: ${maxDepth})`);
      process.exit(1);
    }
    
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
    const results = await orchestrator.runEvaluation(suiteConfig, options.config);

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

/**
 * Calculate the maximum depth of a nested object
 */
function getObjectDepth(obj: any, currentDepth: number = 0): number {
  if (obj === null || typeof obj !== 'object') {
    return currentDepth;
  }
  
  if (Array.isArray(obj)) {
    return Math.max(
      currentDepth,
      ...obj.map(item => getObjectDepth(item, currentDepth + 1))
    );
  }
  
  const depths = Object.values(obj).map(value => 
    getObjectDepth(value, currentDepth + 1)
  );
  
  return depths.length > 0 ? Math.max(...depths) : currentDepth;
}
