const mockMkdir = jest.fn();
const mockWarn = jest.fn();

jest.mock('fs/promises', () => ({
  ...jest.requireActual<typeof import('fs/promises')>('fs/promises'),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

jest.mock('../../src/lib/logger.js', () => ({
  warn: (...args: unknown[]) => mockWarn(...args),
}));

import { GitDiffEvaluator } from '../../src/evaluators/git-diff.js';

interface GitDiffArtifactInternals {
  saveDiffArtifact(artifactsDir: string, diff: string): Promise<unknown[]>;
}

describe('git diff artifact error normalization', () => {
  it('formats Error and non-Error filesystem failures', async () => {
    const evaluator =
      new GitDiffEvaluator() as unknown as GitDiffArtifactInternals;

    mockMkdir.mockRejectedValueOnce(new Error('standard write failure'));
    await expect(evaluator.saveDiffArtifact('unused', 'diff')).resolves.toEqual(
      []
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to save diff artifact: standard write failure'
    );

    mockMkdir.mockRejectedValueOnce('string write failure');
    await expect(evaluator.saveDiffArtifact('unused', 'diff')).resolves.toEqual(
      []
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to save diff artifact: string write failure'
    );
  });
});
