/**
 * Claude Code Adapter
 * 
 * Integrates Claude Code CLI as an agent for youBencha evaluations.
 * Handles execution, output capture, and log normalization.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream, readFileSync, existsSync } from 'fs';
import {
  AgentAdapter,
  AgentExecutionContext,
  AgentExecutionResult,
} from './base.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import { stripAnsiCodes, escapeShellArg, isPathSafe } from '../lib/shell-utils.js';

const execAsync = promisify(exec);

// Maximum output size in bytes (10MB)
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/**
 * Claude Code adapter implementation
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly version = '1.0.0';

  /**
   * Check if Claude Code CLI is available and authenticated
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check if claude is in PATH
      const command = process.platform === 'win32'
        ? 'where claude'
        : 'which claude';

      await execAsync(command);

      // Verify Claude Code works by checking version
      const { stderr } = await execAsync('claude --version');

      // Check for authentication errors in stderr
      if (stderr && (stderr.includes('auth') || stderr.includes('API key'))) {
        throw new Error(
          'Claude Code requires authentication. Run "claude /login" or set ANTHROPIC_API_KEY environment variable.'
        );
      }

      return true;
    } catch (error) {
      // If the error is about authentication, rethrow it
      if (error instanceof Error && error.message.includes('Claude Code requires authentication')) {
        throw error;
      }
      // Otherwise, Claude CLI is not available
      return false;
    }
  }

  /**
   * Execute Claude Code CLI with given context
   */
  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    let output = '';
    let exitCode = 0;
    let status: 'success' | 'failed' | 'timeout' = 'success';
    const errors: Array<{ message: string; timestamp: string; stackTrace?: string }> = [];

    try {
      // Ensure claude-code-logs directory exists
      const claudeLogsDir = path.join(context.artifactsDir, 'claude-code-logs');
      await fs.mkdir(claudeLogsDir, { recursive: true });

      // Create a log file path for terminal output
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const terminalLogPath = path.join(claudeLogsDir, `terminal-output-${timestamp}.log`);

      // Build Claude command
      const { command, args } = this.buildClaudeCommand(context);

      // Log the command being executed for debugging
      console.log('[DEBUG] Claude Code CLI Command:');
      console.log(`  Command: ${command}`);
      console.log(`  Args: ${JSON.stringify(args)}`);
      console.log(`  CWD: ${context.workspaceDir}`);
      console.log(`  Terminal output log: ${terminalLogPath}`);

      // Execute Claude with timeout
      const result = await this.executeWithTimeout(
        command,
        args,
        context.workspaceDir,
        context.env,
        context.timeout,
        terminalLogPath
      );

      output = result.output;
      exitCode = result.exitCode;

      if (result.timedOut) {
        status = 'timeout';
        errors.push({
          message: `Execution timed out after ${context.timeout}ms`,
          timestamp: new Date().toISOString(),
        });
      } else if (result.truncated) {
        // Output was truncated due to size limit
        errors.push({
          message: `Output exceeded ${MAX_OUTPUT_SIZE / (1024 * 1024)}MB limit and was truncated`,
          timestamp: new Date().toISOString(),
        });
        if (exitCode !== 0) {
          status = 'failed';
          errors.push({
            message: `Claude Code exited with code ${exitCode}`,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (exitCode !== 0) {
        status = 'failed';
        errors.push({
          message: `Claude Code exited with code ${exitCode}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      status = 'failed';
      exitCode = 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      errors.push({
        message: errorMessage,
        timestamp: new Date().toISOString(),
        stackTrace,
      });

      output = errorMessage;
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    return {
      exitCode,
      status,
      output,
      startedAt,
      completedAt,
      durationMs,
      errors,
    };
  }

  /**
   * Transform Claude Code output to youBencha Log format
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    // Strip ANSI codes for parsing
    const cleanOutput = stripAnsiCodes(rawOutput);

    // Parse Claude output to extract messages and tool calls
    const messages = this.parseMessages(cleanOutput, result);

    // Extract usage metrics from output if available
    const usage = this.extractUsageMetrics(cleanOutput);

    // Build environment context
    const environment = {
      os: `${os.platform()}-${os.arch()}`,
      node_version: process.version,
      youbencha_version: this.getYouBenchaVersion(),
      working_directory: process.cwd(),
    };

    // Detect model and version from output
    const model = this.parseModel(cleanOutput);
    const version = this.parseVersion(cleanOutput);

    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version: version,
        adapter_version: this.version,
      },
      model: {
        name: model,
        provider: 'Anthropic',
        parameters: {
          temperature: 0.0, // Default Claude parameters
        },
      },
      execution: {
        started_at: result.startedAt,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        exit_code: result.exitCode,
        status: result.status,
      },
      messages,
      usage,
      errors: result.errors.map(err => ({
        message: err.message,
        timestamp: err.timestamp,
        stack_trace: err.stackTrace,
      })),
      environment,
    };
  }

  /**
   * Build Claude Code command with proper platform handling
   */
  private buildClaudeCommand(
    context: AgentExecutionContext
  ): { command: string; args: string[] } {
    let prompt: string | undefined;

    // Handle prompt_file vs prompt
    const promptFile = context.config.prompt_file as string | undefined;
    const inlinePrompt = context.config.prompt as string | undefined;

    // Validate mutual exclusivity
    if (promptFile && inlinePrompt) {
      throw new Error(
        'Cannot specify both "prompt" and "prompt_file". Please use only one.'
      );
    }

    if (promptFile) {
      // Validate path safety
      if (!isPathSafe(promptFile)) {
        throw new Error(
          `Invalid prompt_file path "${promptFile}". Path must be relative and not contain path traversal.`
        );
      }

      // Resolve path relative to workspace
      const resolvedPath = path.resolve(context.workspaceDir, promptFile);

      // Check file exists
      if (!existsSync(resolvedPath)) {
        throw new Error(
          `Prompt file not found: ${promptFile}. Expected at ${resolvedPath}`
        );
      }

      // Read prompt content
      prompt = readFileSync(resolvedPath, 'utf-8');
    } else {
      prompt = inlinePrompt;
    }

    if (!prompt) {
      throw new Error(
        'One of "prompt" or "prompt_file" is required in agent config'
      );
    }

    // Build base args - use print mode for non-interactive execution
    const args = ['-p', prompt];

    // Add model if specified
    const model = context.config.model as string | undefined;
    if (model) {
      args.push('--model', model);
    }

    // Add agent if specified (agent_name maps to --agents flag per research.md)
    const agentName = context.config.agent_name as string | undefined;
    if (agentName) {
      args.push('--agents', agentName);
    }

    // Add append_system_prompt if specified
    const appendSystemPrompt = context.config.append_system_prompt as string | undefined;
    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }

    // Add permission_mode if specified
    const permissionMode = context.config.permission_mode as string | undefined;
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
    }

    // Add allowed_tools if specified
    const allowedTools = context.config.allowed_tools as string[] | undefined;
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    // Add max_tokens if specified
    const maxTokens = context.config.max_tokens as number | undefined;
    if (maxTokens !== undefined) {
      args.push('--max-tokens', String(maxTokens));
    }

    // On Windows, we may need to use PowerShell for proper command execution
    // But first, try direct execution which is safer
    if (process.platform === 'win32') {
      // For Windows, use PowerShell to invoke Claude
      const escapedArgs = args.map(arg => escapeShellArg(arg, 'powershell'));
      const claudeCommand = `& claude ${escapedArgs.join(' ')}`;

      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', claudeCommand],
      };
    }

    // Unix-like systems can execute scripts directly
    return {
      command: 'claude',
      args: args,
    };
  }

  /**
   * Execute command with timeout support and output size limiting
   */
  private async executeWithTimeout(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number,
    logFilePath?: string
  ): Promise<{ output: string; exitCode: number; timedOut: boolean; truncated: boolean }> {
    return new Promise((resolve) => {
      let output = '';
      let outputSize = 0;
      let timedOut = false;
      let truncated = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Create write stream for terminal output log if path provided
      const logStream = logFilePath
        ? createWriteStream(logFilePath, { encoding: 'utf8' })
        : null;

      const childProcess = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell: false,
      });

      // Set timeout if specified
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          childProcess.kill('SIGTERM');

          // Force kill after 5 seconds if still running
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }, timeout);
      }

      // Capture stdout and stderr with size limiting
      const handleData = (data: Buffer): void => {
        const text = data.toString();
        const textSize = Buffer.byteLength(text, 'utf8');

        // Check if we've exceeded the output limit
        if (outputSize + textSize > MAX_OUTPUT_SIZE) {
          if (!truncated) {
            truncated = true;
            const remaining = MAX_OUTPUT_SIZE - outputSize;
            const partial = text.substring(0, remaining);
            output += partial;
            output += `\n[OUTPUT TRUNCATED: Exceeded ${MAX_OUTPUT_SIZE / (1024 * 1024)}MB limit]`;
            outputSize = MAX_OUTPUT_SIZE;
          }
        } else {
          output += text;
          outputSize += textSize;
        }

        // Stream to console in real-time
        process.stdout.write(text);

        // Write to log file
        if (logStream) {
          logStream.write(text);
        }
      };

      childProcess.stdout?.on('data', handleData);
      childProcess.stderr?.on('data', handleData);

      childProcess.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (logStream) {
          logStream.end(() => {
            resolve({
              output: output + '\n' + error.message,
              exitCode: 1,
              timedOut,
              truncated,
            });
          });
        } else {
          resolve({
            output: output + '\n' + error.message,
            exitCode: 1,
            timedOut,
            truncated,
          });
        }
      });

      childProcess.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (logStream) {
          logStream.end(() => {
            resolve({
              output,
              exitCode: code ?? 1,
              timedOut,
              truncated,
            });
          });
        } else {
          resolve({
            output,
            exitCode: code ?? 1,
            timedOut,
            truncated,
          });
        }
      });
    });
  }

  /**
   * Parse Claude Code output into messages array
   */
  private parseMessages(
    rawOutput: string,
    result: AgentExecutionResult
  ): YouBenchaLog['messages'] {
    const messages: YouBenchaLog['messages'] = [];

    // Add system message
    messages.push({
      role: 'system',
      content: 'Claude Code CLI started',
      timestamp: result.startedAt,
    });

    let currentMessageContent = '';
    const currentToolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = [];

    const lines = rawOutput.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) continue;

      // Parse tool calls - Claude Code outputs [TOOL: name] pattern
      const toolMatch = trimmed.match(/\[TOOL:\s*(\w+)\]\s*(.*)/);
      if (toolMatch) {
        currentToolCalls.push({
          id: `call_${Date.now()}_${currentToolCalls.length}`,
          type: 'function',
          function: {
            name: toolMatch[1],
            arguments: JSON.stringify({ input: toolMatch[2] }),
          },
        });
      } else {
        currentMessageContent += line + '\n';
      }
    }

    // Add final assistant message with content and tool calls
    if (currentMessageContent.trim() || currentToolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: currentMessageContent.trim() || rawOutput || 'No output captured',
        timestamp: result.completedAt,
        tool_calls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
      });
    }

    // If no messages were parsed, add default assistant message
    if (messages.length === 1) {
      messages.push({
        role: 'assistant',
        content: rawOutput || 'No output captured',
        timestamp: result.completedAt,
      });
    }

    return messages;
  }

  /**
   * Extract usage metrics from Claude Code output
   */
  private extractUsageMetrics(rawOutput: string): YouBenchaLog['usage'] {
    // Try to extract token usage from output
    // Claude Code may include usage information in output
    const inputTokensMatch = rawOutput.match(/[Ii]nput\s+tokens?:\s*(\d+)/i);
    const outputTokensMatch = rawOutput.match(/[Oo]utput\s+tokens?:\s*(\d+)/i);

    const promptTokens = inputTokensMatch ? parseInt(inputTokensMatch[1], 10) : 0;
    const completionTokens = outputTokensMatch ? parseInt(outputTokensMatch[1], 10) : 0;

    // Estimate tokens if not available (rough estimate: 1 token ≈ 4 characters)
    const estimatedPromptTokens = promptTokens || Math.ceil(rawOutput.length / 4);
    const estimatedCompletionTokens = completionTokens || Math.ceil(rawOutput.length / 8);

    return {
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: estimatedCompletionTokens,
      total_tokens: estimatedPromptTokens + estimatedCompletionTokens,
      estimated_cost_usd: this.estimateCost(estimatedPromptTokens, estimatedCompletionTokens),
    };
  }

  /**
   * Estimate cost based on token usage
   * Using approximate Claude pricing
   */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    // Claude Sonnet approximate pricing: $3 per 1M input tokens, $15 per 1M output tokens
    const promptCost = (promptTokens / 1000000) * 3;
    const completionCost = (completionTokens / 1000000) * 15;
    return promptCost + completionCost;
  }

  /**
   * Parse model name from Claude Code output
   */
  parseModel(rawOutput: string): string {
    // Try to detect model from output
    const modelMatch = rawOutput.match(/[Mm]odel:\s*(claude-[\w\-.]+)/);
    if (modelMatch) {
      return modelMatch[1];
    }

    // Look for model mentions in the output
    const mentionMatch = rawOutput.match(/(claude-(?:sonnet|opus|haiku)-[\d.-]+)/i);
    if (mentionMatch) {
      return mentionMatch[1];
    }

    return 'claude-sonnet-4';
  }

  /**
   * Parse Claude Code version from output
   */
  parseVersion(rawOutput: string): string {
    // Try to detect version from output
    const versionMatch = rawOutput.match(/[Vv]ersion[:\s]+([0-9]+\.[0-9]+\.[0-9]+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    // Look for claude code version pattern
    const claudeVersionMatch = rawOutput.match(/claude[_\s-]?code[_\s]?v?([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (claudeVersionMatch) {
      return claudeVersionMatch[1];
    }

    return 'unknown';
  }

  /**
   * Get youBencha version from package.json
   */
  private getYouBenchaVersion(): string {
    try {
      // Try to read version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
      return packageJson.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
}
