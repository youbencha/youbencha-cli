import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const access = jest.fn();
const stat = jest.fn();
const readFile = jest.fn();
const loadExperiment = jest.fn();
const planExperiment = jest.fn();
const runExperiment = jest.fn();
const aggregateExperimentCells = jest.fn();
const normalizeExperimentProvenance = jest.fn();
const compareExperimentAggregates = jest.fn();
const rulesFromExperimentPolicy = jest.fn();
const baselineRead = jest.fn();
const baselineApprove = jest.fn();
const resultParse = jest.fn((value) => value);
const resultSafeParse = jest.fn();
const bundleParse = jest.fn();
const logParse = jest.fn();
const writeExperimentReports = jest.fn();
const writeExperimentJson = jest.fn();
const writeExperimentJunit = jest.fn();
const writeExperimentMarkdown = jest.fn();
const executorConstructor = jest.fn();

jest.mock('fs/promises', () => ({ access, stat, readFile }));
jest.mock('../../src/experiments/index.js', () => ({
  aggregateExperimentCells,
  compareExperimentAggregates,
  loadExperiment,
  normalizeExperimentProvenance,
  planExperiment,
  rulesFromExperimentPolicy,
  runExperiment,
  BaselineStore: jest.fn().mockImplementation(() => ({
    read: baselineRead,
    approve: baselineApprove,
  })),
  OrchestratorSingleRunExecutor: jest.fn().mockImplementation((options) => {
    executorConstructor(options);
    return { execute: jest.fn() };
  }),
}));
jest.mock('../../src/schemas/experiment.schema.js', () => ({
  experimentDefinitionSchema: { safeParse: resultSafeParse },
}));
jest.mock('../../src/schemas/experiment-result.schema.js', () => ({
  experimentResultSchema: { parse: resultParse },
}));
jest.mock('../../src/schemas/result.schema.js', () => ({
  resultsBundleSchema: { parse: bundleParse },
}));
jest.mock('../../src/schemas/youbenchalog.schema.js', () => ({
  youBenchaLogSchema: { parse: logParse },
}));
jest.mock('../../src/reporters/experiment.js', () => ({
  writeExperimentReports,
  writeExperimentJson,
  writeExperimentJunit,
  writeExperimentMarkdown,
}));

import {
  experimentApproveCommand,
  experimentCompareCommand,
  experimentPlanCommand,
  experimentReportCommand,
  experimentRunCommand,
  experimentValidateCommand,
  registerExperimentCommand,
} from '../../src/cli/commands/experiment.js';

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    definitionHash: 'definition-hash',
    redactedEffectiveConfiguration: { definition: {} },
    testcases: [{ id: 'task', resolvedFile: 'task.yaml' }],
    definition: {
      name: 'experiment',
      execution: {
        retry: { max_attempts: 1, on: [], backoff_ms: 0, jitter: false },
      },
      ...overrides,
    },
  };
}

function plan() {
  return {
    definitionHash: 'definition-hash',
    cellCount: 1,
    maxConcurrent: 2,
    budget: undefined,
    redactedEffectiveConfiguration: {},
    cells: [
      {
        cellId: 'cell',
        testcaseId: 'task',
        variantName: 'variant',
        repetition: 0,
        configHash: 'config-hash',
        config: { agent: {} },
      },
    ],
  };
}

function runtime(cells: unknown[] = []) {
  return {
    experimentId: 'experiment-1',
    experimentDirectory: 'results/experiment-1',
    finalStatus: 'passed',
    exitCode: 0,
    state: {
      started_at: undefined,
      updated_at: '2026-01-01T00:00:01Z',
      cells,
    },
  };
}

function bundle() {
  return {
    execution: { environment: { workspace_dir: 'workspace' } },
    artifacts: { agent_log: 'agent.json' },
    summary: { passed: 1, failed: 0 },
  };
}

function experimentResult(overrides: Record<string, unknown> = {}) {
  return {
    effective_configuration: {
      definition: { regression: { min_pass_rate: 1 } },
    },
    aggregates: [{ scope: 'variant', variant_name: 'candidate' }],
    ...overrides,
  };
}

