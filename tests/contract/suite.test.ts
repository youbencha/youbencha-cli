/**
 * Contract tests for Suite Configuration schema
 * 
 * These tests define the contract for evaluation suite configuration.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure suite configurations are properly validated
 */

import { suiteConfigSchema, SuiteConfig } from '../../src/schemas/suite.schema';

describe('Suite Configuration Schema Contract', () => {
  describe('Valid Suite Configuration', () => {
    it('should validate a complete suite configuration', () => {
      const validConfig: SuiteConfig = {
        repo: 'https://github.com/example/test-repo',
        branch: 'main',
        commit: 'abc123def456',
        agent: {
          type: 'copilot-cli',
          config: {
            tools: ['read', 'write'],
            temperature: 0.7,
          },
        },
        expected_source: 'branch',
        expected: 'feature/ai-completed',
        evaluators: [
          {
            name: 'git-diff',
          },
          {
            name: 'expected-diff',
            config: {
              threshold: 0.85,
            },
          },
          {
            name: 'agentic-judge',
            config: {
              agent: {
                type: 'copilot-cli',
                config: {
                  tools: ['read', 'search', 'analyze'],
                  system_prompt: 'Evaluate code quality...',
                },
              },
              evaluation_criteria: [
                'All functions have error handling',
                'Test coverage >= 80%',
              ],
            },
          },
        ],
        workspace_dir: '.youbencha-workspace',
        timeout: 1800,
      };

      const result = suiteConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validConfig);
      }
    });

    it('should accept minimal valid configuration', () => {
      const minimalConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
    });

    it('should accept SSH repository URLs', () => {
      const config = {
        repo: 'git@github.com:example/test-repo.git',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept configuration with expected reference', () => {
      const config = {
        repo: 'https://github.com/example/test-repo',
        expected_source: 'branch',
        expected: 'feature/reference',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'expected-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept multiple evaluators with different configs', () => {
      const config = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
            config: { include_untracked: true },
          },
          {
            name: 'expected-diff',
            config: { threshold: 0.9, ignore_patterns: ['*.lock'] },
          },
          {
            name: 'agentic-judge',
            config: {
              agent: {
                type: 'copilot-cli',
                config: { system_prompt: 'Test prompt' },
              },
              evaluation_criteria: ['Quality check'],
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Suite Configuration', () => {
    it('should reject configuration without repo', () => {
      const invalidConfig = {
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject configuration without agent', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject configuration without evaluators', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject configuration with empty evaluators array', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject invalid agent type', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'invalid-agent', // Not copilot-cli
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject expected_source without expected value', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        expected_source: 'branch',
        // missing expected field
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject invalid expected_source value', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        expected_source: 'invalid-source', // Not 'branch'
        expected: 'some-ref',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject negative timeout', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
        timeout: -100, // Negative timeout
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject evaluator without name', () => {
      const invalidConfig = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            config: { some: 'config' },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Evaluator-specific validation', () => {
    it('should validate agentic-judge evaluator config', () => {
      const config = {
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'agentic-judge',
            config: {
              agent: {
                type: 'copilot-cli',
                config: {
                  tools: ['read', 'search'],
                  system_prompt: 'Evaluate the code...',
                },
              },
              evaluation_criteria: ['Error handling', 'Test coverage'],
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate expected-diff evaluator config', () => {
      const config = {
        repo: 'https://github.com/example/test-repo',
        expected_source: 'branch',
        expected: 'main',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'expected-diff',
            config: {
              threshold: 0.85,
              ignore_patterns: ['*.lock', 'node_modules/'],
            },
          },
        ],
      };

      const result = suiteConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      const config: SuiteConfig = {
        repo: 'https://github.com/example/test-repo',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: { temperature: 0.7 },
        },
        evaluators: [
          {
            name: 'git-diff',
            config: { include_untracked: true },
          },
        ],
        timeout: 1800,
      };

      // Type assertions to verify proper inference
      const repoUrl: string = config.repo;
      const agentType: 'copilot-cli' = config.agent.type;
      const evaluatorName: string = config.evaluators[0].name;

      expect(repoUrl).toBe('https://github.com/example/test-repo');
      expect(agentType).toBe('copilot-cli');
      expect(evaluatorName).toBe('git-diff');
    });
  });
});
