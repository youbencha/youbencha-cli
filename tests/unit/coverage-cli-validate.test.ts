import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ZodError } from 'zod';

const stat = jest.fn();
const readFile = jest.fn();
const parseConfig = jest.fn();
const getFormatTips = jest.fn(() => ['tip']);
const loadConfig = jest.fn();
const resolveEffectiveEvalConfig = jest.fn();
const resolveEffectiveTestCaseConfig = jest.fn();
const spinner = {
  start: jest.fn(),
  succeed: jest.fn(),
  fail: jest.fn(),
};

jest.mock('fs/promises', () => ({ stat, readFile }));
jest.mock('../../src/lib/progress.js', () => ({
  createSpinner: () => spinner,
}));
jest.mock('../../src/lib/config-parser.js', () => ({
  parseConfig,
  getFormatTips,
}));
jest.mock('../../src/lib/config-loader.js', () => ({ loadConfig }));
jest.mock('../../src/lib/effective-config.js', () => ({
  resolveEffectiveEvalConfig,
  resolveEffectiveTestCaseConfig,
}));
jest.mock('../../src/lib/exit-codes.js', () => ({
  CliExitCode: { Success: 0, ExecutionError: 1 },
}));
jest.mock('../../src/lib/logger.js', () => ({
  configure: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { validateCommand } from '../../src/cli/commands/validate.js';
import * as logger from '../../src/lib/logger.js';

function testcase(overrides: Record<string, unknown> = {}) {
  return {
    name: 'fixture',
    description: 'description',
    repo: 'https://example.com/repo.git',
    branch: 'main',
    expected: 'expected',
    expected_source: 'branch',
    agent: {
      type: 'copilot-cli',
      config: {
        prompt: 'a sufficiently detailed prompt',
        prompt_file: 'prompt.md',
      },
    },
    evaluators: [
      { name: 'git-diff' },
      {
        name: 'agentic-judge',
        config: { assertions: { quality: 'good' } },
      },
    ],
    ...overrides,
  };
}

describe('validate command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    stat.mockResolvedValue({ size: 10 });
    readFile.mockResolvedValue('config');
    parseConfig.mockReturnValue({ repo: 'fixture' });
    loadConfig.mockResolvedValue({ log_level: 'info' });
    resolveEffectiveEvalConfig.mockReturnValue({
      name: 'eval fixture',
      directory: '.',
      evaluators: [{ name: 'git-diff' }],
      output_dir: 'output',
    });
    resolveEffectiveTestCaseConfig.mockReturnValue(testcase());
  });

  it('rejects oversized files', async () => {
    stat.mockResolvedValue({ size: 1024 * 1024 + 1 });
    await validateCommand({ config: 'large.yaml' });
    expect(process.exitCode).toBe(1);
  });

  it.each([
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
    new Error('denied'),
    'read failure',
  ])('reports read failures (%p)', async (failure) => {
    stat.mockRejectedValue(failure);
    await validateCommand({ config: 'missing.yaml' });
    expect(process.exitCode).toBe(1);
  });

  it.each([new Error('bad syntax'), 'bad syntax'])(
    'reports parse failures (%p)',
    async (failure) => {
      parseConfig.mockImplementation(() => {
        throw failure;
      });
      await validateCommand({ config: 'bad.yaml' });
      expect(getFormatTips).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    }
  );

  it('recognizes and summarizes evaluation-only configuration', async () => {
    parseConfig.mockReturnValue({ directory: '.' });
    await validateCommand({ config: 'eval.yaml' });
    expect(resolveEffectiveEvalConfig).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it.each([
    new ZodError([{ code: 'custom', path: ['repo'], message: 'bad' }]),
    new Error('invalid'),
    'invalid',
  ])('reports schema failures (%p)', async (failure) => {
    resolveEffectiveTestCaseConfig.mockImplementation(() => {
      throw failure;
    });
    await validateCommand({ config: 'invalid.yaml' });
    expect(process.exitCode).toBe(1);
  });

  it('prints all verbose metadata and configured assertions', async () => {
    await validateCommand({ config: 'testcase.yaml', verbose: true });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Assertions: 1')
    );
    expect(process.exitCode).toBe(0);
  });

  it('warns about short prompts, duplicates, missing expected refs and assertions', async () => {
    resolveEffectiveTestCaseConfig.mockReturnValue(
      testcase({
        branch: undefined,
        expected: undefined,
        agent: { type: 'codex-cli', config: { prompt: 'short' } },
        evaluators: [
          { name: 'expected-diff', config: {} },
          { name: 'agentic-judge', config: { criteria: {} } },
          { name: 'agentic-judge' },
        ],
      })
    );
    await validateCommand({ config: 'testcase.yaml', verbose: true });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('handles nonverbose configs, non-object evaluator config, and detection fallbacks', async () => {
    resolveEffectiveTestCaseConfig.mockReturnValue(
      testcase({
        agent: { type: 'copilot-cli' },
        evaluators: [{ name: 'git-diff', config: 'not-an-object' }],
      })
    );
    for (const value of [
      null,
      'text',
      { directory: '.', repo: 'also-present' },
    ]) {
      parseConfig.mockReturnValue(value);
      await validateCommand({ config: 'testcase.yaml' });
    }
    expect(resolveEffectiveTestCaseConfig).toHaveBeenCalledTimes(3);
  });

  it.each([
    new Error('unexpected'),
    Object.assign(new Error('without stack'), { stack: undefined }),
    'non-error failure',
  ])('reports unexpected top-level failures (%p)', async (failure) => {
    loadConfig.mockRejectedValue(failure);
    await validateCommand({ config: 'testcase.yaml', verbose: true });
    expect(process.exitCode).toBe(1);
  });
});
