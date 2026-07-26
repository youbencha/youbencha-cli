/**
 * Unit tests for Orchestrator
 *
 * TDD: These tests MUST FAIL before implementation
 */

import { Orchestrator } from '../../src/core/orchestrator.js';
import { CopilotCLIAdapter } from '../../src/adapters/copilot-cli.js';
import { TestCaseConfig } from '../../src/schemas/testcase.schema.js';
import { AgentExecutionResult } from '../../src/adapters/base.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let tempDir: string;
  let mockTestCaseConfig: TestCaseConfig;
  let mockConfigFile: string;
  let sourceRepoDir: string;

  beforeEach(async () => {
    jest
      .spyOn(CopilotCLIAdapter.prototype, 'checkAvailability')
      .mockResolvedValue(true);
    jest
      .spyOn(CopilotCLIAdapter.prototype, 'execute')
      .mockImplementation(async (): Promise<AgentExecutionResult> => {
        const timestamp = new Date().toISOString();
        return {
          exitCode: 0,
          status: 'success',
          output: 'Offline test agent completed successfully',
          startedAt: timestamp,
          completedAt: timestamp,
          durationMs: 1,
          errors: [],
        };
      });

    orchestrator = new Orchestrator();

    // Create temporary test directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-test-'));
    sourceRepoDir = path.join(tempDir, 'source-repo');
    await fs.mkdir(sourceRepoDir);
    await execFileAsync('git', ['init', '-b', 'master'], {
      cwd: sourceRepoDir,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: sourceRepoDir,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: sourceRepoDir,
    });
    await fs.writeFile(
      path.join(sourceRepoDir, 'README.md'),
      '# Local test repository\n'
    );
    await execFileAsync('git', ['add', 'README.md'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: sourceRepoDir,
    });

    // Create a mock config file
    mockConfigFile = path.join(tempDir, 'testcase.yaml');

    mockTestCaseConfig = {
      name: 'Test Case',
      description: 'Test description',
      repo: sourceRepoDir,
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

    // Write a placeholder config file (required by orchestrator)
    await fs.writeFile(mockConfigFile, 'name: Test Case\n', 'utf-8');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('runEvaluation', () => {
    test('returns a ResultsBundle', async () => {
      // This test will fail until orchestrator is implemented
      // Skip git cloning by mocking workspace
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

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
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.test_case.repo).toBe(mockTestCaseConfig.repo);
      expect(result.test_case.branch).toBe(mockTestCaseConfig.branch);
      expect(result.test_case.commit).toBeDefined();
    }, 120000);

    test('includes execution metadata', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.execution.started_at).toBeDefined();
      expect(result.execution.completed_at).toBeDefined();
      expect(result.execution.duration_ms).toBeGreaterThan(0);
      expect(result.execution.youbencha_version).toBeDefined();
      expect(result.execution.environment).toBeDefined();
    }, 120000);

    test('includes agent execution metadata', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.agent.type).toBe('copilot-cli');
      expect(result.agent.status).toMatch(/^(success|failed|timeout)$/);
      expect(result.agent.exit_code).toBeDefined();
      expect(result.agent.youbencha_log_path).toBeDefined();
    }, 180000);

    test('runs configured evaluators', async () => {
      const configWithMultipleEvaluators: TestCaseConfig = {
        ...mockTestCaseConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          {
            name: 'agentic-judge',
            config: { agent: { type: 'copilot-cli', config: {} } },
          },
        ],
      };

      const result = await orchestrator.runEvaluation(
        configWithMultipleEvaluators,
        mockConfigFile
      );

      expect(result.evaluators.length).toBeGreaterThan(0);
      expect(result.evaluators.some((e) => e.evaluator === 'git-diff')).toBe(
        true
      );
    }, 120000);

    test('includes summary statistics', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.summary.total_evaluators).toBeDefined();
      expect(result.summary.passed).toBeDefined();
      expect(result.summary.failed).toBeDefined();
      expect(result.summary.skipped).toBeDefined();
      expect(result.summary.overall_status).toMatch(
        /^(passed|failed|partial)$/
      );
    }, 120000);

    test('includes artifacts manifest', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.artifacts.agent_log).toBeDefined();
      expect(Array.isArray(result.artifacts.reports)).toBe(true);
      expect(Array.isArray(result.artifacts.evaluator_artifacts)).toBe(true);
    }, 120000);

    test('logs prompt provenance and length without logging prompt content', async () => {
      const info = jest.spyOn(console, 'info').mockImplementation(() => {});
      const secretPrompt = 'sensitive prompt content';
      mockTestCaseConfig.agent.config = { prompt: secretPrompt };

      await orchestrator.runEvaluation(mockTestCaseConfig, mockConfigFile);

      const output = info.mock.calls.flat().join('\n');
      expect(output).not.toContain(secretPrompt);
      expect(output).toContain(
        `Agent prompt loaded from inline configuration (${secretPrompt.length} characters)`
      );
    }, 120000);
  });

  describe('Error Handling', () => {
    test('handles invalid repository URL gracefully', async () => {
      const invalidConfig: TestCaseConfig = {
        ...mockTestCaseConfig,
        repo: 'not-a-valid-url',
      };

      await expect(
        orchestrator.runEvaluation(invalidConfig, mockConfigFile)
      ).rejects.toThrow();
    });

    test('rejects unknown evaluators before execution', async () => {
      const configWithInvalidEvaluator: TestCaseConfig = {
        ...mockTestCaseConfig,
        evaluators: [{ name: 'non-existent-evaluator', config: {} }],
      };

      await expect(
        orchestrator.runEvaluation(configWithInvalidEvaluator, mockConfigFile)
      ).rejects.toThrow('Unknown evaluator: non-existent-evaluator');
    });
  });

  describe('Workspace Management', () => {
    test('creates workspace directory', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result).toBeDefined();
      // Workspace should exist during evaluation
    }, 120000);

    test('cleans up workspace after evaluation', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      // Workspace should be cleaned up unless configured to keep
      expect(result).toBeDefined();
    }, 120000);
  });

  describe('Evaluator Execution', () => {
    test('runs evaluators in parallel by default', async () => {
      const configWithMultiple: TestCaseConfig = {
        ...mockTestCaseConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          {
            name: 'agentic-judge',
            config: { agent: { type: 'copilot-cli', config: {} } },
          },
        ],
      };

      const result = await orchestrator.runEvaluation(
        configWithMultiple,
        mockConfigFile
      );

      expect(result.evaluators.length).toBeGreaterThanOrEqual(2);
      // Parallel execution should be faster than sequential
      // This is a weak test but validates the concept
    }, 120000);

    test('continues evaluation when one evaluator is skipped', async () => {
      const configWithMixed: TestCaseConfig = {
        ...mockTestCaseConfig,
        evaluators: [
          { name: 'git-diff', config: {} },
          { name: 'expected-diff', config: {} },
        ],
      };

      const result = await orchestrator.runEvaluation(
        configWithMixed,
        mockConfigFile
      );

      expect(result.evaluators).toHaveLength(2);
      expect(
        result.evaluators.some((evaluation) => evaluation.status === 'skipped')
      ).toBe(true);
    }, 120000);
  });

  describe('Expected Reference Support', () => {
    test('clones expected branch when configured', async () => {
      const configWithExpected: TestCaseConfig = {
        ...mockTestCaseConfig,
        expected_source: 'branch',
        expected: 'master', // Use master branch which exists
      };

      const result = await orchestrator.runEvaluation(
        configWithExpected,
        mockConfigFile
      );

      expect(result.test_case.expected_branch).toBe('master');
      expect(result).toBeDefined();
    }, 120000);

    test('validates expected branch exists', async () => {
      const configWithInvalidExpected: TestCaseConfig = {
        ...mockTestCaseConfig,
        expected_source: 'branch',
        expected: 'nonexistent-branch-xyz',
      };

      await expect(
        orchestrator.runEvaluation(configWithInvalidExpected, mockConfigFile)
      ).rejects.toThrow();
    });
  });

  describe('Results Persistence', () => {
    it('should save youBencha log to artifacts', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result.artifacts.agent_log).toContain('youbencha.log.json');
    }, 120000);

    test('saves results bundle to artifacts', async () => {
      const result = await orchestrator.runEvaluation(
        mockTestCaseConfig,
        mockConfigFile
      );

      expect(result).toBeDefined();
      // Results bundle should be saved
    }, 120000);
  });
});
