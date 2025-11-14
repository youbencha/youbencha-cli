/**
 * Unit tests for Markdown Reporter
 * 
 * Tests Markdown report generation and file writing.
 * These tests MUST FAIL until implementation is complete (TDD).
 */

import { MarkdownReporter } from '../../src/reporters/markdown.js';
import { ResultsBundle } from '../../src/schemas/result.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('MarkdownReporter', () => {
  let reporter: MarkdownReporter;
  let tempDir: string;

  beforeEach(async () => {
    reporter = new MarkdownReporter();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-reporter-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Reporter Interface', () => {
    it('should have name "markdown"', () => {
      expect(reporter.name).toBe('markdown');
    });

    it('should have extension ".md"', () => {
      expect(reporter.extension).toBe('.md');
    });
  });

  describe('generate()', () => {
    it('should generate markdown string from ResultsBundle', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include title header', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('# youBencha Evaluation Report');
    });

    it('should include summary section with overall status', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Summary');
      expect(result).toContain('**Overall Status:**');
      expect(result).toContain('passed');
    });

    it('should include summary statistics table', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('| Metric | Value |');
      expect(result).toContain('| Total Evaluators | 2 |');
      expect(result).toContain('| Passed | 2 |');
      expect(result).toContain('| Failed | 0 |');
      expect(result).toContain('| Skipped | 0 |');
    });

    it('should include suite configuration section', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Suite Configuration');
      expect(result).toContain('**Repository:**');
      expect(result).toContain('https://github.com/example/repo.git');
      expect(result).toContain('**Branch:**');
      expect(result).toContain('main');
    });

    it('should include execution metadata section', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Execution Details');
      expect(result).toContain('**Duration:**');
      expect(result).toContain('**Started:**');
      expect(result).toContain('**Environment:**');
    });

    it('should include agent execution section', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Agent Execution');
      expect(result).toContain('**Type:**');
      expect(result).toContain('copilot-cli');
      expect(result).toContain('**Status:**');
      expect(result).toContain('success');
    });

    it('should include evaluator results section', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Evaluator Results');
      expect(result).toContain('### git-diff');
      expect(result).toContain('### agentic-judge');
    });

    it('should display evaluator metrics in tables', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('| Metric | Value |');
      expect(result).toContain('| files_changed | 5 |');
      expect(result).toContain('| lines_added | 100 |');
      expect(result).toContain('| score | 0.95 |');
    });

    it('should show evaluator status with emoji', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].status = 'passed';
      bundle.evaluators[1].status = 'failed';

      const result = await reporter.generate(bundle);

      expect(result).toContain('✅ **Status:** passed');
      expect(result).toContain('❌ **Status:** failed');
    });

    it('should include evaluator duration', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('**Duration:**');
      expect(result).toMatch(/1000\s*ms|1\.0\s*s/);
    });

    it('should include artifacts section if artifacts exist', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].artifacts = [
        {
          type: 'diff',
          path: 'artifacts/diff.patch',
          description: 'Git diff patch',
        },
      ];

      const result = await reporter.generate(bundle);

      expect(result).toContain('**Artifacts:**');
      expect(result).toContain('- diff:');
      expect(result).toContain('artifacts/diff.patch');
    });

    it('should include error details if evaluator failed', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].status = 'failed';
      bundle.evaluators[0].error = {
        message: 'Evaluator failed',
        stack_trace: 'Error: Evaluator failed\n  at ...',
      };

      const result = await reporter.generate(bundle);

      expect(result).toContain('**Error:**');
      expect(result).toContain('Evaluator failed');
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

      expect(result).toContain('## Evaluator Results');
      expect(result).toContain('No evaluators were run');
    });

    it('should display skipped evaluators', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators[0].status = 'skipped';

      const result = await reporter.generate(bundle);

      expect(result).toContain('⏭️ **Status:** skipped');
    });

    it('should include artifacts manifest section', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();

      const result = await reporter.generate(bundle);

      expect(result).toContain('## Artifacts');
      expect(result).toContain('agent-log.json');
      expect(result).toContain('report.md');
    });

    it('should handle options parameter gracefully', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const options = { custom: 'option' };

      const result = await reporter.generate(bundle, options);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should display expected-diff similarity metrics', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators.push({
        evaluator: 'expected-diff',
        status: 'passed',
        metrics: {
          aggregate_similarity: 0.85,
          threshold: 0.80,
          files_matched: 5,
          files_changed: 2,
          files_added: 1,
          files_removed: 0,
          file_similarities: [],
        },
        message: 'Similarity: 85.0% (threshold: 80%)',
        duration_ms: 1500,
        timestamp: '2025-01-01T00:04:15Z',
      });

      const result = await reporter.generate(bundle);

      expect(result).toContain('expected-diff');
      expect(result).toContain('Aggregate Similarity');
      expect(result).toContain('85.0%');
      expect(result).toContain('Threshold');
      expect(result).toContain('80%');
      expect(result).toContain('Files Matched');
      expect(result).toContain('5');
    });

    it('should display expected-diff file-level details', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      bundle.evaluators.push({
        evaluator: 'expected-diff',
        status: 'failed',
        metrics: {
          aggregate_similarity: 0.65,
          threshold: 0.80,
          files_matched: 3,
          files_changed: 5,
          files_added: 2,
          files_removed: 1,
          file_similarities: [
            { path: 'file1.ts', similarity: 1.0, status: 'matched' },
            { path: 'file2.ts', similarity: 0.75, status: 'changed' },
            { path: 'file3.ts', similarity: 0.45, status: 'changed' },
            { path: 'file4.ts', similarity: 0.0, status: 'added' },
          ],
        },
        message: 'Similarity: 65.0% (threshold: 80%)',
        duration_ms: 2000,
        timestamp: '2025-01-01T00:04:20Z',
      });

      const result = await reporter.generate(bundle);

      expect(result).toContain('File-Level Details');
      expect(result).toContain('file1.ts');
      expect(result).toContain('file2.ts');
      expect(result).toContain('100.0%');
      expect(result).toContain('75.0%');
      expect(result).toContain('matched');
      expect(result).toContain('changed');
    });

    it('should truncate file-level details to 20 files', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      
      // Create 30 file similarities
      const file_similarities = Array.from({ length: 30 }, (_, i) => ({
        path: `file${i}.ts`,
        similarity: Math.random(),
        status: 'changed' as const,
      }));
      
      bundle.evaluators.push({
        evaluator: 'expected-diff',
        status: 'failed',
        metrics: {
          aggregate_similarity: 0.70,
          threshold: 0.80,
          files_matched: 10,
          files_changed: 20,
          files_added: 0,
          files_removed: 0,
          file_similarities,
        },
        message: 'Similarity: 70.0% (threshold: 80%)',
        duration_ms: 2000,
        timestamp: '2025-01-01T00:04:20Z',
      });

      const result = await reporter.generate(bundle);

      expect(result).toContain('File-Level Details');
      expect(result).toContain('10 more files');
    });
  });

  describe('writeToFile()', () => {
    it('should write markdown report to file', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'report.md');

      await reporter.writeToFile(bundle, outputPath);

      const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should create parent directories if they do not exist', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'nested', 'dir', 'report.md');

      await reporter.writeToFile(bundle, outputPath);

      const fileExists = await fs.stat(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should write valid markdown content to file', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'report.md');

      await reporter.writeToFile(bundle, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');

      expect(content).toContain('# youBencha Evaluation Report');
      expect(content).toContain('## Summary');
      expect(content).toContain('https://github.com/example/repo.git');
    });

    it('should overwrite existing file', async () => {
      const bundle1: ResultsBundle = createMockResultsBundle();
      const bundle2: ResultsBundle = {
        ...createMockResultsBundle(),
        suite: {
          ...createMockResultsBundle().suite,
          repo: 'https://github.com/different/repo.git',
        },
      };
      const outputPath = path.join(tempDir, 'report.md');

      await reporter.writeToFile(bundle1, outputPath);
      await reporter.writeToFile(bundle2, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');

      expect(content).toContain('https://github.com/different/repo.git');
    });

    it('should handle options parameter gracefully', async () => {
      const bundle: ResultsBundle = createMockResultsBundle();
      const outputPath = path.join(tempDir, 'report.md');
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
    suite: {
      config_file: 'suite.yaml',
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
