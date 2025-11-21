/**
 * Contract tests for pre-execution schema
 * 
 * Validates that pre-execution configuration conforms to schema
 */

import { preExecutionConfigSchema, PreExecutionConfig } from '../../src/schemas/pre-execution.schema.js';

describe('PreExecutionConfig Schema', () => {
  describe('valid configurations', () => {
    it('should accept script with command only', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'echo "Hello"',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept script with command and args', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'bash',
          args: ['-c', 'echo "test"'],
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept script with environment variables', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'printenv',
          env: {
            MY_VAR: 'value',
            ANOTHER_VAR: 'another_value',
          },
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept script with timeout', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'sleep 5',
          timeout_ms: 10000,
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept script with working directory', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'ls',
          working_dir: '/path/to/dir',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept script with all optional fields', () => {
      const config: PreExecutionConfig = {
        name: 'script',
        config: {
          command: 'bash',
          args: ['-c', 'echo $MY_VAR'],
          env: {
            MY_VAR: 'test',
          },
          timeout_ms: 30000,
          working_dir: '/tmp',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply default timeout of 30000ms', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
        },
      };

      const result = preExecutionConfigSchema.parse(config);
      expect(result.config.timeout_ms).toBe(30000);
    });
  });

  describe('invalid configurations', () => {
    it('should reject unknown pre-execution name', () => {
      const config = {
        name: 'unknown-executor',
        config: {
          command: 'echo test',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing command', () => {
      const config = {
        name: 'script',
        config: {
          args: ['test'],
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid timeout (zero)', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
          timeout_ms: 0,
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid timeout (negative)', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
          timeout_ms: -1000,
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid args type', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
          args: 'not-an-array',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid env type', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
          env: 'not-an-object',
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject env with non-string values', () => {
      const config = {
        name: 'script',
        config: {
          command: 'echo test',
          env: {
            MY_VAR: 123, // Should be string
          },
        },
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing config object', () => {
      const config = {
        name: 'script',
      };

      const result = preExecutionConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});
