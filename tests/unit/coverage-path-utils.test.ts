import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTempDir,
  directoryExists,
  ensureDirectory,
  fileExists,
  generateWorkspacePaths,
  getDirectorySize,
  getRelativePath,
  getTempDir,
  isPathWithinWorkspace,
  removeDirectory,
  resolveWorkspacePath,
  safeJoin,
} from '../../src/lib/path-utils.js';

describe('path utility filesystem coverage', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-path-coverage-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('joins, resolves, relativizes, and bounds workspace paths', () => {
    const nested = safeJoin(temporaryDirectory, 'one', '..', 'two');
    expect(nested).toBe(path.join(temporaryDirectory, 'two'));
    expect(isPathWithinWorkspace(nested, temporaryDirectory)).toBe(true);
    expect(
      isPathWithinWorkspace(
        path.join(temporaryDirectory, '..', 'outside'),
        temporaryDirectory
      )
    ).toBe(false);
    expect(getRelativePath(nested, temporaryDirectory)).toBe('two');
    expect(resolveWorkspacePath('two', temporaryDirectory)).toBe(nested);
    expect(getTempDir()).toBe(os.tmpdir());
    expect(generateWorkspacePaths('relative-root', 'run').root).toBe(
      path.resolve('relative-root')
    );
  });

  it('creates directories and distinguishes files, directories, and missing paths', async () => {
    const directory = path.join(temporaryDirectory, 'nested', 'directory');
    const file = path.join(directory, 'file.txt');
    await ensureDirectory(directory);
    await ensureDirectory(directory);
    await fs.writeFile(file, 'content');

    await expect(directoryExists(directory)).resolves.toBe(true);
    await expect(directoryExists(file)).resolves.toBe(false);
    await expect(
      directoryExists(path.join(temporaryDirectory, 'missing'))
    ).resolves.toBe(false);
    await expect(fileExists(file)).resolves.toBe(true);
    await expect(fileExists(directory)).resolves.toBe(false);
    await expect(
      fileExists(path.join(temporaryDirectory, 'missing'))
    ).resolves.toBe(false);
  });

  it('creates and removes temporary directories with custom and default prefixes', async () => {
    const custom = await createTempDir('coverage-custom-');
    const defaultDirectory = await createTempDir();
    try {
      expect(path.basename(custom)).toMatch(/^coverage-custom-\d+$/);
      expect(path.basename(defaultDirectory)).toMatch(/^youbencha-\d+$/);
      await removeDirectory(custom);
      await removeDirectory(custom);
      await expect(directoryExists(custom)).resolves.toBe(false);
    } finally {
      await fs.rm(custom, { recursive: true, force: true });
      await fs.rm(defaultDirectory, { recursive: true, force: true });
    }
  });

  it('calculates nested directory and file sizes', async () => {
    const nested = path.join(temporaryDirectory, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(temporaryDirectory, 'one.txt'), '1234');
    await fs.writeFile(path.join(nested, 'two.txt'), '56789');

    await expect(getDirectorySize(temporaryDirectory)).resolves.toBe(9);
    await expect(
      getDirectorySize(path.join(temporaryDirectory, 'one.txt'))
    ).resolves.toBe(4);
  });

  it('rejects starting and recursive depths beyond the configured maximum', async () => {
    await expect(getDirectorySize(temporaryDirectory, 0, 1)).rejects.toThrow(
      'Directory depth exceeds maximum of 0 levels'
    );

    const nested = path.join(temporaryDirectory, 'nested');
    await fs.mkdir(nested);
    await expect(getDirectorySize(temporaryDirectory, 0)).rejects.toThrow(
      'Directory depth exceeds maximum of 0 levels'
    );
  });
});
