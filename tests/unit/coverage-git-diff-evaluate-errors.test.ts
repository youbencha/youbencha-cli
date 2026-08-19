const mockGit = {
  status: jest.fn(),
  add: jest.fn(),
  diffSummary: jest.fn(),
  diff: jest.fn(),
  log: jest.fn(),
};
const mockWarn = jest.fn();

jest.mock('simple-git', () => ({
  simpleGit: () => mockGit,
}));

jest.mock('../../src/lib/logger.js', () => ({
  warn: (...args: unknown[]) => mockWarn(...args),
}));

import { GitDiffEvaluator } from '../../src/evaluators/git-diff.js';
import type { EvaluationContext } from '../../src/evaluators/base.js';

describe('git diff mocked evaluation edges', () => {
  const context: EvaluationContext = {
    modifiedDir: 'unused',
    artifactsDir: 'unused',
    config: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGit.status.mockResolvedValue({ not_added: [], modified: [] });
    mockGit.diffSummary.mockResolvedValue({
      files: [],
      insertions: 0,
      deletions: 0,
    });
    mockGit.diff.mockResolvedValue('');
    mockGit.log.mockResolvedValue({ latest: undefined });
  });

  it('uses an unknown commit when the log is empty', async () => {
    const evaluator = new GitDiffEvaluator();
    jest.spyOn(evaluator, 'checkPreconditions').mockResolvedValue(true);
    const result = await evaluator.evaluate(context);
    expect(result.status).toBe('passed');
    expect(result.metrics.current_commit).toBe('unknown');
  });

  it('normalizes Error and non-Error command failures', async () => {
    for (const failure of [new Error('standard failure'), 'string failure']) {
      const evaluator = new GitDiffEvaluator();
      jest.spyOn(evaluator, 'checkPreconditions').mockResolvedValue(true);
      mockGit.status.mockRejectedValueOnce(failure);
      const result = await evaluator.evaluate(context);
      expect(result.status).toBe('skipped');
      expect(result.error?.message).toContain('failure');
      if (failure instanceof Error) {
        expect(result.error?.stack_trace).toBeDefined();
      } else {
        expect(result.error?.stack_trace).toBeUndefined();
      }
    }
  });
});
