/**
 * Script Pre-Execution
 * 
 * Executes a custom script before agent execution.
 * Useful for setup, code preprocessing, environment variable injection, etc.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { PreExecution, PreExecutionContext } from './base.js';
import { PreExecutionResult, ScriptConfig } from '../schemas/pre-execution.schema.js';
import * as logger from '../lib/logger.js';

/**
 * Script Pre-Execution implementation
 */
export class ScriptPreExecution implements PreExecution {
  readonly name = 'script';
  readonly description = 'Executes a custom script before agent execution';

  /**
   * Check if script command is valid
   */
  async checkPreconditions(context: PreExecutionContext): Promise<boolean> {
    const config = context.config as ScriptConfig;
    
    try {
      // Basic validation - command must be non-empty
      if (!config.command || config.command.trim().length === 0) {
        logger.warn('Script command is empty');
        return false;
      }
      return true;
    } catch (error) {
      logger.warn(`Script validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Execute custom script
   */
  async execute(context: PreExecutionContext): Promise<PreExecutionResult> {
    const startTime = Date.now();
    const config = context.config as ScriptConfig;

    try {
      // Replace placeholders in args
      const args = this.replaceVariables(config.args || [], context);

      // Setup environment variables - only include safe, necessary variables
      // Security: Do not inherit all of process.env to avoid leaking sensitive data
      const env = {
        // Safe system variables
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
        // youBencha-specific variables
        WORKSPACE_DIR: context.workspaceDir,
        REPO_DIR: context.repoDir,
        ARTIFACTS_DIR: context.artifactsDir,
        TEST_CASE_NAME: context.testCaseName,
        REPO_URL: context.repoUrl,
        BRANCH: context.branch || '',
        // User-provided environment variables from config
        ...(config.env || {}),
      };

      // Execute script
      const { stdout, stderr, exitCode } = await this.runScript(
        config.command,
        args,
        config.working_dir || context.workspaceDir,
        env,
        config.timeout_ms || 30000
      );

      const duration = Date.now() - startTime;
      const OUTPUT_TRUNCATE_LENGTH = 1000;

      if (exitCode === 0) {
        return {
          pre_executor: this.name,
          status: 'success',
          message: `Script completed successfully`,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
          metadata: {
            command: config.command,
            exit_code: exitCode,
            stdout: stdout.substring(0, OUTPUT_TRUNCATE_LENGTH), // Truncate for metadata
            stderr: stderr.substring(0, OUTPUT_TRUNCATE_LENGTH),
          },
        };
      } else {
        return {
          pre_executor: this.name,
          status: 'failed',
          message: `Script exited with code ${exitCode}`,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
          metadata: {
            command: config.command,
            exit_code: exitCode,
            stdout: stdout.substring(0, OUTPUT_TRUNCATE_LENGTH),
            stderr: stderr.substring(0, OUTPUT_TRUNCATE_LENGTH),
          },
          error: {
            message: `Script exited with code ${exitCode}`,
            stack_trace: stderr,
          },
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        pre_executor: this.name,
        status: 'failed',
        message: 'Failed to execute script',
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack_trace: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Replace variable placeholders in args
   */
  private replaceVariables(args: string[], context: PreExecutionContext): string[] {
    const variables: Record<string, string> = {
      '${WORKSPACE_DIR}': context.workspaceDir,
      '${REPO_DIR}': context.repoDir,
      '${ARTIFACTS_DIR}': context.artifactsDir,
      '${TEST_CASE_NAME}': context.testCaseName,
      '${REPO_URL}': context.repoUrl,
      '${BRANCH}': context.branch || '',
    };

    return args.map((arg) => {
      let result = arg;
      for (const [placeholder, value] of Object.entries(variables)) {
        result = result.replace(placeholder, value);
      }
      return result;
    });
  }

  /**
   * Run script with timeout
   * 
   * Security note: Uses shell: true to support shell features like pipes and redirects.
   * IMPORTANT: Commands must ONLY come from trusted configuration files, NEVER from
   * untrusted user input. youBencha validates that config files are from the repository
   * or trusted sources, not from external/user-provided input.
   * 
   * Shell features enabled:
   * - Pipes (|)
   * - Redirects (>, >>, <)
   * - Environment variable expansion
   * - Command chaining (&&, ||)
   * 
   * Mitigation: 
   * - Commands are from YAML/JSON config files in the repository
   * - Environment variables are controlled and sanitized
   * - Scripts run in isolated workspace directory
   */
  private runScript(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Security note: shell: true is used to support shell features
      // Commands come from trusted config files, not user input
      const child = spawn(command, args, {
        cwd: path.resolve(cwd),
        env,
        shell: true,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        
        // Force kill after 2 seconds
        setTimeout(() => {
          child.kill('SIGKILL');
        }, 2000);
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Display stdout in real-time
        process.stdout.write(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        // Display stderr in real-time
        process.stderr.write(text);
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        
        if (timedOut) {
          reject(new Error(`Script timed out after ${timeoutMs}ms`));
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code || 0,
          });
        }
      });
    });
  }
}
