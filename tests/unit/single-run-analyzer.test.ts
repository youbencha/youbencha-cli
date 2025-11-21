/**
 * Unit tests for Single Run Analyzer
 * 
 * Tests the analysis logic and recommendation generation.
 */

import { analyzeSingleRun } from '../../src/analyzers/single-run';
import { ResultsBundle } from '../../src/schemas/result.schema';

describe('Single Run Analyzer', () => {
  describe('analyzeSingleRun', () => {
    it('should generate analysis for successful run', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
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
            metrics: { files_changed: 5, lines_added: 100, lines_removed: 20 },
            message: 'Analysis complete',
            duration_ms: 1000,
            timestamp: '2025-11-21T00:00:30.000Z',
          },
          {
            evaluator: 'expected-diff',
            status: 'passed',
            metrics: { aggregate_similarity: 0.92, threshold: 0.85 },
            message: 'Similarity above threshold',
            duration_ms: 2000,
            timestamp: '2025-11-21T00:00:32.000Z',
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
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      expect(analysis.version).toBe('1.0.0');
      expect(analysis.source_results).toBe('test-results.json');
      expect(analysis.results).toEqual(mockBundle);
      expect(analysis.insights.length).toBeGreaterThan(0);
      expect(analysis.recommendations.length).toBeGreaterThan(0);
      expect(analysis.metrics.success_rate).toBe(1.0);
      expect(analysis.metrics.evaluator_pass_rate).toBe(1.0);
    });

    it('should identify quality issues when similarity below threshold', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
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
            evaluator: 'expected-diff',
            status: 'failed',
            metrics: { aggregate_similarity: 0.70, threshold: 0.85 },
            message: 'Similarity below threshold',
            duration_ms: 2000,
            timestamp: '2025-11-21T00:00:30.000Z',
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
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      // Should have error insight about similarity
      const qualityError = analysis.insights.find(
        (i) => i.type === 'error' && i.category === 'Quality'
      );
      expect(qualityError).toBeDefined();
      expect(qualityError?.message).toContain('Similarity below threshold');

      // Should have high-priority recommendation
      const highPriorityRec = analysis.recommendations.find(
        (r) => r.priority === 'high' && r.category === 'quality'
      );
      expect(highPriorityRec).toBeDefined();
      expect(highPriorityRec?.title).toContain('Quality');
    });

    it('should detect slow evaluators', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
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
            evaluator: 'slow-evaluator',
            status: 'passed',
            metrics: {},
            message: 'Analysis complete',
            duration_ms: 35000, // 35 seconds - very slow
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

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      // Should have warning about slow evaluator
      const perfWarning = analysis.insights.find(
        (i) => i.type === 'warning' && i.category === 'Performance'
      );
      expect(perfWarning).toBeDefined();
      expect(perfWarning?.message).toContain('Slowest evaluator');

      // Should have performance recommendation
      const perfRec = analysis.recommendations.find((r) => r.category === 'performance');
      expect(perfRec).toBeDefined();
    });

    it('should detect skipped evaluators', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
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
            metrics: {},
            message: 'Analysis complete',
            duration_ms: 1000,
            timestamp: '2025-11-21T00:00:30.000Z',
          },
          {
            evaluator: 'expected-diff',
            status: 'skipped',
            metrics: {},
            message: 'No expected reference configured',
            duration_ms: 100,
            timestamp: '2025-11-21T00:00:31.000Z',
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
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      // Should have warning about skipped evaluators
      const coverageWarning = analysis.insights.find(
        (i) => i.type === 'warning' && i.category === 'Coverage'
      );
      expect(coverageWarning).toBeDefined();
      expect(coverageWarning?.message).toContain('skipped');

      // Should have configuration recommendation
      const configRec = analysis.recommendations.find((r) => r.category === 'configuration');
      expect(configRec).toBeDefined();
    });

    it('should warn when similarity is close to threshold', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
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
            evaluator: 'expected-diff',
            status: 'passed',
            metrics: { aggregate_similarity: 0.87, threshold: 0.85 }, // Only 2% margin
            message: 'Similarity above threshold',
            duration_ms: 2000,
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

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      // Should have warning about being close to threshold
      const qualityWarning = analysis.insights.find(
        (i) => i.type === 'warning' && i.category === 'Quality'
      );
      expect(qualityWarning).toBeDefined();
      expect(qualityWarning?.message).toContain('close to threshold');
    });

    it('should calculate correct metrics', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        test_case: {
          name: 'Test Case',
          description: 'Test description',
          config_file: 'suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/example/repo',
          branch: 'main',
          commit: 'abc123',
        },
        execution: {
          started_at: '2025-11-21T00:00:00.000Z',
          completed_at: '2025-11-21T00:02:00.000Z',
          duration_ms: 120000,
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
            evaluator: 'eval1',
            status: 'passed',
            metrics: {},
            message: 'Complete',
            duration_ms: 1000,
            timestamp: '2025-11-21T00:00:30.000Z',
          },
          {
            evaluator: 'eval2',
            status: 'passed',
            metrics: {},
            message: 'Complete',
            duration_ms: 2000,
            timestamp: '2025-11-21T00:00:32.000Z',
          },
          {
            evaluator: 'eval3',
            status: 'failed',
            metrics: {},
            message: 'Failed',
            duration_ms: 3000,
            timestamp: '2025-11-21T00:00:35.000Z',
          },
        ],
        summary: {
          total_evaluators: 3,
          passed: 2,
          failed: 1,
          skipped: 0,
          overall_status: 'failed',
        },
        artifacts: {
          agent_log: 'artifacts/log.json',
          reports: [],
          evaluator_artifacts: [],
        },
      };

      const analysis = await analyzeSingleRun(mockBundle, 'test-results.json');

      expect(analysis.metrics.success_rate).toBe(1.0); // Agent succeeded
      expect(analysis.metrics.evaluator_pass_rate).toBe(2 / 3); // 2 of 3 passed
      expect(analysis.metrics.total_duration_ms).toBe(120000);
      expect(analysis.metrics.avg_evaluator_duration_ms).toBe(2000); // (1000 + 2000 + 3000) / 3
    });
  });
});
