import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const access = jest.fn();
const readFile = jest.fn();
const writeFile = jest.fn();
const loadConfig = jest.fn();
const configExists = jest.fn();
const findActiveConfigFile = jest.fn();

jest.mock('fs/promises', () => ({ access, readFile, writeFile }));
jest.mock('../../src/lib/config-loader.js', () => ({
  loadConfig,
  getDefaultConfigPath: (level: string) => `${level}.yaml`,
  configExists,
  findActiveConfigFile,
}));
jest.mock('../../src/lib/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

import {
  configInitCommand,
  configListCommand,
  configSetCommand,
  configUnsetCommand,
} from '../../src/cli/commands/config.js';

describe('global config command branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    access.mockResolvedValue(undefined);
    readFile.mockResolvedValue('');
    writeFile.mockResolvedValue(undefined);
    loadConfig.mockResolvedValue({});
    configExists.mockResolvedValue(false);
    findActiveConfigFile.mockResolvedValue(null);
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  it('uses global paths and handles empty YAML files', async () => {
    await configInitCommand({ global: true });
    await configListCommand({});
    await configSetCommand('timeout_ms', '10', { global: true });
    await configUnsetCommand('missing', { global: true });

    expect(writeFile).toHaveBeenCalledWith(
      'user.yaml',
      expect.any(String),
      'utf-8'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
