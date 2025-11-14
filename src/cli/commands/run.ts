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
import { UserErrors, formatUserError } from '../../lib/user-errors.js';

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
      logger.info('💡 Tip: Suite configuration files should typically be under 10KB');
      process.exit(1);
    }
    
    const configContent = await fs.readFile(options.config, 'utf-8');
    
    // Parse YAML
    let configData;
    try {
      configData = yaml.parse(configContent);
    } catch (error) {
      logger.error('Failed to parse YAML configuration file');
      if (error instanceof Error) {
        logger.error(error.message);
      }
      logger.info('');
      logger.info('💡 Common YAML mistakes:');
      logger.info('   - Check indentation (use spaces, not tabs)');
      logger.info('   - Ensure keys and values are properly formatted');
      logger.info('   - Validate YAML syntax at https://yaml-online-parser.appspot.com');
      process.exit(1);
    }
    
    // Validate against schema
    const spinner = createSpinner('Validating suite configuration...');
    spinner.start();
    let suiteConfig: SuiteConfig;
    try {
      suiteConfig = suiteConfigSchema.parse(configData);
      spinner.succeed('Configuration validated ✓');
    } catch (error) {
      spinner.fail('Configuration validation failed');
      
      // Extract validation errors
      const errors: string[] = [];
      if (error instanceof Error && 'errors' in error) {
        const zodError = error as any;
        if (Array.isArray(zodError.errors)) {
          zodError.errors.forEach((err: any) => {
            const path = err.path.join('.');
            errors.push(`${path}: ${err.message}`);
          });
        }
      } else if (error instanceof Error) {
        errors.push(error.message);
      }
      
      // Show user-friendly error
      console.log(formatUserError(UserErrors.invalidConfig(errors)));
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
    logger.info('📊 Results Summary:');
    logger.info(`   Status: ${results.summary.overall_status === 'passed' ? '✓ PASSED' : results.summary.overall_status === 'failed' ? '✗ FAILED' : '⊘ PARTIAL'}`);
    logger.info(`   Evaluators: ${results.summary.passed} passed, ${results.summary.failed} failed, ${results.summary.skipped} skipped (${results.summary.total_evaluators} total)`);
    logger.info('');
    logger.info('📁 Results Location:');
    logger.info(`   ${results.execution.environment.workspace_dir}/artifacts/`);
    logger.info('');
    logger.info('📝 Next Steps:');
    logger.info('   1. Generate a readable report:');
    logger.info(`      yb report --from ${results.execution.environment.workspace_dir}/artifacts/results.json`);
    logger.info('');
    logger.info('   2. Review individual evaluator outputs in the artifacts directory');
    logger.info('');
    if (results.summary.failed > 0) {
      logger.info('⚠️  Some evaluators failed. Check the report for details.');
      logger.info('');
    }

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
