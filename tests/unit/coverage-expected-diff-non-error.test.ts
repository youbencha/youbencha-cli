const mockWriteFile = jest.fn();
const mockWarn = jest.fn();

jest.mock('fs/promises', () => ({
  ...jest.requireActual<typeof import('fs/promises')>('fs/promises'),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('../../src/lib/logger.js', () => ({
  warn: (...args: unknown[]) => mockWarn(...args),
}));

import { ExpectedDiffEvaluator } from '../../src/evaluators/expected-diff.js';

interface ExpectedDiffArtifactInternals {
  generateArtifacts(
    artifactsDir: string,
    similarities: unknown[],
    metrics: Record<string, unknown>
  ): Promise<unknown[]>;
}

describe('expected diff non-Error artifact failure', () => {
  it('formats Error and non-Error write rejections', async () => {
    const evaluator =
      new ExpectedDiffEvaluator() as unknown as ExpectedDiffArtifactInternals;

    mockWriteFile.mockRejectedValueOnce(new Error('standard write failure'));
    await expect(
      evaluator.generateArtifacts('unused', [], {
        aggregate_similarity: 1,
      })
    ).resolves.toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to save diff report artifact: standard write failure'
    );

    mockWriteFile.mockRejectedValueOnce('string write failure');
    await expect(
      evaluator.generateArtifacts('unused', [], {
        aggregate_similarity: 1,
      })
    ).resolves.toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(
      'Failed to save diff report artifact: string write failure'
    );
  });
});
