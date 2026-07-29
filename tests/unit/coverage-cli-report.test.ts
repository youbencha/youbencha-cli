import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as path from 'path';

const readFile = jest.fn();
const parse = jest.fn();
const jsonWrite = jest.fn();
const markdownWrite = jest.fn();

jest.mock('fs/promises', () => ({ readFile }));
jest.mock('../../src/schemas/result.schema.js', () => ({
  resultsBundleSchema: { parse },
}));
jest.mock('../../src/reporters/json.js', () => ({
  JsonReporter: jest.fn().mockImplementation(() => ({
    extension: '.json',
    writeToFile: jsonWrite,
  })),
}));
jest.mock('../../src/reporters/markdown.js', () => ({
  MarkdownReporter: jest.fn().mockImplementation(() => ({
    extension: '.md',
    writeToFile: markdownWrite,
  })),
}));
jest.mock('../../src/lib/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { reportCommand } from '../../src/cli/commands/report.js';

describe('report command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    readFile.mockResolvedValue('{}');
    parse.mockReturnValue({ summary: {} });
    jsonWrite.mockResolvedValue(undefined);
    markdownWrite.mockResolvedValue(undefined);
  });

  it.each([
    [
      { from: path.join('tmp', 'results.json') },
      path.join('tmp', 'report.md'),
      markdownWrite,
    ],
    [
      { from: '/tmp/results.json', format: 'markdown', output: 'custom.md' },
      'custom.md',
      markdownWrite,
    ],
    [
      { from: path.join('tmp', 'results.json'), format: 'md' },
      path.join('tmp', 'report.md'),
      markdownWrite,
    ],
    [
      { from: path.join('tmp', 'results.json'), format: 'json' },
      path.join('tmp', 'report.json'),
      jsonWrite,
    ],
  ] as const)('generates supported reports', async (options, output, write) => {
    await reportCommand(options);
    expect(write).toHaveBeenCalledWith({ summary: {} }, output);
    expect(process.exitCode).toBe(0);
  });

  it.each([new Error('invalid result'), 'invalid result'])(
    'rejects invalid bundles (%p)',
    async (failure) => {
      parse.mockImplementation(() => {
        throw failure;
      });
      await reportCommand({ from: 'results.json' });
      expect(process.exitCode).toBe(1);
    }
  );

  it('rejects unsupported formats', async () => {
    await reportCommand({ from: 'results.json', format: 'xml' });
    expect(process.exitCode).toBe(1);
    expect(markdownWrite).not.toHaveBeenCalled();
  });

  it.each([
    new Error('read failed'),
    Object.assign(new Error('without stack'), { stack: undefined }),
    'non-error failure',
  ])('reports unexpected failures (%p)', async (failure) => {
    readFile.mockRejectedValue(failure);
    await reportCommand({ from: 'results.json' });
    expect(process.exitCode).toBe(1);
  });
});
