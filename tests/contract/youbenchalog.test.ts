/**
 * Contract tests for youBencha Log schema
 * 
 * These tests define the contract for the youBencha Log format.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure normalized agent logs conform to standard schema
 */

import { youBenchaLogSchema, YouBenchaLog } from '../../src/schemas/youbenchalog.schema';

describe('youBencha Log Schema Contract', () => {
  describe('Valid youBencha Log', () => {
    it('should validate a complete valid youBencha Log', () => {
      const validLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'GitHub Copilot CLI',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'gpt-4',
          provider: 'OpenAI',
          parameters: {
            temperature: 0.7,
            max_tokens: 4096,
          },
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:05:00.000Z',
          duration_ms: 300000,
          exit_code: 0,
          status: 'success',
        },
        messages: [
          {
            role: 'system',
            content: 'You are a helpful coding assistant.',
            timestamp: '2025-11-04T10:00:00.000Z',
          },
          {
            role: 'user',
            content: 'Implement a function to calculate fibonacci.',
            timestamp: '2025-11-04T10:00:01.000Z',
          },
          {
            role: 'assistant',
            content: 'Here is the implementation...',
            timestamp: '2025-11-04T10:00:05.000Z',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'create_file',
                  arguments: '{"path": "fibonacci.ts", "content": "..."}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: 'File created successfully',
            timestamp: '2025-11-04T10:00:06.000Z',
            tool_call_id: 'call_123',
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 300,
          total_tokens: 450,
          estimated_cost_usd: 0.0045,
        },
        errors: [],
        environment: {
          os: 'Windows_NT',
          node_version: '20.10.0',
          youbencha_version: '0.1.0',
          working_directory: 'C:\\workspace\\test-run',
        },
      };

      const result = youBenchaLogSchema.safeParse(validLog);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validLog);
      }
    });

    it('should accept minimal valid youBencha Log', () => {
      const minimalLog = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'gpt-4',
          provider: 'OpenAI',
          parameters: {},
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(minimalLog);
      expect(result.success).toBe(true);
    });

    it('should accept log with errors', () => {
      const logWithErrors = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'gpt-4',
          provider: 'OpenAI',
          parameters: {},
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 1,
          status: 'failed',
        },
        messages: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 0,
          total_tokens: 100,
        },
        errors: [
          {
            message: 'API request failed',
            timestamp: '2025-11-04T10:00:30.000Z',
            stack_trace: 'Error: API request failed\n  at...',
          },
        ],
        environment: {
          os: 'Darwin',
          node_version: '20.10.0',
          youbencha_version: '0.1.0',
          working_directory: '/Users/test/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(logWithErrors);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid youBencha Log', () => {
    it('should reject log without version', () => {
      const invalidLog = {
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });

    it('should reject log with invalid version', () => {
      const invalidLog = {
        version: '2.0.0', // Invalid version
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });

    it('should reject log with invalid status', () => {
      const invalidLog = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'invalid-status', // Invalid status
        },
        messages: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });

    it('should reject log with invalid message role', () => {
      const invalidLog = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [
          {
            role: 'invalid-role', // Invalid role
            content: 'Test message',
            timestamp: '2025-11-04T10:00:00.000Z',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });

    it('should reject log with negative duration', () => {
      const invalidLog = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: -100, // Negative duration
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });

    it('should reject log with negative token counts', () => {
      const invalidLog = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: -10, // Negative tokens
          completion_tokens: 0,
          total_tokens: 0,
        },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(invalidLog);
      expect(result.success).toBe(false);
    });
  });

  describe('Message validation', () => {
    it('should validate assistant message with tool calls', () => {
      const log = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [
          {
            role: 'assistant',
            content: 'Let me create that file',
            timestamp: '2025-11-04T10:00:00.000Z',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: {
                  name: 'create_file',
                  arguments: '{"path": "test.ts"}',
                },
              },
            ],
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    });

    it('should validate tool message with tool_call_id', () => {
      const log = {
        version: '1.0.0',
        agent: { name: 'Test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'OpenAI', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [
          {
            role: 'tool',
            content: 'File created',
            timestamp: '2025-11-04T10:00:00.000Z',
            tool_call_id: 'call_abc',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      const result = youBenchaLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      // This test validates that TypeScript types are properly inferred
      const log: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'gpt-4',
          provider: 'OpenAI',
          parameters: { temperature: 0.7 },
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        },
        errors: [],
        environment: {
          os: 'Linux',
          node_version: '20.0.0',
          youbencha_version: '0.1.0',
          working_directory: '/tmp/workspace',
        },
      };

      // Type assertions to verify proper inference
      const agentName: string = log.agent.name;
      const exitCode: number = log.execution.exit_code;
      const status: 'success' | 'failed' | 'timeout' = log.execution.status;
      
      expect(agentName).toBe('Test Agent');
      expect(exitCode).toBe(0);
      expect(status).toBe('success');
    });
  });
});