describe('experiment command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    access.mockRejectedValue(new Error('missing'));
    stat.mockResolvedValue({ isDirectory: () => false });
    readFile.mockResolvedValue('{}');
    loadExperiment.mockResolvedValue(loaded());
    planExperiment.mockReturnValue(plan());
    runExperiment.mockResolvedValue(runtime());
    aggregateExperimentCells.mockReturnValue({ aggregates: [], warnings: [] });
    normalizeExperimentProvenance.mockReturnValue({
      sources: [],
      provenance: [],
      warnings: [],
    });
    compareExperimentAggregates.mockReturnValue({
      status: 'passed',
      findings: [{ message: 'finding' }],
    });
    rulesFromExperimentPolicy.mockReturnValue([]);
    baselineRead.mockResolvedValue({
      result: experimentResult(),
      manifest: { name: 'baseline', content_hash: 'hash' },
    });
    baselineApprove.mockResolvedValue({
      name: 'approved',
      content_hash: 'hash',
    });
    resultParse.mockImplementation((value) => value);
    resultSafeParse.mockReturnValue({
      success: true,
      data: { regression: { min_pass_rate: 1 } },
    });
    bundleParse.mockReturnValue(bundle());
    logParse.mockReturnValue({ events: [] });
    writeExperimentReports.mockResolvedValue({
      json: 'results.json',
      markdown: 'report.md',
      junit: 'junit.xml',
    });
    writeExperimentJson.mockResolvedValue(undefined);
    writeExperimentJunit.mockResolvedValue(undefined);
    writeExperimentMarkdown.mockResolvedValue(undefined);
  });

  it('validates and renders text and JSON plans', async () => {
    const output: string[] = [];
    await experimentValidateCommand('experiment.yaml', {
      stdout: (message) => output.push(message),
    });
    await experimentPlanCommand(
      'experiment.yaml',
      { json: true },
      {
        stdout: (message) => output.push(message),
      }
    );
    planExperiment.mockReturnValue({ ...plan(), budget: { credits: 2 } });
    await experimentPlanCommand(
      'experiment.yaml',
      {},
      {
        stdout: (message) => output.push(message),
      }
    );
    expect(output.join('\n')).toContain('Valid experiment');
    expect(output.join('\n')).toContain('Concurrency: 2');
  });

  it.each([
    [experimentValidateCommand, ['file']],
    [experimentPlanCommand, ['file', {}]],
  ] as const)(
    'maps validation and planning failures',
    async (command, args) => {
      loadExperiment.mockRejectedValueOnce(new Error('load failed'));
      await (command as never)(...args, {});
      loadExperiment.mockRejectedValueOnce('string failure');
      const errors: string[] = [];
      await (command as never)(...args, {
        stderr: (message: string) => errors.push(message),
      });
      expect(errors).toEqual(['string failure']);
    }
  );

  it('runs with supplied and default executors, resume, and empty cells', async () => {
    const output: string[] = [];
    await experimentRunCommand(
      'experiment.yaml',
      { resume: 'experiment-1' },
      {
        cwd: 'project',
        executor: { execute: jest.fn() },
        stdout: (message) => output.push(message),
      }
    );
    expect(runExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'experiment-1', resume: true })
    );
    expect(process.exitCode).toBe(0);

    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        stdout: (message) => output.push(message),
      }
    );
    expect(executorConstructor).toHaveBeenCalledWith({
      configFiles: expect.any(Map),
    });
  });

  it('builds cell inputs, tolerates missing logs, and skips incomplete cells', async () => {
    const cells = [
      { cell_id: 'none', testcase_id: 'task', result_path: undefined },
      { cell_id: 'unknown', testcase_id: 'task', result_path: 'unknown.json' },
      { cell_id: 'cell', testcase_id: 'task', result_path: 'cell.json' },
    ];
    runExperiment.mockResolvedValue(runtime(cells));
    logParse.mockImplementationOnce(() => {
      throw new Error('missing log');
    });
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stdout: jest.fn(),
      }
    );
    expect(aggregateExperimentCells).toHaveBeenCalled();
    expect(normalizeExperimentProvenance).toHaveBeenCalled();
  });

  it('rejects cell result paths that escape the experiment directory', async () => {
    runExperiment.mockResolvedValue(
      runtime([
        { cell_id: 'cell', testcase_id: 'task', result_path: '../escape' },
      ])
    );
    const errors: string[] = [];
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors[0]).toContain('escapes experiment directory');
  });

  it('applies regression comparison failure and partial status rules', async () => {
    loadExperiment.mockResolvedValue(
      loaded({ regression: { min_pass_rate: 1 } })
    );
    rulesFromExperimentPolicy.mockReturnValue([
      { kind: 'minimum' },
      { kind: 'comparison' },
    ]);
    compareExperimentAggregates
      .mockReturnValueOnce({ status: 'partial', findings: [] })
      .mockReturnValueOnce({ status: 'failed', findings: [] });
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stdout: jest.fn(),
      }
    );
    expect(process.exitCode).toBe(2);

    compareExperimentAggregates.mockReturnValue({
      status: 'partial',
      findings: [],
    });
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stdout: jest.fn(),
      }
    );
    expect(process.exitCode).toBe(3);
  });

  it('loads named baselines, handles missing baselines, and rethrows other errors', async () => {
    loadExperiment.mockResolvedValue(
      loaded({
        regression: { min_pass_rate: 1 },
        baseline: { name: 'approved' },
      })
    );
    rulesFromExperimentPolicy.mockReturnValue([{ kind: 'minimum' }]);
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stdout: jest.fn(),
      }
    );

    baselineRead.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stdout: jest.fn(),
      }
    );
    expect(process.exitCode).toBe(3);

    baselineRead.mockRejectedValueOnce(new Error('denied'));
    const errors: string[] = [];
    await experimentRunCommand(
      'experiment.yaml',
      {},
      {
        executor: { execute: jest.fn() },
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors[0]).toContain('denied');
  });

  it('resolves ID, explicit file, and explicit directory candidates for comparison', async () => {
    const output: string[] = [];
    access
      .mockRejectedValueOnce(new Error('not explicit'))
      .mockResolvedValueOnce(undefined);
    resultParse.mockReturnValue(experimentResult());
    await experimentCompareCommand(
      'experiment-1',
      { baseline: 'approved' },
      {
        cwd: 'project',
        stdout: (message) => output.push(message),
      }
    );

    access.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    stat.mockResolvedValueOnce({ isDirectory: () => false });
    await experimentCompareCommand(
      'candidate.json',
      { baseline: 'base.json' },
      {
        cwd: 'project',
        stdout: (message) => output.push(message),
      }
    );

    access.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    stat
      .mockResolvedValueOnce({ isDirectory: () => true })
      .mockResolvedValueOnce({ isDirectory: () => true });
    await experimentCompareCommand(
      'candidate-dir',
      { baseline: 'base-dir' },
      {
        cwd: 'project',
        stdout: (message) => output.push(message),
      }
    );
    expect(output.join('\n')).toContain('Comparison with');
  });

  it.each([
    ['failed', 2],
    ['partial', 3],
    ['passed', 0],
  ])('maps %s comparisons to exit code %i', async (status, code) => {
    access.mockResolvedValue(undefined);
    resultParse.mockReturnValue(experimentResult());
    compareExperimentAggregates.mockReturnValue({ status, findings: [] });
    await experimentCompareCommand(
      'candidate',
      { baseline: 'baseline' },
      {
        stdout: jest.fn(),
      }
    );
    expect(process.exitCode).toBe(code);
  });

  it('rejects invalid/missing candidates, malformed results, and absent policies', async () => {
    const errors: string[] = [];
    await experimentCompareCommand(
      'bad/id',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );

    access
      .mockRejectedValueOnce(new Error('not explicit'))
      .mockRejectedValueOnce(new Error('missing id'));
    await experimentCompareCommand(
      'experiment-1',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );

    access.mockResolvedValueOnce(undefined);
    readFile.mockResolvedValueOnce('not json');
    await experimentCompareCommand(
      'candidate.json',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );

    access.mockResolvedValue(undefined);
    resultParse.mockReturnValue(
      experimentResult({ effective_configuration: null })
    );
    await experimentCompareCommand(
      'candidate',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    resultParse.mockReturnValue(
      experimentResult({ effective_configuration: 'text' })
    );
    await experimentCompareCommand(
      'candidate',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    resultParse.mockReturnValue(experimentResult());
    resultSafeParse.mockReturnValue({ success: false });
    await experimentCompareCommand(
      'candidate',
      { baseline: 'baseline' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('approves result IDs and maps approval errors', async () => {
    access
      .mockRejectedValueOnce(new Error('not explicit'))
      .mockResolvedValueOnce(undefined);
    const output: string[] = [];
    await experimentApproveCommand(
      'experiment-1',
      { name: 'approved' },
      {
        stdout: (message) => output.push(message),
      }
    );
    expect(output[0]).toContain('Approved baseline');

    baselineApprove.mockRejectedValueOnce('approval failed');
    access.mockResolvedValueOnce(undefined);
    const errors: string[] = [];
    await experimentApproveCommand(
      'result.json',
      { name: 'approved' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors).toEqual(['approval failed']);
  });

  it.each(['json', 'junit', 'markdown'])(
    'renders %s reports',
    async (format) => {
      access.mockResolvedValueOnce(undefined);
      await experimentReportCommand(
        'result.json',
        { format },
        {
          stdout: jest.fn(),
        }
      );
    }
  );

  it('rejects unsupported report formats and maps report errors', async () => {
    const errors: string[] = [];
    await experimentReportCommand(
      'result',
      { format: 'xml' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    writeExperimentMarkdown.mockRejectedValueOnce(new Error('write failed'));
    access.mockResolvedValueOnce(undefined);
    await experimentReportCommand(
      'result.json',
      { format: 'markdown' },
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors).toHaveLength(2);
  });

  it('registers all experiment subcommands', () => {
    const actions: unknown[] = [];
    const chain = {
      command: jest.fn(() => chain),
      description: jest.fn(() => chain),
      argument: jest.fn(() => chain),
      option: jest.fn(() => chain),
      requiredOption: jest.fn(() => chain),
      action: jest.fn((callback) => {
        actions.push(callback);
        return chain;
      }),
    };
    registerExperimentCommand(chain as never);
    expect(actions).toHaveLength(6);
  });

  it('uses every command default dependency object and writer', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await experimentValidateCommand('experiment.yaml');
    await experimentPlanCommand('experiment.yaml', {});
    await experimentRunCommand('experiment.yaml', {});

    access.mockResolvedValue(undefined);
    resultParse.mockReturnValue(experimentResult());
    await experimentCompareCommand('candidate.json', {
      baseline: 'baseline.json',
    });
    await experimentApproveCommand('candidate.json', { name: 'approved' });
    await experimentReportCommand('candidate.json', { format: 'markdown' });

    loadExperiment.mockRejectedValueOnce(new Error('default writer failure'));
    await experimentPlanCommand('experiment.yaml', {});
    loadExperiment.mockRejectedValueOnce(new Error('run failure'));
    await experimentRunCommand('experiment.yaml', {});
    access.mockRejectedValue(new Error('missing'));
    await experimentCompareCommand('bad/id', { baseline: 'baseline' });
    await experimentApproveCommand('bad/id', { name: 'approved' });
    await experimentReportCommand('result', { format: 'xml' });
    expect(console.error).toHaveBeenCalled();
  });

  it('rejects object definitions that fail safe parsing', async () => {
    access.mockResolvedValue(undefined);
    resultParse.mockReturnValue(experimentResult());
    resultSafeParse.mockReturnValue({ success: false });
    const errors: string[] = [];
    await experimentCompareCommand(
      'candidate.json',
      {
        baseline: 'baseline.json',
      },
      {
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors[0]).toContain('regression policy');
  });

  it('wraps non-Error result parser failures', async () => {
    access.mockResolvedValue(undefined);
    resultParse.mockImplementationOnce(() => {
      throw 'schema failure';
    });
    const errors: string[] = [];
    await experimentCompareCommand(
      'candidate.json',
      { baseline: 'baseline.json' },
      { stderr: (message) => errors.push(message) }
    );
    expect(errors[0]).toContain('schema failure');
  });
});
