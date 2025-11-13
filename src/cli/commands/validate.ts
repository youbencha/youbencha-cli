/**
 * Validate Command
 * 
 * Validates a suite configuration file without running the evaluation.
 * Useful for checking syntax and configuration before committing.
 */

import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import { suiteConfigSchema, SuiteConfig } from '../../schemas/suite.schema.js';
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
 * Loads and validates suite configuration, providing detailed feedback.
 */
export async function validateCommand(options: ValidateCommandOptions): Promise<void> {
  try {
    logger.info('Validating suite configuration...');
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
        logger.info('💡 Tip: Suite configuration files should typically be under 10KB');
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
    
    let suiteConfig: SuiteConfig;
    try {
      suiteConfig = suiteConfigSchema.parse(configData);
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

    // Check repository URL accessibility (basic validation)
    if (options.verbose) {
      logger.info('📦 Repository:');
      logger.info(`   URL: ${suiteConfig.repo}`);
      logger.info(`   Branch: ${suiteConfig.branch || 'default'}`);
      if (suiteConfig.expected) {
        logger.info(`   Expected: ${suiteConfig.expected_source}:${suiteConfig.expected}`);
      }
      logger.info('');
    }

    // Check agent configuration
    if (options.verbose) {
      logger.info('🤖 Agent:');
      logger.info(`   Type: ${suiteConfig.agent.type}`);
      if (suiteConfig.agent.config?.prompt) {
        const promptLength = suiteConfig.agent.config.prompt.length;
        logger.info(`   Prompt length: ${promptLength} characters`);
        if (promptLength < 10) {
          logger.warn('   ⚠️  Prompt is very short - consider adding more detail');
        }
      }
      logger.info('');
    }

    // Check evaluators
    logger.info('📊 Evaluators:');
    const evaluatorNames = suiteConfig.evaluators.map(e => e.name);
    const uniqueEvaluators = new Set(evaluatorNames);
    
    if (evaluatorNames.length !== uniqueEvaluators.size) {
      logger.warn('   ⚠️  Duplicate evaluators detected (this is usually unintentional)');
    }
    
    evaluatorNames.forEach((name, index) => {
      const config = suiteConfig.evaluators[index].config;
      const hasConfig = config && Object.keys(config).length > 0;
      logger.info(`   ${index + 1}. ${name}${hasConfig ? ' (configured)' : ''}`);
      
      // Check if expected-diff is used without expected reference
      if (name === 'expected-diff' && !suiteConfig.expected) {
        logger.warn('      ⚠️  expected-diff evaluator requires expected reference configuration');
      }
      
      // Check if agentic-judge has criteria
      if (name === 'agentic-judge') {
        const criteria = config?.criteria;
        if (!criteria || (typeof criteria === 'object' && Object.keys(criteria).length === 0)) {
          logger.warn('      ⚠️  agentic-judge evaluator should have evaluation criteria');
        } else if (options.verbose && typeof criteria === 'object') {
          logger.info(`      Criteria: ${Object.keys(criteria).length} defined`);
        }
      }
    });
    logger.info('');

    // Summary
    logger.info('');
    logger.info('✅ Configuration is valid!');
    logger.info('');
    logger.info('📋 Summary:');
    logger.info(`   Repository: ${suiteConfig.repo}`);
    logger.info(`   Agent: ${suiteConfig.agent.type}`);
    logger.info(`   Evaluators: ${suiteConfig.evaluators.length} configured`);
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
