import { diffLines, diffWords } from 'diff';
import {
  compareLines,
  compareWords,
  generatePatch,
} from '../../src/lib/diff-utils.js';

jest.mock('diff', () => ({
  diffLines: jest.fn(),
  diffWords: jest.fn(),
}));

describe('diff utility missing-count coverage', () => {
  it('treats missing line and word counts as zero', () => {
    jest
      .mocked(diffLines)
      .mockReturnValue([
        { value: 'added\n', added: true },
        { value: 'removed\n', removed: true },
        { value: 'same\n' },
      ]);
    jest
      .mocked(diffWords)
      .mockReturnValue([
        { value: 'added', added: true },
        { value: 'removed', removed: true },
        { value: 'same' },
      ]);

    expect(compareLines('source', 'target')).toMatchObject({
      additions: 0,
      deletions: 0,
    });
    expect(compareWords('source', 'target')).toMatchObject({
      additions: 0,
      deletions: 0,
    });
    expect(generatePatch('source', 'target')).toContain('+ added');
  });
});
