/**
 * Init Command
 *
 * Creates a starter testcase.yaml configuration in the current directory.
 * Also installs agent files for GitHub Copilot CLI and Claude Code.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';
import { installAgentFiles } from '../../lib/agent-files.js';
import { MINIMAL_EVAL, STARTER_TESTCASE } from '../init-templates.js';

/**
 * Options for init command
 */
interface InitCommandOptions {
  force?: boolean;
  minimal?: boolean;
}

/**
 * Init command handler
 *
 * Creates a testcase.yaml file in the current directory.
 */
export async function initCommand(options: InitCommandOptions): Promise<void> {
  const outputFilename = options.minimal ? 'eval.yaml' : 'testcase.yaml';
  const outputPath = path.join(process.cwd(), outputFilename);

  try {
    // Check if file already exists
    const spinner = createSpinner(`Checking for existing ${outputFilename}...`);
    spinner.start();

    try {
      await fs.access(outputPath);
      // File exists
      spinner.stop();

      if (!options.force) {
        logger.error('');
        logger.error(`❌ ${outputFilename} already exists in this directory`);
        logger.info('');
        logger.info('💡 Options:');
        logger.info('   - Use a different directory');
        logger.info('   - Rename the existing file');
        logger.info('   - Run with --force to overwrite (destructive!)');
        logger.info('');
        process.exit(1);
      }

      logger.warn(
        `⚠️  Overwriting existing ${outputFilename} (--force flag used)`
      );
    } catch {
      // File doesn't exist, continue
      spinner.stop();
    }

    // Write the file
    const writeSpinner = createSpinner(`Creating ${outputFilename}...`);
    writeSpinner.start();

    await fs.writeFile(
      outputPath,
      options.minimal ? MINIMAL_EVAL : STARTER_TESTCASE,
      'utf-8'
    );

    writeSpinner.succeed(`Created ${outputFilename} ✓`);

    if (!options.minimal) {
      // Agent files are only needed by the agentic-judge evaluator.
      const agentSpinner = createSpinner('Installing agent files...');
      agentSpinner.start();

      const agentResult = await installAgentFiles({ force: options.force });
      agentSpinner.stop();

      // Display status for each agent file
      for (const file of agentResult.files) {
        switch (file.status) {
          case 'created':
            logger.info(`✓ Created ${file.file}`);
            break;
          case 'skipped':
            logger.info(`- Skipped ${file.file} (already exists)`);
            break;
          case 'overwritten':
            logger.info(`✓ Overwritten ${file.file}`);
            break;
          case 'error':
            logger.error(`✗ Failed ${file.file}`);
            if (file.error) {
              logger.error(`  Error: ${file.error}`);
            }
            break;
        }
      }
    }

    logger.info('');
    logger.info('✨ Starter configuration created successfully!');
    logger.info('');
    logger.info(`📋 What's in ${outputFilename}:`);
    if (options.minimal) {
      logger.info('   - Current working tree as the evaluation target');
      logger.info('   - One objective evaluator: git-diff');
    } else {
      logger.info('   - Example repository (Hello-World)');
      logger.info('   - Sample prompt for the agent');
      logger.info('   - Two evaluators: git-diff and agentic-judge');
    }
    logger.info('   - Comments explaining each section');
    logger.info('');
    if (!options.minimal) {
      logger.info('🤖 Agent files installed:');
      logger.info(
        '   - .github/agents/agentic-judge.md (for GitHub Copilot CLI)'
      );
      logger.info('   - .claude/agents/agentic-judge.md (for Claude Code)');
      logger.info('');
    } else {
      logger.info(
        'ℹ️  Minimal mode does not clone or run an agent and does not use an AI judge.'
      );
      logger.info('   It only needs Node.js, Git, and a Git working tree.');
      logger.info('');
    }
    logger.info('📝 Next Steps:');
    if (options.minimal) {
      logger.info('   1. Make an uncommitted change in this Git repository');
      logger.info('   2. Run: yb doctor');
      logger.info('   3. Run: yb eval -c eval.yaml');
    } else {
      logger.info('   1. Edit testcase.yaml to match your use case');
      logger.info('   2. Run: yb doctor');
      logger.info('   3. Validate: yb validate -c testcase.yaml');
      logger.info('   4. Run: yb run -c testcase.yaml');
    }
    logger.info('');
    logger.info('💡 Tips:');
    logger.info('   - See examples/ directory for more configurations');
    logger.info('   - Run "yb list" to see available evaluators');
    logger.info('   - Check docs/GETTING-STARTED.md for the detailed guide');
    logger.info('');

    process.exit(0);
  } catch (error) {
    logger.error(`Failed to create ${outputFilename}:`);
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}
