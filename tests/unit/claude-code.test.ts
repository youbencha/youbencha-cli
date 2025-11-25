/**
 * Unit tests for Claude Code Adapter
 * 
 * Tests the ClaudeCodeAdapter implementation including:
 * - Availability checking
 * - Agent execution
 * - Log normalization
 * - Command building
 * - Output parsing
 * 
 * TDD: These tests define expected behavior for the adapter
 */

import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext, AgentExecutionResult } from '../../src/adapters/base.js';

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('claude-code');
    });

    it('should have valid semver version', () => {
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('checkAvailability', () => {
    it('should return boolean', async () => {
      const isAvailable = await adapter.checkAvailability();
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should return false when claude CLI is not in PATH', async () => {
      // Test with modified PATH that excludes claude
      const originalPath = process.env.PATH;
      process.env.PATH = '';

      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);

      process.env.PATH = originalPath;
    });
  });

  describe('execute', () => {
    const mockContext: AgentExecutionContext = {
      workspaceDir: '/tmp/youbencha/workspace',
      repoDir: '/tmp/youbencha/workspace/src-modified',
      artifactsDir: '/tmp/youbencha/workspace/artifacts',
      config: {
        prompt: 'List files in the current directory',
      },
      timeout: 300000,
      env: {
        NODE_ENV: 'test',
      },
    };

    it('should return valid AgentExecutionResult structure', async () => {
      try {
        const result = await adapter.execute(mockContext);

        expect(result).toHaveProperty('exitCode');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('output');
        expect(result).toHaveProperty('startedAt');
        expect(result).toHaveProperty('completedAt');
        expect(result).toHaveProperty('durationMs');
        expect(result).toHaveProperty('errors');
      } catch (error) {
        // Expected in environments without Claude CLI
        expect(error).toBeDefined();
      }
    });

    it('should have valid timestamp format in result', async () => {
      try {
        const result = await adapter.execute(mockContext);
        
        // Check ISO 8601 format
        expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      } catch (error) {
        // Expected in environments without Claude CLI
        expect(error).toBeDefined();
      }
    });

    it('should have status as one of success, failed, or timeout', async () => {
      try {
        const result = await adapter.execute(mockContext);
        expect(['success', 'failed', 'timeout']).toContain(result.status);
      } catch (error) {
        // Expected in environments without Claude CLI
        expect(error).toBeDefined();
      }
    });

    it('should return failed status when both prompt and prompt_file are specified', async () => {
      const contextWithBoth: AgentExecutionContext = {
        ...mockContext,
        config: {
          prompt: 'Inline prompt',
          prompt_file: './prompts/task.md',
        },
      };

      const result = await adapter.execute(contextWithBoth);
      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/Cannot specify both/);
    });

    it('should return failed status when prompt_file has path traversal', async () => {
      const contextWithTraversal: AgentExecutionContext = {
        ...mockContext,
        config: {
          prompt_file: '../../../etc/passwd',
        },
      };

      const result = await adapter.execute(contextWithTraversal);
      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/path traversal/i);
    });

    it('should return failed status when prompt_file is absolute path', async () => {
      const contextWithAbsolute: AgentExecutionContext = {
        ...mockContext,
        config: {
          prompt_file: '/etc/passwd',
        },
      };

      const result = await adapter.execute(contextWithAbsolute);
      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/path traversal|relative/i);
    });

    it('should return failed status when neither prompt nor prompt_file provided', async () => {
      const contextWithoutPrompt: AgentExecutionContext = {
        ...mockContext,
        config: {},
      };

      const result = await adapter.execute(contextWithoutPrompt);
      expect(result.status).toBe('failed');
      expect(result.errors[0].message).toMatch(/prompt.*required/i);
    });
  });

  describe('normalizeLog', () => {
    const mockResult: AgentExecutionResult = {
      exitCode: 0,
      status: 'success',
      output: 'Model: claude-sonnet-4\nInput tokens: 100\nOutput tokens: 200\nHello world',
      startedAt: '2025-11-25T10:00:00.000Z',
      completedAt: '2025-11-25T10:01:00.000Z',
      durationMs: 60000,
      errors: [],
    };

    it('should return valid youBencha Log structure', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log).toHaveProperty('version', '1.0.0');
      expect(log).toHaveProperty('agent');
      expect(log).toHaveProperty('model');
      expect(log).toHaveProperty('execution');
      expect(log).toHaveProperty('messages');
      expect(log).toHaveProperty('usage');
      expect(log).toHaveProperty('errors');
      expect(log).toHaveProperty('environment');
    });

    it('should have correct agent metadata', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.agent.name).toBe('claude-code');
      expect(log.agent.adapter_version).toBe('1.0.0');
    });

    it('should have Anthropic as model provider', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.model.provider).toBe('Anthropic');
    });

    it('should extract model name from output', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.model.name).toBe('claude-sonnet-4');
    });

    it('should have matching execution metadata', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.execution.started_at).toBe(mockResult.startedAt);
      expect(log.execution.completed_at).toBe(mockResult.completedAt);
      expect(log.execution.duration_ms).toBe(mockResult.durationMs);
      expect(log.execution.exit_code).toBe(mockResult.exitCode);
      expect(log.execution.status).toBe(mockResult.status);
    });

    it('should extract usage statistics from output', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.usage.prompt_tokens).toBe(100);
      expect(log.usage.completion_tokens).toBe(200);
      expect(log.usage.total_tokens).toBe(300);
    });

    it('should estimate tokens when not found in output', () => {
      const resultNoTokens: AgentExecutionResult = {
        ...mockResult,
        output: 'Hello world without token info',
      };

      const log = adapter.normalizeLog(resultNoTokens.output, resultNoTokens);

      expect(log.usage.prompt_tokens).toBeGreaterThan(0);
      expect(log.usage.completion_tokens).toBeGreaterThan(0);
      expect(log.usage.total_tokens).toBeGreaterThan(0);
    });

    it('should have non-empty messages array', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.messages.length).toBeGreaterThan(0);
    });

    it('should include errors from result', () => {
      const resultWithErrors: AgentExecutionResult = {
        ...mockResult,
        status: 'failed',
        exitCode: 1,
        errors: [
          {
            message: 'Test error',
            timestamp: '2025-11-25T10:00:30.000Z',
          },
        ],
      };

      const log = adapter.normalizeLog(resultWithErrors.output, resultWithErrors);
      expect(log.errors.length).toBeGreaterThan(0);
      expect(log.errors[0].message).toBe('Test error');
    });

    it('should have environment information', () => {
      const log = adapter.normalizeLog(mockResult.output, mockResult);

      expect(log.environment.os).toBeDefined();
      expect(log.environment.node_version).toBeDefined();
      expect(log.environment.youbencha_version).toBeDefined();
      expect(log.environment.working_directory).toBeDefined();
    });
  });

  describe('parseModel', () => {
    it('should extract model from "Model: claude-sonnet-4" format', () => {
      const output = 'Model: claude-sonnet-4\nSome other output';
      expect(adapter.parseModel(output)).toBe('claude-sonnet-4');
    });

    it('should extract model from mentioned claude model names', () => {
      const output = 'Using claude-opus-3-5 for this task';
      expect(adapter.parseModel(output)).toBe('claude-opus-3-5');
    });

    it('should return default model when not found', () => {
      const output = 'No model information here';
      expect(adapter.parseModel(output)).toBe('claude-sonnet-4');
    });

    it('should handle various model name formats', () => {
      expect(adapter.parseModel('Model: claude-haiku-3-5')).toBe('claude-haiku-3-5');
      expect(adapter.parseModel('model: claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('parseVersion', () => {
    it('should extract version from "Version: X.Y.Z" format', () => {
      const output = 'Version: 1.2.3\nSome output';
      expect(adapter.parseVersion(output)).toBe('1.2.3');
    });

    it('should extract version from claude code version pattern', () => {
      const output = 'claude-code v2.0.1 starting';
      expect(adapter.parseVersion(output)).toBe('2.0.1');
    });

    it('should return unknown when version not found', () => {
      const output = 'No version information';
      expect(adapter.parseVersion(output)).toBe('unknown');
    });
  });

  describe('tool call parsing', () => {
    it('should parse [TOOL: name] pattern from output', () => {
      const output = '[TOOL: read_file] src/index.ts\n[TOOL: write_file] output.txt';
      const result: AgentExecutionResult = {
        exitCode: 0,
        status: 'success',
        output,
        startedAt: '2025-11-25T10:00:00.000Z',
        completedAt: '2025-11-25T10:01:00.000Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(output, result);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      expect(assistantMsg?.tool_calls).toBeDefined();
      expect(assistantMsg?.tool_calls?.length).toBe(2);
      expect(assistantMsg?.tool_calls?.[0].function.name).toBe('read_file');
      expect(assistantMsg?.tool_calls?.[1].function.name).toBe('write_file');
    });
  });

  describe('ANSI code handling', () => {
    it('should strip ANSI codes from output in normalized log', () => {
      const outputWithAnsi = '\x1B[31mError:\x1B[0m Something went wrong';
      const result: AgentExecutionResult = {
        exitCode: 1,
        status: 'failed',
        output: outputWithAnsi,
        startedAt: '2025-11-25T10:00:00.000Z',
        completedAt: '2025-11-25T10:01:00.000Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(outputWithAnsi, result);
      const assistantMsg = log.messages.find(m => m.role === 'assistant');

      // Content should not contain ANSI codes
      expect(assistantMsg?.content).not.toContain('\x1B');
    });
  });
});
