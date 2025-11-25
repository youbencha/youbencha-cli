/**
 * Contract tests for AgentAdapter interface
 * 
 * These tests define the contract that all agent adapters must follow.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure agent adapters conform to standard interface
 */

import {
  AgentAdapter,
  AgentExecutionContext,
  AgentExecutionResult,
} from '../../src/adapters/base';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema';

/**
 * Mock adapter for contract testing
 */
class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock-adapter';
  readonly version = '1.0.0';

  async checkAvailability(): Promise<boolean> {
    return true;
  }

  async execute(_context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startedAt = new Date().toISOString();
    const completedAt = new Date(Date.now() + 1000).toISOString();

    return {
      exitCode: 0,
      status: 'success',
      output: 'Mock agent output',
      startedAt,
      completedAt,
      durationMs: 1000,
      errors: [],
    };
  }

  normalizeLog(
    rawOutput: string,
    result: AgentExecutionResult
  ): YouBenchaLog {
    return {
      version: '1.0.0',
      agent: {
        name: this.name,
        version: this.version,
        adapter_version: '1.0.0',
      },
      model: {
        name: 'mock-model',
        provider: 'Mock Provider',
        parameters: {},
      },
      execution: {
        started_at: result.startedAt,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        exit_code: result.exitCode,
        status: result.status,
      },
      messages: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      errors: result.errors,
      environment: {
        os: 'Test',
        node_version: '20.0.0',
        youbencha_version: '0.1.0',
        working_directory: '/tmp/test',
      },
    };
  }
}

