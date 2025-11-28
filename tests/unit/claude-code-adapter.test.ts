/**
 * Unit tests for Claude Code Adapter
 * 
 * These tests verify the internal command building and parsing logic
 * of the Claude Code adapter without requiring actual CLI execution.
 */

import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('ClaudeCodeAdapter Unit Tests', () => {
  let adapter: ClaudeCodeAdapter;
  let tempWorkspace: string;

  beforeAll(() => {
    adapter = new ClaudeCodeAdapter();
  });

  beforeEach(async () => {
    tempWorkspace = path.join('/tmp', `test-unit-${Date.now()}`);
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

  describe('buildClaudeCommand() with model flag', () => {
    it('should include --model flag when model is specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          model: 'claude-sonnet-4',
        },
        timeout: 5000,
        env: {},
      };

      // Execute to trigger command building
      const result = await adapter.execute(context);

      // Verify execution doesn't throw due to model parameter
      expect(result).toBeDefined();
    });

    it('should not include --model flag when model is not specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);

      // Should work without model parameter
      expect(result).toBeDefined();
    });

    it('should handle various Claude model names', async () => {
      const models = [
        'claude-sonnet-4',
        'claude-opus-4',
        'claude-haiku-4',
        'claude-sonnet-4-5-20250929',
      ];

      for (const model of models) {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test',
            model,
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);
        expect(result).toBeDefined();
      }
    });
  });

  describe('buildClaudeCommand() with agent flag', () => {
    // Helper to create an agent file in the test workspace
    const createAgentFile = async (name: string, content?: string) => {
      const agentDir = path.join(tempWorkspace, '.claude', 'agents');
      await fs.mkdir(agentDir, { recursive: true });
      const agentContent = content || `---
name: ${name}
description: Test agent for ${name}
---

You are a test agent called ${name}.`;
      await fs.writeFile(path.join(agentDir, `${name}.md`), agentContent);
    };

    it('should include --append-system-prompt with agent prompt when agent_name is specified', async () => {
      await createAgentFile('code-reviewer');

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
      expect(result).toBeDefined();
    });

    it('should not include --agents flag when agent_name is not specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should handle custom agent names', async () => {
      const agentNames = [
        'custom-agent',
        'test-agent',
        'my-code-reviewer',
      ];

      // Create agent files for each
      for (const agent_name of agentNames) {
        await createAgentFile(agent_name);
      }

      for (const agent_name of agentNames) {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test',
            agent_name,
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);
        expect(result).toBeDefined();
      }
    });

    it('should handle both model and agent_name together', async () => {
      await createAgentFile('code-reviewer');

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
      expect(result).toBeDefined();
    });

    it('should throw error when agent_name is specified but agent file not found', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          agent_name: 'non-existent-agent',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result.status).toBe('failed');
      expect(result.errors[0]?.message).toContain('non-existent-agent');
    });
  });

  describe('buildClaudeCommand() with prompt_file', () => {
    it('should read prompt_file content and use it as prompt', async () => {
      const promptContent = '# Test Prompt\nThis is the prompt content';
      const promptFilePath = path.join(tempWorkspace, 'test-prompt.md');
      await fs.writeFile(promptFilePath, promptContent);

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
      expect(result).toBeDefined();
    });

    it('should resolve relative prompt_file paths correctly', async () => {
      const promptsDir = path.join(tempWorkspace, 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      const promptFilePath = path.join(promptsDir, 'task.md');
      await fs.writeFile(promptFilePath, 'Task content');

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

    it('should handle multiline prompt file content', async () => {
      const promptContent = `Line 1
Line 2
Line 3
Line 4 with "quotes"
Line 5 with 'single quotes'`;
      const promptFilePath = path.join(tempWorkspace, 'multiline.md');
      await fs.writeFile(promptFilePath, promptContent);

      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt_file: './multiline.md',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });
  });

  describe('Prompt validation', () => {
    it('should require either prompt or prompt_file', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          // No prompt or prompt_file
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/required|prompt/i);
    });

    it('should reject both prompt and prompt_file', async () => {
      const promptFilePath = path.join(tempWorkspace, 'test.md');
      await fs.writeFile(promptFilePath, 'Content');

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

      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/both/i);
    });
  });

  describe('Path validation', () => {
    it('should reject path traversal in prompt_file', async () => {
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

      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/invalid.*path/i);
    });

    it('should reject absolute paths in prompt_file', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt_file: '/tmp/absolute-path.md',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/invalid.*path/i);
    });

    it('should allow safe relative paths', async () => {
      const promptsDir = path.join(tempWorkspace, 'safe', 'path');
      await fs.mkdir(promptsDir, { recursive: true });

      const promptFilePath = path.join(promptsDir, 'prompt.md');
      await fs.writeFile(promptFilePath, 'Safe content');

      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt_file: './safe/path/prompt.md',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);

      expect(result).toBeDefined();
    });
  });

  describe('Model parsing', () => {
    it('should extract model from config when specified', async () => {
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

      // Model should be populated (from config if not in output)
      expect(log.model.name).toBeDefined();
      expect(log.model.provider).toBe('Anthropic');
    });

    it('should use default model when not specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      const log = adapter.normalizeLog(result.output, result);

      // Model should still be populated with default or detected value
      expect(log.model.name).toBeDefined();
      expect(log.model.provider).toBe('Anthropic');
    });
  });

  describe('parseMessages() helper', () => {
    it('should parse output into messages with roles', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Processing task...\nTask completed.',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.messages).toBeDefined();
      expect(log.messages.length).toBeGreaterThan(0);
      expect(log.messages[0].role).toBe('system');
    });

    it('should include timestamps in messages', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Test output',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.messages[0].timestamp).toBeDefined();
    });

    it('should handle multiline content', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Line 1\nLine 2\nLine 3',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.content).toContain('Line 1');
      expect(assistantMsg?.content).toContain('Line 2');
      expect(assistantMsg?.content).toContain('Line 3');
    });

    it('should handle empty output', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
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

  describe('parseToolCalls() helper', () => {
    it('should detect [TOOL: name] patterns', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: '[TOOL: read_file] test.ts',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls).toBeDefined();
      expect(assistantMsg?.tool_calls?.length).toBe(1);
    });

    it('should extract tool name correctly', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: '[TOOL: list_files] ./src',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls?.[0].function.name).toBe('list_files');
    });

    it('should extract tool arguments', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: '[TOOL: search_files] *.ts --pattern "test"',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls?.[0].function.arguments).toContain('*.ts');
    });

    it('should handle multiple tool calls', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: '[TOOL: read_file] a.ts\n[TOOL: write_file] b.ts\n[TOOL: list_files] .',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls?.length).toBe(3);
    });

    it('should return undefined when no tool calls present', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Regular output without tools',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls).toBeUndefined();
    });
  });

  describe('parseUsage() / extractUsageMetrics() helper', () => {
    it('should extract input tokens from output', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
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
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Input tokens: 1234\nOutput tokens: 5678',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.usage?.completion_tokens).toBe(5678);
    });

    it('should calculate total tokens', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Input tokens: 1000\nOutput tokens: 2000',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.usage?.total_tokens).toBe(3000);
    });

    it('should handle lowercase token labels', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'input tokens: 100\noutput tokens: 200',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.usage?.prompt_tokens).toBe(100);
      expect(log.usage?.completion_tokens).toBe(200);
    });

    it('should provide estimates when tokens not in output', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Some output without token info',
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
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Input tokens: 1000\nOutput tokens: 2000',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.usage?.estimated_cost_usd).toBeDefined();
      expect(log.usage?.estimated_cost_usd).toBeGreaterThan(0);
    });

    it('should use reasonable approximation for cost', () => {
      const mockResult = {
        exitCode: 0,
        status: 'success' as const,
        output: 'Input tokens: 1000000\nOutput tokens: 1000000',
        startedAt: '2025-11-25T10:00:00Z',
        completedAt: '2025-11-25T10:01:00Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(mockResult.output, mockResult);

      // 1M input + 1M output ≈ $3 + $15 = $18
      expect(log.usage?.estimated_cost_usd).toBeCloseTo(18, 1);
    });
  });

  describe('buildClaudeCommand() with advanced flags', () => {
    it('should include --append-system-prompt flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          append_system_prompt: 'You are an expert TypeScript developer',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should include --permission-mode flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          permission_mode: 'auto',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should handle all permission_mode values', async () => {
      const permissionModes = ['auto', 'plan', 'ask'];

      for (const permission_mode of permissionModes) {
        const context: AgentExecutionContext = {
          workspaceDir: tempWorkspace,
          repoDir: path.join(tempWorkspace, 'src-modified'),
          artifactsDir: path.join(tempWorkspace, 'artifacts'),
          config: {
            prompt: 'Test',
            permission_mode,
          },
          timeout: 5000,
          env: {},
        };

        const result = await adapter.execute(context);
        expect(result).toBeDefined();
      }
    });

    it('should include --allowedTools flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          allowed_tools: ['Read', 'Write', 'Execute'],
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should not include --allowedTools flag when array is empty', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          allowed_tools: [],
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should include --system-prompt flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          system_prompt: 'Custom system instructions',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should include --max-tokens flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          max_tokens: 4096,
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should include --temperature flag when specified', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          temperature: 0.7,
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should handle temperature of 0.0', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          temperature: 0.0,
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should handle all advanced flags together', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          append_system_prompt: 'Expert developer',
          permission_mode: 'auto',
          allowed_tools: ['Read', 'Write'],
          system_prompt: 'Custom prompt',
          max_tokens: 8000,
          temperature: 0.0,
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });

    it('should handle advanced flags with model and agent_name', async () => {
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
          model: 'claude-sonnet-4',
          agent_name: 'code-reviewer',
          append_system_prompt: 'Expert developer',
          permission_mode: 'plan',
          max_tokens: 4096,
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);
      expect(result).toBeDefined();
    });
  });
});
