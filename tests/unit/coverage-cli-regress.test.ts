import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const loadRegressionSuite = jest.fn();
const planRegressionSuite = jest.fn();
const validateRegressionE2BPlan = jest.fn();
const createRegressionE2BExecutor = jest.fn();
const buildRegressionResult = jest.fn();
const runExperiment = jest.fn();
const writeExperimentReports = jest.fn();
const hostConstructor = jest.fn();
const circuitConstructor = jest.fn((executor) => executor);

jest.mock('../../src/regression/index.js', () => ({
  loadRegressionSuite,
  planRegressionSuite,
  validateRegressionE2BPlan,
  createRegressionE2BExecutor,
  buildRegressionResult,
}));
jest.mock('../../src/experiments/index.js', () => ({
  runExperiment,
  OrchestratorSingleRunExecutor: jest.fn().mockImplementation((options) => {
    hostConstructor(options);
    return { execute: jest.fn() };
  }),
  TargetCircuitBreakerExecutor: jest.fn().mockImplementation((executor) => {
    circuitConstructor(executor);
    return executor;
  }),
}));
jest.mock('../../src/reporters/experiment.js', () => ({
  writeExperimentReports,
}));

import {
  registerRegressCommand,
  regressCommand,
} from '../../src/cli/commands/regress.js';

function suite(provider: 'host-trusted' | 'e2b' = 'host-trusted') {
  return {
    definition: {
      name: 'suite',
      execution: {
        provider: { type: provider },
        retry: { max_attempts: 1, on: [], backoff_ms: 0, jitter: false },
      },
    },
    tasks: [{ id: 'task', resolvedFile: 'task.yaml' }],
  };
}

function plan(provider: 'host-trusted' | 'e2b' = 'host-trusted') {
  return {
    definitionHash: 'hash',
    selection: { provider },
    cellCount: 1,
    maxConcurrent: 1,
    cells: [
      {
        cellId: 'cell',
        testcaseId: 'task',
        variantName: 'target',
        repetition: 1,
        configHash: 'config',
      },
    ],
  };
}

