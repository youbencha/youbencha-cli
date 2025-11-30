/**
 * Install Agents Command
 * 
 * Standalone command to install agentic-judge agent files for
 * GitHub Copilot CLI and Claude Code.
 */

import * as logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';
import { installAgentFiles } from '../../lib/agent-files.js';

/**
 * Options for install-agents command
 */
interface InstallAgentsCommandOptions {
  force?: boolean;
}

/**
 * Install-agents command handler
 * 
 * Installs agent files for GitHub Copilot CLI and Claude Code.
 * Creates parent directories as needed and handles existing files.
 * 
 * @param options - Command options
 */
export async function installAgentsCommand(options: InstallAgentsCommandOptions): Promise<void> {
  const spinner = createSpinner('Installing agent files...');
  spinner.start();
  
  // Display warning when --force is used
  if (options.force) {
    spinner.stop();
    logger.warn('⚠️  Overwriting existing agent files (--force flag used)');
    logger.info('');
    spinner.start();
  }
  
  const result = await installAgentFiles({ force: options.force });
  spinner.stop();
  
  // Display status for each file
  for (const file of result.files) {
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
  
  logger.info('');
  
  // Display appropriate success/hint messages
  if (result.success) {
    if (result.summary.skipped > 0 && result.summary.created === 0 && result.summary.overwritten === 0) {
      // All files were skipped
      logger.info('ℹ️  Agent files already exist. Use --force to overwrite.');
    } else if (result.summary.skipped > 0) {
      // Some files were created/overwritten, some skipped
      logger.info('✨ Agent files installed successfully!');
      logger.info(`ℹ️  ${result.summary.skipped} file${result.summary.skipped > 1 ? 's' : ''} skipped (use --force to overwrite)`);
    } else if (result.summary.overwritten > 0) {
      // Files were overwritten
      logger.info('✨ Agent files updated successfully!');
    } else {
      // All files were created
      logger.info('✨ Agent files installed successfully!');
      logger.info('');
      logger.info('These files enable the agentic-judge evaluator to work with:');
      logger.info('  - GitHub Copilot CLI');
      logger.info('  - Claude Code');
    }
  } else {
    // Some errors occurred
    logger.error('');
    logger.error('❌ Some agent files could not be installed.');
  }
  
  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}
