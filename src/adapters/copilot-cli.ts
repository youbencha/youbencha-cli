/**
 * GitHub Copilot CLI Adapter
 * 
 * Integrates GitHub Copilot CLI as an agent for youBencha evaluations.
 * Handles execution, output capture, and log normalization.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { 
  AgentAdapter, 
  AgentExecutionContext, 
  AgentExecutionResult 
} from './base.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';

const execAsync = promisify(exec);

/**
 * GitHub Copilot CLI adapter implementation
 */
export class CopilotCLIAdapter implements AgentAdapter {
  readonly name = 'copilot-cli';
  readonly version = '1.0.0';

  /**
   * Check if copilot is available and authenticated
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check if copilot is in PATH
      const command = process.platform === 'win32' 
        ? 'where copilot' 
        : 'which copilot';
      
      await execAsync(command);
      
      // Check if authenticated (this may fail if not logged in)
      // We'll just check if the binary exists for now
      // Authentication check would require running copilot with auth check
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute GitHub Copilot CLI with given context
   */
  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    let output = '';
    let exitCode = 0;
    let status: 'success' | 'failed' | 'timeout' = 'success';
    const errors: Array<{ message: string; timestamp: string; stackTrace?: string }> = [];

    try {
      // Build copilot command arguments
      const args = this.buildCopilotArgs(context);
      
      // Execute copilot with timeout
      const result = await this.executeWithTimeout(
        'copilot',
        args,
        context.workspaceDir,
        context.env,
        context.timeout
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
          message: `Copilot CLI exited with code ${exitCode}`,
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
   * Transform copilot output to youBencha Log format
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    // Parse copilot output to extract messages and tool calls
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
        version: this.detectCopilotVersion(rawOutput),
        adapter_version: this.version,
      },
      model: {
        name: model,
        provider: 'GitHub',
        parameters: {
          temperature: 0.7, // Default copilot parameters
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
   * Build copilot command arguments from context
   */
  private buildCopilotArgs(context: AgentExecutionContext): string[] {
    const args: string[] = [];
    
    // Add prompt using -p flag for programmatic mode
    if (context.config.prompt) {
      args.push('-p', context.config.prompt);
    }
    
    // Allow all tools for programmatic execution
    // This enables copilot to execute commands without manual approval
    args.push('--allow-all-tools');
    
    return args;
  }

  /**
   * Execute command with timeout support
   */
  private async executeWithTimeout(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number
  ): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
    return new Promise((resolve) => {
      let output = '';
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const childProcess = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell: true,
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

      // Capture stdout and stderr
      childProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      childProcess.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          output: output + '\n' + error.message,
          exitCode: 1,
          timedOut,
        });
      });

      childProcess.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          output,
          exitCode: code ?? 1,
          timedOut,
        });
      });
    });
  }

  /**
   * Parse copilot output into messages array
   */
  private parseMessages(rawOutput: string, result: AgentExecutionResult): YouBenchaLog['messages'] {
    const messages: YouBenchaLog['messages'] = [];
    const lines = rawOutput.split('\n');
    
    // Add system message
    messages.push({
      role: 'system',
      content: 'GitHub Copilot CLI started',
      timestamp: result.startedAt,
    });

    let currentMessageContent = '';
    let currentToolCalls: any[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed) continue;

      // Parse tool calls
      if (trimmed.startsWith('[TOOL_CALL]')) {
        const toolMatch = trimmed.match(/\[TOOL_CALL\]\s+(\w+):\s*(.+)/);
        if (toolMatch) {
          currentToolCalls.push({
            id: `call_${Date.now()}_${currentToolCalls.length}`,
            type: 'function',
            function: {
              name: toolMatch[1],
              arguments: JSON.stringify({ input: toolMatch[2] }),
            },
          });
        }
      } 
      // Parse responses
      else if (trimmed.startsWith('[RESPONSE]')) {
        const responseContent = trimmed.replace('[RESPONSE]', '').trim();
        
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
      else if (trimmed.startsWith('[INFO]') || trimmed.startsWith('[DEBUG]')) {
        currentMessageContent += line + '\n';
      } else {
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
   * Extract usage metrics from copilot output
   */
  private extractUsageMetrics(rawOutput: string): YouBenchaLog['usage'] {
    // Try to extract token usage from output
    // Copilot CLI may include usage information in output
    const promptTokensMatch = rawOutput.match(/prompt[_\s]tokens?:\s*(\d+)/i);
    const completionTokensMatch = rawOutput.match(/completion[_\s]tokens?:\s*(\d+)/i);
    
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
   * Using approximate GPT-4 pricing as default
   */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    // GPT-4 approximate pricing: $0.03 per 1K prompt tokens, $0.06 per 1K completion tokens
    const promptCost = (promptTokens / 1000) * 0.03;
    const completionCost = (completionTokens / 1000) * 0.06;
    return promptCost + completionCost;
  }

  /**
   * Detect copilot version from output
   */
  private detectCopilotVersion(rawOutput: string): string {
    const versionMatch = rawOutput.match(/copilot[_\s-]cli[_\s]version?:\s*([0-9.]+)/i);
    return versionMatch ? versionMatch[1] : 'unknown';
  }

  /**
   * Detect model from output
   */
  private detectModel(rawOutput: string): string {
    const modelMatch = rawOutput.match(/using\s+model:\s*([\w-]+)/i);
    return modelMatch ? modelMatch[1] : 'gpt-4';
  }

  /**
   * Get youBencha version from package.json
   */
  private getYouBenchaVersion(): string {
    try {
      // Try to read version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const fs = require('fs');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
}
