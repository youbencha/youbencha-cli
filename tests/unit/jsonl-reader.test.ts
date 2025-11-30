/**
 * Unit tests for JSONL Reader
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { JSONLReader, JSONLReaderError } from '../../src/analysis/jsonl-reader';
import { ExportedResultsBundle } from '../../src/analysis/schemas/analysis.schema';

/**
 * Create a valid ExportedResultsBundle for testing
 */
function createValidBundle(
  name: string = 'Test Case',
  exportedAt: string = '2025-11-30T10:00:00Z',
  agentType: string = 'copilot-cli',
  status: 'passed' | 'failed' | 'partial' = 'passed'
): ExportedResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name,
      description: 'Test description',
      config_file: 'testcase.yaml',
      config_hash: 'abc123',
      repo: 'https://github.com/test/repo',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: exportedAt,
      completed_at: exportedAt,
      duration_ms: 30000,
      youbencha_version: '0.1.1',
      environment: {
        os: 'Linux',
        node_version: '20.0.0',
        workspace_dir: '/tmp/workspace',
      },
    },
    agent: {
      type: agentType,
      youbencha_log_path: 'youbencha.log.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [
      {
        evaluator: 'git-diff',
        status: 'passed',
        metrics: { files_changed: 3 },
        message: 'Passed',
        duration_ms: 500,
        timestamp: exportedAt,
      },
    ],
    summary: {
      total_evaluators: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      overall_status: status,
    },
    artifacts: {
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
    exported_at: exportedAt,
  };
}

