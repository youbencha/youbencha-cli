/**
 * suggest-suite command - Interactive suite generation using AI agents
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';

/**
 * Register suggest-suite command
 */
export function registerSuggestSuiteCommand(program: Command): void {
  program
    .command('suggest-suite')
    .description('Generate evaluation suite suggestions using AI agent')
    .requiredOption('--agent <type>', 'Agent tool to use (e.g., copilot-cli)')
    .requiredOption('--output-dir <path>', 'Path to successful agent output folder')
    .option('--agent-file <path>', 'Custom agent file path', 'agents/suggest-suite.agent.md')
    .option('--save <path>', 'Path to save generated suite (default: suggested-suite.yaml)')
    .action(async (options) => {
      try {
        await handleSuggestSuite(options);
      } catch (error) {
        logger.error('Suite suggestion failed:', error);
        process.exit(1);
      }
    });
}

/**
 * Handle suggest-suite command execution
 */
async function handleSuggestSuite(options: {
  agent: string;
  outputDir: string;
  agentFile: string;
  save?: string;
}): Promise<void> {
  logger.info('Starting suite suggestion workflow...');

  // Step 1: Validate output directory
  const spinner = createSpinner('Validating output directory...');
  spinner.start();
  try {
    await validateOutputDir(options.outputDir);
    spinner.succeed('Output directory validated');
  } catch (error) {
    spinner.fail(`Invalid output directory: ${(error as Error).message}`);
    throw error;
  }

  // Step 2: Validate agent tool
  const agentSpinner = createSpinner(`Validating ${options.agent} installation...`);
  agentSpinner.start();
  try {
    await validateAgentTool(options.agent);
    agentSpinner.succeed(`${options.agent} is available`);
  } catch (error) {
    agentSpinner.fail(`Agent validation failed: ${(error as Error).message}`);
    throw error;
  }

  // Step 3: Validate agent file
  const fileSpinner = createSpinner('Loading agent workflow file...');
  fileSpinner.start();
  try {
    const agentFilePath = await validateAgentFile(options.agentFile);
    fileSpinner.succeed(`Agent file loaded: ${agentFilePath}`);
  } catch (error) {
    fileSpinner.fail(`Agent file not found: ${(error as Error).message}`);
    throw error;
  }

  // Step 4: Launch agent
  logger.info('\n🤖 Launching interactive agent session...\n');
  logger.info('The agent will guide you through the suite generation process.');
  logger.info('Follow the prompts to provide context about your changes.\n');

  try {
    await launchAgent(options.agent, options.agentFile, options.outputDir);
    logger.info('\n✅ Agent session completed successfully');
  } catch (error) {
    logger.error('\n❌ Agent session failed:', (error as Error).message);
    throw error;
  }

  // Step 5: Provide next steps
  logger.info('\n📋 Next Steps:');
  logger.info('1. Review the generated suite configuration');
  logger.info('2. Save it as suite.yaml in your project');
  logger.info('3. Run: yb run -c suite.yaml');
  logger.info('4. Review evaluation results\n');
}

/**
 * Validate that output directory exists and is readable
 */
async function validateOutputDir(dirPath: string): Promise<void> {
  try {
    const resolvedPath = path.resolve(dirPath);
    const stats = await fs.stat(resolvedPath);
    
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }

    // Try to read directory to ensure it's accessible
    await fs.readdir(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    throw new Error(`Cannot access directory: ${dirPath} - ${(error as Error).message}`);
  }
}

/**
 * Validate that agent tool is installed and available
 */
async function validateAgentTool(agentType: string): Promise<void> {
  const supportedAgents: Record<string, string> = {
    'copilot-cli': 'copilot',
    'aider': 'aider',
    'cursor': 'cursor',
  };

  const command = supportedAgents[agentType];
  if (!command) {
    throw new Error(
      `Unsupported agent type: ${agentType}. Supported: ${Object.keys(supportedAgents).join(', ')}`
    );
  }

  // Check if command is available without shell
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where' : 'which';

    const proc = spawn(checkCmd, [command], {
      stdio: 'ignore',
      shell: false
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `${agentType} is not installed or not in PATH. ` +
          `Please install it first: https://github.com/${agentType}`
        ));
      }
    });

    proc.on('error', () => {
      reject(new Error(`Failed to check for ${agentType} installation`));
    });
  });
}

