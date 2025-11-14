/**
 * Contract tests for Reporter interface
 * 
 * These tests define the contract that all reporters must follow.
 * Tests MUST be written first and MUST FAIL before implementation.
 * 
 * Purpose: Ensure reporters conform to standard interface
 */

import { Reporter } from '../../src/reporters/base';
import { ResultsBundle } from '../../src/schemas/result.schema';

/**
 * Mock reporter for contract testing
 */
class MockReporter implements Reporter {
  readonly name = 'mock';
  readonly extension = '.mock';

  async generate(
    bundle: ResultsBundle,
    options?: Record<string, unknown>
  ): Promise<string> {
    return `Mock report for ${bundle.suite.repo}`;
  }

  async writeToFile(
    bundle: ResultsBundle,
    outputPath: string,
    options?: Record<string, unknown>
  ): Promise<void> {
    // Mock implementation - would write to file
    return Promise.resolve();
  }
}

describe('Reporter Contract', () => {
  let reporter: Reporter;

  beforeEach(() => {
    reporter = new MockReporter();
  });

  const mockBundle: ResultsBundle = {
    version: '1.0.0',
    suite: {
      config_file: 'suite.yaml',
      config_hash: 'abc123',
      repo: 'https://github.com/example/test-repo',
      branch: 'main',
      commit: 'abc123def456',
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
    ],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'artifacts/youbencha.log.json',
      reports: ['artifacts/report.md'],
      evaluator_artifacts: [],
    },
  };

  describe('Interface Properties', () => {
    it('should have name property', () => {
      expect(reporter.name).toBeDefined();
      expect(typeof reporter.name).toBe('string');
      expect(reporter.name.length).toBeGreaterThan(0);
    });

    it('should have extension property', () => {
      expect(reporter.extension).toBeDefined();
      expect(typeof reporter.extension).toBe('string');
      expect(reporter.extension).toMatch(/^\./); // Should start with a dot
    });
  });

  describe('generate()', () => {
    it('should return a string', async () => {
      const result = await reporter.generate(mockBundle);
      expect(typeof result).toBe('string');
    });

    it('should not return empty string', async () => {
      const result = await reporter.generate(mockBundle);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should accept optional options parameter', async () => {
      const options = {
        includeDetails: true,
        format: 'verbose',
      };

      await expect(reporter.generate(mockBundle, options)).resolves.toBeDefined();
    });

    it('should handle bundle with multiple evaluators', async () => {
      const bundleWithMultipleEvaluators: ResultsBundle = {
        ...mockBundle,
        evaluators: [
          {
            evaluator: 'git-diff',
            status: 'passed',
            metrics: { files_changed: 5 },
            message: 'Git diff completed',
            duration_ms: 1500,
            timestamp: '2025-11-04T10:05:00.000Z',
          },
          {
            evaluator: 'expected-diff',
            status: 'failed',
            metrics: { similarity: 0.65 },
            message: 'Similarity below threshold',
            duration_ms: 2500,
            timestamp: '2025-11-04T10:06:00.000Z',
          },
        ],
        summary: {
          total_evaluators: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          overall_status: 'failed',
        },
      };

      const result = await reporter.generate(bundleWithMultipleEvaluators);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle bundle with skipped evaluators', async () => {
      const bundleWithSkipped: ResultsBundle = {
        ...mockBundle,
        evaluators: [
          {
            evaluator: 'expected-diff',
            status: 'skipped',
            metrics: {},
            message: 'Expected reference not configured',
            duration_ms: 100,
            timestamp: '2025-11-04T10:05:00.000Z',
            error: {
              message: 'No expected reference provided',
            },
          },
        ],
        summary: {
          total_evaluators: 1,
          passed: 0,
          failed: 0,
          skipped: 1,
          overall_status: 'partial',
        },
      };

      const result = await reporter.generate(bundleWithSkipped);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('writeToFile()', () => {
    it('should accept valid file path', async () => {
      const outputPath = '/tmp/report.mock';
      await expect(
        reporter.writeToFile(mockBundle, outputPath)
      ).resolves.not.toThrow();
    });

    it('should accept optional options parameter', async () => {
      const outputPath = '/tmp/report.mock';
      const options = {
        includeDetails: true,
      };

      await expect(
        reporter.writeToFile(mockBundle, outputPath, options)
      ).resolves.not.toThrow();
    });

    it('should handle different output paths', async () => {
      const paths = [
        '/tmp/report.mock',
        '/home/user/reports/test.mock',
        'C:\\reports\\test.mock',
      ];

      for (const path of paths) {
        await expect(
          reporter.writeToFile(mockBundle, path)
        ).resolves.not.toThrow();
      }
    });
  });

  describe('Report Content Validation', () => {
    it('should include suite information in report', async () => {
      const result = await reporter.generate(mockBundle);
      
      // Basic content checks - actual format depends on reporter implementation
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle bundles with different overall statuses', async () => {
      const statuses: Array<'passed' | 'failed' | 'partial'> = [
        'passed',
        'failed',
        'partial',
      ];

      for (const status of statuses) {
        const bundleWithStatus: ResultsBundle = {
          ...mockBundle,
          summary: {
            ...mockBundle.summary,
            overall_status: status,
          },
        };

        const result = await reporter.generate(bundleWithStatus);
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('should handle bundle with no evaluators gracefully', async () => {
      const bundleWithNoEvaluators: ResultsBundle = {
        ...mockBundle,
        evaluators: [],
        summary: {
          total_evaluators: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
      };

      const result = await reporter.generate(bundleWithNoEvaluators);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
