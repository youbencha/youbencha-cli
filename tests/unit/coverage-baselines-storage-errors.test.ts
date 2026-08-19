import * as fs from 'fs/promises';
import { watch } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeExclusiveAtomic } from '../../src/baselines/storage-utils.js';

describe('exclusive baseline write errors', () => {
  it('rethrows non-collision link errors and tolerates a missing temporary file', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-exclusive-error-')
    );
    const destination = path.join(temporaryDirectory, 'destination.json');
    const watcher = watch(temporaryDirectory, (_event, filename) => {
      if (filename?.endsWith('.tmp')) {
        void fs.rm(path.join(temporaryDirectory, filename), { force: true });
      }
    });
    try {
      await expect(
        writeExclusiveAtomic(destination, 'contents')
      ).rejects.toMatchObject({ code: expect.stringMatching(/ENOENT|EPERM/) });
    } finally {
      watcher.close();
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
