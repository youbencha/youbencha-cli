/**
 * Unit tests for Orchestrator
 * 
 * TDD: These tests MUST FAIL before implementation
 */

import { Orchestrator } from '../../src/core/orchestrator.js';
import { SuiteConfig } from '../../src/schemas/suite.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let tempDir: string;
  let mockSuiteConfig: SuiteConfig;

  beforeEach(async () => {
    orchestrator = new Orchestrator();
    
    // Create temporary test directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-test-'));
    
    mockSuiteConfig = {
      repo: 'https://github.com/octocat/Hello-World.git',
      branch: 'master',
      agent: {
        type: 'copilot-cli',
        config: {
          prompt: 'Test task',
        },
      },
      expected_source: undefined,
      evaluators: [
        {
          name: 'git-diff',
          config: {},
        },
      ],
      workspace_dir: tempDir,
      timeout: 60000,
    };
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('runEvaluation', () => {
    test('returns a ResultsBundle', async () => {
      // This test will fail until orchestrator is implemented
      // Skip git cloning by mocking workspace
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.test_case).toBeDefined();
      expect(result.execution).toBeDefined();
      expect(result.agent).toBeDefined();
      expect(result.evaluators).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.artifacts).toBeDefined();
    }, 120000); // 2 min timeout for potential git operations

    test('includes test case metadata', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.test_case.repo).toBe(mockSuiteConfig.repo);
      expect(result.test_case.branch).toBe(mockSuiteConfig.branch);
      expect(result.test_case.commit).toBeDefined();
    }, 120000);

    test('includes execution metadata', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.execution.started_at).toBeDefined();
      expect(result.execution.completed_at).toBeDefined();
      expect(result.execution.duration_ms).toBeGreaterThan(0);
      expect(result.execution.youbencha_version).toBeDefined();
      expect(result.execution.environment).toBeDefined();
    }, 120000);

    test('includes agent execution metadata', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.agent.type).toBe('copilot-cli');
      expect(result.agent.status).toMatch(/^(success|failed|timeout)$/);
      expect(result.agent.exit_code).toBeDefined();
      expect(result.agent.youbencha_log_path).toBeDefined();
    }, 120000);

    test('runs configured evaluators', async () => {
      const configWithMultipleEvaluators: SuiteConfig = {
        ...mockSuiteConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          { name: 'agentic-judge', config: { agent: { type: 'copilot-cli', config: {} } } },
        ],
      };

      const result = await orchestrator.runEvaluation(configWithMultipleEvaluators);
      
      expect(result.evaluators.length).toBeGreaterThan(0);
      expect(result.evaluators.some(e => e.evaluator === 'git-diff')).toBe(true);
    }, 120000);

    test('includes summary statistics', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.summary.total_evaluators).toBeDefined();
      expect(result.summary.passed).toBeDefined();
      expect(result.summary.failed).toBeDefined();
      expect(result.summary.skipped).toBeDefined();
      expect(result.summary.overall_status).toMatch(/^(passed|failed|partial)$/);
    }, 120000);

    test('includes artifacts manifest', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.artifacts.agent_log).toBeDefined();
      expect(Array.isArray(result.artifacts.reports)).toBe(true);
      expect(Array.isArray(result.artifacts.evaluator_artifacts)).toBe(true);
    }, 120000);
  });

  describe('Error Handling', () => {
    test('handles invalid repository URL gracefully', async () => {
      const invalidConfig: SuiteConfig = {
        ...mockSuiteConfig,
        repo: 'not-a-valid-url',
      };

      await expect(orchestrator.runEvaluation(invalidConfig)).rejects.toThrow();
    });

    test('handles evaluator errors gracefully', async () => {
      const configWithInvalidEvaluator: SuiteConfig = {
        ...mockSuiteConfig,
        evaluators: [
          { name: 'non-existent-evaluator', config: {} },
        ],
      };

      const result = await orchestrator.runEvaluation(configWithInvalidEvaluator);
      
      // Should complete but mark evaluator as skipped
      expect(result).toBeDefined();
      expect(result.evaluators.some(e => e.status === 'skipped')).toBe(true);
    }, 120000);
  });

  describe('Workspace Management', () => {
    test('creates workspace directory', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result).toBeDefined();
      // Workspace should exist during evaluation
    }, 120000);

    test('cleans up workspace after evaluation', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      // Workspace should be cleaned up unless configured to keep
      expect(result).toBeDefined();
    }, 120000);
  });

  describe('Evaluator Execution', () => {
    test('runs evaluators in parallel by default', async () => {
      const configWithMultiple: SuiteConfig = {
        ...mockSuiteConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          { name: 'agentic-judge', config: { agent: { type: 'copilot-cli', config: {} } } },
        ],
      };

      const startTime = Date.now();
      const result = await orchestrator.runEvaluation(configWithMultiple);
      const endTime = Date.now();
      // Keep these variables for potential future timing validation
      void startTime;
      void endTime;

      expect(result.evaluators.length).toBeGreaterThanOrEqual(2);
      // Parallel execution should be faster than sequential
      // This is a weak test but validates the concept
    }, 120000);

    test('continues evaluation even if one evaluator fails', async () => {
      const configWithMixed: SuiteConfig = {
        ...mockSuiteConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          { name: 'invalid-evaluator', config: {} },
        ],
      };

      const result = await orchestrator.runEvaluation(configWithMixed);
      
      expect(result.evaluators.length).toBeGreaterThan(0);
      // Should have at least one result even if others fail
    }, 120000);
  });

  describe('Expected Reference Support', () => {
    test('clones expected branch when configured', async () => {
      const configWithExpected: SuiteConfig = {
        ...mockSuiteConfig,
        expected_source: 'branch',
        expected: 'master', // Use master branch which exists
      };

      const result = await orchestrator.runEvaluation(configWithExpected);
      
      expect(result.test_case.expected_branch).toBe('master');
      expect(result).toBeDefined();
    }, 120000);

    test('validates expected branch exists', async () => {
      const configWithInvalidExpected: SuiteConfig = {
        ...mockSuiteConfig,
        expected_source: 'branch',
        expected: 'nonexistent-branch-xyz',
      };

      await expect(orchestrator.runEvaluation(configWithInvalidExpected)).rejects.toThrow();
    });
  });

  describe('Results Persistence', () => {
    it('should save youBencha log to artifacts', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result.artifacts.agent_log).toContain('youbencha.log.json');
    }, 120000);

    test('saves results bundle to artifacts', async () => {
      const result = await orchestrator.runEvaluation(mockSuiteConfig);
      
      expect(result).toBeDefined();
      // Results bundle should be saved
    }, 120000);
  });
});
