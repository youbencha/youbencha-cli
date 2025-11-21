/**
 * Post-Evaluators Unit Tests
 * 
 * Tests for webhook, database, and script post-evaluators.
 */

import { WebhookPostEvaluator } from '../../src/post-evaluators/webhook';
import { DatabasePostEvaluator } from '../../src/post-evaluators/database';
import { ScriptPostEvaluator } from '../../src/post-evaluators/script';
import { PostEvaluationContext } from '../../src/post-evaluators/base';
import { ResultsBundle } from '../../src/schemas/result.schema';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Create a mock ResultsBundle for testing
 */
function createMockResultsBundle(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'test',
      description: 'test case',
      config_file: 'test.yaml',
      config_hash: 'abc123',
      repo: 'https://github.com/test/test.git',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: '2025-01-01T00:00:00Z',
      completed_at: '2025-01-01T00:05:00Z',
      duration_ms: 300000,
      youbencha_version: '1.0.0',
      environment: {
        os: 'Linux',
        node_version: '20.0.0',
        workspace_dir: '/tmp/workspace',
      },
    },
    agent: {
      type: 'copilot-cli',
      youbencha_log_path: 'youbencha.log.json',
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
      agent_log: 'youbencha.log.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

describe('WebhookPostEvaluator', () => {
  let evaluator: WebhookPostEvaluator;
  let mockContext: PostEvaluationContext;

  beforeEach(() => {
    evaluator = new WebhookPostEvaluator();
    
    const mockBundle = createMockResultsBundle();

    mockContext = {
      resultsBundle: mockBundle,
      resultsBundlePath: '/tmp/results.json',
      artifactsDir: '/tmp/artifacts',
      workspaceDir: '/tmp/workspace',
      config: {
        url: 'https://httpbin.org/post',
        method: 'POST',
        timeout_ms: 5000,
        retry_on_failure: false,
      },
    };
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(evaluator.name).toBe('webhook');
    });

    it('should have descriptive description', () => {
      expect(evaluator.description).toContain('webhook');
    });
  });

  describe('checkPreconditions', () => {
    it('should return true for valid webhook URL', async () => {
      const result = await evaluator.checkPreconditions(mockContext);
      expect(result).toBe(true);
    });

    it('should return false for invalid webhook URL', async () => {
      mockContext.config = { url: 'not-a-url' };
      const result = await evaluator.checkPreconditions(mockContext);
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should return result with correct structure', async () => {
      const result = await evaluator.execute(mockContext);
      
      expect(result).toHaveProperty('post_evaluator', 'webhook');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('duration_ms');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.duration_ms).toBe('number');
    });
  });
});

describe('DatabasePostEvaluator', () => {
  let evaluator: DatabasePostEvaluator;
  let mockContext: PostEvaluationContext;
  let tempDir: string;
  let outputPath: string;

  beforeEach(async () => {
    evaluator = new DatabasePostEvaluator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-test-'));
    outputPath = path.join(tempDir, 'results.jsonl');
    
    const mockBundle = createMockResultsBundle();

    mockContext = {
      resultsBundle: mockBundle,
      resultsBundlePath: '/tmp/results.json',
      artifactsDir: '/tmp/artifacts',
      workspaceDir: '/tmp/workspace',
      config: {
        type: 'json-file',
        output_path: outputPath,
        include_full_bundle: true,
        append: true,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(evaluator.name).toBe('database');
    });

    it('should have descriptive description', () => {
      expect(evaluator.description).toContain('database');
    });
  });

  describe('checkPreconditions', () => {
    it('should return true when output directory can be created', async () => {
      const result = await evaluator.checkPreconditions(mockContext);
      expect(result).toBe(true);
    });
  });

  describe('execute', () => {
    it('should create JSONL file with results', async () => {
      const result = await evaluator.execute(mockContext);
      
      expect(result.status).toBe('success');
      expect(result.post_evaluator).toBe('database');
      
      // Check file was created
      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // Check file content
      const content = await fs.readFile(outputPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      
      const data = JSON.parse(lines[0]);
      expect(data).toHaveProperty('version', '1.0.0');
      expect(data).toHaveProperty('exported_at');
    });

    it('should append to existing file', async () => {
      // First write
      await evaluator.execute(mockContext);
      
      // Second write
      await evaluator.execute(mockContext);
      
      const content = await fs.readFile(outputPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });
  });
});

describe('ScriptPostEvaluator', () => {
  let evaluator: ScriptPostEvaluator;
  let mockContext: PostEvaluationContext;

  beforeEach(() => {
    evaluator = new ScriptPostEvaluator();
    
    const mockBundle = createMockResultsBundle();

    mockContext = {
      resultsBundle: mockBundle,
      resultsBundlePath: '/tmp/results.json',
      artifactsDir: '/tmp/artifacts',
      workspaceDir: '/tmp/workspace',
      config: {
        command: 'echo',
        args: ['Hello World'],
        timeout_ms: 5000,
      },
    };
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(evaluator.name).toBe('script');
    });

    it('should have descriptive description', () => {
      expect(evaluator.description).toContain('script');
    });
  });

  describe('checkPreconditions', () => {
    it('should return true for valid command', async () => {
      const result = await evaluator.checkPreconditions(mockContext);
      expect(result).toBe(true);
    });

    it('should return false for empty command', async () => {
      mockContext.config = { command: '' };
      const result = await evaluator.checkPreconditions(mockContext);
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute simple command successfully', async () => {
      const result = await evaluator.execute(mockContext);
      
      expect(result.status).toBe('success');
      expect(result.post_evaluator).toBe('script');
      expect(result.metadata).toHaveProperty('exit_code', 0);
    });

    it('should replace variables in args', async () => {
      mockContext.config = {
        command: 'echo',
        args: ['${TEST_CASE_NAME}'],
        timeout_ms: 5000,
      };
      
      const result = await evaluator.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('test');
    });
  });
});
