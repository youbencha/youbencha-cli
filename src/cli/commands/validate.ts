/**
 * Validate Command
 * 
 * Validates a test case configuration file without running the evaluation.
 * Useful for checking syntax and configuration before committing.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { testCaseConfigSchema, TestCaseConfig } from '../../schemas/testcase.schema.js';
import { resolveEvaluatorConfigs } from '../../lib/evaluator-loader.js';
import { createSpinner } from '../../lib/progress.js';
import * as logger from '../../lib/logger.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';

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
export async function validateCommand(options: ValidateCommandOptions): Promise<void> {
  try {
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
        logger.error(`Configuration file too large: ${configStats.size} bytes (max: ${maxConfigSize})`);
        logger.info('💡 Tip: Test case configuration files should typically be under 10KB');
        process.exit(1);
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
      process.exit(1);
    }

    // Parse YAML
    const yamlSpinner = createSpinner('Parsing YAML...');
    yamlSpinner.start();
    
    let configData: any;
    try {
      configData = yaml.parse(configContent);
      yamlSpinner.succeed('YAML parsed successfully ✓');
    } catch (error) {
      yamlSpinner.fail('YAML parsing failed');
      logger.error('');
      logger.error('❌ Invalid YAML syntax');
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
    const schemaSpinner = createSpinner('Validating configuration schema...');
    schemaSpinner.start();
    
    let testCaseConfig: TestCaseConfig;
    try {
      testCaseConfig = testCaseConfigSchema.parse(configData);
      schemaSpinner.succeed('Schema validation passed ✓');
    } catch (error) {
      schemaSpinner.fail('Schema validation failed');
      
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
        logger.info(`   Expected: ${testCaseConfig.expected_source}:${testCaseConfig.expected}`);
      }
      logger.info('');
    }

    // Check agent configuration
    if (options.verbose) {
      logger.info('🤖 Agent:');
      logger.info(`   Type: ${testCaseConfig.agent.type}`);
      if (testCaseConfig.agent.config?.prompt) {
        const promptLength = testCaseConfig.agent.config.prompt.length;
        logger.info(`   Prompt length: ${promptLength} characters`);
        if (promptLength < 10) {
          logger.warn('   ⚠️  Prompt is very short - consider adding more detail');
        }
      }
      logger.info('');
    }

    // Check evaluators
    logger.info('📊 Evaluators:');
    
    // Resolve evaluator file references first
    const configFileDir = path.dirname(path.resolve(options.config));
    let resolvedEvaluators;
    try {
      resolvedEvaluators = resolveEvaluatorConfigs(testCaseConfig.evaluators, configFileDir);
    } catch (error) {
      logger.error(`Failed to resolve evaluator file references: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    
    const evaluatorNames = resolvedEvaluators.map(e => e.name);
    const uniqueEvaluators = new Set(evaluatorNames);
    
    if (evaluatorNames.length !== uniqueEvaluators.size) {
      logger.warn('   ⚠️  Duplicate evaluators detected (this is usually unintentional)');
    }
    
    evaluatorNames.forEach((name, index) => {
      const config = resolvedEvaluators[index].config;
      const hasConfig = config && Object.keys(config).length > 0;
      logger.info(`   ${index + 1}. ${name}${hasConfig ? ' (configured)' : ''}`);
      
      // Check if expected-diff is used without expected reference
      if (name === 'expected-diff' && !testCaseConfig.expected) {
        logger.warn('      ⚠️  expected-diff evaluator requires expected reference configuration');
      }
      
      // Check if agentic-judge has assertions
      if (name === 'agentic-judge') {
        const assertions = config?.assertions || config?.criteria; // Support both
        if (!assertions || (typeof assertions === 'object' && Object.keys(assertions).length === 0)) {
          logger.warn('      ⚠️  agentic-judge evaluator should have assertions defined');
        } else if (options.verbose && typeof assertions === 'object') {
          logger.info(`      Assertions: ${Object.keys(assertions).length} defined`);
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
    logger.info(`   Evaluators: ${testCaseConfig.evaluators.length} configured`);
    logger.info('');
    logger.info('🚀 Ready to run:');
    logger.info(`   yb run -c ${options.config}`);
    logger.info('');

    process.exit(0);
  } catch (error) {
    logger.error('');
    logger.error('Validation failed:');
    if (error instanceof Error) {
      logger.error(error.message);
      if (options.verbose && error.stack) {
        logger.debug(error.stack);
      }
    }
    process.exit(1);
  }
}
