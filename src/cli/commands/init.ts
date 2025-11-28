/**
 * Init Command
 * 
 * Creates a starter testcase.yaml configuration in the current directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';

/**
 * Starter test case template
 */
const STARTER_TESTCASE = `# youBencha Test Case Configuration
# Learn more: https://github.com/youbencha/youbencha-cli

# Test case metadata
name: "Welcome Message Addition"
description: "Tests the agent's ability to add a friendly welcome message to the README file"

# Repository to evaluate
repo: https://github.com/youbencha/hello-world.git
branch: main

# Optional: Compare against a reference implementation
# expected_source: branch
# expected: feature/completed-implementation

# Agent configuration
agent:
  type: copilot-cli  # Currently the only supported agent
  config:
    prompt: |
      Add a friendly welcome message to the README file.
      Keep it short and welcoming.

# Evaluators - how to measure quality
evaluators:
  # Measures scope: files changed, lines added/removed
  - name: git-diff
  
  # Optional: Compares output to reference implementation
  # - name: expected-diff
  #   config:
  #     threshold: 0.85  # 85% similarity required to pass
  
  # Uses AI to evaluate quality based on your assertions
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      
      # Define success assertions (keys become metric names)
      assertions:
        readme_modified: "The README.md file was modified. Score 1 if true, 0 if false."
        message_is_friendly: "A friendly welcome message was added. Score 1 if friendly and clear, 0.5 if present but unclear, 0 if absent."
        no_markdown_errors: "The markdown is valid with no syntax errors. Score 1 if valid, 0 if broken."

# Next steps:
# 1. Update the repo and prompt for your use case
# 2. Customize the evaluation assertions
# 3. Run: yb run -c testcase.yaml
# 4. View results: yb report --from .youbencha-workspace/run-*/artifacts/results.json
`;

/**
 * Options for init command
 */
interface InitCommandOptions {
  force?: boolean;
}

/**
 * Init command handler
 * 
 * Creates a testcase.yaml file in the current directory.
 */
export async function initCommand(options: InitCommandOptions): Promise<void> {
  const outputPath = path.join(process.cwd(), 'testcase.yaml');
  
  try {
    // Check if file already exists
    const spinner = createSpinner('Checking for existing testcase.yaml...');
    spinner.start();
    
    try {
      await fs.access(outputPath);
      // File exists
      spinner.stop();
      
      if (!options.force) {
        logger.error('');
        logger.error('❌ testcase.yaml already exists in this directory');
        logger.info('');
        logger.info('💡 Options:');
        logger.info('   - Use a different directory');
        logger.info('   - Rename the existing file');
        logger.info('   - Run with --force to overwrite (destructive!)');
        logger.info('');
        process.exit(1);
      }
      
      logger.warn('⚠️  Overwriting existing testcase.yaml (--force flag used)');
    } catch {
      // File doesn't exist, continue
      spinner.stop();
    }
    
    // Write the file
    const writeSpinner = createSpinner('Creating testcase.yaml...');
    writeSpinner.start();
    
    await fs.writeFile(outputPath, STARTER_TESTCASE, 'utf-8');
    
    writeSpinner.succeed('Created testcase.yaml ✓');
    
    logger.info('');
    logger.info('✨ Starter configuration created successfully!');
    logger.info('');
    logger.info('📋 What\'s in testcase.yaml:');
    logger.info('   - Example repository (Hello-World)');
    logger.info('   - Sample prompt for the agent');
    logger.info('   - Two evaluators: git-diff and agentic-judge');
    logger.info('   - Comments explaining each section');
    logger.info('');
    logger.info('📝 Next Steps:');
    logger.info('   1. Edit testcase.yaml to match your use case');
    logger.info('   2. Update the repo, prompt, and evaluation assertions');
    logger.info('   3. Run: yb run -c testcase.yaml');
    logger.info('   4. View results: yb report --from .youbencha-workspace/run-*/artifacts/results.json');
    logger.info('');
    logger.info('💡 Tips:');
    logger.info('   - See examples/ directory for more configurations');
    logger.info('   - Run "yb list" to see available evaluators');
    logger.info('   - Check GETTING-STARTED.md for detailed guide');
    logger.info('');
    
    process.exit(0);
  } catch (error) {
    logger.error('Failed to create testcase.yaml:');
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}
