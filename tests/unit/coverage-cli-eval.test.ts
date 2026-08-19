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
const writeDefaultMarkdownReport = jest.fn();
const getResultsExitCode = jest.fn(() => 0);
const runEvaluationOnly = jest.fn();
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
}));
jest.mock('../../src/lib/results-output.js', () => ({
  writeDefaultMarkdownReport,
}));
jest.mock('../../src/lib/exit-codes.js', () => ({
  CliExitCode: { Success: 0, ExecutionError: 1 },
  getResultsExitCode,
}));
jest.mock('../../src/core/orchestrator.js', () => ({
  Orchestrator: jest.fn().mockImplementation(() => ({ runEvaluationOnly })),
}));
jest.mock('../../src/lib/logger.js', () => ({
  configure: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { evalCommand } from '../../src/cli/commands/eval.js';

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

describe('eval command coverage', () => {
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
      timeout_ms: 100,
      agent: { timeout_ms: 200, model: 'fixture' },
      evaluators: { max_concurrent: 2 },
    });
    resolveEffectiveEvalConfig.mockReturnValue({ name: 'fixture' });
    runEvaluationOnly.mockResolvedValue(result('passed'));
    writeDefaultMarkdownReport.mockResolvedValue({
      results: 'results.json',
      report: 'report.md',
    });
    getResultsExitCode.mockReturnValue(0);
  });

  it('rejects an oversized configuration', async () => {
    stat.mockResolvedValue({ size: 1024 * 1024 + 1 });
    await evalCommand({ config: 'large.yaml' });
    expect(readFile).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([new Error('bad syntax'), 'bad syntax'])(
    'reports parser failures (%p)',
    async (failure) => {
      parseConfig.mockImplementation(() => {
        throw failure;
      });
      await evalCommand({ config: 'bad.yaml' });
      expect(getFormatTips).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    }
  );

  it.each([
    new ZodError([{ code: 'custom', path: ['directory'], message: 'bad' }]),
    new Error('invalid'),
    'invalid',
  ])('reports schema failures (%p)', async (failure) => {
    resolveEffectiveEvalConfig.mockImplementation(() => {
      throw failure;
    });
    await evalCommand({ config: 'invalid.yaml' });
    expect(spinner.fail).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['passed', 0],
    ['failed', 1],
    ['partial', 0],
  ] as const)('runs and reports a %s result', async (status, failed) => {
    runEvaluationOnly.mockResolvedValue(result(status, failed));
    getResultsExitCode.mockReturnValue(status === 'passed' ? 0 : 2);
    await evalCommand({ config: 'eval.yaml' });
    expect(writeDefaultMarkdownReport).toHaveBeenCalled();
    expect(process.exitCode).toBe(status === 'passed' ? 0 : 2);
  });

  it.each([
    new Error('evaluation failed'),
    Object.assign(new Error('without stack'), { stack: undefined }),
    'non-error failure',
  ])('maps unexpected failures to execution error (%p)', async (failure) => {
    loadConfig.mockRejectedValue(failure);
    await evalCommand({ config: 'eval.yaml' });
    expect(process.exitCode).toBe(1);
  });
});
