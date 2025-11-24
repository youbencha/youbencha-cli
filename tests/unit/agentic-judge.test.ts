/**
 * Unit tests for AgenticJudgeEvaluator
 * 
 * TDD: These tests MUST FAIL before implementation
 */

import { AgenticJudgeEvaluator } from '../../src/evaluators/agentic-judge.js';
import { EvaluationContext } from '../../src/evaluators/base.js';
import { CopilotCLIAdapter } from '../../src/adapters/copilot-cli.js';
import { AgentAdapter } from '../../src/adapters/base.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AgenticJudgeEvaluator', () => {
  let evaluator: AgenticJudgeEvaluator;
  let tempDir: string;
  let mockContext: EvaluationContext;

  beforeEach(async () => {
    evaluator = new AgenticJudgeEvaluator();
    
    // Create temporary test directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentic-judge-test-'));
    
    mockContext = {
      modifiedDir: path.join(tempDir, 'src-modified'),
      artifactsDir: path.join(tempDir, 'artifacts'),
      agentLog: {
        version: '1.0.0',
        agent: { name: 'copilot-cli', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'gpt-4', provider: 'GitHub', parameters: {} },
        execution: {
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [],
        environment: {
          os: 'linux',
          node_version: 'v20.0.0',
          youbencha_version: '1.0.0',
          working_directory: '/tmp',
        },
      },
      config: {
        criteria: [
          'Error handling completeness',
          'Test coverage adequacy',
          'Documentation quality',
        ],
      },
      testCaseConfig: {
        name: 'Test Case',
        description: 'Test case for agentic judge',
        version: '1.0.0',
        repo: 'https://github.com/test/repo',
        branch: 'main',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Evaluate the code quality',
          },
        },
        expected_source: 'none',
        evaluators: [],
      },
    };

    // Create directories
    await fs.mkdir(mockContext.modifiedDir, { recursive: true });
    await fs.mkdir(mockContext.artifactsDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Interface Contract', () => {
    test('has name property', () => {
      expect(evaluator.name).toBe('agentic-judge');
    });

    test('has description property', () => {
      expect(evaluator.description).toBeDefined();
      expect(typeof evaluator.description).toBe('string');
      expect(evaluator.description.length).toBeGreaterThan(0);
    });

    test('requiresExpectedReference is false', () => {
      expect(evaluator.requiresExpectedReference).toBe(false);
    });
  });

  describe('checkPreconditions', () => {
    test('returns true when agent is configured', async () => {
      const result = await evaluator.checkPreconditions(mockContext);
      expect(typeof result).toBe('boolean');
    });

    test('returns false when agent config is missing', async () => {
      const contextWithoutAgent = {
        ...mockContext,
        testCaseConfig: {
          ...mockContext.testCaseConfig,
          agent: undefined as any,
        },
      };
      
      const result = await evaluator.checkPreconditions(contextWithoutAgent);
      expect(result).toBe(false);
    });

    test('returns false when agent type is invalid', async () => {
      const contextWithInvalidAgent = {
        ...mockContext,
        testCaseConfig: {
          ...mockContext.testCaseConfig,
          agent: {
            type: 'invalid-agent-type' as any,
            config: {},
          },
        },
      };
      
      const result = await evaluator.checkPreconditions(contextWithInvalidAgent);
      expect(result).toBe(false);
    });
  });

  describe('evaluate - Agent Execution', () => {
    test('executes agent via adapter', async () => {
      // Mock successful agent execution
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({
            status: 'passed',
            metrics: { code_quality: 8.5 },
            message: 'Code quality is good',
          }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      // Inject mock adapter
      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.evaluator).toBe('agentic-judge');
      expect(result.status).toBe('passed');
      expect(mockAdapter.execute).toHaveBeenCalled();
    });

    test('parses JSON output from agent', async () => {
      const expectedResult = {
        status: 'passed',
        metrics: {
          error_handling_score: 9.0,
          test_coverage_score: 8.5,
          documentation_score: 7.0,
        },
        message: 'All assertions met',
      };

      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify(expectedResult),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.status).toBe('passed');
      expect(result.metrics).toMatchObject(expectedResult.metrics);
      expect(result.message).toBe(expectedResult.message);
    });

    test('builds evaluation prompt with assertions', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({ status: 'passed', metrics: {}, message: 'OK' }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      await evaluator.evaluate(mockContext);

      const executeCall = (mockAdapter.execute as jest.Mock).mock.calls[0][0];
      const prompt = executeCall.config.prompt;

      expect(prompt).toContain('Error handling completeness');
      expect(prompt).toContain('Test coverage adequacy');
      expect(prompt).toContain('Documentation quality');
    });

    test('includes prompt in evaluation prompt', async () => {
      const promptText = 'Do not ask for clarification or additional information. Use only the files in the repository to evaluate the assertions.';
      
      const contextWithPrompt = {
        ...mockContext,
        config: {
          ...mockContext.config,
          type: 'copilot-cli',
          prompt: promptText,
        },
      };

      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({ status: 'passed', metrics: {}, message: 'OK' }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      await evaluator.evaluate(contextWithPrompt);

      const executeCall = (mockAdapter.execute as jest.Mock).mock.calls[0][0];
      const evaluationPrompt = executeCall.config.prompt;

      // Should contain prompt text
      expect(evaluationPrompt).toContain(promptText);
      // Should still contain the assertions
      expect(evaluationPrompt).toContain('Error handling completeness');
      expect(evaluationPrompt).toContain('Test coverage adequacy');
      expect(evaluationPrompt).toContain('Documentation quality');
      // Prompt should appear before assertions
      const promptIndex = evaluationPrompt.indexOf(promptText);
      const assertionsIndex = evaluationPrompt.indexOf('Error handling completeness');
      expect(promptIndex).toBeLessThan(assertionsIndex);
    });

    test('works without prompt (backward compatibility)', async () => {
      const contextWithoutPrompt = {
        ...mockContext,
        config: {
          ...mockContext.config,
          type: 'copilot-cli',
          // No prompt field
        },
      };

      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({ status: 'passed', metrics: {}, message: 'OK' }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      await evaluator.evaluate(contextWithoutPrompt);

      const executeCall = (mockAdapter.execute as jest.Mock).mock.calls[0][0];
      const evaluationPrompt = executeCall.config.prompt;

      // Should still contain assertions without prompt
      expect(evaluationPrompt).toContain('Error handling completeness');
      expect(evaluationPrompt).toContain('Test coverage adequacy');
      expect(evaluationPrompt).toContain('Documentation quality');
    });
  });

  describe('evaluate - Error Handling', () => {
    test('handles agent execution failure', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 1,
          status: 'failed',
          output: 'Agent execution failed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 100,
          errors: [{ message: 'Execution error', timestamp: new Date().toISOString() }],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.status).toBe('skipped');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('failed');
    });

    test('handles invalid JSON output from agent', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: 'This is not valid JSON',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.status).toBe('skipped');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('JSON');
    });

    test('handles agent timeout', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 1,
          status: 'timeout',
          output: 'Execution timed out',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 60000,
          errors: [{ message: 'Timeout after 60000ms', timestamp: new Date().toISOString() }],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.status).toBe('skipped');
      expect(result.message).toContain('timed out');
    });

    test('skips when preconditions not met', async () => {
      const contextWithoutAgent = {
        ...mockContext,
        testCaseConfig: {
          ...mockContext.testCaseConfig,
          agent: undefined as any,
        },
      };

      const result = await evaluator.evaluate(contextWithoutAgent);

      expect(result.status).toBe('skipped');
      expect(result.message).toContain('not configured');
    });
  });

  describe('evaluate - Output Validation', () => {
    test('returns valid EvaluationResult structure', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({
            status: 'passed',
            metrics: { score: 8.5 },
            message: 'Evaluation complete',
          }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result).toHaveProperty('evaluator');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('duration_ms');
      expect(result).toHaveProperty('timestamp');
      expect(result.evaluator).toBe('agentic-judge');
      expect(typeof result.duration_ms).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });

    test('includes duration_ms in result', async () => {
      const mockAdapter: AgentAdapter = {
        name: 'test-adapter',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({ status: 'passed', metrics: {}, message: 'OK' }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);

      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Adapter Loading', () => {
    test('loads copilot-cli adapter when configured', async () => {
      // Mock the adapter to avoid actually executing copilot
      const mockAdapter: AgentAdapter = {
        name: 'copilot-cli',
        version: '1.0.0',
        checkAvailability: jest.fn().mockResolvedValue(true),
        execute: jest.fn().mockResolvedValue({
          exitCode: 0,
          status: 'success',
          output: JSON.stringify({
            status: 'passed',
            metrics: { quality_score: 9.0 },
            message: 'Code quality check passed',
          }),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 1000,
          errors: [],
        }),
        normalizeLog: jest.fn(),
      };

      (evaluator as any).getAdapter = jest.fn().mockResolvedValue(mockAdapter);

      const result = await evaluator.evaluate(mockContext);
      
      // Should complete without throwing
      expect(result).toBeDefined();
      expect(result.evaluator).toBe('agentic-judge');
      expect(result.status).toBe('passed');
    });

    test('handles unknown adapter type', async () => {
      const contextWithUnknownAdapter = {
        ...mockContext,
        testCaseConfig: {
          ...mockContext.testCaseConfig,
          agent: {
            type: 'unknown-adapter' as any,
            config: {},
          },
        },
      };

      const result = await evaluator.evaluate(contextWithUnknownAdapter);

      expect(result.status).toBe('skipped');
      expect(result.message).toContain('not configured');
    });
  });

  describe('Custom Named Instances', () => {
    test('accepts custom name in constructor', () => {
      const customEvaluator = new AgenticJudgeEvaluator('agentic-judge-error-handling');
      expect(customEvaluator.name).toBe('agentic-judge-error-handling');
    });

    test('uses default name when not provided', () => {
      const defaultEvaluator = new AgenticJudgeEvaluator();
      expect(defaultEvaluator.name).toBe('agentic-judge');
    });

    test('custom named instance has same description', () => {
      const customEvaluator = new AgenticJudgeEvaluator('agentic-judge-docs');
      expect(customEvaluator.description).toBe(evaluator.description);
    });

    test('custom named instance has same requiresExpectedReference', () => {
      const customEvaluator = new AgenticJudgeEvaluator('agentic-judge-tests');
      expect(customEvaluator.requiresExpectedReference).toBe(false);
    });

    test('multiple instances can have different names', () => {
      const errorHandling = new AgenticJudgeEvaluator('agentic-judge-error-handling');
      const documentation = new AgenticJudgeEvaluator('agentic-judge-documentation');
      const bestPractices = new AgenticJudgeEvaluator('agentic-judge-best-practices');

      expect(errorHandling.name).toBe('agentic-judge-error-handling');
      expect(documentation.name).toBe('agentic-judge-documentation');
      expect(bestPractices.name).toBe('agentic-judge-best-practices');

      // Each should be independent
      expect(errorHandling.name).not.toBe(documentation.name);
      expect(documentation.name).not.toBe(bestPractices.name);
    });
  });
});
