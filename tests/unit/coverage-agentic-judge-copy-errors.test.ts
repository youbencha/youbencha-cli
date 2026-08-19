const mockCopy = jest.fn();
const mockWarn = jest.fn();

jest.mock('fs-extra', () => ({
  __esModule: true,
  default: {
    copy: (...args: unknown[]) => mockCopy(...args),
  },
}));

jest.mock('../../src/lib/logger.js', () => ({
  debug: jest.fn(),
  warn: (...args: unknown[]) => mockWarn(...args),
}));

import { AgenticJudgeEvaluator } from '../../src/evaluators/agentic-judge.js';
import type { EvaluationContext } from '../../src/evaluators/base.js';

interface JudgeAccess {
  checkPreconditions(context: EvaluationContext): Promise<boolean>;
  evaluate(context: EvaluationContext): Promise<{ status: string }>;
  getAdapter(type: string): Promise<unknown>;
}

describe('agentic judge named-agent copy errors', () => {
  it('formats Error and non-Error copy failures and continues evaluation', async () => {
    mockCopy
      .mockRejectedValueOnce(new Error('GitHub copy failed'))
      .mockRejectedValueOnce('Claude copy failed');
    const evaluator = new AgenticJudgeEvaluator() as unknown as JudgeAccess;
    evaluator.checkPreconditions = jest.fn().mockResolvedValue(true);
    evaluator.getAdapter = jest.fn().mockResolvedValue({
      execute: jest.fn().mockResolvedValue({
        status: 'success',
        output: JSON.stringify({
          status: 'passed',
          metrics: {},
          message: 'ok',
        }),
        durationMs: 1,
        errors: [],
      }),
    });

    const result = await evaluator.evaluate({
      modifiedDir: 'unused',
      artifactsDir: 'unused',
      config: {
        type: 'copilot-cli',
        assertions: ['check'],
        agent_name: 'reviewer',
      },
    });
    expect(result.status).toBe('passed');
    expect(mockWarn).toHaveBeenCalledWith(
      'Could not copy GitHub agent files: GitHub copy failed'
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Could not copy Claude agent files: Claude copy failed'
    );

    mockCopy
      .mockRejectedValueOnce('GitHub string failure')
      .mockRejectedValueOnce(new Error('Claude standard failure'));
    await evaluator.evaluate({
      modifiedDir: 'unused',
      artifactsDir: 'unused',
      config: {
        type: 'copilot-cli',
        assertions: ['check'],
        agent_name: 'reviewer',
      },
    });
    expect(mockWarn).toHaveBeenCalledWith(
      'Could not copy GitHub agent files: GitHub string failure'
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Could not copy Claude agent files: Claude standard failure'
    );
  });
});
