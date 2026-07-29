/**
 * suggest-testcase command - Interactive test case generation using AI agents
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn } from 'child_process';
import logger from '../../lib/logger.js';
import { createSpinner } from '../../lib/progress.js';
import { UserErrors, formatUserError } from '../../lib/user-errors.js';
import { resolveCliExecutable, runCliProcess } from '../../lib/cli-process.js';

/**
 * Register suggest-testcase command
 */
export function registerSuggestTestCaseCommand(program: Command): void {
  program
    .command('suggest-testcase')
    .description('Generate test case suggestions using AI agent')
    .requiredOption('--agent <type>', 'Agent tool to use (e.g., copilot-cli)')
    .requiredOption(
      '--output-dir <path>',
      'Path to successful agent output folder'
    )
    .option(
      '--agent-file <path>',
      'Custom agent file path',
      'agents/suggest-suite.agent.md'
    )
    .option(
      '--save <path>',
      'Path to save generated test case (default: suggested-testcase.yaml)'
    )
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
export interface SuggestTestCaseOptions {
  agent: string;
  outputDir: string;
  agentFile: string;
  save?: string;
}

/**
 * Handle suggest-testcase command execution
 */
export async function handleSuggestTestCase(
  options: SuggestTestCaseOptions
): Promise<void> {
  logger.info('Starting test case suggestion workflow...');

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
  const agentSpinner = createSpinner(
    `Validating ${options.agent} installation...`
  );
  agentSpinner.start();
  try {
    await validateAgentTool(options.agent);
    agentSpinner.succeed(`${options.agent} is available ✓`);
  } catch (error) {
    agentSpinner.fail(`Agent validation failed`);
    console.log(formatUserError(UserErrors.agentNotInstalled(options.agent)));
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
  const isHeadless = options.agent === 'codex-cli';
  logger.info(
    isHeadless
      ? '\n🤖 Launching headless Codex suggestion...\n'
      : '\n🤖 Launching interactive agent session...\n'
  );
  logger.info(
    isHeadless
      ? 'Codex will inspect the output directory and produce a best-effort suite without prompting.'
      : 'The agent will guide you through the test case generation process.'
  );
  if (!isHeadless) {
    logger.info('Follow the prompts to provide context about your changes.\n');
  }

  try {
    await launchAgent(
      options.agent,
      options.agentFile,
      options.outputDir,
      options.save
    );
    logger.info('\n✅ Agent session completed successfully');
  } catch (error) {
    logger.error('\n❌ Agent session failed:', (error as Error).message);
    throw error;
  }

  // Step 5: Provide next steps
  logger.info('\n📋 Next Steps:');
  logger.info('1. Review the generated test case configuration');
  logger.info('2. Save it as testcase-<description>.yaml in your project');
  logger.info('3. Run: yb run -c testcase-<description>.yaml');
  logger.info('4. Review evaluation results\n');
}

/**
 * Validate that output directory exists and is readable
 */
export async function validateOutputDir(dirPath: string): Promise<void> {
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
    throw new Error(
      `Cannot access directory: ${dirPath} - ${(error as Error).message}`
    );
  }
}

/**
 * Validate that agent tool is installed and available
 */
export async function validateAgentTool(agentType: string): Promise<void> {
  const supportedAgents: Record<string, string> = {
    'copilot-cli': 'copilot',
    'codex-cli': 'codex',
    aider: 'aider',
    cursor: 'cursor',
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
      shell: false,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${agentType} is not installed or not in PATH. ` +
              `Please install it first: https://github.com/${agentType}`
          )
        );
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
export async function validateAgentFile(
  agentFilePath: string
): Promise<string> {
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
export async function launchAgent(
  agentType: string,
  agentFilePath: string,
  outputDir: string,
  savePath?: string
): Promise<void> {
  const resolvedAgentFile = path.resolve(agentFilePath);
  const resolvedOutputDir = path.resolve(outputDir);

  // Read agent file content
  const agentContent = await fs.readFile(resolvedAgentFile, 'utf-8');

  if (agentType === 'codex-cli') {
    const maxSuggestionBytes = 1024 * 1024;
    const environment = { ...process.env };
    const executable = await resolveCliExecutable('codex', {
      env: environment,
    });
    if (!executable) {
      throw new Error('codex-cli is not installed or not in PATH');
    }
    const artifactDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-codex-suggest-')
    );
    try {
      const stdoutArtifactPath = path.join(
        artifactDirectory,
        'codex-stdout.log'
      );
      const headlessPrompt = `${agentContent.trim()}

## Headless execution requirements

Run this workflow non-interactively. Do not ask the user questions. Inspect the
current working directory, make reasonable best-effort assumptions from the
available files, and return only one complete youBencha YAML configuration
without Markdown fences or explanatory prose.
`;
      const result = await runCliProcess({
        executable,
        args: [
          '--ask-for-approval',
          'never',
          'exec',
          '--sandbox',
          'workspace-write',
          '--ephemeral',
          '--ignore-user-config',
          '-C',
          resolvedOutputDir,
          '-',
        ],
        cwd: resolvedOutputDir,
        env: environment,
        stdin: headlessPrompt,
        timeoutMs: 600_000,
        maxCapturedOutputBytes: maxSuggestionBytes,
        maxArtifactOutputBytes: maxSuggestionBytes,
        artifactRedactions: credentialEnvironmentValues(environment),
        stdoutArtifactPath,
        stderrArtifactPath: path.join(artifactDirectory, 'codex-stderr.log'),
      });
      if (result.error) {
        throw new Error('Codex test-case suggestion could not be completed');
      }
      if (result.timedOut) {
        throw new Error(
          'Codex test-case suggestion timed out after 10 minutes'
        );
      }
      if (result.exitCode !== 0) {
        throw new Error(
          `Codex test-case suggestion exited with code ${result.exitCode ?? 'unknown'}; run "codex login status" and retry`
        );
      }
      if (result.stdoutArtifactTruncated) {
        throw new Error(
          `Codex test-case suggestion exceeded the ${maxSuggestionBytes}-byte output limit`
        );
      }
      const suggestion = (await fs.readFile(stdoutArtifactPath, 'utf8')).trim();
      if (!suggestion) {
        throw new Error(
          'Codex test-case suggestion completed without returning a configuration'
        );
      }
      if (savePath) {
        const resolvedSavePath = path.resolve(savePath);
        await fs.writeFile(resolvedSavePath, `${suggestion}\n`, 'utf8');
        logger.info(`Saved Codex suggestion to ${resolvedSavePath}`);
      }
      logger.info(`\n${suggestion}\n`);
    } finally {
      await fs.rm(artifactDirectory, { recursive: true, force: true });
    }
    return;
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
          const command = 'copilot suggest';

          proc = spawn(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
            {
              stdio: 'inherit',
              shell: false,
              cwd: resolvedOutputDir,
              env: {
                ...process.env,
                YOUBENCHA_AGENT_FILE: resolvedAgentFile,
                YOUBENCHA_OUTPUT_DIR: resolvedOutputDir,
                YOUBENCHA_AGENT_INSTRUCTIONS: agentContent,
              },
            }
          );
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
              YOUBENCHA_AGENT_INSTRUCTIONS: agentContent,
            },
          });
        }
        break;

      case 'aider':
        // Launch Aider with agent file as prompt
        proc = spawn(
          'aider',
          [
            '--message-file',
            resolvedAgentFile,
            '--yes', // Auto-approve file edits for agent workflow
            '--no-git', // Don't auto-commit
          ],
          {
            stdio: 'inherit',
            shell: false,
            cwd: resolvedOutputDir,
          }
        );
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
            "4. Follow the agent's workflow instructions\n"
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

export function credentialEnvironmentValues(
  environment: NodeJS.ProcessEnv
): string[] {
  return Object.entries(environment)
    .filter(
      ([key, value]) =>
        Boolean(value) &&
        /(token|secret|password|api[_-]?key|authorization)/i.test(key)
    )
    .map(([, value]) => value as string);
}
