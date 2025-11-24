/**
 * OpenAI Codex CLI Adapter
 * 
 * Integrates OpenAI's API (modern successor to Codex) as an agent for youBencha evaluations.
 * This adapter simulates a CLI-like interface using OpenAI's Chat Completion API.
 * 
 * Note: OpenAI's original Codex API was deprecated in March 2023. This adapter uses
 * the current OpenAI API with models like gpt-4, gpt-3.5-turbo, or o1 for code generation.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { 
  AgentAdapter, 
  AgentExecutionContext, 
  AgentExecutionResult 
} from './base.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';

const execAsync = promisify(exec);

/**
 * OpenAI Codex CLI adapter implementation
 * 
 * This adapter interfaces with OpenAI's API for code-related tasks.
 * Configuration requires OPENAI_API_KEY environment variable.
 */
export class CodexCLIAdapter implements AgentAdapter {
  readonly name = 'codex-cli';
  readonly version = '1.0.0';

  /**
   * Check if OpenAI API is accessible
   * Verifies that the OPENAI_API_KEY is set and potentially validates it
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check if OPENAI_API_KEY is set
      if (!process.env.OPENAI_API_KEY) {
        return false;
      }

      // Check if openai CLI or Python SDK is available
      // We'll use Python SDK for API calls
      try {
        await execAsync('python3 -c "import openai"');
        return true;
      } catch {
        try {
          await execAsync('python -c "import openai"');
          return true;
        } catch {
          // If Python SDK not available, we can still use curl/node
          // For now, just check if API key exists
          return true;
        }
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute OpenAI Codex with given context
   * 
   * This creates a wrapper script that calls OpenAI's API with the provided prompt
   * and workspace context, simulating a CLI-like interface.
   */
  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    let output = '';
    let exitCode = 0;
    let status: 'success' | 'failed' | 'timeout' = 'success';
    const errors: Array<{ message: string; timestamp: string; stackTrace?: string }> = [];

