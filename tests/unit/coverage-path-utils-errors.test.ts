import * as fs from 'fs/promises';
import { ensureDirectory, removeDirectory } from '../../src/lib/path-utils.js';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  rm: jest.fn(),
}));

describe('path utility error coverage', () => {
  it('ignores EEXIST from mkdir and propagates other errors', async () => {
    jest
      .mocked(fs.mkdir)
      .mockRejectedValueOnce(
        Object.assign(new Error('already exists'), { code: 'EEXIST' })
      );
    await expect(ensureDirectory('already-there')).resolves.toBeUndefined();

    jest
      .mocked(fs.mkdir)
      .mockRejectedValueOnce(
        Object.assign(new Error('input/output failure'), { code: 'EIO' })
      );
    await expect(ensureDirectory('broken')).rejects.toThrow(
      'input/output failure'
    );
  });

  it('ignores ENOENT from rm and propagates other errors', async () => {
    jest
      .mocked(fs.rm)
      .mockRejectedValueOnce(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      );
    await expect(removeDirectory('missing')).resolves.toBeUndefined();

    jest
      .mocked(fs.rm)
      .mockRejectedValueOnce(
        Object.assign(new Error('input/output failure'), { code: 'EIO' })
      );
    await expect(removeDirectory('broken')).rejects.toThrow(
      'input/output failure'
    );
  });
});
