/**
 * Unit tests for Evaluator Loader
 * 
 * Tests the functionality of loading evaluator definitions from YAML files
 * and resolving file references in test case configurations.
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadEvaluatorDefinition, resolveEvaluatorConfigs, isFileReference } from '../../src/lib/evaluator-loader';
import { type EvaluatorConfig } from '../../src/schemas/testcase.schema';

describe('Evaluator Loader', () => {
  const testDir = join(__dirname, '.test-evaluator-loader');
  const evaluatorsDir = join(testDir, 'evaluators');

  beforeEach(() => {
    // Create test directory structure
    mkdirSync(evaluatorsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadEvaluatorDefinition', () => {
    it('should load valid evaluator definition from YAML file', () => {
      const evaluatorYaml = `
name: agentic-judge:readme-grammar
description: "Checks README grammar"
config:
  type: copilot-cli
  agent_name: agentic-judge
  assertions:
    grammatically_correct: "README is grammatically correct. Score 1 if true, 0 if false."
`;
      const filePath = join(evaluatorsDir, 'readme-grammar.yaml');
      writeFileSync(filePath, evaluatorYaml, 'utf-8');

      const definition = loadEvaluatorDefinition('./evaluators/readme-grammar.yaml', testDir);

      expect(definition.name).toBe('agentic-judge:readme-grammar');
      expect(definition.description).toBe('Checks README grammar');
      expect(definition.config).toEqual({
        type: 'copilot-cli',
        agent_name: 'agentic-judge',
        assertions: {
          grammatically_correct: 'README is grammatically correct. Score 1 if true, 0 if false.',
        },
      });
    });

    it('should load evaluator definition with minimal fields', () => {
      const evaluatorYaml = `
name: git-diff
`;
      const filePath = join(evaluatorsDir, 'git-diff.yaml');
      writeFileSync(filePath, evaluatorYaml, 'utf-8');

      const definition = loadEvaluatorDefinition('./evaluators/git-diff.yaml', testDir);

      expect(definition.name).toBe('git-diff');
      expect(definition.description).toBeUndefined();
      expect(definition.config).toBeUndefined();
    });

    it('should resolve absolute file paths', () => {
      const evaluatorYaml = `
name: test-evaluator
description: "Test description"
`;
      const filePath = join(evaluatorsDir, 'test.yaml');
      writeFileSync(filePath, evaluatorYaml, 'utf-8');

      const definition = loadEvaluatorDefinition(filePath, testDir);

      expect(definition.name).toBe('test-evaluator');
      expect(definition.description).toBe('Test description');
    });

    it('should throw error for non-existent file', () => {
      expect(() => {
        loadEvaluatorDefinition('./evaluators/non-existent.yaml', testDir);
      }).toThrow(/Failed to load evaluator definition/);
    });

    it('should throw error for invalid YAML syntax', () => {
      const invalidYaml = `
name: test
  invalid: syntax
    wrong: indentation
`;
      const filePath = join(evaluatorsDir, 'invalid.yaml');
      writeFileSync(filePath, invalidYaml, 'utf-8');

      expect(() => {
        loadEvaluatorDefinition('./evaluators/invalid.yaml', testDir);
      }).toThrow(/Failed to load evaluator definition/);
    });

    it('should throw error for definition missing required name field', () => {
      const missingNameYaml = `
description: "Test description"
config:
  some: value
`;
      const filePath = join(evaluatorsDir, 'missing-name.yaml');
      writeFileSync(filePath, missingNameYaml, 'utf-8');

      expect(() => {
        loadEvaluatorDefinition('./evaluators/missing-name.yaml', testDir);
      }).toThrow(/Invalid evaluator definition/);
    });

    it('should throw error for definition with empty name', () => {
      const emptyNameYaml = `
name: ""
description: "Test description"
`;
      const filePath = join(evaluatorsDir, 'empty-name.yaml');
      writeFileSync(filePath, emptyNameYaml, 'utf-8');

      expect(() => {
        loadEvaluatorDefinition('./evaluators/empty-name.yaml', testDir);
      }).toThrow(/Invalid evaluator definition/);
    });
  });

  describe('resolveEvaluatorConfigs', () => {
    it('should return inline configs unchanged', () => {
      const configs: EvaluatorConfig[] = [
        {
          name: 'git-diff',
          config: { max_files_changed: 5 },
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
      ];

      const resolved = resolveEvaluatorConfigs(configs, testDir);

      expect(resolved).toEqual(configs);
    });

    it('should resolve file references to inline configs', () => {
      const evaluatorYaml = `
name: agentic-judge:test-coverage
description: "Test coverage check"
config:
  type: copilot-cli
  agent_name: agentic-judge
  assertions:
    tests_added: "Tests were added. Score 1 if true, 0 if false."
`;
      const filePath = join(evaluatorsDir, 'test-coverage.yaml');
      writeFileSync(filePath, evaluatorYaml, 'utf-8');

      const configs: EvaluatorConfig[] = [
        {
          file: './evaluators/test-coverage.yaml',
        },
      ];

      const resolved = resolveEvaluatorConfigs(configs, testDir);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toEqual({
        name: 'agentic-judge:test-coverage',
        config: {
          type: 'copilot-cli',
          agent_name: 'agentic-judge',
          assertions: {
            tests_added: 'Tests were added. Score 1 if true, 0 if false.',
          },
        },
      });
    });

    it('should resolve mix of inline and file-referenced configs', () => {
      const evaluatorYaml = `
name: agentic-judge:readme-grammar
config:
  type: copilot-cli
  agent_name: agentic-judge
  assertions:
    grammatically_correct: "README is grammatically correct. Score 1 if true, 0 if false."
`;
      const filePath = join(evaluatorsDir, 'readme-grammar.yaml');
      writeFileSync(filePath, evaluatorYaml, 'utf-8');

      const configs: EvaluatorConfig[] = [
        {
          name: 'git-diff',
          config: { max_files_changed: 3 },
        },
        {
          file: './evaluators/readme-grammar.yaml',
        },
        {
          name: 'expected-diff',
        },
      ];

      const resolved = resolveEvaluatorConfigs(configs, testDir);

      expect(resolved).toHaveLength(3);
      expect(resolved[0]).toEqual({
        name: 'git-diff',
        config: { max_files_changed: 3 },
      });
      expect(resolved[1]).toEqual({
        name: 'agentic-judge:readme-grammar',
        config: {
          type: 'copilot-cli',
          agent_name: 'agentic-judge',
          assertions: {
            grammatically_correct: 'README is grammatically correct. Score 1 if true, 0 if false.',
          },
        },
      });
      expect(resolved[2]).toEqual({
        name: 'expected-diff',
      });
    });

    it('should resolve multiple file references', () => {
      const readmeYaml = `
name: agentic-judge:readme-grammar
config:
  assertions:
    grammatically_correct: "README is grammatically correct."
`;
      const testYaml = `
name: agentic-judge:test-coverage
config:
  assertions:
    tests_added: "Tests were added."
`;
      writeFileSync(join(evaluatorsDir, 'readme-grammar.yaml'), readmeYaml, 'utf-8');
      writeFileSync(join(evaluatorsDir, 'test-coverage.yaml'), testYaml, 'utf-8');

      const configs: EvaluatorConfig[] = [
        {
          file: './evaluators/readme-grammar.yaml',
        },
        {
          file: './evaluators/test-coverage.yaml',
        },
      ];

      const resolved = resolveEvaluatorConfigs(configs, testDir);

      expect(resolved).toHaveLength(2);
      expect(resolved[0].name).toBe('agentic-judge:readme-grammar');
      expect(resolved[1].name).toBe('agentic-judge:test-coverage');
    });

    it('should propagate errors for invalid file references', () => {
      const configs: EvaluatorConfig[] = [
        {
          file: './evaluators/non-existent.yaml',
        },
      ];

      expect(() => {
        resolveEvaluatorConfigs(configs, testDir);
      }).toThrow(/Failed to load evaluator definition/);
    });
  });

  describe('isFileReference', () => {
    it('should return true for file reference config', () => {
      const config: EvaluatorConfig = {
        file: './evaluators/test.yaml',
      };

      expect(isFileReference(config)).toBe(true);
    });

    it('should return false for inline config', () => {
      const config: EvaluatorConfig = {
        name: 'git-diff',
        config: { max_files_changed: 5 },
      };

      expect(isFileReference(config)).toBe(false);
    });

    it('should return false for inline config without config field', () => {
      const config: EvaluatorConfig = {
        name: 'git-diff',
      };

      expect(isFileReference(config)).toBe(false);
    });
  });
});
