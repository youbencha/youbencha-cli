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

const resolveCliExecutable = jest.fn();
const runCliProcess = jest.fn();
jest.mock('../../src/lib/cli-process.js', () => ({
  resolveCliExecutable,
  runCliProcess,
}));
jest.mock('../../src/lib/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import {
  defaultDoctorDependencies,
  doctorCommand,
  getCommandOutput,
  getCommandVersion,
  isWritable,
  pathExists,
  type DoctorDependencies,
} from '../../src/cli/commands/doctor.js';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import * as logger from '../../src/lib/logger.js';

function dependencies(
  overrides: Partial<DoctorDependencies> = {}
): DoctorDependencies {
  return {
    nodeVersion: '20.0.0',
    cwd: process.cwd(),
    commandVersion: async (command) =>
      command === 'git' ? 'git 2' : command === 'copilot' ? 'copilot 1' : null,
    isWritable: async () => false,
    pathExists: async () => false,
    findActiveConfigFile: async () => null,
    readTextFile: async () => '',
    loadConfig: async () => {
      throw new Error('bad configuration');
    },
    ...overrides,
  };
}

describe('doctor default helpers and output', () => {
  let directory: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-doctor-helper-'));
  });

  afterEach(async () => {
    process.exitCode = undefined;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('checks path existence and writable ancestors', async () => {
    const file = path.join(directory, 'file.txt');
    await fs.writeFile(file, 'fixture');
    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(path.join(directory, 'missing'))).toBe(false);
    expect(await isWritable(directory)).toBe(true);
    expect(await isWritable(file)).toBe(false);
    expect(await isWritable(path.join(directory, 'nested', 'future'))).toBe(
      true
    );
    expect(
      await isWritable(path.join(directory, 'missing'), {
        pathExists: async () => false,
      })
    ).toBe(false);
    expect(
      await isWritable(directory, {
        pathExists: async () => true,
        stat: async () => {
          throw new Error('stat failed');
        },
        access: async () => undefined,
      })
    ).toBe(false);
  });

  it('handles unavailable and failed command probes', async () => {
    resolveCliExecutable.mockResolvedValue(null);
    expect(await getCommandOutput('missing', [])).toBeNull();

    resolveCliExecutable.mockResolvedValue('tool');
    runCliProcess.mockResolvedValue({
      error: new Error('failed'),
      timedOut: false,
    });
    expect(await getCommandOutput('tool', [])).toBeNull();
    runCliProcess.mockResolvedValue({ error: undefined, timedOut: true });
    expect(await getCommandOutput('tool', [])).toBeNull();
  });

  it('exposes usable default file dependencies', async () => {
    const file = path.join(directory, 'config.yaml');
    await fs.writeFile(file, 'log_level: info');
    expect(await defaultDoctorDependencies.readTextFile(file)).toContain(
      'log_level'
    );
  });

  it('runs through the default dependency wiring', async () => {
    resolveCliExecutable.mockResolvedValue(null);
    const { runDoctor } = await import('../../src/cli/commands/doctor.js');
    const result = await runDoctor();
    expect(result.checks.length).toBeGreaterThan(0);
    await doctorCommand();
  });

  it.each([
    [{ exitCode: 0, stdout: '1.2.3\n', stderr: '' }, '1.2.3'],
    [{ exitCode: 0, stdout: '', stderr: 'from stderr\n' }, 'from stderr'],
    [{ exitCode: 0, stdout: '', stderr: '' }, 'installed'],
    [{ exitCode: 2, stdout: '', stderr: 'bad' }, null],
    [{ exitCode: null, stdout: 'output', stderr: '' }, null],
  ])('extracts command versions', async (probe, expected) => {
    resolveCliExecutable.mockResolvedValue('tool');
    runCliProcess.mockResolvedValue({
      error: undefined,
      timedOut: false,
      ...probe,
    });
    expect(await getCommandVersion('tool')).toBe(expected);
  });

  it('renders pass, warning, failure, and remediation output', async () => {
    await doctorCommand(dependencies());
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('✓ Node.js')
    );
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await doctorCommand(
      dependencies({
        isWritable: async () => true,
        pathExists: async () => true,
        loadConfig: async () => defaultConfig,
      })
    );
    expect(process.exitCode).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'Ready to use youBencha. Warnings apply only to optional workflows.'
    );
  });

  it('covers absent probes, unknown versions, valid active config, and string failures', async () => {
    const { runDoctor } = await import('../../src/cli/commands/doctor.js');
    const active = path.join(directory, '.youbencharc');
    const noProbes = await runDoctor(
      dependencies({
        nodeVersion: '',
        commandVersion: async (command) =>
          command === 'codex' ? 'codex 1' : null,
        commandOutput: undefined,
        findActiveConfigFile: async () => active,
        readTextFile: async () => 'log_level: info',
        loadConfig: async () => defaultConfig,
      })
    );
    expect(noProbes.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Node.js',
          message: expect.stringContaining('unknown'),
        }),
        expect.objectContaining({
          name: 'Configuration',
          status: 'pass',
        }),
      ])
    );

    const genericFailures = await runDoctor(
      dependencies({
        commandVersion: async (command) =>
          command === 'codex' ? 'codex 1' : null,
        commandOutput: async (_command, args) =>
          args[0] === 'login'
            ? ({ exitCode: 1, stdout: undefined, stderr: undefined } as never)
            : args[0] === '--help'
              ? null
              : {
                  exitCode: 2,
                  stdout: '',
                  stderr: 'ordinary failure',
                },
        loadConfig: async () => {
          throw 'string config failure';
        },
      })
    );
    expect(genericFailures.ok).toBe(false);

    const unsupported = await runDoctor(
      dependencies({
        commandVersion: async (command) =>
          command === 'codex' ? 'codex 1' : null,
        commandOutput: async (_command, args) =>
          args[0] === 'login'
            ? { exitCode: 0, stdout: 'signed in', stderr: '' }
            : {
                exitCode: 2,
                stdout: '',
                stderr: 'unknown command or option',
              },
      })
    );
    expect(
      unsupported.checks.find((check) => check.name === 'Codex CLI')?.message
    ).toContain('unsupported');
  });
});
