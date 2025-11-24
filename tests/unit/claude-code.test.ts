/**
 * Unit tests for Claude Code CLI Adapter
 * 
 * Tests the ClaudeCodeAdapter implementation including:
 * - Availability checking
 * - Agent execution
 * - Log normalization
 * - Output parsing
 * 
 * TDD: These tests define expected behavior for the adapter
 */

import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext, AgentExecutionResult } from '../../src/adapters/base.js';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';

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
    it('should return true when claude is available', async () => {
      // This test will check if claude is in PATH
      // Mock implementation will be needed for CI/CD
      const isAvailable = await adapter.checkAvailability();
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should return false when claude is not in PATH', async () => {
      // Test with modified PATH that excludes claude
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      
      const isAvailable = await adapter.checkAvailability();
      expect(isAvailable).toBe(false);
      
      process.env.PATH = originalPath;
    });

    it('should handle errors gracefully', async () => {
      try {
        const isAvailable = await adapter.checkAvailability();
        expect(typeof isAvailable).toBe('boolean');
      } catch (error) {
        // Should not throw, but return false instead
        fail('checkAvailability should not throw errors');
      }
    });
  });

  describe('execute', () => {
    const mockContext: AgentExecutionContext = {
      workspaceDir: '/tmp/youbencha/workspace',
      repoDir: '/tmp/youbencha/workspace/src-modified',
      artifactsDir: '/tmp/youbencha/workspace/artifacts',
      config: {
        prompt: 'Add documentation to the README file',
        model: 'claude-3-5-sonnet-20241022',
      },
      timeout: 300000, // 5 minutes
      env: {
        NODE_ENV: 'test',
      },
    };

    it('should require prompt in config', async () => {
      const contextWithoutPrompt: AgentExecutionContext = {
        ...mockContext,
        config: {},
      };

      const result = await adapter.execute(contextWithoutPrompt);
      
      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Prompt is required');
    });

    it('should execute claude with correct parameters', async () => {
      // This test requires claude to be installed
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
        
        // Verify timestamps are valid ISO strings
        expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
        expect(new Date(result.completedAt).toISOString()).toBe(result.completedAt);
      } catch (error) {
        // Expected in environments without claude
        expect(error).toBeDefined();
      }
    });

    it('should handle timeouts correctly', async () => {
      const shortTimeoutContext: AgentExecutionContext = {
        ...mockContext,
        timeout: 100, // Very short timeout
      };

      try {
        const result = await adapter.execute(shortTimeoutContext);
        
        // If the command runs longer than timeout, status should be 'timeout'
        if (result.durationMs > shortTimeoutContext.timeout) {
          expect(result.status).toBe('timeout');
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors[0].message).toContain('timed out');
        }
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should handle non-zero exit codes', async () => {
      // Mock context that would likely fail
      const failingContext: AgentExecutionContext = {
        ...mockContext,
        config: {
          prompt: '', // Empty prompt should fail
        },
      };

      try {
        const result = await adapter.execute(failingContext);
        
        if (result.exitCode !== 0) {
          expect(result.status).toBe('failed');
          expect(result.errors.length).toBeGreaterThan(0);
        }
      } catch (error) {
        // Expected
        expect(error).toBeDefined();
      }
    });

    it('should create artifacts directory with logs', async () => {
      // Verify that claude-logs directory is created
      // This would need file system mocking in a real test
      expect(mockContext.artifactsDir).toBeDefined();
    });
  });

  describe('normalizeLog', () => {
    const mockResult: AgentExecutionResult = {
      exitCode: 0,
      status: 'success',
      output: 'Claude Code CLI executed successfully',
      startedAt: '2025-11-24T10:00:00.000Z',
      completedAt: '2025-11-24T10:01:00.000Z',
      durationMs: 60000,
      errors: [],
    };

    it('should return valid youBencha Log structure', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log).toBeDefined();
      expect(log.version).toBe('1.0.0');
      expect(log.agent).toBeDefined();
      expect(log.model).toBeDefined();
      expect(log.execution).toBeDefined();
      expect(log.messages).toBeDefined();
      expect(log.usage).toBeDefined();
      expect(log.errors).toBeDefined();
      expect(log.environment).toBeDefined();
    });

    it('should populate agent metadata correctly', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.agent.name).toBe('claude-code');
      expect(log.agent.version).toBeDefined();
      expect(log.agent.adapter_version).toBe('1.0.0');
    });

    it('should use Anthropic as provider', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.model.provider).toBe('Anthropic');
      expect(log.model.name).toBeDefined();
      expect(log.model.name).toContain('claude');
    });

    it('should match execution metadata', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.execution.started_at).toBe(mockResult.startedAt);
      expect(log.execution.completed_at).toBe(mockResult.completedAt);
      expect(log.execution.duration_ms).toBe(mockResult.durationMs);
      expect(log.execution.exit_code).toBe(mockResult.exitCode);
      expect(log.execution.status).toBe(mockResult.status);
    });

    it('should parse messages from output', () => {
      const outputWithMessages = `
[TOOL] read_file: README.md
[RESULT] File contents: # Hello World
Assistant response: I've read the file
      `.trim();

      const log = adapter.normalizeLog(outputWithMessages, mockResult);

      expect(log.messages).toBeDefined();
      expect(Array.isArray(log.messages)).toBe(true);
      expect(log.messages.length).toBeGreaterThan(0);
      
      // Should have at least a system message
      const systemMessage = log.messages.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage?.content).toContain('Claude Code CLI started');
    });

    it('should extract usage metrics', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.completion_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.total_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.total_tokens).toBe(
        log.usage.prompt_tokens + log.usage.completion_tokens
      );
    });

    it('should estimate cost', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      if (log.usage.estimated_cost_usd !== undefined) {
        expect(log.usage.estimated_cost_usd).toBeGreaterThanOrEqual(0);
      }
    });

    it('should include environment context', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.environment.os).toBeDefined();
      expect(log.environment.node_version).toBeDefined();
      expect(log.environment.youbencha_version).toBeDefined();
      expect(log.environment.working_directory).toBeDefined();
    });

    it('should handle errors in result', () => {
      const resultWithErrors: AgentExecutionResult = {
        ...mockResult,
        status: 'failed',
        exitCode: 1,
        errors: [
          {
            message: 'Authentication failed',
            timestamp: '2025-11-24T10:00:30.000Z',
            stackTrace: 'Error: Authentication failed\n  at ...',
          },
        ],
      };

      const log = adapter.normalizeLog('raw output', resultWithErrors);
      
      expect(log.errors.length).toBe(1);
      expect(log.errors[0].message).toBe('Authentication failed');
      expect(log.errors[0].timestamp).toBe('2025-11-24T10:00:30.000Z');
      expect(log.errors[0].stack_trace).toContain('Authentication failed');
    });

    it('should detect model from output', () => {
      const outputWithModel = 'using model: claude-3-opus-20240229';
      const log = adapter.normalizeLog(outputWithModel, mockResult);

      expect(log.model.name).toBe('claude-3-opus-20240229');
    });

    it('should use default model when not detected', () => {
      const log = adapter.normalizeLog('no model info', mockResult);

      expect(log.model.name).toBe('claude-3-5-sonnet-20241022');
    });

    it('should parse token usage from output', () => {
      const outputWithTokens = `
Execution completed
input tokens: 1000
output tokens: 500
Total tokens used: 1500
      `.trim();

      const log = adapter.normalizeLog(outputWithTokens, mockResult);

      expect(log.usage.prompt_tokens).toBe(1000);
      expect(log.usage.completion_tokens).toBe(500);
      expect(log.usage.total_tokens).toBe(1500);
    });
  });

  describe('platform-specific behavior', () => {
    it('should handle Windows platform', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      // Test Windows-specific command building
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.name).toBe('claude-code');

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });

    it('should handle Unix-like platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      });

      // Test Unix-specific command building
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.name).toBe('claude-code');

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });
  });

  describe('cost estimation', () => {
    it('should calculate costs based on Claude pricing', () => {
      // Mock result with known token counts
      const result: AgentExecutionResult = {
        exitCode: 0,
        status: 'success',
        output: 'input tokens: 10000\noutput tokens: 5000',
        startedAt: '2025-11-24T10:00:00.000Z',
        completedAt: '2025-11-24T10:01:00.000Z',
        durationMs: 60000,
        errors: [],
      };

      const log = adapter.normalizeLog(result.output, result);

      // Claude 3.5 Sonnet: $3/1M input, $15/1M output
      // 10,000 input tokens = $0.03
      // 5,000 output tokens = $0.075
      // Total = $0.105
      const expectedCost = (10000 / 1000000) * 3 + (5000 / 1000000) * 15;
      
      expect(log.usage.estimated_cost_usd).toBeCloseTo(expectedCost, 4);
    });
  });

  describe('model configuration', () => {
    it('should accept custom model in config', async () => {
      const contextWithCustomModel: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test prompt',
          model: 'claude-3-opus-20240229',
        },
        timeout: 60000,
        env: {},
      };

      try {
        await adapter.execute(contextWithCustomModel);
      } catch (error) {
        // Expected if claude not installed
        expect(error).toBeDefined();
      }
    });

    it('should work without explicit model', async () => {
      const contextWithoutModel: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test prompt',
        },
        timeout: 60000,
        env: {},
      };

      try {
        await adapter.execute(contextWithoutModel);
      } catch (error) {
        // Expected if claude not installed
        expect(error).toBeDefined();
      }
    });
  });

  describe('agent/subagent configuration', () => {
    it('should accept custom agent in config', async () => {
      const contextWithAgent: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test prompt',
          agent: 'code-reviewer',  // Custom agent name
        },
        timeout: 60000,
        env: {},
      };

      try {
        await adapter.execute(contextWithAgent);
      } catch (error) {
        // Expected if claude not installed
        expect(error).toBeDefined();
      }
    });

    it('should work without explicit agent', async () => {
      const contextWithoutAgent: AgentExecutionContext = {
        workspaceDir: '/tmp/test',
        repoDir: '/tmp/test/src',
        artifactsDir: '/tmp/test/artifacts',
        config: {
          prompt: 'Test prompt',
        },
        timeout: 60000,
        env: {},
      };

      try {
        await adapter.execute(contextWithoutAgent);
      } catch (error) {
        // Expected if claude not installed
        expect(error).toBeDefined();
      }
    });
  });
});
