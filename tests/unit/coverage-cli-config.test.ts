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
import {
  configGetCommand,
  configInitCommand,
  configListCommand,
  configSetCommand,
  configUnsetCommand,
} from '../../src/cli/commands/config.js';
import * as logger from '../../src/lib/logger.js';

describe('config command coverage', () => {
  let directory: string;
  let originalCwd: string;
  let info: jest.SpiedFunction<typeof logger.info>;
  let error: jest.SpiedFunction<typeof logger.error>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-cli-config-'));
    process.chdir(directory);
    info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('initializes, lists, gets, sets, and unsets project configuration', async () => {
    await configListCommand({});
    await configInitCommand({});
    await expect(configInitCommand({})).rejects.toThrow('exit:1');
    await configInitCommand({ force: true });

    await configListCommand({});
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Active config'));

    await configSetCommand('agent.timeout_ms', '42', {});
    await configGetCommand('agent.timeout_ms', {});
    await configGetCommand('agent', {});
    await expect(configGetCommand('missing.path', {})).rejects.toThrow(
      'exit:1'
    );

    await configSetCommand('enabled', 'true', {});
    await configSetCommand('disabled', 'false', {});
    await configSetCommand('label', '1e3', {});
    await configSetCommand('empty', '', {});
    await configSetCommand('ratio', '-1.5', {});

    await configUnsetCommand('agent.timeout_ms', {});
    await expect(configUnsetCommand('agent.missing', {})).rejects.toThrow(
      'exit:1'
    );
    await expect(configUnsetCommand('unknown.child', {})).rejects.toThrow(
      'exit:1'
    );

    const parsed = await fs.readFile(
      path.join(directory, '.youbencharc'),
      'utf8'
    );
    expect(parsed).toContain('enabled: true');
    expect(parsed).toContain('disabled: false');
    expect(parsed).toContain('label: "1e3"');
    expect(parsed).toContain('ratio: -1.5');
    expect(error).toHaveBeenCalled();
  });

  it('creates missing files during set and reports missing files during unset', async () => {
    await configSetCommand('name', 'fixture', {});
    await fs.rm(path.join(directory, '.youbencharc'));
    await expect(configUnsetCommand('name', {})).rejects.toThrow('exit:1');
  });
});
