/**
 * Contract tests for Eval Configuration schema
 * 
 * These tests define the contract for eval-only configuration.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure eval configurations are properly validated
 */

import { evalConfigSchema, EvalConfig } from '../../src/schemas/eval.schema';

describe('Eval Configuration Schema Contract', () => {
  describe('Valid Eval Configuration', () => {
    it('should validate a complete eval configuration', () => {
      const validConfig: EvalConfig = {
        name: 'Test Evaluation',
        description: 'Testing evaluators on existing code',
        directory: './test-directory',
        expected_directory: './expected-directory',
        evaluators: [
          {
            name: 'git-diff',
            config: {
              thresholds: {
                files_changed: 10,
                lines_added: 100,
              },
            },
          },
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              assertions: {
                test_1: 'Code is well documented',
              },
            },
          },
        ],
        post_evaluation: [
          {
            name: 'webhook',
            config: {
              url: 'https://example.com/webhook',
            },
          },
        ],
        output_dir: '.youbencha-eval',
      };

      const result = evalConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        // Check that required fields are present (defaults may be added by schema)
        expect(result.data.name).toBe(validConfig.name);
        expect(result.data.description).toBe(validConfig.description);
        expect(result.data.directory).toBe(validConfig.directory);
        expect(result.data.evaluators.length).toBe(validConfig.evaluators.length);
      }
    });

    it('should accept minimal valid configuration', () => {
      const minimalConfig = {
        name: 'Minimal Eval',
        description: 'Minimal evaluation',
        directory: './test-dir',
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = evalConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
    });

    it('should allow evaluators without config', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        evaluators: [
          {
            name: 'git-diff',
          },
        ],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Eval Configuration', () => {
    it('should reject configuration without name', () => {
      const config = {
        description: 'Test',
        directory: './test',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject configuration without description', () => {
      const config = {
        name: 'Test',
        directory: './test',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject configuration without directory', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject configuration without evaluators', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject configuration with empty evaluators array', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        evaluators: [],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject name that exceeds max length', () => {
      const config = {
        name: 'A'.repeat(201),
        description: 'Test',
        directory: './test',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject description that exceeds max length', () => {
      const config = {
        name: 'Test',
        description: 'A'.repeat(1001),
        directory: './test',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty directory', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: '',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Evaluator Configuration', () => {
    it('should accept evaluator with config', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        evaluators: [
          {
            name: 'git-diff',
            config: {
              threshold: 0.8,
            },
          },
        ],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept multiple evaluators', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        evaluators: [
          { name: 'git-diff' },
          { name: 'expected-diff' },
          {
            name: 'agentic-judge',
            config: { assertions: {} },
          },
        ],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Optional Fields', () => {
    it('should accept configuration with expected_directory', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        expected_directory: './expected',
        evaluators: [{ name: 'expected-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept configuration with output_dir', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        output_dir: './custom-output',
        evaluators: [{ name: 'git-diff' }],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept configuration with post_evaluation', () => {
      const config = {
        name: 'Test',
        description: 'Test',
        directory: './test',
        evaluators: [{ name: 'git-diff' }],
        post_evaluation: [
          {
            name: 'webhook',
            config: {
              url: 'https://example.com',
            },
          },
        ],
      };

      const result = evalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});
