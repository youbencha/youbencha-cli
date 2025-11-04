/**
 * Contract tests for Evaluator interface
 * 
 * These tests define the contract that all evaluators must follow.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure evaluators conform to standard interface
 */

import {
  Evaluator,
  EvaluationContext,
} from '../../src/evaluators/base';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema';
import { SuiteConfig } from '../../src/schemas/suite.schema';
import { EvaluationResult } from '../../src/schemas/result.schema';

/**
 * Mock evaluator for contract testing
 */
class MockEvaluator implements Evaluator {
  readonly name = 'mock-evaluator';
  readonly description = 'Mock evaluator for testing';
  readonly requiresExpectedReference = false;

  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    return true;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const timestamp = new Date().toISOString();
    return {
      evaluator: this.name,
      status: 'passed',
      metrics: { mock_metric: 100 },
      message: 'Mock evaluation completed',
      duration_ms: 1000,
      timestamp,
    };
  }
}

/**
 * Mock evaluator that requires expected reference
 */
class MockExpectedRefEvaluator implements Evaluator {
  readonly name = 'mock-expected-ref-evaluator';
  readonly description = 'Mock evaluator requiring expected reference';
  readonly requiresExpectedReference = true;

  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    return !!context.expectedDir;
  }

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const timestamp = new Date().toISOString();

    if (!context.expectedDir) {
      return {
        evaluator: this.name,
        status: 'skipped',
        metrics: {},
        message: 'Expected reference not provided',
        duration_ms: 10,
        timestamp,
        error: {
          message: 'Expected reference directory not configured',
        },
      };
    }

    return {
      evaluator: this.name,
      status: 'passed',
      metrics: { similarity: 0.95 },
      message: 'Comparison completed successfully',
      duration_ms: 2000,
      timestamp,
    };
  }
}

describe('Evaluator Contract', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new MockEvaluator();
  });

  describe('Interface Properties', () => {
    it('should have name property', () => {
      expect(evaluator.name).toBeDefined();
      expect(typeof evaluator.name).toBe('string');
      expect(evaluator.name.length).toBeGreaterThan(0);
    });

    it('should have description property', () => {
      expect(evaluator.description).toBeDefined();
      expect(typeof evaluator.description).toBe('string');
      expect(evaluator.description.length).toBeGreaterThan(0);
    });

    it('should have requiresExpectedReference property', () => {
      expect(evaluator.requiresExpectedReference).toBeDefined();
      expect(typeof evaluator.requiresExpectedReference).toBe('boolean');
    });
  });

  describe('checkPreconditions()', () => {
    const mockContext: EvaluationContext = {
      modifiedDir: '/tmp/src-modified',
      artifactsDir: '/tmp/artifacts',
      faceLog: {} as YouBenchaLog,
      config: {},
      suiteConfig: {} as SuiteConfig,
    };

    it('should return a boolean', async () => {
      const result = await evaluator.checkPreconditions(mockContext);
      expect(typeof result).toBe('boolean');
    });

    it('should not throw errors', async () => {
      await expect(evaluator.checkPreconditions(mockContext)).resolves.not.toThrow();
    });
  });

  describe('evaluate()', () => {
    const mockContext: EvaluationContext = {
      modifiedDir: '/tmp/src-modified',
      artifactsDir: '/tmp/artifacts',
      faceLog: {} as YouBenchaLog,
      config: {},
      suiteConfig: {} as SuiteConfig,
    };

    it('should return valid EvaluationResult', async () => {
      const result = await evaluator.evaluate(mockContext);

      expect(result).toBeDefined();
      expect(result.evaluator).toBe(evaluator.name);
      expect(result.status).toMatch(/^(passed|failed|skipped)$/);
      expect(typeof result.message).toBe('string');
      expect(typeof result.metrics).toBe('object');
      expect(typeof result.duration_ms).toBe('number');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.timestamp).toBe('string');
    });

    it('should have valid timestamp in ISO 8601 format', async () => {
      const result = await evaluator.evaluate(mockContext);
      const timestamp = new Date(result.timestamp);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });

    it('should include error if status is skipped', async () => {
      const result = await evaluator.evaluate(mockContext);

      if (result.status === 'skipped') {
        expect(result.error).toBeDefined();
        expect(result.error?.message).toBeDefined();
      }
    });

    it('should accept evaluator-specific config', async () => {
      const contextWithConfig: EvaluationContext = {
        ...mockContext,
        config: {
          threshold: 0.85,
          customOption: 'value',
        },
      };

      await expect(evaluator.evaluate(contextWithConfig)).resolves.toBeDefined();
    });

    it('should provide access to youBencha Log', async () => {
      const mockLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'test-agent',
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

      const contextWithLog: EvaluationContext = {
        ...mockContext,
        faceLog: mockLog,
      };

      await expect(evaluator.evaluate(contextWithLog)).resolves.toBeDefined();
    });
  });

  describe('Expected Reference Handling', () => {
    it('should skip gracefully when expected reference required but not provided', async () => {
      const expectedRefEvaluator = new MockExpectedRefEvaluator();
      
      expect(expectedRefEvaluator.requiresExpectedReference).toBe(true);

      const contextWithoutExpected: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        // expectedDir intentionally omitted
        artifactsDir: '/tmp/artifacts',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const result = await expectedRefEvaluator.evaluate(contextWithoutExpected);
      expect(result.status).toBe('skipped');
      expect(result.error).toBeDefined();
    });

    it('should run successfully when expected reference provided', async () => {
      const expectedRefEvaluator = new MockExpectedRefEvaluator();

      const contextWithExpected: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        expectedDir: '/tmp/src-expected',
        artifactsDir: '/tmp/artifacts',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const result = await expectedRefEvaluator.evaluate(contextWithExpected);
      expect(result.status).not.toBe('skipped');
    });

    it('should report false preconditions when expected ref missing', async () => {
      const expectedRefEvaluator = new MockExpectedRefEvaluator();

      const contextWithoutExpected: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        artifactsDir: '/tmp/artifacts',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const canRun = await expectedRefEvaluator.checkPreconditions(contextWithoutExpected);
      expect(canRun).toBe(false);
    });
  });

  describe('Artifacts Handling', () => {
    it('should be able to write artifacts to artifacts directory', async () => {
      const context: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        artifactsDir: '/tmp/artifacts/evaluators',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      if (result.artifacts) {
        result.artifacts.forEach((artifact) => {
          expect(artifact.type).toBeDefined();
          expect(artifact.path).toBeDefined();
          expect(artifact.description).toBeDefined();
        });
      }
    });
  });

  describe('Metrics Handling', () => {
    it('should return metrics object even if empty', async () => {
      const context: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        artifactsDir: '/tmp/artifacts',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      expect(result.metrics).toBeDefined();
      expect(typeof result.metrics).toBe('object');
    });

    it('should support custom metric types', async () => {
      const context: EvaluationContext = {
        modifiedDir: '/tmp/src-modified',
        artifactsDir: '/tmp/artifacts',
        faceLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      // Metrics can be any JSON-serializable value
      Object.values(result.metrics).forEach((value) => {
        const type = typeof value;
        expect(['string', 'number', 'boolean', 'object'].includes(type)).toBe(true);
      });
    });
  });
});
