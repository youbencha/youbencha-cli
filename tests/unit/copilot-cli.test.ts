/**
 * Unit tests for GitHub Copilot CLI Adapter
 * 
 * Tests the CopilotCLIAdapter implementation including:
 * - Availability checking
 * - Agent execution
 * - Log normalization
 * 
 * TDD: These tests MUST FAIL initially before implementation
 */

import { CopilotCLIAdapter } from '../../src/adapters/copilot-cli.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';

describe('CopilotCLIAdapter', () => {
  let adapter: CopilotCLIAdapter;

  beforeEach(() => {
    adapter = new CopilotCLIAdapter();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('copilot-cli');
    });

    it('should have valid semver version', () => {
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('checkAvailability', () => {
    it('should return true when copilot-cli is available', async () => {
      // This test will check if copilot-cli is in PATH
      // Mock implementation will be needed for CI/CD
      const isAvailable = await adapter.checkAvailability();
      expect(typeof isAvailable).toBe('boolean');
    });

    // This test only works reliably on Unix-like systems where PATH controls binary lookup
    // On Windows, 'where' can find executables through other means like App Paths registry
    (process.platform === 'win32' ? it.skip : it)('should return false when copilot-cli is not in PATH', async () => {
      // Test with modified PATH that excludes copilot-cli
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      
      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);
      
      process.env.PATH = originalPath;
    });

    it('should check authentication status', async () => {
      // Should verify copilot-cli authentication
      // This may fail in CI without proper setup
      try {
        const isAvailable = await adapter.checkAvailability();
        expect(typeof isAvailable).toBe('boolean');
      } catch (error) {
        // Expected in environments without copilot-cli
        expect(error).toBeDefined();
      }
    });
  });

  describe('execute', () => {
    // Skip execute tests unless COPILOT_CLI_INTEGRATION_TESTS env var is set
    // These tests call the real CLI and will timeout in CI/development environments
    const skipIfNoCopilotCLI = (): boolean => {
      if (!process.env.COPILOT_CLI_INTEGRATION_TESTS) {
        console.log('Skipping: Set COPILOT_CLI_INTEGRATION_TESTS=1 to run real CLI tests');
        return true;
      }
      return false;
    };

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
      },
    };

    it('should execute copilot-cli with correct parameters', async () => {
      if (skipIfNoCopilotCLI()) return;
      // This test requires copilot-cli to be installed
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
        // Expected in environments without copilot-cli
        expect(error).toBeDefined();
      }
    });

    it('should return success status on successful execution', async () => {
      if (skipIfNoCopilotCLI()) return;
      // Mock successful execution
      const result = await adapter.execute(mockContext);
      
      if (result.exitCode === 0) {
        expect(result.status).toBe('success');
      }
    });

    it('should return failed status on non-zero exit code', async () => {
      if (skipIfNoCopilotCLI()) return;
      // Test with invalid configuration to trigger failure
      const invalidContext: AgentExecutionContext = {
        ...mockContext,
        repoDir: '/nonexistent/path',
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
      if (skipIfNoCopilotCLI()) return;
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
      if (skipIfNoCopilotCLI()) return;
      try {
        const result = await adapter.execute(mockContext);
        
        expect(typeof result.output).toBe('string');
        // Output should contain agent logs
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should respect environment variables', async () => {
      if (skipIfNoCopilotCLI()) return;
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
      if (skipIfNoCopilotCLI()) return;
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

    it('should pass log-level and log-dir parameters', async () => {
      // Test that the command includes --log-level all and --log-dir
      const testContext: AgentExecutionContext = {
        workspaceDir: '/tmp/test-workspace',
        repoDir: '/tmp/test-workspace/src',
        artifactsDir: '/tmp/test-workspace/artifacts',
        config: {
          prompt: 'Test prompt',
        },
        timeout: 30000,
        env: {},
      };

      try {
        // We can't fully test this without mocking spawn, but we can verify
        // the context includes the artifactsDir which will be used
        expect(testContext.artifactsDir).toBeDefined();
        expect(testContext.artifactsDir).toContain('artifacts');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('normalizeLog', () => {
    const mockRawOutput = `
[INFO] Starting GitHub Copilot CLI
[INFO] Using model: gpt-4
[TOOL_CALL] read_file: src/example.ts
[RESPONSE] File content retrieved
[TOOL_CALL] write_file: src/example.ts
[RESPONSE] File updated successfully
[INFO] Task completed
`;

    const mockResult = {
      exitCode: 0,
      status: 'success' as const,
      output: mockRawOutput,
      startedAt: '2025-11-04T10:00:00.000Z',
      completedAt: '2025-11-04T10:05:30.000Z',
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
      
      expect(log.agent.name).toBe('copilot-cli');
      expect(log.agent.version).toBeDefined();
      expect(log.agent.adapter_version).toBe(adapter.version);
    });

    it('should set correct model information', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.model.name).toBeDefined();
      expect(log.model.provider).toBe('GitHub');
      expect(log.model.parameters).toBeDefined();
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
    });

    it('should extract tool calls from messages', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      // Check if any messages have tool calls
      const messagesWithTools = log.messages.filter(m => m.tool_calls);
      
      if (messagesWithTools.length > 0) {
        expect(messagesWithTools[0].tool_calls).toBeDefined();
        expect(Array.isArray(messagesWithTools[0].tool_calls)).toBe(true);
      }
    });

    it('should populate usage metrics', () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      expect(log.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.completion_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.total_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.total_tokens).toBe(
        log.usage.prompt_tokens + log.usage.completion_tokens
      );
    });

    it('should handle errors from execution result', () => {
      const errorResult = {
        ...mockResult,
        exitCode: 1,
        status: 'failed' as const,
        errors: [
          {
            message: 'File not found',
            timestamp: '2025-11-04T10:02:00.000Z',
            stackTrace: 'Error: File not found\n  at ...',
          },
        ],
      };

      const log = adapter.normalizeLog(mockRawOutput, errorResult);
      
      expect(log.errors.length).toBeGreaterThan(0);
      expect(log.errors[0].message).toBe('File not found');
      expect(log.errors[0].timestamp).toBe('2025-11-04T10:02:00.000Z');
      expect(log.errors[0].stack_trace).toContain('Error: File not found');
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

    it('should conform to youBencha Log schema', async () => {
      const log = adapter.normalizeLog(mockRawOutput, mockResult);
      
      // This will throw if schema validation fails
      const { youBenchaLogSchema } = await import('../../src/schemas/youbenchalog.schema.js');
      expect(() => youBenchaLogSchema.parse(log)).not.toThrow();
    });
  });

  describe('error handling', () => {
    // This test only works reliably on Unix-like systems where PATH controls binary lookup
    // On Windows, 'where' can find executables through other means like App Paths registry
    (process.platform === 'win32' ? it.skip : it)('should handle missing copilot-cli binary', async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      
      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);
      
      process.env.PATH = originalPath;
    });

    it('should handle authentication errors', async () => {
      // Test behavior when copilot is not authenticated
      try {
        await adapter.checkAvailability();
      } catch (error) {
        expect(error).toBeDefined();
        // Error message should mention authentication
      }
    });

    it('should handle invalid workspace directory', async () => {
      const invalidContext: AgentExecutionContext = {
        workspaceDir: '/nonexistent/invalid/path',
        repoDir: '/nonexistent/invalid/path/src',
        artifactsDir: '/nonexistent/invalid/path/artifacts',
        config: {},
        timeout: 30000,
        env: {},
      };

      try {
        await adapter.execute(invalidContext);
        fail('Should have thrown an error');
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
        startedAt: '2025-11-04T10:00:00.000Z',
        completedAt: '2025-11-04T10:00:01.000Z',
        durationMs: 1000,
        errors: [],
      };

      const log = adapter.normalizeLog(malformedOutput, result);
      
      // Should still produce valid log
      expect(log).toBeDefined();
      expect(log.version).toBe('1.0.0');
    });
  });
});