describe('AgentAdapter Contract', () => {
  let adapter: AgentAdapter;

  beforeEach(() => {
    adapter = new MockAgentAdapter();
  });

  describe('Interface Properties', () => {
    it('should have name property', () => {
      expect(adapter.name).toBeDefined();
      expect(typeof adapter.name).toBe('string');
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    it('should have version property', () => {
      expect(adapter.version).toBeDefined();
      expect(typeof adapter.version).toBe('string');
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/); // semver format
    });
  });

  describe('checkAvailability()', () => {
    it('should return a boolean', async () => {
      const result = await adapter.checkAvailability();
      expect(typeof result).toBe('boolean');
    });

    it('should not throw errors', async () => {
      await expect(adapter.checkAvailability()).resolves.not.toThrow();
    });
  });

  describe('execute()', () => {
    const mockContext: AgentExecutionContext = {
      workspaceDir: '/tmp/test-workspace',
      repoDir: '/tmp/test-workspace/src-modified',
      artifactsDir: '/tmp/test-workspace/artifacts',
      config: {},
      timeout: 60000,
      env: {},
    };

    it('should return valid AgentExecutionResult', async () => {
      const result = await adapter.execute(mockContext);

      expect(result).toBeDefined();
      expect(typeof result.exitCode).toBe('number');
      expect(result.status).toMatch(/^(success|failed|timeout)$/);
      expect(typeof result.output).toBe('string');
      expect(typeof result.startedAt).toBe('string');
      expect(typeof result.completedAt).toBe('string');
      expect(typeof result.durationMs).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should have valid timestamps', async () => {
      const result = await adapter.execute(mockContext);

      const startTime = new Date(result.startedAt).getTime();
      const endTime = new Date(result.completedAt).getTime();

      expect(startTime).toBeLessThanOrEqual(endTime);
      expect(isNaN(startTime)).toBe(false);
      expect(isNaN(endTime)).toBe(false);
    });

    it('should have non-negative duration', async () => {
      const result = await adapter.execute(mockContext);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should have consistent status and exit code', async () => {
      const result = await adapter.execute(mockContext);

      if (result.status === 'success') {
        expect(result.exitCode).toBe(0);
      }
      if (result.exitCode === 0) {
        expect(result.status).toBe('success');
      }
    });

    it('should populate errors array on failure', async () => {
      // Note: This test assumes the adapter properly implements error handling
      const result = await adapter.execute(mockContext);

      if (result.status === 'failed') {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('normalizeLog()', () => {
    const mockResult: AgentExecutionResult = {
      exitCode: 0,
      status: 'success',
      output: 'Test output',
      startedAt: '2025-11-04T10:00:00.000Z',
      completedAt: '2025-11-04T10:01:00.000Z',
      durationMs: 60000,
      errors: [],
    };

    it('should return valid youBencha Log', () => {
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

    it('should have matching execution metadata', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.execution.started_at).toBe(mockResult.startedAt);
      expect(log.execution.completed_at).toBe(mockResult.completedAt);
      expect(log.execution.duration_ms).toBe(mockResult.durationMs);
      expect(log.execution.exit_code).toBe(mockResult.exitCode);
      expect(log.execution.status).toBe(mockResult.status);
    });

    it('should have agent metadata', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.agent.name).toBe(adapter.name);
      expect(log.agent.version).toBeDefined();
      expect(log.agent.adapter_version).toBeDefined();
    });

    it('should have model metadata', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.model.name).toBeDefined();
      expect(log.model.provider).toBeDefined();
      expect(typeof log.model.parameters).toBe('object');
    });

    it('should have usage statistics', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(typeof log.usage.prompt_tokens).toBe('number');
      expect(typeof log.usage.completion_tokens).toBe('number');
      expect(typeof log.usage.total_tokens).toBe('number');
      expect(log.usage.prompt_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.completion_tokens).toBeGreaterThanOrEqual(0);
      expect(log.usage.total_tokens).toBeGreaterThanOrEqual(0);
    });

    it('should have environment context', () => {
      const log = adapter.normalizeLog('raw output', mockResult);

      expect(log.environment.os).toBeDefined();
      expect(log.environment.node_version).toBeDefined();
      expect(log.environment.youbencha_version).toBeDefined();
      expect(log.environment.working_directory).toBeDefined();
    });

    it('should include errors from result', () => {
      const resultWithErrors: AgentExecutionResult = {
        ...mockResult,
        status: 'failed',
        exitCode: 1,
        errors: [
          {
            message: 'Test error',
            timestamp: '2025-11-04T10:00:30.000Z',
          },
        ],
      };

      const log = adapter.normalizeLog('raw output', resultWithErrors);
      expect(log.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Context Handling', () => {
    it('should accept custom configuration', async () => {
      const contextWithConfig: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {
          temperature: 0.7,
          customOption: 'value',
        },
        timeout: 120000,
        env: {},
      };

      await expect(adapter.execute(contextWithConfig)).resolves.toBeDefined();
    });

    it('should accept environment variables', async () => {
      const contextWithEnv: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {},
        timeout: 60000,
        env: {
          CUSTOM_VAR: 'value',
        },
      };

      await expect(adapter.execute(contextWithEnv)).resolves.toBeDefined();
    });

    it('should respect timeout setting', async () => {
      const contextWithTimeout: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {},
        timeout: 1000, // 1 second
        env: {},
      };

      const result = await adapter.execute(contextWithTimeout);
      
      // If execution takes longer than timeout, status should be 'timeout'
      if (result.durationMs > contextWithTimeout.timeout) {
        expect(result.status).toBe('timeout');
      }
    });

    // Phase 4: Model parameter support (CR-2.6)
    it('should accept model parameter in config', async () => {
      const contextWithModel: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {
          prompt: 'Test prompt',
          model: 'claude-sonnet-4',
        },
        timeout: 60000,
        env: {},
      };

      await expect(adapter.execute(contextWithModel)).resolves.toBeDefined();
    });

    // Phase 4: Agent name parameter support (CR-2.7)
    it('should accept agent_name parameter in config', async () => {
      const contextWithAgentName: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {
          prompt: 'Test prompt',
          agent_name: 'code-reviewer',
        },
        timeout: 60000,
        env: {},
      };

      await expect(adapter.execute(contextWithAgentName)).resolves.toBeDefined();
    });

    // Phase 5: Prompt file support (CR-2.5)
    it('should accept prompt_file parameter in config', async () => {
      const contextWithPromptFile: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {
          prompt_file: './prompts/task.md',
        },
        timeout: 60000,
        env: {},
      };

      // This should be accepted by the interface even if file doesn't exist
      // (file validation is implementation-specific)
      await expect(adapter.execute(contextWithPromptFile)).resolves.toBeDefined();
    });

    // Phase 5: Mutual exclusivity of prompt and prompt_file (CR-4.1)
    it('should handle mutually exclusive prompt and prompt_file', async () => {
      const contextWithBoth: AgentExecutionContext = {
        workspaceDir: '/tmp/workspace',
        repoDir: '/tmp/workspace/src-modified',
        artifactsDir: '/tmp/workspace/artifacts',
        config: {
          prompt: 'Inline prompt',
          prompt_file: './prompts/task.md',
        },
        timeout: 60000,
        env: {},
      };

      // Implementation should handle this gracefully - either succeed or fail
      // but should not throw an unhandled exception
      await expect(adapter.execute(contextWithBoth)).resolves.toBeDefined();
    });
  });
});
