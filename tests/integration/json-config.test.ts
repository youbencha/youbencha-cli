/**
 * Integration tests for JSON configuration support
 * 
 * Tests that JSON configurations can be loaded and validated end-to-end
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema';
import { parseConfig } from '../../src/lib/config-parser';
import { resolveEvaluatorConfigs } from '../../src/lib/evaluator-loader';

describe('JSON Configuration Integration', () => {
  const tempDir = path.join(process.cwd(), '.test-temp', 'json-config-tests');

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Test case configuration from JSON', () => {
    it('should load and validate a simple JSON test case config', async () => {
      const configPath = path.join(tempDir, 'test-simple.json');
      const config = {
        name: 'Test Case',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);
      const validated = testCaseConfigSchema.parse(parsed);

      expect(validated.name).toBe('Test Case');
      expect(validated.repo).toBe('https://github.com/test/repo');
      expect(validated.agent.type).toBe('copilot-cli');
      expect(validated.evaluators).toHaveLength(1);
    });

    it('should load JSON config with multiple evaluators', async () => {
      const configPath = path.join(tempDir, 'test-multi.json');
      const config = {
        name: 'Multi Evaluator Test',
        description: 'Test with multiple evaluators',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          { name: 'git-diff' },
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              assertions: {
                test1: 'Test assertion 1',
                test2: 'Test assertion 2',
              },
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);
      const validated = testCaseConfigSchema.parse(parsed);

      expect(validated.evaluators).toHaveLength(2);
      expect(validated.evaluators[0].name).toBe('git-diff');
      expect(validated.evaluators[1].name).toBe('agentic-judge');
    });

    it('should load JSON config with expected reference', async () => {
      const configPath = path.join(tempDir, 'test-expected.json');
      const config = {
        name: 'Expected Reference Test',
        description: 'Test with expected reference',
        repo: 'https://github.com/test/repo',
        expected_source: 'branch',
        expected: 'expected-branch',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          {
            name: 'expected-diff',
            config: {
              threshold: 0.85,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);
      const validated = testCaseConfigSchema.parse(parsed);

      expect(validated.expected_source).toBe('branch');
      expect(validated.expected).toBe('expected-branch');
    });

    it('should reject invalid JSON config', async () => {
      const configPath = path.join(tempDir, 'test-invalid.json');
      const config = {
        name: 'Invalid Config',
        // Missing required fields
        agent: {
          type: 'copilot-cli',
        },
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);

      expect(() => testCaseConfigSchema.parse(parsed)).toThrow();
    });
  });

  describe('Evaluator definition from JSON', () => {
    it('should load evaluator definition from JSON file', async () => {
      const evaluatorPath = path.join(tempDir, 'custom-evaluator.json');
      const evaluatorDef = {
        name: 'custom-check',
        config: {
          threshold: 0.9,
          custom_option: true,
        },
      };

      await fs.writeFile(evaluatorPath, JSON.stringify(evaluatorDef, null, 2));

      const configPath = path.join(tempDir, 'test-with-file-ref.json');
      const config = {
        name: 'Test with File Reference',
        description: 'Test evaluator file reference',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          { file: './custom-evaluator.json' },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);
      const validated = testCaseConfigSchema.parse(parsed);

      const resolved = resolveEvaluatorConfigs(validated.evaluators, tempDir);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].name).toBe('custom-check');
      expect(resolved[0].config?.threshold).toBe(0.9);
    });

    it('should mix inline and file reference evaluators', async () => {
      const evaluatorPath = path.join(tempDir, 'file-evaluator.json');
      await fs.writeFile(
        evaluatorPath,
        JSON.stringify({ name: 'from-file', config: {} }, null, 2)
      );

      const configPath = path.join(tempDir, 'test-mixed.json');
      const config = {
        name: 'Mixed Evaluators',
        description: 'Mix of inline and file evaluators',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
        },
        evaluators: [
          { name: 'git-diff' },
          { file: './file-evaluator.json' },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = parseConfig(content, configPath);
      const validated = testCaseConfigSchema.parse(parsed);

      const resolved = resolveEvaluatorConfigs(validated.evaluators, tempDir);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].name).toBe('git-diff');
      expect(resolved[1].name).toBe('from-file');
    });
  });

  describe('JSON and YAML interoperability', () => {
    it('should produce equivalent results for JSON and YAML configs', async () => {
      const sharedConfig = {
        name: 'Interop Test',
        description: 'Test interoperability',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      // Write JSON version
      const jsonPath = path.join(tempDir, 'config.json');
      await fs.writeFile(jsonPath, JSON.stringify(sharedConfig, null, 2));

      // Write YAML version
      const yamlPath = path.join(tempDir, 'config.yaml');
      const yamlContent = `
name: Interop Test
description: Test interoperability
repo: https://github.com/test/repo
agent:
  type: copilot-cli
  config:
    prompt: Test prompt
evaluators:
  - name: git-diff
`;
      await fs.writeFile(yamlPath, yamlContent);

      // Parse both
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      const yamlContentRead = await fs.readFile(yamlPath, 'utf-8');
      
      const jsonParsed = parseConfig(jsonContent, jsonPath);
      const yamlParsed = parseConfig(yamlContentRead, yamlPath);

      // Validate both
      const jsonValidated = testCaseConfigSchema.parse(jsonParsed);
      const yamlValidated = testCaseConfigSchema.parse(yamlParsed);

      // Should be equivalent
      expect(jsonValidated).toEqual(yamlValidated);
    });
  });
});
