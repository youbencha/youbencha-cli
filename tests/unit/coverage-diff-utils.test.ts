import type { Change } from 'diff';
import {
  calculateChangeEntropy,
  calculateSimilarity,
  compareLines,
  compareWords,
  generatePatch,
  levenshteinDistance,
} from '../../src/lib/diff-utils.js';

describe('diff utility coverage', () => {
  it('calculates Levenshtein substitutions, insertions, deletions, and matches', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('same', 'same')).toBe(0);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('abc', 'ab')).toBe(1);
    expect(levenshteinDistance('ab', 'abc')).toBe(1);
  });

  it('calculates bounded string similarities', () => {
    expect(calculateSimilarity('', '')).toBe(1);
    expect(calculateSimilarity('same', 'same')).toBe(1);
    expect(calculateSimilarity('abc', '')).toBe(0);
    expect(calculateSimilarity('abc', 'axc')).toBeCloseTo(2 / 3);
  });

  it('compares lines through unchanged, added, and removed segments', () => {
    expect(compareLines('same\n', 'same\n')).toMatchObject({
      additions: 0,
      deletions: 0,
      changes: 0,
      similarity: 1,
    });
    const result = compareLines('one\ntwo\n', 'one\nthree\nfour\n');
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(
      result.changeDetails.some((change) => !change.added && !change.removed)
    ).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });

  it('compares words and clamps highly divergent changes', () => {
    expect(compareWords('same words', 'same words')).toMatchObject({
      additions: 0,
      deletions: 0,
      changes: 0,
      similarity: 1,
    });
    const result = compareWords(
      'one',
      'two three four five six seven eight nine'
    );
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });

  it('calculates entropy for empty, uniform, and mixed changes', () => {
    expect(calculateChangeEntropy([])).toBe(0);
    expect(calculateChangeEntropy([{ value: 'added', added: true }])).toBe(0);
    expect(calculateChangeEntropy([{ value: 'same' }])).toBe(0);
    expect(
      calculateChangeEntropy([
        { value: 'added', added: true },
        { value: 'removed', removed: true },
        { value: 'same' },
        { value: 'same again' },
      ])
    ).toBe(1);
  });

  it('generates patches with default and custom filenames', () => {
    const patch = generatePatch('one\ntwo\n', 'one\nthree\n', {
      filename: 'fixture.txt',
      contextLines: 0,
    });
    expect(patch).toContain('--- fixture.txt');
    expect(patch).toContain('+++ fixture.txt');
    expect(patch).toContain('  one');
    expect(patch).toContain('- two');
    expect(patch).toContain('+ three');

    expect(generatePatch('', '')).toBe('--- file\n+++ file\n');
  });

  it('accepts change objects with both added and removed flags as changed', () => {
    const unusual = {
      value: 'changed',
      added: true,
      removed: true,
    } as Change;
    expect(calculateChangeEntropy([unusual])).toBe(0);
  });
});
