import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createRequire, syncBuiltinESMExports } from 'module';
import { ensureLinkSafeDirectory } from '../../src/experiments/artifact-security.js';

type MutableFsPromises = typeof import('fs/promises') & {
  mkdir: typeof fs.mkdir;
  lstat: typeof fs.lstat;
};

const localRequire = createRequire(path.join(process.cwd(), 'package.json'));
const mutableFs = localRequire('fs/promises') as MutableFsPromises;

describe('link-safe directory creation races', () => {
  let temporaryDirectory: string;
  const originalMkdir = mutableFs.mkdir;
  const originalLstat = mutableFs.lstat;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-artifact-race-')
    );
  });

  afterEach(async () => {
    mutableFs.mkdir = originalMkdir;
    mutableFs.lstat = originalLstat;
    syncBuiltinESMExports();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('accepts a directory concurrently created after the missing-path check', async () => {
    const target = path.join(temporaryDirectory, 'created-by-racer');
    const outcomes = await Promise.all([
      ensureLinkSafeDirectory(temporaryDirectory, target),
      fs.mkdir(target, { recursive: true }),
    ]);
    expect(outcomes).toHaveLength(2);
  });

  it('rejects a link swapped in between the missing-path check and validation', async () => {
    const target = path.join(temporaryDirectory, 'swapped');
    const destination = path.join(temporaryDirectory, 'destination');
    await fs.mkdir(destination);
    mutableFs.mkdir = async (directory): Promise<string | undefined> => {
      await fs.symlink(destination, directory as string, 'junction');
      return undefined;
    };
    syncBuiltinESMExports();
    await expect(
      ensureLinkSafeDirectory(temporaryDirectory, target)
    ).rejects.toThrow('Linked path component');
  });
});
