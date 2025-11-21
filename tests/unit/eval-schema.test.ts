/**
 * Unit tests for Eval Configuration Schema
 * 
 * Tests validation of eval-only configuration
 */

import { evalConfigSchema, EvalConfig } from '../../src/schemas/eval.schema';

describe('Eval Configuration Schema', () => {
  describe('valid configurations', () => {
    it('should accept minimal valid configuration', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '/path/to/code',
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      const result = evalConfigSchema.parse(config);
      
      expect(result.name).toBe('Test eval');
      expect(result.directory).toBe('/path/to/code');
      expect(result.evaluators).toHaveLength(1);
    });

    it('should accept configuration with optional fields', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '/path/to/code',
        expected_directory: '/path/to/expected',
        output_dir: '/path/to/output',
        timeout: 60000,
        evaluators: [
          { name: 'git-diff' },
          { name: 'agentic-judge', config: { assertions: { test: 'value' } } },
        ],
      };

      const result = evalConfigSchema.parse(config);
      
      expect(result.expected_directory).toBe('/path/to/expected');
      expect(result.output_dir).toBe('/path/to/output');
      expect(result.timeout).toBe(60000);
      expect(result.evaluators).toHaveLength(2);
    });

    it('should accept evaluator with file reference', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '.',
        evaluators: [
          { file: './evaluators/custom.yaml' },
        ],
      };

      const result = evalConfigSchema.parse(config);
      
      expect(result.evaluators).toHaveLength(1);
      expect('file' in result.evaluators[0]).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should reject configuration without name', () => {
      const config = {
        description: 'Testing eval',
        directory: '.',
        evaluators: [{ name: 'git-diff' }],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration without description', () => {
      const config = {
        name: 'Test eval',
        directory: '.',
        evaluators: [{ name: 'git-diff' }],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration without directory', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        evaluators: [{ name: 'git-diff' }],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration without evaluators', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '.',
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration with empty evaluators array', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '.',
        evaluators: [],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject name that is too long', () => {
      const config = {
        name: 'x'.repeat(201),
        description: 'Testing eval',
        directory: '.',
        evaluators: [{ name: 'git-diff' }],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject description that is too long', () => {
      const config = {
        name: 'Test eval',
        description: 'x'.repeat(1001),
        directory: '.',
        evaluators: [{ name: 'git-diff' }],
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });

    it('should reject negative timeout', () => {
      const config = {
        name: 'Test eval',
        description: 'Testing eval',
        directory: '.',
        evaluators: [{ name: 'git-diff' }],
        timeout: -1,
      };

      expect(() => evalConfigSchema.parse(config)).toThrow();
    });
  });
});
