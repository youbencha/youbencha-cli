import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const spinner = {
  start: jest.fn(),
  stop: jest.fn(),
  succeed: jest.fn(),
  fail: jest.fn(),
};
jest.mock('../../src/lib/progress.js', () => ({
  createSpinner: () => spinner,
}));

import { initCommand } from '../../src/cli/commands/init.js';
import { installAgentsCommand } from '../../src/cli/commands/install-agents.js';
import { listCommand } from '../../src/cli/commands/list.js';
import * as logger from '../../src/lib/logger.js';

describe('simple CLI command coverage', () => {
  let directory: string;
  let originalCwd: string;
  let exit: jest.SpiedFunction<typeof process.exit>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-cli-simple-'));
    process.chdir(directory);
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('creates both starter variants and handles existing files', async () => {
    await initCommand({ minimal: true });
    expect(
      await fs.readFile(path.join(directory, 'eval.yaml'), 'utf8')
    ).toContain('directory: "."');

    await initCommand({ minimal: true });
    expect(exit).toHaveBeenCalledWith(1);
    await initCommand({ minimal: true, force: true });
    await initCommand({});
    await initCommand({ force: true });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('reports all init installation statuses and operational failures', async () => {
    const installAgentFiles = jest.fn(async () => ({
      files: [
        { file: 'created', status: 'created' as const },
        { file: 'skipped', status: 'skipped' as const },
        { file: 'overwritten', status: 'overwritten' as const },
        { file: 'error', status: 'error' as const, error: 'denied' },
        { file: 'error-no-message', status: 'error' as const },
      ],
      summary: { created: 1, skipped: 1, overwritten: 1, errors: 2 },
      success: false,
    }));
    const codes: number[] = [];
    await initCommand(
      {},
      {
        cwd: directory,
        access: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
        installAgentFiles,
        exit: (code) => codes.push(code),
      }
    );
    expect(codes).toEqual([0]);

    await initCommand(
      { minimal: true },
      {
        cwd: directory,
        access: async () => {
          throw new Error('missing');
        },
        writeFile: async () => {
          throw 'write failure';
        },
        exit: (code) => codes.push(code),
      }
    );
    await initCommand(
      { minimal: true },
      {
        cwd: directory,
        access: async () => {
          throw new Error('missing');
        },
        writeFile: async () => {
          throw new Error('write failure');
        },
        exit: (code) => codes.push(code),
      }
    );
    expect(codes).toEqual([0, 1, 1]);
  });

  it('installs, skips, and overwrites agent files', async () => {
    await installAgentsCommand({});
    await installAgentsCommand({});
    await installAgentsCommand({ force: true });
    expect(exit).toHaveBeenNthCalledWith(1, 0);
    expect(exit).toHaveBeenNthCalledWith(2, 0);
    expect(exit).toHaveBeenNthCalledWith(3, 0);
  });

  it('reports mixed and failed installation results', async () => {
    const codes: number[] = [];
    await installAgentsCommand(
      {},
      {
        installAgentFiles: async () => ({
          files: [
            { file: 'created', status: 'created' },
            { file: 'skipped', status: 'skipped' },
            { file: 'overwritten', status: 'overwritten' },
            { file: 'failed', status: 'error', error: 'denied' },
            { file: 'failed-quietly', status: 'error' },
          ],
          summary: { created: 1, skipped: 2, overwritten: 1, errors: 2 },
          success: false,
        }),
        exit: (code) => codes.push(code),
      }
    );
    await installAgentsCommand(
      {},
      {
        installAgentFiles: async () => ({
          files: [],
          summary: { created: 1, skipped: 1, overwritten: 0, errors: 0 },
          success: true,
        }),
        exit: (code) => codes.push(code),
      }
    );
    await installAgentsCommand(
      {},
      {
        installAgentFiles: async () => ({
          files: [
            { file: 'created', status: 'created' },
            { file: 'skipped', status: 'skipped' },
          ],
          summary: { created: 1, skipped: 2, overwritten: 0, errors: 0 },
          success: true,
        }),
        exit: (code) => codes.push(code),
      }
    );
    await installAgentsCommand(
      {},
      {
        installAgentFiles: async () => ({
          files: [],
          summary: { created: 0, skipped: 2, overwritten: 0, errors: 0 },
          success: true,
        }),
        exit: (code) => codes.push(code),
      }
    );
    expect(codes).toEqual([1, 0, 0, 0]);
  });

  it('lists adapters and both evaluator reference modes', async () => {
    await listCommand();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('expected-diff')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('git-diff')
    );
  });
});
