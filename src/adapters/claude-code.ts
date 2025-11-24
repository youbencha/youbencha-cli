/**
 * Anthropic Claude Code CLI Adapter
 * 
 * Integrates Anthropic's Claude Code CLI as an agent for youBencha evaluations.
 * Handles execution, output capture, and log normalization.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream, readFileSync } from 'fs';
import { 
  AgentAdapter, 
  AgentExecutionContext, 
  AgentExecutionResult 
} from './base.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';

const execAsync = promisify(exec);

/**
 * Anthropic Claude Code CLI adapter implementation
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly version = '1.0.0';

  /**
   * Check if claude is available and authenticated
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check if claude is in PATH
      const command = process.platform === 'win32' 
        ? 'where claude' 
        : 'which claude';
      
      await execAsync(command);
      
      // Could add authentication check here if needed
      // For now, just verify the binary exists
      return true;
    } catch (error) {
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
      // Ensure claude-logs directory exists
      const claudeLogsDir = path.join(context.artifactsDir, 'claude-logs');
      await fs.mkdir(claudeLogsDir, { recursive: true });

      // Create a log file path for terminal output
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const terminalLogPath = path.join(claudeLogsDir, `terminal-output-${timestamp}.log`);

      // Build claude command
      const { command, args } = this.buildClaudeCommand(context);
      
      // Log the command being executed for debugging
      console.log('[DEBUG] Claude Code CLI Command:');
      console.log(`  Command: ${command}`);
      console.log(`  Args: ${JSON.stringify(args)}`);
      console.log(`  CWD: ${context.workspaceDir}`);
      console.log(`  Prompt length: ${(context.config.prompt as string)?.length || 0} chars`);
      console.log(`  Terminal output log: ${terminalLogPath}`);
      
      // Execute claude with timeout
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
      } else if (exitCode !== 0) {
        status = 'failed';
        errors.push({
          message: `Claude Code CLI exited with code ${exitCode}`,
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
   * Transform claude output to youBencha Log format
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    // Parse claude output to extract messages and tool calls
    const messages = this.parseMessages(rawOutput, result);
    
    // Extract usage metrics from output if available
    const usage = this.extractUsageMetrics(rawOutput);
    
    // Build environment context
    const environment = {
      os: `${os.platform()}-${os.arch()}`,
      node_version: process.version,
      youbencha_version: this.getYouBenchaVersion(),
      working_directory: process.cwd(),
    };

    // Detect model from config or output
    const model = this.detectModel(rawOutput);

    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version: this.detectClaudeVersion(rawOutput),
        adapter_version: this.version,
      },
      model: {
        name: model,
        provider: 'Anthropic',
        parameters: {
          temperature: 0.7, // Default claude parameters
          top_p: 1.0,
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
   * Build claude command with proper platform handling
   */
  private buildClaudeCommand(
    context: AgentExecutionContext
  ): { command: string; args: string[] } {
    const prompt = context.config.prompt as string | undefined;
    const model = context.config.model as string | undefined;
    
    if (!prompt) {
      throw new Error('Prompt is required in agent config');
    }

    // Build base args
    const baseArgs = ['-p', prompt];
    
    // Add model if specified
    if (model) {
      baseArgs.push('--model', model);
    }
    
    // Add logging configuration
    baseArgs.push('--log-level', 'all');
    
    // Create claude-logs subdirectory in artifacts for better organization
    const claudeLogsDir = path.join(context.artifactsDir, 'claude-logs');
    baseArgs.push('--log-dir', claudeLogsDir);

    // On Windows, use PowerShell to invoke claude
    if (process.platform === 'win32') {
      // Add --add-dir to the arguments before escaping
      const allArgs = [...baseArgs, '--add-dir', context.workspaceDir];
      
      // Build the PowerShell command using the call operator (&)
      const escapedArgs = allArgs.map(arg => {
        // Escape single quotes by doubling them for PowerShell
        const escaped = arg.replace(/'/g, "''");
        return `'${escaped}'`;
      });
      
      // Use & operator to call claude with arguments
      const claudeCommand = `& claude ${escapedArgs.join(' ')}`;
      
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', claudeCommand],
      };
    }

    // Unix-like systems can execute scripts directly
    return {
      command: 'claude',
      args: [...baseArgs, '--add-dir', context.workspaceDir],
    };
  }

  /**
   * Execute command with timeout support
   */
  private async executeWithTimeout(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number,
    logFilePath?: string
  ): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
    return new Promise((resolve) => {
      let output = '';
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Create write stream for terminal output log if path provided
      const logStream = logFilePath ? createWriteStream(logFilePath, { encoding: 'utf8' }) : null;

      // Use direct command execution without shell
      const shellConfig = this.getShellConfig();

      const childProcess = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        ...shellConfig,
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

      // Capture stdout and stderr with real-time streaming
      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        // Stream to console in real-time
        process.stdout.write(text);
        // Write to log file
        if (logStream) {
          logStream.write(text);
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        // Stream to console in real-time
        process.stderr.write(text);
        // Write to log file
        if (logStream) {
          logStream.write(text);
        }
      });

      childProcess.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (logStream) {
          logStream.end(() => {
            resolve({
              output: output + '\n' + error.message,
              exitCode: 1,
              timedOut,
            });
          });
        } else {
          resolve({
            output: output + '\n' + error.message,
            exitCode: 1,
            timedOut,
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
            });
          });
        } else {
          resolve({
            output,
            exitCode: code ?? 1,
            timedOut,
          });
        }
      });
    });
  }

  /**
   * Get spawn configuration for direct command execution
   */
  private getShellConfig(): { shell?: boolean | string; windowsVerbatimArguments?: boolean } {
    // Don't use shell to avoid argument parsing issues on all platforms
    return { shell: false };
  }

  /**
   * Parse claude output into messages array
   */
  private parseMessages(rawOutput: string, result: AgentExecutionResult): YouBenchaLog['messages'] {
    const messages: YouBenchaLog['messages'] = [];
    const lines = rawOutput.split('\n');
    
    // Add system message
    messages.push({
      role: 'system',
      content: 'Claude Code CLI started',
      timestamp: result.startedAt,
    });

    let currentMessageContent = '';
    let currentToolCalls: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }> = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed) continue;

      // Parse tool calls (Claude Code format may differ - adjust as needed)
      if (trimmed.startsWith('[TOOL]') || trimmed.includes('tool_use')) {
        const toolMatch = trimmed.match(/\[TOOL\]\s+(\w+):\s*(.+)/) || 
                         trimmed.match(/tool_use.*name["\s:]+(\w+)/);
        if (toolMatch) {
          currentToolCalls.push({
            id: `call_${Date.now()}_${currentToolCalls.length}`,
            type: 'function',
            function: {
              name: toolMatch[1],
              arguments: JSON.stringify({ input: toolMatch[2] || '' }),
            },
          });
        }
      } 
      // Parse responses
      else if (trimmed.startsWith('[RESULT]') || trimmed.includes('tool_result')) {
        const responseContent = trimmed.replace(/\[RESULT\]/, '').trim();
        
        // Add assistant message with tool calls if any
        if (currentToolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: currentMessageContent || 'Tool call initiated',
            timestamp: new Date().toISOString(),
            tool_calls: currentToolCalls,
          });
          currentToolCalls = [];
          currentMessageContent = '';
        }

        // Add tool response
        messages.push({
          role: 'tool',
          content: responseContent,
          timestamp: new Date().toISOString(),
          tool_call_id: messages.length > 0 ? `call_${Date.now()}` : undefined,
        });
      }
      // Regular content
      else {
        currentMessageContent += line + '\n';
      }
    }

    // Add final assistant message if there's remaining content
    if (currentMessageContent.trim()) {
      messages.push({
        role: 'assistant',
        content: currentMessageContent.trim(),
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
   * Extract usage metrics from claude output
   */
  private extractUsageMetrics(rawOutput: string): YouBenchaLog['usage'] {
    // Try to extract token usage from output
    const promptTokensMatch = rawOutput.match(/input[_\s]tokens?:\s*(\d+)/i);
    const completionTokensMatch = rawOutput.match(/output[_\s]tokens?:\s*(\d+)/i);
    
    const promptTokens = promptTokensMatch ? parseInt(promptTokensMatch[1], 10) : 0;
    const completionTokens = completionTokensMatch ? parseInt(completionTokensMatch[1], 10) : 0;

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
   * Using Claude 3.5 Sonnet pricing as default
   */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    // Claude 3.5 Sonnet approximate pricing: $3 per 1M input tokens, $15 per 1M output tokens
    const promptCost = (promptTokens / 1000000) * 3;
    const completionCost = (completionTokens / 1000000) * 15;
    return promptCost + completionCost;
  }

  /**
   * Detect claude version from output
   */
  private detectClaudeVersion(rawOutput: string): string {
    const versionMatch = rawOutput.match(/claude[_\s-]code[_\s]version?:\s*([0-9.]+)/i) ||
                        rawOutput.match(/claude[_\s]version?:\s*([0-9.]+)/i);
    return versionMatch ? versionMatch[1] : 'unknown';
  }

  /**
   * Detect model from output or config
   */
  private detectModel(rawOutput: string): string {
    const modelMatch = rawOutput.match(/using\s+model:\s*(claude-[\w.-]+)/i) ||
                      rawOutput.match(/model:\s*(claude-[\w.-]+)/i);
    return modelMatch ? modelMatch[1] : 'claude-3-5-sonnet-20241022';
  }

  /**
   * Get youBencha version from package.json
   */
  private getYouBenchaVersion(): string {
    try {
      // Try to read version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
      return packageJson.version ?? '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
}
