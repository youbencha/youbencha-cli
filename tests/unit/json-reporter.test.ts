/**
 * Unit tests for JSON Reporter
 * 
 * Tests JSON report generation and file writing.
 * These tests MUST FAIL until implementation is complete (TDD).
 */

import { JsonReporter } from '../../src/reporters/json.js';
import { ResultsBundle } from '../../src/schemas/result.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('JsonReporter', () => {
  let reporter: JsonReporter;
  let tempDir: string;

  beforeEach(async () => {
    reporter = new JsonReporter();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-reporter-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Reporter Interface', () => {
    it('should have name "json"', () => {
      expect(reporter.name).toBe('json');
    });

    it('should have extension ".json"', () => {
      expect(reporter.extension).toBe('.json');
    });
  });

  describe('generate()', () => {
    it('should generate valid JSON string from ResultsBundle', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(typeof result).toBe('string');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('should produce pretty-printed JSON with 2-space indentation', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      // Check for indentation (pretty print)
      expect(result).toContain('\n  ');
      expect(result).toMatch(/"version":\s+"1\.0\.0"/);
    });

    it('should preserve all fields from ResultsBundle', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);
      const parsed = JSON.parse(result);

      expect(parsed.version).toBe(bundle.version);
      expect(parsed.test_case.repo).toBe(bundle.test_case.repo);
      expect(parsed.summary.total_evaluators).toBe(bundle.summary.total_evaluators);
      expect(parsed.evaluators).toHaveLength(bundle.evaluators.length);
    });

    it('should handle empty evaluators array', async () => {
      const bundle: ResultsBundle = {
        ...createMockResultsBundle(),
        evaluators: [],
        summary: {
          total_evaluators: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          overall_status: 'passed',
        },
      };

      const result = await reporter.generate(bundle);
      const parsed = JSON.parse(result);

      expect(parsed.evaluators).toEqual([]);
      expect(parsed.summary.total_evaluators).toBe(0);
    });

    it('should handle evaluator with artifacts', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].artifacts = [
        {
          type: 'diff',
          path: 'artifacts/diff.patch',
          description: 'Git diff patch',
        },
      ];

      const result = await reporter.generate(bundle);
      const parsed = JSON.parse(result);

      expect(parsed.evaluators[0].artifacts).toHaveLength(1);
      expect(parsed.evaluators[0].artifacts[0].type).toBe('diff');
    });

    it('should handle evaluator with error', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].status = 'failed';
      bundle.evaluators[0].error = {
        message: 'Evaluator failed',
        stack_trace: 'Error: Evaluator failed\n  at ...',
      };

      const result = await reporter.generate(bundle);
      const parsed = JSON.parse(result);

      expect(parsed.evaluators[0].error).toBeDefined();
      expect(parsed.evaluators[0].error.message).toBe('Evaluator failed');
    });

    it('should handle options parameter gracefully', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const options = { custom: 'option' };

      const result = await reporter.generate(bundle, options);

      expect(typeof result).toBe('string');
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('writeToFile()', () => {
    it('should write JSON report to file', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'results.json');

      await reporter.writeToFile(bundle, outputPath);

      const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should create parent directories if they do not exist', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'nested', 'dir', 'results.json');

      await reporter.writeToFile(bundle, outputPath);

      const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should write valid JSON content to file', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'results.json');

      await reporter.writeToFile(bundle, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBe(bundle.version);
      expect(parsed.test_case.repo).toBe(bundle.test_case.repo);
    });

    it('should overwrite existing file', async () => {
      const bundle1: ResultsBundle = createMockResultsBundle();
      const bundle2: ResultsBundle = {
        ...createMockResultsBundle(),
        test_case: {
          ...createMockResultsBundle().test_case,
          repo: 'https://github.com/different/repo.git',
        },
      };
      const outputPath = path.join(tempDir, 'results.json');

      await reporter.writeToFile(bundle1, outputPath);
      await reporter.writeToFile(bundle2, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.test_case.repo).toBe(bundle2.test_case.repo);
    });

    it('should handle options parameter gracefully', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'results.json');
      const options = { custom: 'option' };

      await reporter.writeToFile(bundle, outputPath, options);

      const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should reject with error if path is invalid', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const invalidPath = '\0invalid\0path';

      await expect(reporter.writeToFile(bundle, invalidPath)).rejects.toThrow();
    });
  });
});

/**
 * Helper function to create mock ResultsBundle for testing
 */
function createMockResultsBundle(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'Test Case Name',
      description: 'Test case description',
      config_file: 'testcase.yaml',
      config_hash: 'abc123',
      repo: 'https://github.com/example/repo.git',
      branch: 'main',
      commit: 'commit123',
    },
    execution: {
      started_at: '2025-01-01T00:00:00Z',
      completed_at: '2025-01-01T00:05:00Z',
      duration_ms: 300000,
      youbencha_version: '1.0.0',
      environment: {
        os: 'linux',
        node_version: '20.0.0',
        workspace_dir: '/tmp/workspace',
      },
    },
    agent: {
      type: 'copilot-cli',
      youbencha_log_path: 'artifacts/agent-log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [
      {
        evaluator: 'git-diff',
        status: 'passed',
        metrics: {
          files_changed: 5,
          lines_added: 100,
          lines_removed: 50,
        },
        message: 'Git diff evaluation completed',
        duration_ms: 1000,
        timestamp: '2025-01-01T00:04:00Z',
      },
      {
        evaluator: 'agentic-judge',
        status: 'passed',
        metrics: {
          score: 0.95,
        },
        message: 'Agentic judge evaluation completed',
        duration_ms: 2000,
        timestamp: '2025-01-01T00:04:30Z',
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
      agent_log: 'artifacts/agent-log.json',
      reports: ['artifacts/report.md'],
      evaluator_artifacts: [],
    },
  };
}
