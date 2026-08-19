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
const getFormatTips = jest.fn(() => ['tip one', 'tip two']);
const loadConfig = jest.fn();
const resolveEffectiveTestCaseConfig = jest.fn();
const writeDefaultMarkdownReport = jest.fn();
const getResultsExitCode = jest.fn(() => 0);
const runEvaluation = jest.fn();
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
  resolveEffectiveTestCaseConfig,
}));
jest.mock('../../src/lib/results-output.js', () => ({
  writeDefaultMarkdownReport,
}));
jest.mock('../../src/lib/exit-codes.js', () => ({
  CliExitCode: { Success: 0, ExecutionError: 1 },
  getResultsExitCode,
}));
jest.mock('../../src/core/orchestrator.js', () => ({
  Orchestrator: jest.fn().mockImplementation(() => ({ runEvaluation })),
}));
jest.mock('../../src/lib/logger.js', () => ({
  configure: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { runCommand } from '../../src/cli/commands/run.js';
import * as logger from '../../src/lib/logger.js';

function result(
  status: 'passed' | 'failed' | 'partial',
  failed = status === 'failed' ? 1 : 0
) {
  return {
    summary: {
      overall_status: status,
      passed: status === 'passed' ? 1 : 0,
      failed,
      skipped: status === 'partial' ? 1 : 0,
      total_evaluators: 1,
    },
  };
}

describe('run command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    stat.mockResolvedValue({ size: 10 });
    readFile.mockResolvedValue('config');
    parseConfig.mockReturnValue({ raw: true });
    loadConfig.mockResolvedValue({
      log_level: 'info',
      keep_workspace: true,
      timeout_ms: 100,
      agent: { timeout_ms: 200, model: 'fixture' },
      evaluators: { max_concurrent: 2 },
    });
    resolveEffectiveTestCaseConfig.mockReturnValue({ name: 'fixture' });
    runEvaluation.mockResolvedValue(result('passed'));
    writeDefaultMarkdownReport.mockResolvedValue({
      results: 'results.json',
      report: 'report.md',
    });
    getResultsExitCode.mockReturnValue(0);
  });

  it('rejects an oversized configuration', async () => {
    stat.mockResolvedValue({ size: 1024 * 1024 + 1 });
    await runCommand({ config: 'large.yaml' });
    expect(readFile).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([new Error('bad syntax'), 'bad syntax'])(
    'reports parser failures (%p)',
    async (failure) => {
      parseConfig.mockImplementation(() => {
        throw failure;
      });
      await runCommand({ config: 'bad.yaml' });
      expect(getFormatTips).toHaveBeenCalledWith('bad.yaml');
      expect(process.exitCode).toBe(1);
    }
  );

  it.each([
    new ZodError([{ code: 'custom', path: ['agent', 'type'], message: 'bad' }]),
    new Error('invalid'),
    'invalid',
  ])('reports schema failures (%p)', async (failure) => {
    resolveEffectiveTestCaseConfig.mockImplementation(() => {
      throw failure;
    });
    await runCommand({ config: 'invalid.yaml' });
    expect(spinner.fail).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['passed', 0],
    ['failed', 1],
    ['partial', 0],
  ] as const)('runs and reports a %s result', async (status, failed) => {
    runEvaluation.mockResolvedValue(result(status, failed));
    getResultsExitCode.mockReturnValue(status === 'passed' ? 0 : 2);
    await runCommand({ config: 'testcase.yaml' });
    expect(writeDefaultMarkdownReport).toHaveBeenCalled();
    expect(process.exitCode).toBe(status === 'passed' ? 0 : 2);
  });

  it('deletes the workspace and skips durable report output', async () => {
    loadConfig.mockResolvedValue({ log_level: 'debug' });
    await runCommand({ config: 'testcase.yaml', deleteWorkspace: true });
    expect(writeDefaultMarkdownReport).not.toHaveBeenCalled();
  });

  it.each([
    new Error('orchestration failed'),
    Object.assign(new Error('without stack'), { stack: undefined }),
    'non-error failure',
  ])('maps unexpected failures to execution error (%p)', async (failure) => {
    loadConfig.mockRejectedValue(failure);
    await runCommand({ config: 'testcase.yaml' });
    expect(process.exitCode).toBe(1);
  });

  it('uses the default keep-workspace fallback', async () => {
    loadConfig.mockResolvedValue({ log_level: 'info' });
    await runCommand({ config: 'testcase.yaml' });
    expect(writeDefaultMarkdownReport).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Results:')
    );
  });
});
