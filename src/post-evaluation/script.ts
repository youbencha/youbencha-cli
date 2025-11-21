/**
 * Script Post-Evaluation
 * 
 * Executes a custom script with access to evaluation results.
 * Useful for custom analysis, integrations, or post-processing.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { PostEvaluation, PostEvaluationContext } from './base.js';
import { PostEvaluationResult, ScriptConfig } from '../schemas/post-evaluation.schema.js';
import * as logger from '../lib/logger.js';

/**
 * Script Post-Evaluation implementation
 */
export class ScriptPostEvaluation implements PostEvaluation {
  readonly name = 'script';
  readonly description = 'Executes a custom script with access to evaluation results';

  /**
   * Check if script exists and is executable
   */
  async checkPreconditions(context: PostEvaluationContext): Promise<boolean> {
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
  async execute(context: PostEvaluationContext): Promise<PostEvaluationResult> {
    const startTime = Date.now();
    const config = context.config as ScriptConfig;

    try {
      // Replace placeholders in args
      const args = this.replaceVariables(config.args || [], context);

      // Setup environment variables
      const env = {
        ...process.env,
        RESULTS_PATH: context.resultsBundlePath,
        ARTIFACTS_DIR: context.artifactsDir,
        WORKSPACE_DIR: context.workspaceDir,
        TEST_CASE_NAME: context.resultsBundle.test_case.name,
        OVERALL_STATUS: context.resultsBundle.summary.overall_status,
        ...(config.env || {}),
      };

      // Execute script
      const { stdout, stderr, exitCode } = await this.runScript(
        config.command,
        args,
        config.working_dir || process.cwd(),
        env,
        config.timeout_ms || 30000
      );

      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        return {
          post_evaluator: this.name,
          status: 'success',
          message: `Script completed successfully`,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
          metadata: {
            command: config.command,
            exit_code: exitCode,
            stdout: stdout.substring(0, 1000), // Truncate for metadata
            stderr: stderr.substring(0, 1000),
          },
        };
      } else {
        return {
          post_evaluator: this.name,
          status: 'failed',
          message: `Script exited with code ${exitCode}`,
          duration_ms: duration,
          timestamp: new Date().toISOString(),
          metadata: {
            command: config.command,
            exit_code: exitCode,
            stdout: stdout.substring(0, 1000),
            stderr: stderr.substring(0, 1000),
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
        post_evaluator: this.name,
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
  private replaceVariables(args: string[], context: PostEvaluationContext): string[] {
    const variables: Record<string, string> = {
      '${RESULTS_PATH}': context.resultsBundlePath,
      '${ARTIFACTS_DIR}': context.artifactsDir,
      '${WORKSPACE_DIR}': context.workspaceDir,
      '${TEST_CASE_NAME}': context.resultsBundle.test_case.name,
      '${OVERALL_STATUS}': context.resultsBundle.summary.overall_status,
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
   * Note: Uses shell: true to support shell features like pipes and redirects.
   * Only use with trusted commands from configuration files.
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
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
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
