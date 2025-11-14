/**
 * Unit tests for Storage Manager
 * 
 * Tests storage operations: save JSON, save artifacts, artifact manifest
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { YouBenchaLog, ResultsBundle } from '../../src/schemas/index.js';

// Import the storage manager (will be implemented in T033)
import {
  saveYouBenchaLog,
  saveResultsBundle,
  saveArtifact,
  getArtifactManifest,
  ensureArtifactsDirectory,
} from '../../src/core/storage.js';

describe('Storage Manager', () => {
  let testDir: string;
  let artifactsDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `youbencha-test-${Date.now()}`);
    artifactsDir = join(testDir, 'artifacts');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('saveYouBenchaLog', () => {
    test('saves youBencha Log to artifacts directory', async () => {
      const mockLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'test-model',
          provider: 'TestProvider',
          parameters: { temperature: 0.7 },
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:05:00.000Z',
          duration_ms: 300000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        errors: [],
        environment: {
          os: 'linux',
          node_version: '20.10.0',
          youbencha_version: '0.1.0',
          working_directory: '/test/workspace',
        },
      };

      const filePath = await saveYouBenchaLog(mockLog, artifactsDir);

      // Verify file was created
      expect(existsSync(filePath)).toBe(true);
      expect(filePath).toBe(join(artifactsDir, 'youbencha.log.json'));

      // Verify content
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content).toEqual(mockLog);
    });

    test('creates artifacts directory if it does not exist', async () => {
      const mockLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'test-model',
          provider: 'TestProvider',
          parameters: {},
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:05:00.000Z',
          duration_ms: 300000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        errors: [],
        environment: {
          os: 'linux',
          node_version: '20.10.0',
          youbencha_version: '0.1.0',
          working_directory: '/test/workspace',
        },
      };

      expect(existsSync(artifactsDir)).toBe(false);

      await saveYouBenchaLog(mockLog, artifactsDir);

      expect(existsSync(artifactsDir)).toBe(true);
    });

    test('pretty-prints JSON with 2-space indentation', async () => {
      const mockLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'Test Agent',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'test-model',
          provider: 'TestProvider',
          parameters: {},
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:05:00.000Z',
          duration_ms: 300000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        errors: [],
        environment: {
          os: 'linux',
          node_version: '20.10.0',
          youbencha_version: '0.1.0',
          working_directory: '/test/workspace',
        },
      };

      const filePath = await saveYouBenchaLog(mockLog, artifactsDir);

      const rawContent = readFileSync(filePath, 'utf-8');
      expect(rawContent).toContain('  "version": "1.0.0"');
      expect(rawContent).toContain('\n');
    });
  });

  describe('saveResultsBundle', () => {
    test('saves results bundle to artifacts directory', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        suite: {
          config_file: '/path/to/suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/test/repo',
          branch: 'main',
          commit: 'def456',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'linux',
            node_version: '20.10.0',
            workspace_dir: '/test/workspace',
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

      const filePath = await saveResultsBundle(mockBundle, artifactsDir);

      // Verify file was created
      expect(existsSync(filePath)).toBe(true);
      expect(filePath).toBe(join(artifactsDir, 'results.json'));

      // Verify content
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content).toEqual(mockBundle);
    });

    test('creates artifacts directory if it does not exist', async () => {
      const mockBundle: ResultsBundle = {
        version: '1.0.0',
        suite: {
          config_file: '/path/to/suite.yaml',
          config_hash: 'abc123',
          repo: 'https://github.com/test/repo',
          branch: 'main',
          commit: 'def456',
        },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:10:00.000Z',
          duration_ms: 600000,
          youbencha_version: '0.1.0',
          environment: {
            os: 'linux',
            node_version: '20.10.0',
            workspace_dir: '/test/workspace',
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

      expect(existsSync(artifactsDir)).toBe(false);

      await saveResultsBundle(mockBundle, artifactsDir);

      expect(existsSync(artifactsDir)).toBe(true);
    });
  });

  describe('saveArtifact', () => {
    test('saves text artifact to artifacts directory', async () => {
      const content = 'This is a test artifact';
      const filename = 'test-artifact.txt';

      const filePath = await saveArtifact(content, filename, artifactsDir);

      // Verify file was created
      expect(existsSync(filePath)).toBe(true);
      expect(filePath).toBe(join(artifactsDir, filename));

      // Verify content
      const savedContent = readFileSync(filePath, 'utf-8');
      expect(savedContent).toBe(content);
    });

    test('saves artifact in subdirectory', async () => {
      const content = 'Evaluator artifact';
      const filename = 'evaluators/git-diff.patch';

      const filePath = await saveArtifact(content, filename, artifactsDir);

      // Verify file was created
      expect(existsSync(filePath)).toBe(true);
      expect(filePath).toBe(join(artifactsDir, filename));

      // Verify subdirectory was created
      const subdirPath = join(artifactsDir, 'evaluators');
      expect(existsSync(subdirPath)).toBe(true);
    });

    test('overwrites existing artifact', async () => {
      const filename = 'overwrite-test.txt';
      const filePath = join(artifactsDir, filename);

      // Create initial file
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(filePath, 'Original content');

      // Save new content
      await saveArtifact('New content', filename, artifactsDir);

      // Verify content was overwritten
      const savedContent = readFileSync(filePath, 'utf-8');
      expect(savedContent).toBe('New content');
    });
  });

  describe('getArtifactManifest', () => {
    test('returns list of all files in artifacts directory', async () => {
      // Create some test files
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(join(artifactsDir, 'file1.txt'), 'content1');
      writeFileSync(join(artifactsDir, 'file2.json'), 'content2');

      const subdir = join(artifactsDir, 'subdir');
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(subdir, 'file3.txt'), 'content3');

      const manifest = await getArtifactManifest(artifactsDir);

      // Verify all files are listed with relative paths
      expect(manifest).toHaveLength(3);
      expect(manifest).toContain('file1.txt');
      expect(manifest).toContain('file2.json');
      expect(manifest).toContain(join('subdir', 'file3.txt'));
    });

    test('returns empty array for empty directory', async () => {
      mkdirSync(artifactsDir, { recursive: true });

      const manifest = await getArtifactManifest(artifactsDir);

      expect(manifest).toEqual([]);
    });

    test('returns empty array for non-existent directory', async () => {
      const manifest = await getArtifactManifest(artifactsDir);

      expect(manifest).toEqual([]);
    });

    test('excludes directories from manifest', async () => {
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(join(artifactsDir, 'file.txt'), 'content');

      const subdir = join(artifactsDir, 'emptydir');
      mkdirSync(subdir, { recursive: true });

      const manifest = await getArtifactManifest(artifactsDir);

      // Should only include the file, not the directory
      expect(manifest).toHaveLength(1);
      expect(manifest).toContain('file.txt');
    });
  });

  describe('ensureArtifactsDirectory', () => {
    test('creates artifacts directory if it does not exist', async () => {
      expect(existsSync(artifactsDir)).toBe(false);

      await ensureArtifactsDirectory(artifactsDir);

      expect(existsSync(artifactsDir)).toBe(true);
    });

    test('does not throw if directory already exists', async () => {
      mkdirSync(artifactsDir, { recursive: true });
      expect(existsSync(artifactsDir)).toBe(true);

      await expect(ensureArtifactsDirectory(artifactsDir)).resolves.not.toThrow();
    });

    test('creates nested directories', async () => {
      const nestedDir = join(artifactsDir, 'evaluators', 'reports');

      await ensureArtifactsDirectory(nestedDir);

      expect(existsSync(nestedDir)).toBe(true);
    });
  });
});
