/**
 * Contract tests for Evaluator Definition schema and loader
 * 
 * These tests define the contract for standalone evaluator definitions
 * that can be referenced from multiple test case files.
 * 
 * Purpose: Ensure evaluator definitions are properly validated and loaded
 */

import { evaluatorDefinitionSchema, type EvaluatorDefinition } from '../../src/schemas/evaluator-definition.schema';
import { testCaseConfigSchema, type EvaluatorConfig } from '../../src/schemas/testcase.schema';

describe('Evaluator Definition Schema Contract', () => {
  describe('Valid Evaluator Definition', () => {
    it('should validate a complete agentic-judge evaluator definition', () => {
      const validDefinition: EvaluatorDefinition = {
        name: 'agentic-judge:readme-grammar',
        description: 'Checks that README.md has grammatically correct content',
        config: {
          type: 'copilot-cli',
          agent_name: 'agentic-judge',
          timeout: 300000,
          assertions: {
            grammatically_correct: 'README.md content is grammatically correct. Score 1 if true, 0 if false.',
            no_spelling_errors: 'README.md has no spelling errors. Score 1 if true, 0 if false.',
          },
        },
      };

      const result = evaluatorDefinitionSchema.safeParse(validDefinition);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validDefinition);
      }
    });

    it('should validate a git-diff evaluator definition', () => {
      const validDefinition: EvaluatorDefinition = {
        name: 'git-diff',
        description: 'Ensures changes are focused and minimal',
        config: {
          assertions: {
            max_files_changed: 3,
            max_lines_added: 100,
            max_lines_removed: 50,
          },
        },
      };

      const result = evaluatorDefinitionSchema.safeParse(validDefinition);
      expect(result.success).toBe(true);
    });

    it('should accept minimal evaluator definition (name only)', () => {
      const minimalDefinition = {
        name: 'custom-evaluator',
      };

      const result = evaluatorDefinitionSchema.safeParse(minimalDefinition);
      expect(result.success).toBe(true);
    });

    it('should accept evaluator definition without description', () => {
      const definition = {
        name: 'agentic-judge:test-coverage',
        config: {
          type: 'copilot-cli',
          agent_name: 'agentic-judge',
          assertions: {
            tests_added: 'Tests were added. Score 1 if true, 0 if false.',
          },
        },
      };

      const result = evaluatorDefinitionSchema.safeParse(definition);
      expect(result.success).toBe(true);
    });

    it('should accept evaluator definition without config', () => {
      const definition = {
        name: 'git-diff',
        description: 'Basic git diff evaluator',
      };

      const result = evaluatorDefinitionSchema.safeParse(definition);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Evaluator Definition', () => {
    it('should reject definition without name', () => {
      const invalidDefinition = {
        description: 'Some evaluator',
        config: { some: 'config' },
      };

      const result = evaluatorDefinitionSchema.safeParse(invalidDefinition);
      expect(result.success).toBe(false);
    });

    it('should reject definition with empty name', () => {
      const invalidDefinition = {
        name: '',
        config: { some: 'config' },
      };

      const result = evaluatorDefinitionSchema.safeParse(invalidDefinition);
      expect(result.success).toBe(false);
    });

    it('should reject definition with invalid config type', () => {
      const invalidDefinition = {
        name: 'test-evaluator',
        config: 'invalid-config', // Should be an object
      };

      const result = evaluatorDefinitionSchema.safeParse(invalidDefinition);
      expect(result.success).toBe(false);
    });
  });
});

describe('Evaluator Configuration with File References', () => {
  describe('Valid Evaluator Configurations', () => {
    it('should accept inline evaluator configuration', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
            config: { max_files_changed: 5 },
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept evaluator configuration with file reference', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            file: './evaluators/readme-grammar-check.yaml',
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept mix of inline and file-referenced evaluators', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
            config: { max_files_changed: 3 },
          },
          {
            file: './evaluators/readme-grammar-check.yaml',
          },
          {
            name: 'agentic-judge:basic',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              assertions: {
                test_check: 'Tests exist. Score 1 if true, 0 if false.',
              },
            },
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept multiple file references', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            file: './evaluators/readme-grammar-check.yaml',
          },
          {
            file: './evaluators/test-coverage-check.yaml',
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Evaluator Configurations', () => {
    it('should reject file reference with empty path', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            file: '',
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject evaluator config with both name and file', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
        repo: 'https://github.com/example/test-repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'git-diff',
            file: './evaluators/git-diff.yaml',
          },
        ],
      };

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject evaluator config without name or file', () => {
      const config = {
        name: 'Test case name',
        description: 'Test case description',
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

      const result = testCaseConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Type inference for evaluator configurations', () => {
    it('should infer correct types for inline evaluator config', () => {
      const evaluatorConfig: EvaluatorConfig = {
        name: 'git-diff',
        config: { max_files_changed: 5 },
      };

      // Type assertion to verify proper inference
      if ('name' in evaluatorConfig) {
        const name: string = evaluatorConfig.name;
        expect(name).toBe('git-diff');
      }
    });

    it('should infer correct types for file reference config', () => {
      const evaluatorConfig: EvaluatorConfig = {
        file: './evaluators/test.yaml',
      };

      // Type assertion to verify proper inference
      if ('file' in evaluatorConfig) {
        const filePath: string = evaluatorConfig.file;
        expect(filePath).toBe('./evaluators/test.yaml');
      }
    });
  });
});
