import { loadConfig } from '../../src/lib/config-loader.js';

jest.mock('fs/promises', () => ({
  access: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('ignored'),
}));

jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/mock-user'),
}));

jest.mock('../../src/lib/config-parser.js', () => ({
  parseConfig: jest.fn(() => {
    throw 'non-error parser failure';
  }),
}));

describe('configuration loader non-Error coverage', () => {
  it('stringifies non-Error parser failures', async () => {
    await expect(loadConfig()).rejects.toThrow('non-error parser failure');
  });
});
