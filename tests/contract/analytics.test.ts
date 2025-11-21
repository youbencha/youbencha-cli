/**
 * Contract tests for Analytics schemas
 * 
 * These tests define the contract for analytics data structures.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure analytics results conform to standard schema
 */

import {
  recommendationSchema,
  performanceInsightSchema,
  singleRunAnalysisSchema,
  type Recommendation,
  type PerformanceInsight,
  type SingleRunAnalysis,
} from '../../src/schemas/analytics.schema';
import { ResultsBundle } from '../../src/schemas/result.schema';

describe('Analytics Schema Contract', () => {
  describe('Recommendation Schema', () => {
    it('should validate a high priority recommendation', () => {
      const validRec: Recommendation = {
        category: 'quality',
        priority: 'high',
        title: 'Improve Agent Output Quality',
        description: 'Agent output similarity is below threshold',
        action: 'Review the prompt and increase context',
        impact: 'Better alignment with expected results',
      };

      const result = recommendationSchema.safeParse(validRec);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validRec);
      }
    });

    it('should validate a recommendation without impact', () => {
      const validRec: Recommendation = {
        category: 'performance',
        priority: 'medium',
        title: 'Optimize Evaluator',
        description: 'Evaluator is running slowly',
        action: 'Review configuration and caching',
      };

      const result = recommendationSchema.safeParse(validRec);
      expect(result.success).toBe(true);
    });

    it('should reject recommendation with invalid priority', () => {
      const invalidRec = {
        category: 'quality',
        priority: 'critical', // Invalid
        title: 'Test',
        description: 'Test desc',
        action: 'Test action',
      };

      const result = recommendationSchema.safeParse(invalidRec);
      expect(result.success).toBe(false);
    });

    it('should reject recommendation with invalid category', () => {
      const invalidRec = {
        category: 'invalid-category',
        priority: 'high',
        title: 'Test',
        description: 'Test desc',
        action: 'Test action',
      };

      const result = recommendationSchema.safeParse(invalidRec);
      expect(result.success).toBe(false);
    });
  });

  describe('Performance Insight Schema', () => {
    it('should validate a success insight', () => {
      const validInsight: PerformanceInsight = {
        type: 'success',
        category: 'Agent Execution',
        message: 'Agent completed successfully',
      };

      const result = performanceInsightSchema.safeParse(validInsight);
      expect(result.success).toBe(true);
    });

    it('should validate an error insight with metric values', () => {
      const validInsight: PerformanceInsight = {
        type: 'error',
        category: 'Quality',
        message: 'Similarity below threshold',
        metric_value: 0.72,
        reference_value: 0.85,
      };

      const result = performanceInsightSchema.safeParse(validInsight);
      expect(result.success).toBe(true);
    });

    it('should reject insight with invalid type', () => {
      const invalidInsight = {
        type: 'critical', // Invalid
        category: 'Test',
        message: 'Test message',
      };

      const result = performanceInsightSchema.safeParse(invalidInsight);
      expect(result.success).toBe(false);
    });
  });

  describe('Single Run Analysis Schema', () => {
    it('should validate a complete analysis', () => {
      const mockResultsBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test',
          description: 'Test case',
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-21T00:00:00.000Z',
          completed_at: '2025-11-21T00:01:00.000Z',
          duration_ms: 60000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/log.json',
          status: 'success',
          exit_code: 0,
        },
        evaluators: [
          {
            evaluator: 'git-diff',
            status: 'passed',
            metrics: { files_changed: 5 },
            message: 'Analysis complete',
            duration_ms: 1000,
            timestamp: '2025-11-21T00:00:30.000Z',
          },
        ],
        summary: {
          total_evaluators: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
        artifacts: {
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const validAnalysis: SingleRunAnalysis = {
        version: '1.0.0',
        analyzed_at: '2025-11-21T00:02:00.000Z',
        source_results: 'results.json',
        results: mockResultsBundle,
        insights: [
          {
            type: 'success',
            category: 'Overall',
            message: 'All evaluators passed',
          },
        ],
        recommendations: [
          {
            category: 'quality',
            priority: 'low',
            title: 'Establish Baseline',
            description: 'Save as reference',
            action: 'Document this configuration',
          },
        ],
        metrics: {
          success_rate: 1.0,
          avg_evaluator_duration_ms: 1000,
          total_duration_ms: 60000,
          evaluator_pass_rate: 1.0,
        },
      };

      const result = singleRunAnalysisSchema.safeParse(validAnalysis);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('1.0.0');
        expect(result.data.insights).toHaveLength(1);
        expect(result.data.recommendations).toHaveLength(1);
      }
    });

    it('should validate analysis with cost analysis', () => {
      const mockResultsBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test',
          description: 'Test case',
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-21T00:00:00.000Z',
          completed_at: '2025-11-21T00:01:00.000Z',
          duration_ms: 60000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/log.json',
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
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const validAnalysis: SingleRunAnalysis = {
        version: '1.0.0',
        analyzed_at: '2025-11-21T00:02:00.000Z',
        source_results: 'results.json',
        results: mockResultsBundle,
        insights: [],
        recommendations: [],
        cost_analysis: {
          total_tokens: 1500,
          prompt_tokens: 1000,
          completion_tokens: 500,
          estimated_cost_usd: 0.03,
          model: 'gpt-4',
          cost_per_1k_tokens: 0.02,
        },
        metrics: {
          success_rate: 1.0,
          avg_evaluator_duration_ms: 0,
          total_duration_ms: 60000,
          evaluator_pass_rate: 0,
        },
      };

      const result = singleRunAnalysisSchema.safeParse(validAnalysis);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cost_analysis).toBeDefined();
        expect(result.data.cost_analysis?.total_tokens).toBe(1500);
      }
    });

    it('should reject analysis without version', () => {
      const invalidAnalysis = {
        analyzed_at: '2025-11-21T00:00:00.000Z',
        source_results: 'results.json',
        results: {},
        insights: [],
        recommendations: [],
        metrics: {
          success_rate: 1.0,
          avg_evaluator_duration_ms: 0,
          total_duration_ms: 0,
          evaluator_pass_rate: 1.0,
        },
      };

      const result = singleRunAnalysisSchema.safeParse(invalidAnalysis);
      expect(result.success).toBe(false);
    });

    it('should reject analysis with invalid metrics', () => {
      const mockResultsBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test',
          description: 'Test case',
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-21T00:00:00.000Z',
          completed_at: '2025-11-21T00:01:00.000Z',
          duration_ms: 60000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'Linux',
            node_version: '20.0.0',
            workspace_dir: '/tmp/workspace',
          },
        },
        agent: {
          type: 'copilot-cli',
          youbencha_log_path: 'artifacts/log.json',
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
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const invalidAnalysis = {
        version: '1.0.0',
        analyzed_at: '2025-11-21T00:00:00.000Z',
        source_results: 'results.json',
        results: mockResultsBundle,
        insights: [],
        recommendations: [],
        metrics: {
          success_rate: 1.5, // Invalid: > 1.0
          avg_evaluator_duration_ms: 0,
          total_duration_ms: 0,
          evaluator_pass_rate: 1.0,
        },
      };

      const result = singleRunAnalysisSchema.safeParse(invalidAnalysis);
      expect(result.success).toBe(false);
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      const rec: Recommendation = {
        category: 'performance',
        priority: 'high',
        title: 'Test',
        description: 'Test desc',
        action: 'Test action',
        impact: 'Test impact',
      };

      const insight: PerformanceInsight = {
        type: 'warning',
        category: 'Test',
        message: 'Test message',
        metric_value: 100,
      };

      // Type assertions to verify proper inference
      const category: 'performance' | 'cost' | 'quality' | 'configuration' | 'evaluator' =
        rec.category;
      const priority: 'high' | 'medium' | 'low' = rec.priority;
      const insightType: 'success' | 'warning' | 'error' | 'info' = insight.type;

      expect(category).toBe('performance');
      expect(priority).toBe('high');
      expect(insightType).toBe('warning');
    });
  });
});
