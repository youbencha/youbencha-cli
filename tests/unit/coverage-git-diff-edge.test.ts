import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DiffResult } from 'simple-git';
import { GitDiffEvaluator } from '../../src/evaluators/git-diff.js';

interface GitDiffInternals {
  calculateFileMetrics(summary: DiffResult): Array<{
    path: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  calculateEntropy(
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      changes: number;
    }>
  ): number;
  evaluateAssertions(
    filesChanged: number,
    linesAdded: number,
    linesRemoved: number,
    changeEntropy: number,
    assertions: Record<string, number>
  ): { status: 'passed' | 'failed'; violations: string[] };
  buildMessage(
    filesChanged: number,
    linesAdded: number,
    linesRemoved: number,
    status: 'passed' | 'failed',
    violations: string[]
  ): string;
  saveDiffArtifact(artifactsDir: string, diff: string): Promise<unknown[]>;
}

describe('git diff edge coverage', () => {
  it('normalizes missing file counters and zero-change entropy', () => {
    const evaluator = new GitDiffEvaluator() as unknown as GitDiffInternals;
    const files = evaluator.calculateFileMetrics({
      files: [{ file: 'binary.dat', binary: true }],
    } as unknown as DiffResult);
    expect(files).toEqual([
      { path: 'binary.dat', additions: 0, deletions: 0, changes: 0 },
    ]);
    expect(evaluator.calculateEntropy(files)).toBe(0);
    expect(
      evaluator.calculateEntropy([
        { path: 'zero', additions: 0, deletions: 0, changes: 0 },
        { path: 'changed', additions: 1, deletions: 0, changes: 1 },
      ])
    ).toBe(0);
  });

  it('reports every assertion violation and both message statuses', () => {
    const evaluator = new GitDiffEvaluator() as unknown as GitDiffInternals;
    const result = evaluator.evaluateAssertions(2, 3, 4, 0.5, {
      max_files_changed: 1,
      max_lines_added: 2,
      max_lines_removed: 3,
      max_total_changes: 6,
      min_change_entropy: 0.6,
      max_change_entropy: 0.4,
    });
    expect(result.status).toBe('failed');
    expect(result.violations).toHaveLength(6);
    expect(
      evaluator.buildMessage(2, 3, 4, 'failed', result.violations)
    ).toContain('Violations');
    expect(evaluator.buildMessage(0, 0, 0, 'passed', [])).toContain('✓');
  });

  it('skips empty artifacts and tolerates artifact write failures', async () => {
    const evaluator = new GitDiffEvaluator() as unknown as GitDiffInternals;
    await expect(evaluator.saveDiffArtifact('unused', '  ')).resolves.toEqual(
      []
    );

    const fileAsDirectory = path.join(await makeDirectory(), 'artifact-file');
    await writeFile(fileAsDirectory, 'not a directory');
    await expect(
      evaluator.saveDiffArtifact(fileAsDirectory, 'diff content')
    ).resolves.toEqual([]);
  });
});

async function makeDirectory(): Promise<string> {
  const root = path.join(
    os.tmpdir(),
    `youbencha-git-diff-${Date.now()}-${Math.random()}`
  );
  await mkdir(root, { recursive: true });
  return root;
}
