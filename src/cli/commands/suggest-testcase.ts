/**
 * suggest-testcase command - Interactive test case generation using AI agents
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';

/**
 * Register suggest-testcase command
 */
export function registerSuggestTestCaseCommand(program: Command): void {
  program
    .command('suggest-testcase')
    .description('Generate test case suggestions using AI agent')
    .requiredOption('--agent <type>', 'Agent tool to use (e.g., copilot-cli)')
    .option('--spec <path>', 'Path to specification or task description file (.md, .txt, .yaml)')
    .option('--output-dir <path>', 'Path to successful agent output folder (optional context)')
    .option('--agent-file <path>', 'Custom agent file path', 'agents/suggest-testcase.agent.md')
    .option('--save <path>', 'Path to save generated test case (default: suggested-testcase.yaml)')
    .addHelpText('after', `
Examples:
  $ yb suggest-testcase --agent copilot-cli --spec feature-spec.md
  $ yb suggest-testcase --agent copilot-cli --spec spec.md --output-dir ./completed-output
  $ yb suggest-testcase --agent copilot-cli --output-dir ./completed-output

Workflow:
  1. Provide a spec file (--spec) to generate a testcase from requirements
  2. Optionally provide --output-dir to give the agent context from existing output
  3. The AI agent will guide you through creating a testcase.yaml
  4. Save the generated testcase and run it with: yb run -c testcase.yaml
    `)
    .action(async (options: SuggestTestCaseOptions) => {
      try {
        await handleSuggestTestCase(options);
      } catch (error) {
        logger.error('Test case suggestion failed:', error);
        process.exit(1);
      }
    });
}

/**
 * Options type for suggest-testcase command
 */
interface SuggestTestCaseOptions {
  agent: string;
  spec?: string;
  outputDir?: string;
  agentFile: string;
  save?: string;
}

/**
 * Handle suggest-testcase command execution
 */
async function handleSuggestTestCase(options: SuggestTestCaseOptions): Promise<void> {
  // Require at least --spec or --output-dir
  if (!options.spec && !options.outputDir) {
    logger.error('Please provide either --spec <path> or --output-dir <path> (or both).');
    logger.info('  --spec <path>       Path to your spec or task description file');
    logger.info('  --output-dir <path> Path to existing agent output for context');
    process.exit(1);
  }

  logger.info('Starting test case suggestion workflow...');

  // Step 1: Validate and read spec file (if provided)
  let specContent: string | undefined;
  if (options.spec) {
    const specSpinner = createSpinner('Loading spec file...');
    specSpinner.start();
    try {
      specContent = await readSpecFile(options.spec);
      specSpinner.succeed(`Spec loaded: ${options.spec}`);
    } catch (error) {
      specSpinner.fail(`Failed to load spec: ${(error as Error).message}`);
      throw error;
    }
  }

  // Step 2: Validate output directory (if provided)
  if (options.outputDir) {
    const spinner = createSpinner('Validating output directory...');
    spinner.start();
    try {
      await validateOutputDir(options.outputDir);
      spinner.succeed('Output directory validated');
    } catch (error) {
      spinner.fail(`Invalid output directory: ${(error as Error).message}`);
      throw error;
    }
  }

  // Step 3: Validate agent tool
  const agentSpinner = createSpinner(`Validating ${options.agent} installation...`);
  agentSpinner.start();
  try {
    await validateAgentTool(options.agent);
    agentSpinner.succeed(`${options.agent} is available ✓`);
  } catch (error) {
    agentSpinner.fail(`Agent validation failed`);
    console.log(formatUserError(UserErrors.agentNotInstalled(options.agent)));
    throw error;
  }

  // Step 4: Validate agent file
  const fileSpinner = createSpinner('Loading agent workflow file...');
  fileSpinner.start();
  try {
    const agentFilePath = await validateAgentFile(options.agentFile);
    fileSpinner.succeed(`Agent file loaded: ${agentFilePath}`);
  } catch (error) {
    fileSpinner.fail(`Agent file not found: ${(error as Error).message}`);
    throw error;
  }

  // Step 5: Launch agent
  logger.info('\n🤖 Launching interactive agent session...\n');
  if (specContent) {
    logger.info('The agent will convert your spec into a testcase.yaml configuration.');
  } else {
    logger.info('The agent will guide you through the test case generation process.');
  }
  logger.info('Follow the prompts to provide context about your changes.\n');

  const workingDir = options.outputDir ?? process.cwd();
  try {
    await launchAgent(options.agent, options.agentFile, workingDir, specContent);
    logger.info('\n✅ Agent session completed successfully');
  } catch (error) {
    logger.error('\n❌ Agent session failed:', (error as Error).message);
    throw error;
  }

  // Step 6: Provide next steps
  logger.info('\n📋 Next Steps:');
  logger.info('1. Review the generated test case configuration');
  logger.info('2. Save it as testcase-<description>.yaml in your project');
  logger.info('3. Run: yb run -c testcase-<description>.yaml');
  logger.info('4. Review evaluation results\n');
}

/**
 * Read and validate a spec file
 */
async function readSpecFile(specPath: string): Promise<string> {
  const resolvedPath = path.resolve(specPath);

  try {
    await fs.access(resolvedPath, fs.constants.R_OK);
    const stats = await fs.stat(resolvedPath);

    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${specPath}`);
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    if (!content.trim()) {
      throw new Error(`Spec file is empty: ${specPath}`);
    }

    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Spec file not found: ${specPath}`);
    }
    throw error;
  }
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
  workingDir: string,
  specContent?: string
): Promise<void> {
  const resolvedAgentFile = path.resolve(agentFilePath);
  const resolvedWorkingDir = path.resolve(workingDir);

  // Read agent file content
  const agentContent = await fs.readFile(resolvedAgentFile, 'utf-8');

  // Build environment with optional spec content
  const agentEnv: NodeJS.ProcessEnv = {
    ...process.env,
    YOUBENCHA_AGENT_FILE: resolvedAgentFile,
    YOUBENCHA_OUTPUT_DIR: resolvedWorkingDir,
    YOUBENCHA_AGENT_INSTRUCTIONS: agentContent,
  };
  if (specContent !== undefined) {
    agentEnv['YOUBENCHA_SPEC_CONTENT'] = specContent;
  }

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
            cwd: resolvedWorkingDir,
            env: agentEnv
          });
        } else {
          // Unix-like systems can execute scripts directly
          proc = spawn('copilot', ['suggest'], {
            stdio: 'inherit',
            shell: false,
            cwd: resolvedWorkingDir,
            env: agentEnv
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
          cwd: resolvedWorkingDir,
          env: agentEnv
        });
        break;

      case 'cursor':
        // Launch Cursor (if API available)
        // For now, provide instructions for manual use
        logger.warn(
          '\n⚠️  Cursor integration not yet implemented.\n' +
          'Please manually:\n' +
          `1. Open Cursor in ${resolvedWorkingDir}\n` +
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
