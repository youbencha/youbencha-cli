/**
 * Run Command
 *
 * Executes a test case from a configuration file.
 */

import * as fs from 'fs/promises';
import { Orchestrator } from '../../core/orchestrator.js';
import { TestCaseConfig } from '../../schemas/testcase.schema.js';
import { createSpinner } from '../../lib/progress.js';
import * as logger from '../../lib/logger.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';
import { parseConfig, getFormatTips } from '../../lib/config-parser.js';
import { loadConfig } from '../../lib/config-loader.js';
import { resolveEffectiveTestCaseConfig } from '../../lib/effective-config.js';
import { CliExitCode, getResultsExitCode } from '../../lib/exit-codes.js';
import { writeDefaultMarkdownReport } from '../../lib/results-output.js';
import { ZodError } from 'zod';

/**
 * Options for run command
 */
interface RunCommandOptions {
  config: string;
  deleteWorkspace?: boolean;
}

/**
 * Run command handler
 *
 * Loads test case configuration, validates it, and orchestrates evaluation.
 */
export async function runCommand(options: RunCommandOptions): Promise<void> {
  try {
    // Load youBencha configuration
    const config = await loadConfig();
    logger.configure({ level: config.log_level as logger.LogLevel });

    // Load configuration file
    logger.info(`Loading test case configuration from ${options.config}`);

    // Validate file size before reading
    const configStats = await fs.stat(options.config);
    const maxConfigSize = 1024 * 1024; // 1MB

    if (configStats.size > maxConfigSize) {
      logger.error(
        `Configuration file too large: ${configStats.size} bytes (max: ${maxConfigSize})`
      );
      logger.info(
        '💡 Tip: Test case configuration files should typically be under 10KB'
      );
      process.exitCode = CliExitCode.ExecutionError;
      return;
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
      tips.forEach((tip) => logger.info(`   ${tip}`));
      process.exitCode = CliExitCode.ExecutionError;
      return;
    }

    // Validate against schema
    const spinner = createSpinner('Validating test case configuration...');
    spinner.start();
    let testCaseConfig: TestCaseConfig;
    try {
      testCaseConfig = resolveEffectiveTestCaseConfig(
        configData,
        options.config,
        config
      );
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
      process.exitCode = CliExitCode.ExecutionError;
      return;
    }

    // Apply keep_workspace from config if CLI flag not specified
    const keepWorkspace =
      options.deleteWorkspace === true
        ? false
        : (config.keep_workspace ?? true);

    // Create orchestrator with config values
    const orchestrator = new Orchestrator({
      keepWorkspace,
      maxConcurrentEvaluators: config.evaluators?.max_concurrent,
      defaultTimeout: config.timeout_ms,
      agentTimeout: config.agent?.timeout_ms,
      agentModel: config.agent?.model,
    });

    // Run evaluation
    logger.info('Starting evaluation...');
    const results = await orchestrator.runEvaluation(
      testCaseConfig,
      options.config
    );
    const outputPaths = keepWorkspace
      ? await writeDefaultMarkdownReport(results)
      : undefined;

    // Report success
    logger.info('');
    logger.info('✅ Evaluation completed successfully');
    logger.info('');
    logger.info('📊 Results Summary:');
    logger.info(
      `   Status: ${results.summary.overall_status === 'passed' ? '✓ PASSED' : results.summary.overall_status === 'failed' ? '✗ FAILED' : '⊘ PARTIAL'}`
    );
    logger.info(
      `   Evaluators: ${results.summary.passed} passed, ${results.summary.failed} failed, ${results.summary.skipped} skipped (${results.summary.total_evaluators} total)`
    );
    logger.info('');
    logger.info('📁 Results Location:');
    if (outputPaths) {
      logger.info(`   Results: ${outputPaths.results}`);
      logger.info(`   Report:  ${outputPaths.report}`);
    } else {
      logger.info('   Workspace and artifacts deleted as requested.');
    }
    logger.info('');
    logger.info(
      '📝 Next Step: Review the report and individual evaluator artifacts.'
    );
    logger.info('');
    if (results.summary.failed > 0) {
      logger.info('⚠️  Some evaluators failed. Check the report for details.');
      logger.info('');
    }

    const exitCode = getResultsExitCode(results);
    logger.info(`CLI exit code: ${exitCode}`);
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Evaluation failed:');
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exitCode = CliExitCode.ExecutionError;
  }
}