/**
 * Validate that agent file exists and is readable
 */
async function validateAgentFile(agentFilePath: string): Promise<string> {
  const resolvedPath = path.resolve(agentFilePath);
  
  try {
    await fs.access(resolvedPath, fs.constants.R_OK);
    const stats = await fs.stat(resolvedPath);
    
    if (!stats.isFile()) {
      throw new Error('Path is not a file');
    }

    return resolvedPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Agent file not found: ${agentFilePath}\n` +
        `Please ensure the agent file exists at the specified path.`
      );
    }
    throw error;
  }
}

/**
 * Launch agent tool with agent file
 */
async function launchAgent(
  agentType: string,
  agentFilePath: string,
  outputDir: string
): Promise<void> {
  const resolvedAgentFile = path.resolve(agentFilePath);
  const resolvedOutputDir = path.resolve(outputDir);

  // Read agent file content
  const agentContent = await fs.readFile(resolvedAgentFile, 'utf-8');

  return new Promise((resolve, reject) => {
    let proc;

    switch (agentType) {
      case 'copilot-cli':
        // Launch GitHub Copilot CLI in interactive mode
        // Pass agent instructions and output directory context
        // On Windows, use PowerShell with secure execution policy
        if (process.platform === 'win32') {
          // Use PowerShell with secure execution settings
          // -NoProfile: Don't load PowerShell profiles (prevents executing untrusted profile scripts)
          // -ExecutionPolicy Bypass: Allow script execution for this session only
          // -Command: Execute the command
          // Arguments are properly escaped to prevent injection
          const command = "copilot suggest";
          
          proc = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', command
          ], {
            stdio: 'inherit',
            shell: false,
            cwd: resolvedOutputDir,
            env: {
              ...process.env,
              YOUBENCHA_AGENT_FILE: resolvedAgentFile,
              YOUBENCHA_OUTPUT_DIR: resolvedOutputDir,
              YOUBENCHA_AGENT_INSTRUCTIONS: agentContent
            }
          });
        } else {
          // Unix-like systems can execute scripts directly
          proc = spawn('copilot', ['suggest'], {
            stdio: 'inherit',
            shell: false,
            cwd: resolvedOutputDir,
            env: {
              ...process.env,
              YOUBENCHA_AGENT_FILE: resolvedAgentFile,
              YOUBENCHA_OUTPUT_DIR: resolvedOutputDir,
              YOUBENCHA_AGENT_INSTRUCTIONS: agentContent
            }
          });
        }
        break;

      case 'aider':
        // Launch Aider with agent file as prompt
        proc = spawn('aider', [
          '--message-file', resolvedAgentFile,
          '--yes',  // Auto-approve file edits for agent workflow
          '--no-git'  // Don't auto-commit
        ], {
          stdio: 'inherit',
          shell: false,
          cwd: resolvedOutputDir
        });
        break;

      case 'cursor':
        // Launch Cursor (if API available)
        // For now, provide instructions for manual use
        logger.warn(
          '\n⚠️  Cursor integration not yet implemented.\n' +
          'Please manually:\n' +
          `1. Open Cursor in ${resolvedOutputDir}\n` +
          `2. Start a new chat session\n` +
          `3. Copy and paste the contents of ${resolvedAgentFile}\n` +
          '4. Follow the agent\'s workflow instructions\n'
        );
        resolve();
        return;

      default:
        reject(new Error(`Unsupported agent type: ${agentType}`));
        return;
    }

    if (!proc) {
      reject(new Error('Failed to spawn agent process'));
      return;
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Agent exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to launch agent: ${error.message}`));
    });

    // Handle SIGINT gracefully
    process.on('SIGINT', () => {
      proc?.kill('SIGINT');
      reject(new Error('Agent session interrupted by user'));
    });
  });
}
