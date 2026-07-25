/**
 * Validate Command
 *
 * Validates a test case configuration file without running the evaluation.
 * Useful for checking syntax and configuration before committing.
 */

import * as fs from 'fs/promises';
import { TestCaseConfig } from '../../schemas/testcase.schema.js';
import { createSpinner } from '../../lib/progress.js';
import * as logger from '../../lib/logger.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';
import { parseConfig, getFormatTips } from '../../lib/config-parser.js';
import { loadConfig } from '../../lib/config-loader.js';
import {
  resolveEffectiveEvalConfig,
  resolveEffectiveTestCaseConfig,
} from '../../lib/effective-config.js';
import { CliExitCode } from '../../lib/exit-codes.js';
import { ZodError } from 'zod';

/**
 * Options for validate command
 */
interface ValidateCommandOptions {
  config: string;
  verbose?: boolean;
}

/**
 * Validate command handler
 *
 * Loads and validates test case configuration, providing detailed feedback.
 */
export async function validateCommand(
  options: ValidateCommandOptions
): Promise<void> {
  try {
    const config = await loadConfig();
    logger.configure({ level: config.log_level as logger.LogLevel });
    logger.info('Validating test case configuration...');
    logger.info('');

    // Load configuration file
    const spinner = createSpinner('Loading configuration file...');
    spinner.start();

    let configContent: string;
    try {
      const configStats = await fs.stat(options.config);
      const maxConfigSize = 1024 * 1024; // 1MB

      if (configStats.size > maxConfigSize) {
        spinner.fail('File too large');
        logger.error(
          `Configuration file too large: ${configStats.size} bytes (max: ${maxConfigSize})`
        );
        logger.info(
          '💡 Tip: Test case configuration files should typically be under 10KB'
        );
        process.exitCode = CliExitCode.ExecutionError;
        return;
      }

      configContent = await fs.readFile(options.config, 'utf-8');
      spinner.succeed('Configuration file loaded ✓');
    } catch (error) {
      spinner.fail('Failed to read file');
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.error(`File not found: ${options.config}`);
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exitCode = CliExitCode.ExecutionError;
      return;
    }

    // Parse configuration (YAML or JSON)
    const parseSpinner = createSpinner('Parsing configuration...');
    parseSpinner.start();

    let configData: unknown;
    try {
      configData = parseConfig(configContent, options.config);
      parseSpinner.succeed('Configuration parsed successfully ✓');
    } catch (error) {
      parseSpinner.fail('Configuration parsing failed');
      logger.error('');
      logger.error('❌ Invalid configuration syntax');
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
    const schemaSpinner = createSpinner('Validating configuration schema...');
    schemaSpinner.start();

    let testCaseConfig: TestCaseConfig;
    try {
      if (
        configData !== null &&
        typeof configData === 'object' &&
        'directory' in configData &&
        !('repo' in configData)
      ) {
        const evalConfig = resolveEffectiveEvalConfig(
          configData,
          options.config,
          config
        );
        schemaSpinner.succeed('Eval configuration validation passed ✓');
        logger.info('');
        logger.info('✅ Eval configuration is valid!');
        logger.info('');
        logger.info('📋 Summary:');
        logger.info(`   Eval: ${evalConfig.name}`);
        logger.info(`   Directory: ${evalConfig.directory}`);
        logger.info(
          `   Evaluators: ${evalConfig.evaluators.length} configured`
        );
        logger.info(`   Output: ${evalConfig.output_dir}`);
        logger.info('');
        logger.info('🚀 Ready to run:');
        logger.info(`   yb eval -c ${options.config}`);
        logger.info('');
        process.exitCode = CliExitCode.Success;
        return;
      }

      testCaseConfig = resolveEffectiveTestCaseConfig(
        configData,
        options.config,
        config
      );
      schemaSpinner.succeed('Schema validation passed ✓');
    } catch (error) {
      schemaSpinner.fail('Schema validation failed');

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

    // Additional validation checks
    logger.info('');
    logger.info('Running additional checks...');
    logger.info('');

    // Display test case metadata
    logger.info('📝 Test Case:');
    logger.info(`   Name: ${testCaseConfig.name}`);
    logger.info(`   Description: ${testCaseConfig.description}`);
    logger.info('');

    // Check repository URL accessibility (basic validation)
    if (options.verbose) {
      logger.info('📦 Repository:');
      logger.info(`   URL: ${testCaseConfig.repo}`);
      logger.info(`   Branch: ${testCaseConfig.branch || 'default'}`);
      if (testCaseConfig.expected) {
        logger.info(
          `   Expected: ${testCaseConfig.expected_source}:${testCaseConfig.expected}`
        );
      }
      logger.info('');
    }

    // Check agent configuration
    if (options.verbose) {
      logger.info('🤖 Agent:');
      logger.info(`   Type: ${testCaseConfig.agent.type}`);
      if (testCaseConfig.agent.config?.prompt) {
        const promptLength = String(testCaseConfig.agent.config.prompt).length;
        logger.info(`   Prompt length: ${promptLength} characters`);
        if (promptLength < 10) {
          logger.warn(
            '   ⚠️  Prompt is very short - consider adding more detail'
          );
        }
      }
      if (testCaseConfig.agent.config?.prompt_file) {
        logger.info(
          `   Prompt file: ${String(testCaseConfig.agent.config.prompt_file)}`
        );
      }
      logger.info('');
    }

    // Check evaluators
    logger.info('📊 Evaluators:');

    const resolvedEvaluators = testCaseConfig.evaluators.filter(
      (evaluator): evaluator is Extract<typeof evaluator, { name: string }> =>
        'name' in evaluator
    );
    const evaluatorNames = resolvedEvaluators.map((e) => e.name);
    const uniqueEvaluators = new Set(evaluatorNames);

    if (evaluatorNames.length !== uniqueEvaluators.size) {
      logger.warn(
        '   ⚠️  Duplicate evaluators detected (this is usually unintentional)'
      );
    }

    evaluatorNames.forEach((name, index) => {
      const rawConfig: unknown = resolvedEvaluators[index].config;
      const config =
        rawConfig !== null && typeof rawConfig === 'object'
          ? (rawConfig as Record<string, unknown>)
          : undefined;
      const hasConfig = config !== undefined && Object.keys(config).length > 0;
      logger.info(
        `   ${index + 1}. ${name}${hasConfig ? ' (configured)' : ''}`
      );

      // Check if expected-diff is used without expected reference
      if (name === 'expected-diff' && !testCaseConfig.expected) {
        logger.warn(
          '      ⚠️  expected-diff evaluator requires expected reference configuration'
        );
      }

      // Check if agentic-judge has assertions
      if (name === 'agentic-judge') {
        const assertions: unknown = config?.assertions ?? config?.criteria;
        if (
          !assertions ||
          (typeof assertions === 'object' &&
            Object.keys(assertions).length === 0)
        ) {
          logger.warn(
            '      ⚠️  agentic-judge evaluator should have assertions defined'
          );
        } else if (options.verbose && typeof assertions === 'object') {
          logger.info(
            `      Assertions: ${Object.keys(assertions).length} defined`
          );
        }
      }
    });
    logger.info('');

    // Summary
    logger.info('');
    logger.info('✅ Configuration is valid!');
    logger.info('');
    logger.info('📋 Summary:');
    logger.info(`   Test Case: ${testCaseConfig.name}`);
    logger.info(`   Repository: ${testCaseConfig.repo}`);
    logger.info(`   Agent: ${testCaseConfig.agent.type}`);
    logger.info(
      `   Evaluators: ${testCaseConfig.evaluators.length} configured`
    );
    logger.info('');
    logger.info('🚀 Ready to run:');
    logger.info(`   yb run -c ${options.config}`);
    logger.info('');

    process.exitCode = CliExitCode.Success;
  } catch (error) {
    logger.error('');
    logger.error('Validation failed:');
    if (error instanceof Error) {
      logger.error(error.message);
      if (options.verbose && error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exitCode = CliExitCode.ExecutionError;
  }
}