    try {
      // Ensure codex-logs directory exists
      const codexLogsDir = path.join(context.artifactsDir, 'codex-logs');
      await fs.mkdir(codexLogsDir, { recursive: true });

      // Create a log file path for terminal output
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const terminalLogPath = path.join(codexLogsDir, `terminal-output-${timestamp}.log`);

      // Build the execution command
      const { command, args, scriptPath } = await this.buildCodexCommand(context, codexLogsDir);
      
      // Log the command being executed for debugging
      console.log('[DEBUG] Codex CLI Command:');
      console.log(`  Command: ${command}`);
      console.log(`  Args: ${JSON.stringify(args)}`);
      console.log(`  CWD: ${context.workspaceDir}`);
      console.log(`  Prompt length: ${(context.config.prompt as string)?.length || 0} chars`);
      console.log(`  Terminal output log: ${terminalLogPath}`);
      console.log(`  Script path: ${scriptPath}`);
      
      // Execute with timeout
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
          message: `Codex CLI exited with code ${exitCode}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Clean up temporary script
      if (scriptPath) {
        try {
          await fs.unlink(scriptPath);
        } catch (error) {
          // Ignore cleanup errors
        }
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
   * Transform Codex output to youBencha Log format
   */
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog {
    // Parse codex output to extract messages and tool calls
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
        version: this.detectCodexVersion(rawOutput),
        adapter_version: this.version,
      },
      model: {
        name: model,
        provider: 'OpenAI',
        parameters: {
          temperature: 0.7, // Default parameters
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
   * Build Codex command - creates a Python script that calls OpenAI API
   */
  private async buildCodexCommand(
    context: AgentExecutionContext,
    logsDir: string
  ): Promise<{ command: string; args: string[]; scriptPath: string }> {
    const prompt = context.config.prompt as string | undefined;
    const model = (context.config.model as string | undefined) || 'gpt-4';
    
    if (!prompt) {
      throw new Error('Prompt is required in agent config');
    }

    // Create a Python script that will execute the OpenAI API call
    const scriptContent = this.generatePythonScript(prompt, model, context.workspaceDir, logsDir);
    
    // Write script to temporary file
    const scriptPath = path.join(logsDir, `codex_execution_${Date.now()}.py`);
    await fs.writeFile(scriptPath, scriptContent, { encoding: 'utf-8' });

    // Make script executable on Unix-like systems
    if (process.platform !== 'win32') {
      await fs.chmod(scriptPath, 0o755);
    }

    // Determine Python command
    let pythonCommand = 'python3';
    try {
      await execAsync('python3 --version');
    } catch {
      pythonCommand = 'python';
    }

    return {
      command: pythonCommand,
      args: [scriptPath],
      scriptPath,
    };
  }

  /**
   * Generate Python script for OpenAI API interaction
   */
  private generatePythonScript(
    prompt: string,
    model: string,
    workspaceDir: string,
    logsDir: string
  ): string {
    // Escape prompt for Python string
    const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    
    return `#!/usr/bin/env python3
"""
OpenAI Codex CLI Wrapper Script
Generated by youBencha CodexCLIAdapter
"""

import os
import sys
import json
from datetime import datetime

try:
    import openai
except ImportError:
    print("[ERROR] OpenAI Python SDK not installed. Install with: pip install openai", file=sys.stderr)
    sys.exit(1)

# Configuration
API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    print("[ERROR] OPENAI_API_KEY environment variable not set", file=sys.stderr)
    sys.exit(1)

MODEL = "${model}"
WORKSPACE_DIR = "${workspaceDir.replace(/\\/g, '\\\\')}"
LOGS_DIR = "${logsDir.replace(/\\/g, '\\\\')}"
PROMPT = """${escapedPrompt}"""

# Initialize OpenAI client
client = openai.OpenAI(api_key=API_KEY)

print(f"[INFO] Starting OpenAI Codex execution")
print(f"[INFO] Model: {MODEL}")
print(f"[INFO] Workspace: {WORKSPACE_DIR}")
print(f"[INFO] Prompt length: {len(PROMPT)} characters")

try:
    # Create chat completion
    print(f"[INFO] Sending request to OpenAI API...")
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": "You are an expert coding assistant. When asked to modify code, provide clear explanations and make precise changes. Focus on the workspace directory provided."
            },
            {
                "role": "user",
                "content": PROMPT
            }
        ],
        temperature=0.7,
        max_tokens=4096
    )
    
    # Extract response
    completion = response.choices[0].message.content
    usage = response.usage
    
    print(f"[INFO] Response received")
    print(f"[INFO] Prompt tokens: {usage.prompt_tokens}")
    print(f"[INFO] Completion tokens: {usage.completion_tokens}")
    print(f"[INFO] Total tokens: {usage.total_tokens}")
    print()
    print("[RESPONSE]")
    print(completion)
    print()
    
    # Save detailed log
    log_path = os.path.join(LOGS_DIR, f"codex_response_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(log_path, 'w') as f:
        json.dump({
            'model': MODEL,
            'prompt': PROMPT,
            'response': completion,
            'usage': {
                'prompt_tokens': usage.prompt_tokens,
                'completion_tokens': usage.completion_tokens,
                'total_tokens': usage.total_tokens
            },
            'timestamp': datetime.now().isoformat()
        }, f, indent=2)
    
    print(f"[INFO] Detailed log saved to: {log_path}")
    print(f"[INFO] Execution completed successfully")
    
    sys.exit(0)
    
except openai.APIError as e:
    print(f"[ERROR] OpenAI API error: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
`;
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

      // Capture stdout and stderr with real-time streaming
      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        // Stream to console in real-time
        process.stdout.write(text);
        // Write to log file
        if (logStream) {
          logStream.write(text);
        }
      });

      childProcess.stderr?.on('data', (data) => {
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
   * Parse Codex output into messages array
   */
  private parseMessages(rawOutput: string, result: AgentExecutionResult): YouBenchaLog['messages'] {
    const messages: YouBenchaLog['messages'] = [];
    const lines = rawOutput.split('\n');
    
    // Add system message
    messages.push({
      role: 'system',
      content: 'OpenAI Codex (via API) started',
      timestamp: result.startedAt,
    });

    let currentMessageContent = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!trimmed) continue;

      // Parse different message types
      if (trimmed.startsWith('[INFO]') || trimmed.startsWith('[DEBUG]')) {
        currentMessageContent += line + '\n';
      } else if (trimmed.startsWith('[RESPONSE]')) {
        // This marks the start of the AI response
        continue;
      } else if (trimmed.startsWith('[ERROR]')) {
        currentMessageContent += line + '\n';
      } else {
        currentMessageContent += line + '\n';
      }
    }

    // Add the main assistant message with the response
    if (currentMessageContent.trim()) {
      messages.push({
        role: 'assistant',
        content: currentMessageContent.trim(),
        timestamp: result.completedAt,
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
   * Extract usage metrics from Codex output
   */
  private extractUsageMetrics(rawOutput: string): YouBenchaLog['usage'] {
    // Try to extract token usage from output
    const promptTokensMatch = rawOutput.match(/Prompt tokens?:\s*(\d+)/i);
    const completionTokensMatch = rawOutput.match(/Completion tokens?:\s*(\d+)/i);
    const totalTokensMatch = rawOutput.match(/Total tokens?:\s*(\d+)/i);
    
    const promptTokens = promptTokensMatch ? parseInt(promptTokensMatch[1], 10) : 0;
    const completionTokens = completionTokensMatch ? parseInt(completionTokensMatch[1], 10) : 0;
    const totalTokens = totalTokensMatch ? parseInt(totalTokensMatch[1], 10) : (promptTokens + completionTokens);

    // Estimate tokens if not available (rough estimate: 1 token ≈ 4 characters)
    const estimatedPromptTokens = promptTokens || Math.ceil(rawOutput.length / 4);
    const estimatedCompletionTokens = completionTokens || Math.ceil(rawOutput.length / 8);
    const estimatedTotalTokens = totalTokens || (estimatedPromptTokens + estimatedCompletionTokens);

    return {
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: estimatedCompletionTokens,
      total_tokens: estimatedTotalTokens,
      estimated_cost_usd: this.estimateCost(estimatedPromptTokens, estimatedCompletionTokens),
    };
  }

  /**
   * Estimate cost based on token usage
   * Using GPT-4 pricing as default
   */
  private estimateCost(promptTokens: number, completionTokens: number): number {
    // GPT-4 pricing: $0.03 per 1K prompt tokens, $0.06 per 1K completion tokens
    const promptCost = (promptTokens / 1000) * 0.03;
    const completionCost = (completionTokens / 1000) * 0.06;
    return promptCost + completionCost;
  }

  /**
   * Detect Codex version from output
   */
  private detectCodexVersion(rawOutput: string): string {
    const versionMatch = rawOutput.match(/version[:\s]+([0-9.]+)/i);
    return versionMatch ? versionMatch[1] : '1.0.0';
  }

  /**
   * Detect model from output
   */
  private detectModel(rawOutput: string): string {
    const modelMatch = rawOutput.match(/Model:\s*([\w-]+)/i);
    return modelMatch ? modelMatch[1] : 'gpt-4';
  }

  /**
   * Get youBencha version from package.json
   */
  private getYouBenchaVersion(): string {
    try {
      // Try to read version from package.json
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const fsSync = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const packageJson = JSON.parse(fsSync.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return packageJson.version || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }
}
