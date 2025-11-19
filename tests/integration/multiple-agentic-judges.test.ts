/**
 * Integration tests for multiple agentic-judge evaluators
 * 
 * Tests the ability to define and run multiple agentic-judge instances
 * in a single evaluation suite.
 */

import { Orchestrator } from '../../src/core/orchestrator.js';
import { AgenticJudgeEvaluator } from '../../src/evaluators/agentic-judge.js';

describe('Multiple Agentic Judge Evaluators', () => {
  describe('AgenticJudgeEvaluator instances', () => {
    test('creates evaluator with default name', () => {
      const evaluator = new AgenticJudgeEvaluator();
      expect(evaluator.name).toBe('agentic-judge');
    });

    test('creates evaluator with custom name using hyphen separator', () => {
      const evaluator = new AgenticJudgeEvaluator('agentic-judge-error-handling');
      expect(evaluator.name).toBe('agentic-judge-error-handling');
    });

    test('creates evaluator with custom name using colon separator', () => {
      const evaluator = new AgenticJudgeEvaluator('agentic-judge:documentation');
      expect(evaluator.name).toBe('agentic-judge:documentation');
    });

    test('creates multiple independent evaluator instances', () => {
      const errorHandling = new AgenticJudgeEvaluator('agentic-judge-error-handling');
      const documentation = new AgenticJudgeEvaluator('agentic-judge-documentation');
      const bestPractices = new AgenticJudgeEvaluator('agentic-judge-best-practices');

      expect(errorHandling.name).toBe('agentic-judge-error-handling');
      expect(documentation.name).toBe('agentic-judge-documentation');
      expect(bestPractices.name).toBe('agentic-judge-best-practices');

      // All share same interface
      expect(errorHandling.requiresExpectedReference).toBe(false);
      expect(documentation.requiresExpectedReference).toBe(false);
      expect(bestPractices.requiresExpectedReference).toBe(false);
    });
  });

  describe('Orchestrator evaluator instantiation', () => {
    let orchestrator: Orchestrator;

    beforeEach(() => {
      orchestrator = new Orchestrator();
    });

    test('instantiates standard agentic-judge evaluator', () => {
      // Use reflection to access private method for testing
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      const evaluator = getEvaluator('agentic-judge');
      
      expect(evaluator).toBeDefined();
      expect(evaluator.name).toBe('agentic-judge');
    });

    test('instantiates custom-named agentic-judge with hyphen prefix', () => {
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      const evaluator = getEvaluator('agentic-judge-error-handling');
      
      expect(evaluator).toBeDefined();
      expect(evaluator.name).toBe('agentic-judge-error-handling');
    });

    test('instantiates custom-named agentic-judge with colon prefix', () => {
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      const evaluator = getEvaluator('agentic-judge:documentation');
      
      expect(evaluator).toBeDefined();
      expect(evaluator.name).toBe('agentic-judge:documentation');
    });

    test('returns null for unknown evaluator name', () => {
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      const evaluator = getEvaluator('unknown-evaluator');
      
      expect(evaluator).toBeNull();
    });

    test('does not match partial names without prefix', () => {
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      const evaluator = getEvaluator('judge-error-handling');
      
      expect(evaluator).toBeNull();
    });

    test('instantiates multiple different custom judges', () => {
      const getEvaluator = (orchestrator as any).getEvaluator.bind(orchestrator);
      
      const judge1 = getEvaluator('agentic-judge-error-handling');
      const judge2 = getEvaluator('agentic-judge-documentation');
      const judge3 = getEvaluator('agentic-judge-best-practices');
      
      expect(judge1).toBeDefined();
      expect(judge2).toBeDefined();
      expect(judge3).toBeDefined();
      
      expect(judge1.name).toBe('agentic-judge-error-handling');
      expect(judge2.name).toBe('agentic-judge-documentation');
      expect(judge3.name).toBe('agentic-judge-best-practices');
    });
  });

  describe('Naming conventions', () => {
    test('supports descriptive names with hyphens', () => {
      const names = [
        'agentic-judge-error-handling',
        'agentic-judge-documentation',
        'agentic-judge-best-practices',
        'agentic-judge-test-coverage',
        'agentic-judge-security',
      ];

      names.forEach(name => {
        const evaluator = new AgenticJudgeEvaluator(name);
        expect(evaluator.name).toBe(name);
      });
    });

    test('supports descriptive names with colons', () => {
      const names = [
        'agentic-judge:error-handling',
        'agentic-judge:documentation',
        'agentic-judge:best-practices',
      ];

      names.forEach(name => {
        const evaluator = new AgenticJudgeEvaluator(name);
        expect(evaluator.name).toBe(name);
      });
    });
  });
});
