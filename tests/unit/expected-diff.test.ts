/**
 * Unit tests for ExpectedDiffEvaluator
 * 
 * Tests the ExpectedDiffEvaluator implementation including:
 * - File comparison between modified and expected directories
 * - Similarity scoring for individual files
 * - Aggregate similarity calculation
 * - Threshold checking for pass/fail status
 * 
 * TDD: These tests MUST FAIL initially before implementation
 */

import { ExpectedDiffEvaluator } from '../../src/evaluators/expected-diff.js';
import { EvaluationContext } from '../../src/evaluators/base.js';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';
import { SuiteConfig } from '../../src/schemas/suite.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ExpectedDiffEvaluator', () => {
  let evaluator: ExpectedDiffEvaluator;
  let tempDir: string;
  let modifiedDir: string;
  let expectedDir: string;
  let artifactsDir: string;
  let mockAgentLog: YouBenchaLog;
  let mockSuiteConfig: SuiteConfig;

  beforeAll(async () => {
    evaluator = new ExpectedDiffEvaluator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'expected-diff-test-'));
    modifiedDir = path.join(tempDir, 'src-modified');
    expectedDir = path.join(tempDir, 'src-expected');
    artifactsDir = path.join(tempDir, 'artifacts');

    await fs.mkdir(modifiedDir, { recursive: true });
    await fs.mkdir(expectedDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });

    mockAgentLog = {
      version: '1.0.0',
      agent: { name: 'test-agent', version: '1.0.0', adapter_version: '1.0.0' },
      model: { name: 'test-model', provider: 'test', parameters: {} },
      execution: {
        started_at: '2025-11-04T10:00:00.000Z',
        completed_at: '2025-11-04T10:01:00.000Z',
        duration_ms: 60000,
        exit_code: 0,
        status: 'success',
      },
      messages: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      errors: [],
      environment: {
        os: 'test',
        node_version: 'v20.0.0',
        youbencha_version: '1.0.0',
        working_directory: '/test',
      },
    };

    mockSuiteConfig = {
      version: '1.0.0',
      repo: 'https://github.com/test/repo.git',
      branch: 'main',
      agent: { name: 'test-agent', config: {} },
      evaluators: [],
    };
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(evaluator.name).toBe('expected-diff');
    });

    it('should have descriptive description', () => {
      expect(evaluator.description).toBeDefined();
      expect(evaluator.description.length).toBeGreaterThan(10);
    });

    it('should require expected reference', () => {
      expect(evaluator.requiresExpectedReference).toBe(true);
    });
  });

  describe('checkPreconditions', () => {
    it('should return true when both directories exist', async () => {
      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(context);
      expect(canRun).toBe(true);
    });

    it('should return false when expectedDir is missing', async () => {
      const context: EvaluationContext = {
        modifiedDir,
        expectedDir: undefined,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(context);
      expect(canRun).toBe(false);
    });

    it('should return false when modified directory does not exist', async () => {
      const context: EvaluationContext = {
        modifiedDir: '/nonexistent/path',
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(context);
      expect(canRun).toBe(false);
    });

    it('should return false when expected directory does not exist', async () => {
      const context: EvaluationContext = {
        modifiedDir,
        expectedDir: '/nonexistent/path',
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(context);
      expect(canRun).toBe(false);
    });
  });

  describe('evaluate - file comparison', () => {
    beforeEach(async () => {
      // Clean directories before each test
      await fs.rm(modifiedDir, { recursive: true, force: true });
      await fs.rm(expectedDir, { recursive: true, force: true });
      await fs.mkdir(modifiedDir, { recursive: true });
      await fs.mkdir(expectedDir, { recursive: true });
    });

    it('should compare identical files and return 100% similarity', async () => {
      // Create identical files
      const content = 'function test() {\n  return true;\n}\n';
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), content);
      await fs.writeFile(path.join(expectedDir, 'test.ts'), content);

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.evaluator).toBe('expected-diff');
      expect(result.status).toBe('passed');
      expect(result.metrics.aggregate_similarity).toBe(1.0);
      expect(result.metrics.files_matched).toBe(1);
      expect(result.metrics.files_changed).toBe(0);
    });

    it('should detect differences in file content', async () => {
      // Create different files
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'console.log("modified");\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'console.log("expected");\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics.aggregate_similarity).toBeLessThan(1.0);
      expect(result.metrics.aggregate_similarity).toBeGreaterThan(0.0);
      expect(result.metrics.files_changed).toBeGreaterThan(0);
    });

    it('should handle added files in modified directory', async () => {
      // File only exists in modified
      await fs.writeFile(path.join(modifiedDir, 'new-file.ts'), 'console.log("new");\n');
      await fs.writeFile(path.join(expectedDir, 'existing.ts'), 'console.log("old");\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics).toHaveProperty('files_added');
      expect(result.metrics.files_added).toBe(1);
    });

    it('should handle removed files from expected directory', async () => {
      // File only exists in expected
      await fs.writeFile(path.join(modifiedDir, 'remaining.ts'), 'console.log("remains");\n');
      await fs.writeFile(path.join(expectedDir, 'remaining.ts'), 'console.log("remains");\n');
      await fs.writeFile(path.join(expectedDir, 'removed.ts'), 'console.log("gone");\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics).toHaveProperty('files_removed');
      expect(result.metrics.files_removed).toBe(1);
    });

    it('should compare multiple files', async () => {
      // Create multiple files with varying similarity
      await fs.writeFile(path.join(modifiedDir, 'file1.ts'), 'identical content\n');
      await fs.writeFile(path.join(expectedDir, 'file1.ts'), 'identical content\n');
      
      await fs.writeFile(path.join(modifiedDir, 'file2.ts'), 'modified content here\n');
      await fs.writeFile(path.join(expectedDir, 'file2.ts'), 'expected content here\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics.files_matched).toBeGreaterThanOrEqual(1);
      expect(result.metrics.aggregate_similarity).toBeGreaterThan(0.5);
      expect(result.metrics.aggregate_similarity).toBeLessThan(1.0);
    });
  });

  describe('evaluate - similarity scoring', () => {
    beforeEach(async () => {
      await fs.rm(modifiedDir, { recursive: true, force: true });
      await fs.rm(expectedDir, { recursive: true, force: true });
      await fs.mkdir(modifiedDir, { recursive: true });
      await fs.mkdir(expectedDir, { recursive: true });
    });

    it('should provide per-file similarity scores', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'console.log("test");\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'console.log("test");\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics).toHaveProperty('file_similarities');
      expect(Array.isArray(result.metrics.file_similarities)).toBe(true);
      
      if (result.metrics.file_similarities && result.metrics.file_similarities.length > 0) {
        const firstFile = result.metrics.file_similarities[0];
        expect(firstFile).toHaveProperty('path');
        expect(firstFile).toHaveProperty('similarity');
        expect(firstFile.similarity).toBeGreaterThanOrEqual(0);
        expect(firstFile.similarity).toBeLessThanOrEqual(1);
      }
    });

    it('should calculate aggregate similarity as average', async () => {
      // Create files with known similarities
      await fs.writeFile(path.join(modifiedDir, 'identical.ts'), 'same content\n');
      await fs.writeFile(path.join(expectedDir, 'identical.ts'), 'same content\n');
      
      await fs.writeFile(path.join(modifiedDir, 'different.ts'), 'completely different\n');
      await fs.writeFile(path.join(expectedDir, 'different.ts'), 'xyz\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      // Aggregate should be between 0 and 1
      expect(result.metrics.aggregate_similarity).toBeGreaterThan(0);
      expect(result.metrics.aggregate_similarity).toBeLessThan(1);
    });
  });

  describe('evaluate - threshold checking', () => {
    beforeEach(async () => {
      await fs.rm(modifiedDir, { recursive: true, force: true });
      await fs.rm(expectedDir, { recursive: true, force: true });
      await fs.mkdir(modifiedDir, { recursive: true });
      await fs.mkdir(expectedDir, { recursive: true });
    });

    it('should pass when similarity exceeds threshold', async () => {
      // Create identical files
      const content = 'function test() { return true; }\n';
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), content);
      await fs.writeFile(path.join(expectedDir, 'test.ts'), content);

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: { threshold: 0.95 },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.status).toBe('passed');
      expect(result.metrics.threshold).toBe(0.95);
      expect(result.metrics.aggregate_similarity).toBeGreaterThanOrEqual(0.95);
    });

    it('should fail when similarity is below threshold', async () => {
      // Create very different files
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'completely different content\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'xyz\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: { threshold: 0.80 },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.status).toBe('failed');
      expect(result.metrics.threshold).toBe(0.80);
      expect(result.metrics.aggregate_similarity).toBeLessThan(0.80);
    });

    it('should use default threshold of 0.80 when not configured', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'test\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'test\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {}, // No threshold specified
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics.threshold).toBe(0.80);
    });
  });

  describe('evaluate - artifact generation', () => {
    beforeEach(async () => {
      await fs.rm(modifiedDir, { recursive: true, force: true });
      await fs.rm(expectedDir, { recursive: true, force: true });
      await fs.rm(artifactsDir, { recursive: true, force: true });
      await fs.mkdir(modifiedDir, { recursive: true });
      await fs.mkdir(expectedDir, { recursive: true });
      await fs.mkdir(artifactsDir, { recursive: true });
    });

    it('should save detailed diff report as artifact', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'modified\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'expected\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.artifacts).toBeDefined();
      expect(Array.isArray(result.artifacts)).toBe(true);
      expect(result.artifacts!.length).toBeGreaterThan(0);
    });

    it('should create diff patch file in artifacts directory', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'modified content\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'expected content\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      const diffArtifact = result.artifacts?.find(a => a.type === 'diff-report');
      expect(diffArtifact).toBeDefined();
      
      if (diffArtifact) {
        const artifactPath = path.join(artifactsDir, diffArtifact.path);
        const exists = await fs.access(artifactPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it('should include file-level details in artifact', async () => {
      await fs.writeFile(path.join(modifiedDir, 'file1.ts'), 'content1\n');
      await fs.writeFile(path.join(expectedDir, 'file1.ts'), 'content1\n');
      await fs.writeFile(path.join(modifiedDir, 'file2.ts'), 'different\n');
      await fs.writeFile(path.join(expectedDir, 'file2.ts'), 'also different\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      const diffArtifact = result.artifacts?.find(a => a.type === 'diff-report');
      if (diffArtifact) {
        const artifactPath = path.join(artifactsDir, diffArtifact.path);
        const artifactContent = await fs.readFile(artifactPath, 'utf-8');
        
        // Artifact should contain file information
        expect(artifactContent).toContain('file1.ts');
        expect(artifactContent).toContain('file2.ts');
        expect(artifactContent).toContain('similarity');
      }
    });
  });

  describe('evaluate - error handling', () => {
    it('should skip when expectedDir is not provided', async () => {
      const context: EvaluationContext = {
        modifiedDir,
        expectedDir: undefined,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.status).toBe('skipped');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Expected reference');
    });

    it('should handle file read errors gracefully', async () => {
      // Create a file that will cause read error (if possible on the platform)
      const context: EvaluationContext = {
        modifiedDir: '/nonexistent',
        expectedDir: '/nonexistent',
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.status).toBe('skipped');
      expect(result.error).toBeDefined();
    });
  });

  describe('evaluate - metrics completeness', () => {
    beforeEach(async () => {
      await fs.rm(modifiedDir, { recursive: true, force: true });
      await fs.rm(expectedDir, { recursive: true, force: true });
      await fs.mkdir(modifiedDir, { recursive: true });
      await fs.mkdir(expectedDir, { recursive: true });
    });

    it('should include all required metrics', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'test\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'test\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result.metrics).toHaveProperty('aggregate_similarity');
      expect(result.metrics).toHaveProperty('threshold');
      expect(result.metrics).toHaveProperty('files_matched');
      expect(result.metrics).toHaveProperty('files_changed');
      expect(result.metrics).toHaveProperty('files_added');
      expect(result.metrics).toHaveProperty('files_removed');
      expect(result.metrics).toHaveProperty('file_similarities');
    });

    it('should include execution metadata', async () => {
      await fs.writeFile(path.join(modifiedDir, 'test.ts'), 'test\n');
      await fs.writeFile(path.join(expectedDir, 'test.ts'), 'test\n');

      const context: EvaluationContext = {
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog: mockAgentLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration_ms');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