describe('JSONLReader', () => {
  let tempDir: string;
  let reader: JSONLReader;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-jsonl-test-'));
    reader = new JSONLReader();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('readAll', () => {
    it('should read all valid records from JSONL file', async () => {
      const filePath = path.join(tempDir, 'results.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readAll(filePath);

      expect(result).toHaveLength(3);
      expect(result[0].test_case.name).toBe('Test 1');
      expect(result[1].test_case.name).toBe('Test 2');
      expect(result[2].test_case.name).toBe('Test 3');
    });

    it('should handle empty file', async () => {
      const filePath = path.join(tempDir, 'empty.jsonl');
      await fs.writeFile(filePath, '', 'utf-8');

      const result = await reader.readAll(filePath);

      expect(result).toHaveLength(0);
    });

    it('should throw error for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.jsonl');

      await expect(reader.readAll(filePath)).rejects.toThrow(JSONLReaderError);
      await expect(reader.readAll(filePath)).rejects.toThrow('No history file found');
    });

    it('should skip malformed JSON lines', async () => {
      const filePath = path.join(tempDir, 'mixed.jsonl');
      const validRecord = createValidBundle();

      const content = [
        JSON.stringify(validRecord),
        'not valid json',
        JSON.stringify(validRecord),
      ].join('\n');

      await fs.writeFile(filePath, content, 'utf-8');

      const result = await reader.readAll(filePath);

      expect(result).toHaveLength(2);
    });

    it('should skip invalid ResultsBundle records', async () => {
      const filePath = path.join(tempDir, 'invalid-schema.jsonl');
      const validRecord = createValidBundle();
      const invalidRecord = { version: '2.0.0', invalid: true }; // Wrong version

      const content = [
        JSON.stringify(validRecord),
        JSON.stringify(invalidRecord),
        JSON.stringify(validRecord),
      ].join('\n');

      await fs.writeFile(filePath, content, 'utf-8');

      const result = await reader.readAll(filePath);

      expect(result).toHaveLength(2);
    });

    it('should skip empty lines', async () => {
      const filePath = path.join(tempDir, 'with-blanks.jsonl');
      const record = createValidBundle();

      const content = [
        JSON.stringify(record),
        '',
        '   ',
        JSON.stringify(record),
      ].join('\n');

      await fs.writeFile(filePath, content, 'utf-8');

      const result = await reader.readAll(filePath);

      expect(result).toHaveLength(2);
    });
  });

  describe('stream', () => {
    it('should yield records one at a time', async () => {
      const filePath = path.join(tempDir, 'stream.jsonl');
      const records = [
        createValidBundle('Test 1'),
        createValidBundle('Test 2'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const streamed: ExportedResultsBundle[] = [];
      for await (const record of reader.stream(filePath)) {
        streamed.push(record);
      }

      expect(streamed).toHaveLength(2);
    });
  });

  describe('readFiltered', () => {
    it('should filter by test case name (exact match)', async () => {
      const filePath = path.join(tempDir, 'filter-testcase.jsonl');
      const records = [
        createValidBundle('Test Alpha', '2025-11-28T10:00:00Z'),
        createValidBundle('Test Beta', '2025-11-29T10:00:00Z'),
        createValidBundle('Test Alpha', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, { testCase: 'Test Alpha' });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.test_case.name === 'Test Alpha')).toBe(true);
    });

    it('should filter by test case name with glob pattern', async () => {
      const filePath = path.join(tempDir, 'filter-glob.jsonl');
      const records = [
        createValidBundle('Add README comment', '2025-11-28T10:00:00Z'),
        createValidBundle('Add error handling', '2025-11-29T10:00:00Z'),
        createValidBundle('Fix bug', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, { testCase: 'Add *' });

      expect(result).toHaveLength(2);
    });

    it('should filter by agent type', async () => {
      const filePath = path.join(tempDir, 'filter-agent.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z', 'copilot-cli'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z', 'claude-code'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z', 'copilot-cli'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, { agent: 'copilot-cli' });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.agent.type === 'copilot-cli')).toBe(true);
    });

    it('should filter by date range (since)', async () => {
      const filePath = path.join(tempDir, 'filter-since.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, {
        since: new Date('2025-11-29T00:00:00Z'),
      });

      expect(result).toHaveLength(2);
    });

    it('should filter by date range (until)', async () => {
      const filePath = path.join(tempDir, 'filter-until.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, {
        until: new Date('2025-11-29T23:59:59Z'),
      });

      expect(result).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const filePath = path.join(tempDir, 'filter-status.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z', 'copilot-cli', 'passed'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z', 'copilot-cli', 'failed'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z', 'copilot-cli', 'passed'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, {
        status: ['passed'],
      });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.summary.overall_status === 'passed')).toBe(true);
    });

    it('should combine multiple filters', async () => {
      const filePath = path.join(tempDir, 'filter-combined.jsonl');
      const records = [
        createValidBundle('Test A', '2025-11-28T10:00:00Z', 'copilot-cli', 'passed'),
        createValidBundle('Test A', '2025-11-29T10:00:00Z', 'claude-code', 'passed'),
        createValidBundle('Test B', '2025-11-30T10:00:00Z', 'copilot-cli', 'passed'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, {
        testCase: 'Test A',
        agent: 'copilot-cli',
      });

      expect(result).toHaveLength(1);
      expect(result[0].test_case.name).toBe('Test A');
      expect(result[0].agent.type).toBe('copilot-cli');
    });

    it('should respect limit', async () => {
      const filePath = path.join(tempDir, 'filter-limit.jsonl');
      const records = Array.from({ length: 10 }, (_, i) =>
        createValidBundle(`Test ${i}`, `2025-11-${20 + i}T10:00:00Z`)
      );

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readFiltered(filePath, { limit: 5 });

      expect(result).toHaveLength(5);
    });
  });

  describe('readLast', () => {
    it('should return last N records', async () => {
      const filePath = path.join(tempDir, 'last-n.jsonl');
      const records = [
        createValidBundle('Test 1', '2025-11-28T10:00:00Z'),
        createValidBundle('Test 2', '2025-11-29T10:00:00Z'),
        createValidBundle('Test 3', '2025-11-30T10:00:00Z'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readLast(filePath, 2);

      expect(result).toHaveLength(2);
      expect(result[0].test_case.name).toBe('Test 2');
      expect(result[1].test_case.name).toBe('Test 3');
    });

    it('should return all records if N exceeds count', async () => {
      const filePath = path.join(tempDir, 'last-all.jsonl');
      const records = [
        createValidBundle('Test 1'),
        createValidBundle('Test 2'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readLast(filePath, 10);

      expect(result).toHaveLength(2);
    });

    it('should apply filter before taking last N', async () => {
      const filePath = path.join(tempDir, 'last-filtered.jsonl');
      const records = [
        createValidBundle('Test A', '2025-11-28T10:00:00Z', 'copilot-cli'),
        createValidBundle('Test B', '2025-11-29T10:00:00Z', 'claude-code'),
        createValidBundle('Test A', '2025-11-30T10:00:00Z', 'copilot-cli'),
        createValidBundle('Test A', '2025-11-30T11:00:00Z', 'copilot-cli'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const result = await reader.readLast(filePath, 2, { agent: 'copilot-cli' });

      expect(result).toHaveLength(2);
      // Should get the last 2 copilot-cli records
      expect(result.every((r) => r.agent.type === 'copilot-cli')).toBe(true);
    });
  });

  describe('count', () => {
    it('should return correct record count', async () => {
      const filePath = path.join(tempDir, 'count.jsonl');
      const records = [
        createValidBundle('Test 1'),
        createValidBundle('Test 2'),
        createValidBundle('Test 3'),
      ];

      await fs.writeFile(
        filePath,
        records.map((r) => JSON.stringify(r)).join('\n'),
        'utf-8'
      );

      const count = await reader.count(filePath);

      expect(count).toBe(3);
    });

    it('should return 0 for empty file', async () => {
      const filePath = path.join(tempDir, 'empty-count.jsonl');
      await fs.writeFile(filePath, '', 'utf-8');

      const count = await reader.count(filePath);

      expect(count).toBe(0);
    });
  });
});
