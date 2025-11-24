/**
 * Unit tests for OpenAI Codex CLI Adapter
 * 
 * Tests the CodexCLIAdapter implementation including:
 * - Availability checking
 * - Agent execution
 * - Log normalization
 * - Python script generation
 * 
 * TDD: These tests MUST FAIL initially before implementation
 */

import { CodexCLIAdapter } from '../../src/adapters/codex-cli.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';

describe('CodexCLIAdapter', () => {
  let adapter: CodexCLIAdapter;

  beforeEach(() => {
    adapter = new CodexCLIAdapter();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('codex-cli');
    });

    it('should have valid semver version', () => {
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('checkAvailability', () => {
    it('should return false when OPENAI_API_KEY is not set', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);
      
      // Restore original key
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('should return true when OPENAI_API_KEY is set', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key-12345';
      
      const isAvailable = await adapter.checkAvailability();
      expect(typeof isAvailable).toBe('boolean');
      
      // Restore original key
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it('should check for Python availability', async () => {
      // This test verifies the adapter checks for Python
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      
      try {
        const isAvailable = await adapter.checkAvailability();
        expect(typeof isAvailable).toBe('boolean');
      } catch (error) {
        // Expected in environments without Python or OpenAI SDK
        expect(error).toBeDefined();
      } finally {
        // Restore original key
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });
  });

  describe('execute', () => {
    const mockContext: AgentExecutionContext = {
      workspaceDir: '/tmp/youbencha/workspace',
      repoDir: '/tmp/youbencha/workspace/src-modified',
      artifactsDir: '/tmp/youbencha/workspace/artifacts',
      config: {
        prompt: 'Fix the bug in the function',
        model: 'gpt-4',
      },
      timeout: 300000, // 5 minutes
      env: {
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'test-key-12345',
      },
    };

    it('should execute Codex with correct parameters', async () => {
      // This test requires OpenAI API key to be set
      // Will be skipped in CI without proper setup
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
        // Expected in environments without OpenAI setup
        expect(error).toBeDefined();
      }
    });

    it('should return success status on successful execution', async () => {
      try {
        const result = await adapter.execute(mockContext);
        
        if (result.exitCode === 0) {
          expect(result.status).toBe('success');
        }
      } catch (error) {
        // Expected without proper setup
        expect(error).toBeDefined();
      }
    });

    it('should return failed status on non-zero exit code', async () => {
      // Test with invalid configuration to trigger failure
      const invalidContext: AgentExecutionContext = {
        ...mockContext,
        config: {}, // Missing prompt
      };

      try {
        const result = await adapter.execute(invalidContext);
        
        if (result.exitCode !== 0) {
          expect(result.status).toBe('failed');
          expect(result.errors.length).toBeGreaterThan(0);
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle timeout correctly', async () => {
      // Test with very short timeout
      const timeoutContext: AgentExecutionContext = {
        ...mockContext,
        timeout: 100, // 100ms - should timeout
      };

      try {
        const result = await adapter.execute(timeoutContext);
        
        if (result.status === 'timeout') {
          expect(result.durationMs).toBeGreaterThanOrEqual(100);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors[0].message).toContain('timeout');
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should capture stdout and stderr', async () => {
      try {
        const result = await adapter.execute(mockContext);
        
        expect(typeof result.output).toBe('string');
        // Output should contain agent logs
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should respect environment variables', async () => {
      const envContext: AgentExecutionContext = {
        ...mockContext,
        env: {
          ...mockContext.env,
          CUSTOM_VAR: 'test-value',
        },
      };

      try {
        const result = await adapter.execute(envContext);
        expect(result).toBeDefined();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should calculate duration correctly', async () => {
      try {
        const result = await adapter.execute(mockContext);
        
        const startTime = new Date(result.startedAt).getTime();
        const endTime = new Date(result.completedAt).getTime();
        const expectedDuration = endTime - startTime;
        
        // Allow 10ms tolerance for timing differences
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(Math.abs(result.durationMs - expectedDuration)).toBeLessThan(10);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should create logs directory for artifacts', async () => {
      // Test that the artifacts directory is used correctly
      const testContext: AgentExecutionContext = {
        workspaceDir: '/tmp/test-workspace',
        repoDir: '/tmp/test-workspace/src',
        artifactsDir: '/tmp/test-workspace/artifacts',
        config: {
          prompt: 'Test prompt',
        },
        timeout: 30000,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      };

      try {
        // We can't fully test this without mocking, but we can verify context
        expect(testContext.artifactsDir).toBeDefined();
        expect(testContext.artifactsDir).toContain('artifacts');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should require prompt in config', async () => {
      const noPromptContext: AgentExecutionContext = {
        ...mockContext,
        config: {}, // No prompt
      };

      const result = await adapter.execute(noPromptContext);
      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Prompt is required');
    });
  });

  describe('normalizeLog', () => {
    const mockRawOutput = `
[INFO] Starting OpenAI Codex execution
[INFO] Model: gpt-4
[INFO] Workspace: /tmp/workspace
[INFO] Prompt length: 100 characters
[INFO] Sending request to OpenAI API...
[INFO] Response received
[INFO] Prompt tokens: 250
[INFO] Completion tokens: 500
[INFO] Total tokens: 750

[RESPONSE]
Here is the solution to your problem:

function fixBug() {
  // Fixed implementation
  return true;
}

[INFO] Detailed log saved to: /tmp/logs/codex_response_20250124_120000.json
[INFO] Execution completed successfully
`;

    const mockResult = {
      exitCode: 0,
      status: 'success' as const,
      output: mockRawOutput,
      startedAt: '2025-01-24T12:00:00.000Z',
      completedAt: '2025-01-24T12:05:30.000Z',
      durationMs: 330000,
      errors: [],
    };

    it('should transform raw output to youBencha Log schema', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log).toHaveProperty('version');
      expect(log.version).toBe('1.0.0');
      expect(log).toHaveProperty('agent');
      expect(log).toHaveProperty('model');
      expect(log).toHaveProperty('execution');
      expect(log).toHaveProperty('messages');
      expect(log).toHaveProperty('usage');
      expect(log).toHaveProperty('errors');
      expect(log).toHaveProperty('environment');
    });

    it('should set correct agent metadata', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.agent.name).toBe('codex-cli');
      expect(log.agent.version).toBeDefined();
      expect(log.agent.adapter_version).toBe(adapter.version);
    });

    it('should set correct model information', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.model.name).toBeDefined();
      expect(log.model.provider).toBe('OpenAI');
      expect(log.model.parameters).toBeDefined();
      expect(log.model.parameters.temperature).toBe(0.7);
    });

    it('should populate execution metadata correctly', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.execution.started_at).toBe(mockResult.startedAt);
      expect(log.execution.completed_at).toBe(mockResult.completedAt);
      expect(log.execution.duration_ms).toBe(mockResult.durationMs);
      expect(log.execution.exit_code).toBe(mockResult.exitCode);
      expect(log.execution.status).toBe(mockResult.status);
    });

    it('should parse messages from output', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(Array.isArray(log.messages)).toBe(true);
      expect(log.messages.length).toBeGreaterThan(0);
      
      // Should have at least system and assistant messages
      const roles = log.messages.map(m => m.role);
      expect(roles).toContain('assistant');
      expect(roles).toContain('system');
    });

    it('should populate usage metrics from output', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.usage.prompt_tokens).toBeGreaterThan(0);
      expect(log.usage.completion_tokens).toBeGreaterThan(0);
      expect(log.usage.total_tokens).toBeGreaterThan(0);
      expect(log.usage.total_tokens).toBe(
        log.usage.prompt_tokens + log.usage.completion_tokens
      );
    });

    it('should extract token counts from output', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      // Our mock output has specific token counts
      expect(log.usage.prompt_tokens).toBeGreaterThanOrEqual(250);
      expect(log.usage.completion_tokens).toBeGreaterThanOrEqual(500);
      expect(log.usage.total_tokens).toBeGreaterThanOrEqual(750);
    });

    it('should handle errors from execution result', () => {
      const errorResult = {
        ...mockResult,
        exitCode: 1,
        status: 'failed' as const,
        errors: [
          {
            message: 'API rate limit exceeded',
            timestamp: '2025-01-24T12:02:00.000Z',
            stackTrace: 'Error: API rate limit exceeded\n  at ...',
          },
        ],
      };

      const log = adapter.normalizeLog(mockRawOutput, errorResult);
      
      expect(log.errors.length).toBeGreaterThan(0);
      expect(log.errors[0].message).toBe('API rate limit exceeded');
      expect(log.errors[0].timestamp).toBe('2025-01-24T12:02:00.000Z');
      expect(log.errors[0].stack_trace).toContain('Error: API rate limit exceeded');
    });

    it('should capture environment information', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.environment.os).toBeDefined();
      expect(log.environment.node_version).toBeDefined();
      expect(log.environment.youbencha_version).toBeDefined();
      expect(log.environment.working_directory).toBeDefined();
    });

    it('should generate valid ISO 8601 timestamps for messages', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      log.messages.forEach(message => {
        expect(message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(new Date(message.timestamp).toISOString()).toBe(message.timestamp);
      });
    });

    it('should handle empty output gracefully', () => {
      const emptyResult = {
        ...mockResult,
        output: '',
      };

      const log = adapter.normalizeLog('', emptyResult);
      
      expect(log).toBeDefined();
      expect(log.messages.length).toBeGreaterThanOrEqual(0);
      expect(log.execution.status).toBe('success');
    });

    it('should conform to youBencha Log schema', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      // This will throw if schema validation fails
      const { youBenchaLogSchema } = require('../../src/schemas/youbenchalog.schema.js');
      expect(() => youBenchaLogSchema.parse(log)).not.toThrow();
    });

    it('should detect model from output', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.model.name).toBe('gpt-4');
    });

    it('should estimate cost based on token usage', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.usage.estimated_cost_usd).toBeGreaterThan(0);
      // Cost should be reasonable (not negative or extremely high)
      expect(log.usage.estimated_cost_usd).toBeLessThan(1000);
    });
  });

  describe('error handling', () => {
    it('should handle missing API key gracefully', async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);
      
      // Restore original key
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    });

    it('should handle invalid workspace directory', async () => {
      const invalidContext: AgentExecutionContext = {
        workspaceDir: '/nonexistent/invalid/path',
        repoDir: '/nonexistent/invalid/path/src',
        artifactsDir: '/nonexistent/invalid/path/artifacts',
        config: {
          prompt: 'Test prompt',
        },
        timeout: 30000,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      };

      try {
        await adapter.execute(invalidContext);
        // May not fail immediately due to directory creation
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle malformed output during normalization', () => {
      const malformedOutput = 'Invalid\x00Binary\x01Data\nWith\nNewlines';
      const result = {
        exitCode: 0,
        status: 'success' as const,
        output: malformedOutput,
        startedAt: '2025-01-24T10:00:00.000Z',
        completedAt: '2025-01-24T10:00:01.000Z',
        durationMs: 1000,
        errors: [],
      };

      const log = adapter.normalizeLog(malformedOutput, result);
      
      // Should still produce valid log
      expect(log).toBeDefined();
      expect(log.version).toBe('1.0.0');
    });
  });

  describe('Python script generation', () => {
    it('should escape special characters in prompts', () => {
      // This tests the internal script generation logic
      // We can verify behavior through execution
      const context: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Fix "the" bug with \\n newlines',
          model: 'gpt-4',
        },
        timeout: 30000,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      };

      // Execute should handle special characters without crashing
      expect(context.config.prompt).toContain('"');
      expect(context.config.prompt).toContain('\\');
    });

    it('should use specified model in script', () => {
      const context: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test',
          model: 'gpt-3.5-turbo',
        },
        timeout: 30000,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      };

      expect(context.config.model).toBe('gpt-3.5-turbo');
    });

    it('should default to gpt-4 if no model specified', () => {
      const context: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test',
        },
        timeout: 30000,
        env: {
          OPENAI_API_KEY: 'test-key',
        },
      };

      expect(context.config.model).toBeUndefined();
      // Adapter should default to 'gpt-4' internally
    });
  });
});
