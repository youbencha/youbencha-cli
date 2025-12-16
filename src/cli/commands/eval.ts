/**
 * Eval Command
 * 
 * Runs evaluators on existing directories without executing an agent.
 * Useful for re-evaluating agent outputs, testing evaluators, or evaluating manual changes.
 */

import * as fs from 'fs/promises';
import { Orchestrator } from '../../core/orchestrator.js';
import { evalConfigSchema, EvalConfig } from '../../schemas/eval.schema.js';
import { createSpinner } from '../../lib/progress.js';
import * as logger from '../../lib/logger.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';
import { parseConfig, getFormatTips } from '../../lib/config-parser.js';
import { loadConfig, substituteVariablesInObject } from '../../lib/config-loader.js';
import { ZodError } from 'zod';

/**
 * Options for eval command
 */
interface EvalCommandOptions {
  config: string;
}

/**
 * Eval command handler
 * 
 * Loads eval configuration, validates it, and runs evaluators on existing directories.
 */
export async function evalCommand(options: EvalCommandOptions): Promise<void> {
  try {
    // Load youBencha configuration
    const config = await loadConfig();
    
    // Load configuration file
    logger.info(`Loading eval configuration from ${options.config}`);
    
    // Validate file size before reading
    const configStats = await fs.stat(options.config);
    const maxConfigSize = 1024 * 1024; // 1MB
    
    if (configStats.size > maxConfigSize) {
      logger.error(`Configuration file too large: ${configStats.size} bytes (max: ${maxConfigSize})`);
      logger.info('💡 Tip: Eval configuration files should typically be under 10KB');
      process.exit(1);
    }
    
    const configContent = await fs.readFile(options.config, 'utf-8');
    
    // Parse configuration (YAML or JSON)
    let configData;
    try {
      configData = parseConfig(configContent, options.config);
    } catch (error) {
      logger.error('Failed to parse configuration file');
      if (error instanceof Error) {
        logger.error(error.message);
      }
      logger.info('');
      logger.info('💡 Common mistakes:');
      const tips = getFormatTips(options.config);
      tips.forEach(tip => logger.info(`   ${tip}`));
      process.exit(1);
    }
    
    // Apply variable substitution if configured
    if (config.variables && Object.keys(config.variables).length > 0) {
      configData = substituteVariablesInObject(configData, config.variables);
      logger.debug('Applied variable substitution from youBencha config');
    }
    
    // Validate against schema
    const spinner = createSpinner('Validating eval configuration...');
    spinner.start();
    let evalConfig: EvalConfig;
    try {
      evalConfig = evalConfigSchema.parse(configData);
      spinner.succeed('Configuration validated ✓');
    } catch (error) {
      spinner.fail('Configuration validation failed');
      
      // Extract validation errors
      const errors: string[] = [];
      if (error instanceof ZodError) {
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          errors.push(`${path}: ${err.message}`);
        });
      } else if (error instanceof Error) {
        errors.push(error.message);
      }
      
      // Show user-friendly error
      console.log(formatUserError(UserErrors.invalidConfig(errors)));
      process.exit(1);
    }

    // Apply output_dir from config if specified and not overridden in eval config
    if (config.output_dir && !evalConfig.output_dir) {
      evalConfig.output_dir = config.output_dir;
      logger.debug(`Using output directory from config: ${config.output_dir}`);
    }

    // Create orchestrator with config values
    const orchestrator = new Orchestrator({
      keepWorkspace: true, // Always keep workspace for eval-only mode
      maxConcurrentEvaluators: config.evaluators?.max_concurrent,
    });

    // Run evaluation
    logger.info('Starting evaluation (no agent execution)...');
    const results = await orchestrator.runEvaluationOnly(evalConfig, options.config);

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
