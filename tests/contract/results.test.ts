/**
 * Contract tests for Results Bundle and Evaluation Result schemas
 * 
 * These tests define the contract for evaluation results.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure evaluation results conform to standard schema
 */

import {
  evaluationResultSchema,
  EvaluationResult,
  resultsBundleSchema,
  ResultsBundle,
} from '../../src/schemas/result.schema';

describe('Evaluation Result Schema Contract', () => {
  describe('Valid Evaluation Result', () => {
    it('should validate a passed evaluation result', () => {
      const validResult: EvaluationResult = {
        evaluator: 'git-diff',
        status: 'passed',
        metrics: {
          files_changed: 5,
          lines_added: 120,
          lines_removed: 45,
        },
        message: 'Git diff analysis completed successfully',
        duration_ms: 1500,
        timestamp: '2025-11-04T10:00:00.000Z',
      };

      const result = evaluationResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validResult);
      }
    });

    it('should validate a failed evaluation result', () => {
      const validResult: EvaluationResult = {
        evaluator: 'expected-diff',
        status: 'failed',
        metrics: {
          similarity: 0.65,
          threshold: 0.85,
        },
        message: 'Similarity below threshold: 0.65 < 0.85',
        duration_ms: 2500,
        timestamp: '2025-11-04T10:01:00.000Z',
      };

      const result = evaluationResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it('should validate a skipped evaluation result with error', () => {
      const validResult: EvaluationResult = {
        evaluator: 'agentic-judge',
        status: 'skipped',
        metrics: {},
        message: 'Evaluator skipped due to missing prerequisites',
        duration_ms: 100,
        timestamp: '2025-11-04T10:02:00.000Z',
        error: {
          message: 'Expected reference not configured',
          stack_trace: 'Error: Expected reference not configured\n  at...',
        },
      };

      const result = evaluationResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it('should validate evaluation result with artifacts', () => {
      const validResult: EvaluationResult = {
        evaluator: 'git-diff',
        status: 'passed',
        metrics: { files_changed: 3 },
        message: 'Analysis complete',
        duration_ms: 1000,
        timestamp: '2025-11-04T10:03:00.000Z',
        artifacts: [
          {
            type: 'diff-patch',
            path: 'artifacts/evaluators/git-diff.patch',
            description: 'Complete diff patch file',
          },
          {
            type: 'report-html',
            path: 'artifacts/evaluators/git-diff.html',
            description: 'HTML visualization of changes',
          },
        ],
      };

      const result = evaluationResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Evaluation Result', () => {
    it('should reject result without evaluator name', () => {
      const invalidResult = {
        status: 'passed',
        metrics: {},
        message: 'Test',
        duration_ms: 1000,
        timestamp: '2025-11-04T10:00:00.000Z',
      };

      const result = evaluationResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it('should reject result with invalid status', () => {
      const invalidResult = {
        evaluator: 'test-eval',
        status: 'invalid-status',
        metrics: {},
        message: 'Test',
        duration_ms: 1000,
        timestamp: '2025-11-04T10:00:00.000Z',
      };

      const result = evaluationResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it('should reject result with negative duration', () => {
      const invalidResult = {
        evaluator: 'test-eval',
        status: 'passed',
        metrics: {},
        message: 'Test',
        duration_ms: -100,
        timestamp: '2025-11-04T10:00:00.000Z',
      };

      const result = evaluationResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });
  });
});

describe('Results Bundle Schema Contract', () => {
  describe('Valid Results Bundle', () => {
    it('should validate a complete results bundle', () => {
      const validBundle: ResultsBundle = {
        version: '1.0.0',
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123def456',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123def456',
          expected_branch: 'feature/reference',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Windows_NT',
            node_version: '20.10.0',
            workspace_dir: '.youbencha-workspace/run-20251104-100000',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [
          {
            evaluator: 'git-diff',
            status: 'passed',
            metrics: { files_changed: 5 },
            message: 'Git diff analysis completed',
            duration_ms: 1500,
            timestamp: '2025-11-04T10:05:00.000Z',
          },
          {
            evaluator: 'expected-diff',
            status: 'passed',
            metrics: { similarity: 0.92 },
            message: 'Similarity above threshold',
            duration_ms: 2500,
            timestamp: '2025-11-04T10:06:00.000Z',
          },
        ],
        summary: {
          total_evaluators: 2,
          passed: 2,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: ['artifacts/report.md', 'artifacts/report.json'],
          evaluator_artifacts: [
            'artifacts/evaluators/git-diff.patch',
            'artifacts/evaluators/expected-diff.html',
          ],
        },
      };

      const result = resultsBundleSchema.safeParse(validBundle);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validBundle);
      }
    });

    it('should validate bundle with partial success', () => {
      const bundle: ResultsBundle = {
        version: '1.0.0',
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [
          {
            evaluator: 'git-diff',
            status: 'passed',
            metrics: { files_changed: 5 },
            message: 'Analysis completed',
            duration_ms: 1500,
            timestamp: '2025-11-04T10:05:00.000Z',
          },
          {
            evaluator: 'expected-diff',
            status: 'skipped',
            metrics: {},
            message: 'Expected reference not configured',
            duration_ms: 100,
            timestamp: '2025-11-04T10:05:01.000Z',
            error: {
              message: 'No expected reference provided',
            },
          },
        ],
        summary: {
          total_evaluators: 2,
          passed: 1,
          failed: 0,
          skipped: 1,
          overall_status: 'partial',
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: ['artifacts/report.md'],
          evaluator_artifacts: ['artifacts/evaluators/git-diff.patch'],
        },
      };

      const result = resultsBundleSchema.safeParse(bundle);
      expect(result.success).toBe(true);
    });

    it('should validate bundle with failed evaluations', () => {
      const bundle: ResultsBundle = {
        version: '1.0.0',
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Darwin',
            node_version: '20.10.0',
            workspace_dir: '/Users/test/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [
          {
            evaluator: 'expected-diff',
            status: 'failed',
            metrics: { similarity: 0.65, threshold: 0.85 },
            message: 'Similarity below threshold',
            duration_ms: 2500,
            timestamp: '2025-11-04T10:05:00.000Z',
          },
        ],
        summary: {
          total_evaluators: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          overall_status: 'failed',
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: ['artifacts/report.md'],
          evaluator_artifacts: [],
        },
      };

      const result = resultsBundleSchema.safeParse(bundle);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid Results Bundle', () => {
    it('should reject bundle without version', () => {
      const invalidBundle = {
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [],
        summary: {
          total_evaluators: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const result = resultsBundleSchema.safeParse(invalidBundle);
      expect(result.success).toBe(false);
    });

    it('should reject bundle with invalid version', () => {
      const invalidBundle = {
        version: '2.0.0', // Invalid version
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [],
        summary: {
          total_evaluators: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const result = resultsBundleSchema.safeParse(invalidBundle);
      expect(result.success).toBe(false);
    });

    it('should reject bundle with invalid overall_status', () => {
      const invalidBundle = {
        version: '1.0.0',
        suite: {
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/test-repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/youbencha.log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [],
        summary: {
          total_evaluators: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          overall_status: 'invalid-status', // Invalid status
        },
        artifacts: {
          agent_log: 'artifacts/youbencha.log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const result = resultsBundleSchema.safeParse(invalidBundle);
      expect(result.success).toBe(false);
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      const result: EvaluationResult = {
        evaluator: 'test-eval',
        status: 'passed',
        metrics: { test_metric: 100 },
        message: 'Test completed',
        duration_ms: 1000,
        timestamp: '2025-11-04T10:00:00.000Z',
      };

      // Type assertions to verify proper inference
      const evaluatorName: string = result.evaluator;
      const status: 'passed' | 'failed' | 'skipped' = result.status;
      const duration: number = result.duration_ms;

      expect(evaluatorName).toBe('test-eval');
      expect(status).toBe('passed');
      expect(duration).toBe(1000);
    });
  });
});