describe('regress command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    loadRegressionSuite.mockResolvedValue(suite());
    planRegressionSuite.mockReturnValue(plan());
    validateRegressionE2BPlan.mockReturnValue([]);
    createRegressionE2BExecutor.mockReturnValue({ execute: jest.fn() });
    runExperiment.mockResolvedValue({
      experimentId: 'experiment',
      experimentDirectory: 'results/experiment',
    });
    buildRegressionResult.mockResolvedValue({
      final_status: 'passed',
      exit_code: 0,
    });
    writeExperimentReports.mockResolvedValue({
      json: 'results.json',
      markdown: 'report.md',
      junit: 'report.xml',
    });
  });

  it('plans defaults and populated E2B selections', async () => {
    const output: string[] = [];
    await regressCommand(
      'suite.yaml',
      { plan: true },
      {
        cwd: 'project',
        stdout: (message) => output.push(message),
      }
    );
    expect(JSON.parse(output[0]) as unknown).not.toHaveProperty('e2b');

    validateRegressionE2BPlan.mockReturnValue([{ targetId: 'target' }]);
    await regressCommand(
      'suite.yaml',
      {
        plan: true,
        profile: 'smoke',
        case: ['task'],
        target: ['target'],
        provider: 'e2b',
        repetitions: '2',
      },
      { cwd: 'project', stdout: (message) => output.push(message) }
    );
    expect(planRegressionSuite).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        profile: 'smoke',
        caseIds: ['task'],
        targetIds: ['target'],
        provider: 'e2b',
        repetitions: 2,
      })
    );
    expect(JSON.parse(output[1]) as unknown).toHaveProperty('e2b');
  });

  it('normalizes empty selections and numeric repetitions', async () => {
    await regressCommand(
      'suite.yaml',
      { plan: true, case: [], target: [], repetitions: 3 },
      { stdout: jest.fn() }
    );
    expect(planRegressionSuite).toHaveBeenCalledWith(expect.anything(), {
      repetitions: 3,
    });
  });

  it.each([
    [{ provider: 'invalid' }, '--provider'],
    [{ repetitions: 'nope' }, '--repetitions'],
    [{ repetitions: 0 }, '--repetitions'],
    [{ repetitions: 1.5 }, '--repetitions'],
  ] as const)('rejects invalid options', async (options, message) => {
    const errors: string[] = [];
    await regressCommand('suite.yaml', options as never, {
      stderr: (value) => errors.push(value),
    });
    expect(errors[0]).toContain(message);
  });

  it('runs supplied executors with resume and baseline overrides', async () => {
    const executor = { execute: jest.fn() };
    const output: string[] = [];
    await regressCommand(
      'suite.yaml',
      { resume: 'experiment', against: 'production' },
      {
        executor,
        stdout: (message) => output.push(message),
      }
    );
    expect(runExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'experiment', resume: true })
    );
    expect(buildRegressionResult).toHaveBeenCalledWith(
      expect.objectContaining({ against: 'production' })
    );
    expect(output).toHaveLength(5);
    expect(process.exitCode).toBe(0);
  });

  it('constructs the default host executor', async () => {
    await regressCommand('suite.yaml', {}, { stdout: jest.fn() });
    expect(hostConstructor).toHaveBeenCalledWith({
      configFiles: expect.any(Map),
    });
    expect(circuitConstructor).toHaveBeenCalled();
  });

  it('constructs default and custom E2B executors and forwards warnings', async () => {
    loadRegressionSuite.mockResolvedValue(suite('e2b'));
    planRegressionSuite.mockReturnValue(plan('e2b'));
    const errors: string[] = [];
    createRegressionE2BExecutor.mockImplementation((_suite, _plan, options) => {
      options.onWarning('warning');
      return { execute: jest.fn() };
    });
    await regressCommand(
      'suite.yaml',
      {},
      {
        stderr: (message) => errors.push(message),
        stdout: jest.fn(),
      }
    );
    expect(errors).toEqual(['warning']);

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await regressCommand('suite.yaml', {}, { stdout: jest.fn() });
    expect(console.error).toHaveBeenCalledWith('warning');

    const custom = jest.fn(() => ({ execute: jest.fn() }));
    await regressCommand(
      'suite.yaml',
      {},
      {
        createE2BExecutor: custom,
        stdout: jest.fn(),
      }
    );
    expect(custom).toHaveBeenCalled();
  });

  it('rejects E2B overrides when suite policy is absent', async () => {
    planRegressionSuite.mockReturnValue(plan('e2b'));
    const errors: string[] = [];
    await regressCommand(
      'suite.yaml',
      {},
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors[0]).toContain('does not define E2B');
  });

  it('maps Error and string execution failures using default and custom writers', async () => {
    loadRegressionSuite.mockRejectedValueOnce(new Error('load failed'));
    await regressCommand('suite.yaml', {});
    expect(process.exitCode).toBe(1);

    const errors: string[] = [];
    loadRegressionSuite.mockRejectedValueOnce('string failure');
    await regressCommand(
      'suite.yaml',
      {},
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors).toEqual(['string failure']);
  });

  it('registers repeatable case and target parsers and the command action', () => {
    const parsers: Array<(value: string, previous: string[]) => string[]> = [];
    const actions: unknown[] = [];
    const chain = {
      command: jest.fn(() => chain),
      argument: jest.fn(() => chain),
      option: jest.fn((...args: unknown[]) => {
        if (typeof args[2] === 'function') {
          parsers.push(
            args[2] as (value: string, previous: string[]) => string[]
          );
        }
        return chain;
      }),
      description: jest.fn(() => chain),
      action: jest.fn((callback) => {
        actions.push(callback);
        return chain;
      }),
    };
    registerRegressCommand(chain as never);
    expect(parsers.map((parser) => parser('two', ['one']))).toEqual([
      ['one', 'two'],
      ['one', 'two'],
    ]);
    expect(actions).toHaveLength(1);
  });
});
