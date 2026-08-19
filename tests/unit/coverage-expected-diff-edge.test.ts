import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExpectedDiffEvaluator } from '../../src/evaluators/expected-diff.js';
import type { EvaluationContext } from '../../src/evaluators/base.js';

interface ExpectedDiffInternals {
  getAllFiles(dir: string, baseDir?: string): Promise<string[]>;
  compareFiles(
    modifiedDir: string,
    expectedDir: string,
    modifiedFiles: string[],
    expectedFiles: string[]
  ): Promise<
    Array<{
      path: string;
      similarity: number;
      status: 'matched' | 'changed' | 'added' | 'removed';
    }>
  >;
  calculateAggregateMetrics(
    similarities: Array<{
      path: string;
      similarity: number;
      status: 'matched' | 'changed' | 'added' | 'removed';
    }>,
    modifiedFiles: string[],
    expectedFiles: string[]
  ): Record<string, unknown>;
  buildMessage(
    metrics: Record<string, unknown>,
    threshold: number,
    status: 'passed' | 'failed'
  ): string;
}

describe('expected diff edge coverage', () => {
  it('recurses, ignores git metadata, and tolerates unreadable paths', async () => {
    const root = await makeDirectory();
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git', 'ignored'), 'ignored');
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'file.txt'), 'content');

    const evaluator =
      new ExpectedDiffEvaluator() as unknown as ExpectedDiffInternals;
    await expect(evaluator.getAllFiles(root)).resolves.toEqual([
      path.join('nested', 'file.txt'),
    ]);
    await expect(
      evaluator.getAllFiles(path.join(root, 'missing'), root)
    ).resolves.toEqual([]);
  });

  it('treats failed reads as changed and covers empty aggregate semantics', async () => {
    const evaluator =
      new ExpectedDiffEvaluator() as unknown as ExpectedDiffInternals;
    const root = await makeDirectory();
    const compared = await evaluator.compareFiles(
      root,
      root,
      ['missing.txt'],
      ['missing.txt']
    );
    expect(compared).toEqual([
      { path: 'missing.txt', similarity: 0, status: 'changed' },
    ]);

    expect(evaluator.calculateAggregateMetrics([], [], [])).toMatchObject({
      aggregate_similarity: 1,
    });
    expect(
      evaluator.calculateAggregateMetrics(
        [{ path: 'added', similarity: 0, status: 'added' }],
        ['added'],
        []
      )
    ).toMatchObject({ aggregate_similarity: 0, files_added: 1 });
  });

  it('includes added and removed counts in passed and failed messages', () => {
    const evaluator =
      new ExpectedDiffEvaluator() as unknown as ExpectedDiffInternals;
    const metrics = {
      aggregate_similarity: 0.5,
      files_matched: 1,
      files_changed: 1,
      files_added: 1,
      files_removed: 1,
    };
    expect(evaluator.buildMessage(metrics, 0.5, 'passed')).toContain('✓');
    expect(evaluator.buildMessage(metrics, 0.6, 'failed')).toContain('✗');
  });

  it('normalizes Error and non-Error evaluation failures', async () => {
    const root = await makeDirectory();
    const context: EvaluationContext = {
      modifiedDir: root,
      expectedDir: root,
      artifactsDir: root,
      config: {},
    };

    for (const failure of [new Error('standard failure'), 'string failure']) {
      const evaluator = new ExpectedDiffEvaluator();
      jest.spyOn(evaluator, 'checkPreconditions').mockResolvedValue(true);
      (evaluator as unknown as ExpectedDiffInternals).getAllFiles = jest
        .fn()
        .mockRejectedValue(failure);
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

  it('keeps a passing evaluation when artifact output cannot be written', async () => {
    const modifiedDir = await makeDirectory();
    const expectedDir = await makeDirectory();
    await writeFile(path.join(modifiedDir, 'same.txt'), 'same');
    await writeFile(path.join(expectedDir, 'same.txt'), 'same');
    const missingArtifacts = path.join(await makeDirectory(), 'missing');

    const result = await new ExpectedDiffEvaluator().evaluate({
      modifiedDir,
      expectedDir,
      artifactsDir: missingArtifacts,
      config: {},
    });
    expect(result.status).toBe('passed');
    expect(result.artifacts).toEqual([]);
  });
});

async function makeDirectory(): Promise<string> {
  const root = path.join(
    os.tmpdir(),
    `youbencha-expected-diff-${Date.now()}-${Math.random()}`
  );
  await mkdir(root, { recursive: true });
  return root;
}
