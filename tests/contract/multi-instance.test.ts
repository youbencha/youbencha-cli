/**
 * Contract tests for multi-instance evaluator support
 * 
 * Tests the ability to have multiple instances of the same evaluator type
 * with different configurations and IDs.
 */

import { suiteConfigSchema } from '../../src/schemas/suite.schema.js';
import { EvaluationContext } from '../../src/evaluators/base.js';
import * as path from 'path';

describe('Multi-Instance Evaluator Support', () => {
  describe('Suite Schema Validation', () => {
    test('should accept evaluators with custom IDs', () => {
      const suite = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        evaluators: [
          {
            name: 'agentic-judge',
            id: 'code-quality',
            config: {
              type: 'copilot-cli',
              criteria: { quality: 'test' },
            },
          },
          {
            name: 'agentic-judge',
            id: 'security',
            config: {
              type: 'copilot-cli',
              criteria: { security: 'test' },
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(suite);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evaluators[0].id).toBe('code-quality');
        expect(result.data.evaluators[1].id).toBe('security');
      }
    });

    test('should accept evaluators without IDs (backwards compatible)', () => {
      const suite = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        evaluators: [
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              criteria: { quality: 'test' },
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(suite);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evaluators[0].id).toBeUndefined();
      }
    });

    test('should accept mix of evaluators with and without IDs', () => {
      const suite = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        evaluators: [
          {
            name: 'git-diff',
            config: {},
          },
          {
            name: 'agentic-judge',
            id: 'code-quality',
            config: {
              type: 'copilot-cli',
              criteria: { quality: 'test' },
            },
          },
          {
            name: 'agentic-judge',
            id: 'security',
            config: {
              type: 'copilot-cli',
              criteria: { security: 'test' },
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(suite);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evaluators[0].id).toBeUndefined();
        expect(result.data.evaluators[1].id).toBe('code-quality');
        expect(result.data.evaluators[2].id).toBe('security');
      }
    });

    test('should validate multi-judge suite example structure', () => {
      const suite = {
        repo: 'https://github.com/octocat/Hello-World.git',
        branch: 'master',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Add comprehensive error handling and input validation to the codebase',
          },
        },
        evaluators: [
          {
            name: 'git-diff',
            config: {},
          },
          {
            name: 'agentic-judge',
            id: 'code-quality',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              timeout: 300000,
              criteria: {
                code_structure: 'Code follows proper modular structure. Score 1-10.',
                naming_conventions: 'Variables and functions have clear, descriptive names. Score 1-10.',
                code_duplication: 'Minimal code duplication. Score 1-10.',
              },
            },
          },
          {
            name: 'agentic-judge',
            id: 'error-handling',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              timeout: 300000,
              criteria: {
                error_handling_coverage: 'All error conditions are handled appropriately. Score 1-10.',
                validation_completeness: 'Input validation is comprehensive. Score 1-10.',
                error_messages: 'Error messages are clear and actionable. Score 1-10.',
              },
            },
          },
          {
            name: 'agentic-judge',
            id: 'documentation',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              timeout: 300000,
              criteria: {
                inline_comments: 'Complex logic has helpful inline comments. Score 1-10.',
                function_documentation: 'Functions have proper documentation comments. Score 1-10.',
                readme_updates: 'README reflects code changes if applicable. Score 1-10.',
              },
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(suite);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evaluators).toHaveLength(4);
        expect(result.data.evaluators[1].name).toBe('agentic-judge');
        expect(result.data.evaluators[1].id).toBe('code-quality');
        expect(result.data.evaluators[2].id).toBe('error-handling');
        expect(result.data.evaluators[3].id).toBe('documentation');
      }
    });
  });

  describe('EvaluationContext', () => {
    test('should support optional evaluatorId field', () => {
      const context: EvaluationContext = {
        modifiedDir: '/tmp/modified',
        expectedDir: '/tmp/expected',
        artifactsDir: '/tmp/artifacts',
        agentLog: {} as any,
        config: {},
        suiteConfig: {} as any,
        evaluatorId: 'custom-id',
      };

      expect(context.evaluatorId).toBe('custom-id');
    });

    test('should work without evaluatorId (backwards compatible)', () => {
      const context: EvaluationContext = {
        modifiedDir: '/tmp/modified',
        artifactsDir: '/tmp/artifacts',
        agentLog: {} as any,
        config: {},
        suiteConfig: {} as any,
      };

      expect(context.evaluatorId).toBeUndefined();
    });
  });

  describe('Evaluator ID Formatting', () => {
    test('should format evaluator name with ID using colon separator', () => {
      const name = 'agentic-judge';
      const id = 'code-quality';
      const formatted = `${name}:${id}`;

      expect(formatted).toBe('agentic-judge:code-quality');
    });

    test('should use name alone when no ID provided', () => {
      const name = 'agentic-judge';
      const id = undefined;
      const formatted = id ? `${name}:${id}` : name;

      expect(formatted).toBe('agentic-judge');
    });

    test('should format multiple instances with different IDs', () => {
      const name = 'agentic-judge';
      const ids = ['code-quality', 'security', 'documentation'];
      const formatted = ids.map(id => `${name}:${id}`);

      expect(formatted).toEqual([
        'agentic-judge:code-quality',
        'agentic-judge:security',
        'agentic-judge:documentation',
      ]);
    });
  });
});
