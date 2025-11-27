/**
 * Contract tests for Claude Code Adapter
 * 
 * These tests verify Claude Code adapter follows the AgentAdapter contract
 * and implements Claude Code-specific requirements correctly.
 * 
 * Tests written following TDD approach - tests MUST FAIL before implementation.
 */

import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext, AgentExecutionResult } from '../../src/adapters/base.js';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('ClaudeCodeAdapter Contract Tests', () => {
  let adapter: ClaudeCodeAdapter;
  let tempWorkspace: string;

  beforeAll(() => {
    adapter = new ClaudeCodeAdapter();
  });

  beforeEach(async () => {
    tempWorkspace = path.join('/tmp', `test-claude-${Date.now()}`);
    await fs.mkdir(tempWorkspace, { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, 'artifacts'), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('User Story 2: Model and Agent Selection', () => {
    describe('CR-2.6: Model Parameter', () => {
      it('should accept model parameter in config', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test prompt',
            model: 'claude-sonnet-4-5-20250929',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should not fail due to model parameter
        expect(result).toBeDefined();
        expect(['success', 'failed', 'timeout']).toContain(result.status);
      });

      it('should handle different model names', async () => {
        const modelNames = [
          'claude-sonnet-4',
          'claude-opus-4',
          'claude-haiku-4',
        ];

        for (const modelName of modelNames) {
          const context: AgentExecutionContext = {
            workspaceDir: tempWorkspace,
            repoDir: path.join(tempWorkspace, 'src-modified'),
            artifactsDir: path.join(tempWorkspace, 'artifacts'),
            config: {
              prompt: 'Test',
              model: modelName,
            },
            timeout: 5000,
            env: {},
          };

          const result = await adapter.execute(context);
          expect(result).toBeDefined();
        }
      });

      it('should populate model in normalized log when specified in config', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test',
            model: 'claude-sonnet-4',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);
        const log = adapter.normalizeLog(result.output, result);

        // Model should be populated from config if not detected in output
        expect(log.model.name).toBeDefined();
        expect(log.model.provider).toBe('Anthropic');
      });
    });

    describe('CR-2.7: Agent Name Parameter', () => {
      it('should accept agent_name parameter in config', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test prompt',
            agent_name: 'code-reviewer',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should not fail due to agent_name parameter
        expect(result).toBeDefined();
        expect(['success', 'failed', 'timeout']).toContain(result.status);
      });

      it('should handle custom agent names', async () => {
        const agentNames = [
          'custom-agent',
          'code-reviewer',
          'test-assistant',
        ];

        for (const agentName of agentNames) {
          const context: AgentExecutionContext = {
            workspaceDir: tempWorkspace,
            repoDir: path.join(tempWorkspace, 'src-modified'),
            artifactsDir: path.join(tempWorkspace, 'artifacts'),
            config: {
              prompt: 'Test',
              agent_name: agentName,
            },
            timeout: 5000,
            env: {},
          };

          const result = await adapter.execute(context);
          expect(result).toBeDefined();
        }
      });

      it('should work with both model and agent_name specified', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test prompt',
            model: 'claude-sonnet-4',
            agent_name: 'code-reviewer',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should handle both parameters without conflict
        expect(result).toBeDefined();
        expect(['success', 'failed', 'timeout']).toContain(result.status);
      });
    });
  });

  describe('User Story 3: Prompt File Support', () => {
    describe('CR-2.5: Prompt File Configuration', () => {
      it('should accept prompt_file parameter in config', async () => {
        // Create a prompt file
        const promptFilePath = path.join(tempWorkspace, 'test-prompt.md');
        await fs.writeFile(promptFilePath, '# Test Prompt\nTest content');

        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: './test-prompt.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should read and use file contents
        expect(result).toBeDefined();
        expect(['success', 'failed', 'timeout']).toContain(result.status);
      });

      it('should handle prompt_file in subdirectories', async () => {
        // Create prompts directory and file
        const promptsDir = path.join(tempWorkspace, 'prompts');
        await fs.mkdir(promptsDir, { recursive: true });
        const promptFilePath = path.join(promptsDir, 'task.md');
        await fs.writeFile(promptFilePath, 'Task instructions');

        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: './prompts/task.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);
        expect(result).toBeDefined();
      });

      it('should support various file extensions for prompt_file', async () => {
        const extensions = ['.md', '.txt', '.prompt'];

        for (const ext of extensions) {
          const promptFilePath = path.join(tempWorkspace, `test${ext}`);
          await fs.writeFile(promptFilePath, 'Test content');

          const context: AgentExecutionContext = {
            workspaceDir: tempWorkspace,
            repoDir: path.join(tempWorkspace, 'src-modified'),
            artifactsDir: path.join(tempWorkspace, 'artifacts'),
            config: {
              prompt_file: `./test${ext}`,
            },
            timeout: 5000,
            env: {},
          };

          const result = await adapter.execute(context);
          expect(result).toBeDefined();
        }
      });
    });

    describe('CR-4.1: Prompt/Prompt_file Mutual Exclusivity', () => {
      it('should reject config with both prompt and prompt_file', async () => {
        const promptFilePath = path.join(tempWorkspace, 'test.md');
        await fs.writeFile(promptFilePath, 'File content');

        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Inline prompt',
            prompt_file: './test.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should fail with clear error message
        expect(result.status).toBe('failed');
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toMatch(/both.*prompt.*prompt_file/i);
      });
    });

    describe('CR-4.2: Prompt_file Path Validation', () => {
      it('should reject path traversal attempts', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: '../../../etc/passwd',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should fail with security error
        expect(result.status).toBe('failed');
        expect(result.errors[0].message).toMatch(/invalid.*path|traversal/i);
      });

      it('should reject absolute paths', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: '/tmp/malicious-prompt.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should fail with security error
        expect(result.status).toBe('failed');
        expect(result.errors[0].message).toMatch(/invalid.*path|absolute/i);
      });
    });

    describe('CR-4.3: Prompt_file Error Handling', () => {
      it('should fail gracefully when prompt_file does not exist', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: './nonexistent-file.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Should fail with clear error message
        expect(result.status).toBe('failed');
        expect(result.errors[0].message).toMatch(/not found|does not exist/i);
      });

      it('should provide helpful error with expected path', async () => {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt_file: './missing.md',
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);

        // Error should include expected path for debugging
        expect(result.status).toBe('failed');
        expect(result.errors[0].message).toContain(tempWorkspace);
      });
    });
  });

  describe('User Story 4: Log Export and Normalization', () => {
    describe('CR-3.4: Message Parsing', () => {
      it('should parse Claude output into structured messages', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Model: claude-sonnet-4\nProcessing request...\nTask completed successfully.',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.messages).toBeDefined();
        expect(Array.isArray(log.messages)).toBe(true);
        expect(log.messages.length).toBeGreaterThan(0);
      });

      it('should include system message as first message', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Test output',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.messages[0].role).toBe('system');
        expect(log.messages[0].content).toContain('Claude Code');
      });

      it('should include assistant messages with timestamps', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Assistant response here',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        const assistantMessage = log.messages.find(m => m.role === 'assistant');
        expect(assistantMessage).toBeDefined();
        expect(assistantMessage?.timestamp).toBeDefined();
        expect(assistantMessage?.content).toBeDefined();
      });

      it('should handle empty output gracefully', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: '',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.messages).toBeDefined();
        expect(log.messages.length).toBeGreaterThan(0);
      });
    });

    describe('CR-3.5: Tool Call Parsing', () => {
      it('should parse [TOOL: name] patterns from output', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: '[TOOL: read_file] src/index.ts\n[TOOL: write_file] README.md',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        const assistantMessage = log.messages.find(m => m.role === 'assistant');
        expect(assistantMessage?.tool_calls).toBeDefined();
        expect(assistantMessage?.tool_calls?.length).toBe(2);
      });

      it('should extract tool name from [TOOL: name] pattern', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: '[TOOL: list_files] ./src',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        const assistantMessage = log.messages.find(m => m.role === 'assistant');
        const toolCall = assistantMessage?.tool_calls?.[0];
        expect(toolCall?.function.name).toBe('list_files');
      });

      it('should extract tool arguments after tool name', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: '[TOOL: search_files] *.ts --pattern "function"',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        const assistantMessage = log.messages.find(m => m.role === 'assistant');
        const toolCall = assistantMessage?.tool_calls?.[0];
        expect(toolCall?.function.arguments).toContain('*.ts');
      });

      it('should handle output with no tool calls', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Regular output without tool calls',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        const assistantMessage = log.messages.find(m => m.role === 'assistant');
        expect(assistantMessage?.tool_calls).toBeUndefined();
      });
    });

    describe('CR-3.6: Usage Metrics', () => {
      it('should extract input tokens from output', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Input tokens: 1234\nOutput tokens: 5678',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.usage?.prompt_tokens).toBe(1234);
      });

      it('should extract output tokens from output', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Input tokens: 1234\nOutput tokens: 5678',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.usage?.completion_tokens).toBe(5678);
      });

      it('should calculate total tokens correctly', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Input tokens: 1000\nOutput tokens: 2000',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.usage?.total_tokens).toBe(3000);
      });

      it('should estimate tokens when not present in output', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Output without token information',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.usage?.prompt_tokens).toBeGreaterThan(0);
        expect(log.usage?.completion_tokens).toBeGreaterThan(0);
      });

      it('should include cost estimation', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Input tokens: 1000\nOutput tokens: 2000',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.usage?.estimated_cost_usd).toBeDefined();
        expect(typeof log.usage?.estimated_cost_usd).toBe('number');
        expect(log.usage?.estimated_cost_usd).toBeGreaterThan(0);
      });
    });

    describe('CR-3.7 & CR-3.8: Execution Metadata', () => {
      it('should populate agent_info correctly', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Version: 1.2.3',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.agent.name).toBe('claude-code');
        expect(log.agent.version).toBeDefined();
        expect(log.agent.adapter_version).toBeDefined();
      });

      it('should populate model_info with Anthropic provider', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Model: claude-sonnet-4',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.model.provider).toBe('Anthropic');
        expect(log.model.name).toBeDefined();
      });

      it('should populate execution timestamps', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Test',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.execution.started_at).toBe('2025-11-25T10:00:00Z');
        expect(log.execution.completed_at).toBe('2025-11-25T10:01:00Z');
      });

      it('should populate execution duration', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Test',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.execution.duration_ms).toBe(60000);
      });

      it('should populate execution status', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Test',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.execution.status).toBe('success');
      });

      it('should populate exit code', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 0,
          status: 'success',
          output: 'Test',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.execution.exit_code).toBe(0);
      });

      it('should propagate errors from execution result', () => {
        const mockResult: AgentExecutionResult = {
          exitCode: 1,
          status: 'failed',
          output: 'Error occurred',
          startedAt: '2025-11-25T10:00:00Z',
          completedAt: '2025-11-25T10:01:00Z',
          durationMs: 60000,
          errors: [
            { message: 'Command failed', timestamp: '2025-11-25T10:01:00Z' }
          ],
        };

        const log = adapter.normalizeLog(mockResult.output, mockResult);

        expect(log.errors).toBeDefined();
        expect(log.errors.length).toBeGreaterThan(0);
        expect(log.errors[0].message).toContain('Command failed');
      });
    });
  });
});
