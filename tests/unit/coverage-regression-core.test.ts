import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import {
  compareMappedTargets,
  compileRegressionTask,
  loadRegressionSuite,
  planRegressionSuite,
  projectTargetAggregates,
  resolveRegressionSelection,
  type LoadedRegressionSuite,
  type MappedRegressionRule,
} from '../../src/regression/index.js';

type Aggregate = ExperimentResult['aggregates'][number];

function metric(
  value: number | undefined,
  quality: 'measured' | 'estimated' | 'unavailable' = 'measured',
  sampleSize = 2
): Aggregate['metrics'][string] {
  return {
    value,
    unit: 'ratio' as const,
    sample_size: sampleSize,
    quality,
  };
}

function aggregate(
  target: string,
  value: number | undefined,
  options: {
    testcase?: string;
    metricName?: string;
    quality?: 'measured' | 'estimated' | 'unavailable';
    sampleSize?: number;
  } = {}
): Aggregate {
  return {
    scope: options.testcase === undefined ? 'variant' : 'testcase_variant',
    variant_name: target,
    ...(options.testcase === undefined
      ? {}
      : { testcase_id: options.testcase }),
    cell_count: 2,
    metrics: {
      [options.metricName ?? 'score']: metric(
        value,
        options.quality,
        options.sampleSize
      ),
    },
  };
}

describe('regression comparison residual coverage', () => {
  it('validates projection identity, sorting, filtering, and duplicates', () => {
    expect(() => projectTargetAggregates([], ' ')).toThrow('non-empty');
    const projected = projectTargetAggregates(
      [
        aggregate('other', 1),
        {
          ...aggregate('candidate', 1),
          scope: 'experiment',
        },
        aggregate('candidate', 2, { testcase: 'z' }),
        aggregate('candidate', 1),
        aggregate('candidate', 3, { testcase: 'a' }),
      ],
      'candidate'
    );
    expect(projected.map((item) => [item.scope, item.testcase_id])).toEqual([
      ['target', undefined],
      ['testcase_target', 'a'],
      ['testcase_target', 'z'],
    ]);
    expect(() =>
      projectTargetAggregates(
        [aggregate('candidate', 1), aggregate('candidate', 2)],
        'candidate'
      )
    ).toThrow('duplicate projected aggregate');
  });

  it('covers mapped minimum, absolute, relative, quality, and sample policies', () => {
    const candidate = [aggregate('candidate', 2)];
    const baseline = [aggregate('baseline', 1)];
    const rules: MappedRegressionRule[] = [
      {
        id: 'minimum-pass',
        metric: 'score',
        kind: 'minimum',
        threshold: 2,
        thresholdType: 'absolute',
      },
      {
        id: 'minimum-fail',
        metric: 'score',
        kind: 'minimum',
        threshold: 3,
        thresholdType: 'absolute',
      },
      {
        metric: 'score',
        kind: 'maximum_increase',
        threshold: 1,
        thresholdType: 'absolute',
      },
      {
        metric: 'score',
        kind: 'maximum_decrease',
        threshold: -2,
        thresholdType: 'absolute',
      },
      {
        metric: 'score',
        kind: 'maximum_increase',
        threshold: 0.5,
        thresholdType: 'relative',
      },
    ];
    const compared = compareMappedTargets({
      candidateAggregates: candidate,
      baselineAggregates: baseline,
      mapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'baseline',
      },
      rules,
    });
    expect(compared.status).toBe('failed');
    expect(compared.findings.map((finding) => finding.status)).toEqual([
      'passed',
      'failed',
      'passed',
      'failed',
      'failed',
    ]);
  });

  it('handles zero baselines and missing scopes, metrics, values, and quality', () => {
    const mapping = {
      candidateTarget: 'candidate',
      baselineTarget: 'baseline',
    };
    const relative = (
      zeroBaselineBehavior?: 'fail' | 'partial' | 'absolute_only',
      threshold = 1
    ): MappedRegressionRule => ({
      metric: 'score',
      kind: 'maximum_increase',
      threshold,
      thresholdType: 'relative',
      zeroBaselineBehavior,
    });
    const zeroInput = {
      candidateAggregates: [aggregate('candidate', 2)],
      baselineAggregates: [aggregate('baseline', 0)],
      mapping,
    };
    expect(
      compareMappedTargets({ ...zeroInput, rules: [relative('fail')] }).status
    ).toBe('failed');
    expect(
      compareMappedTargets({
        ...zeroInput,
        rules: [relative('absolute_only', 2)],
      }).status
    ).toBe('passed');
    expect(
      compareMappedTargets({
        ...zeroInput,
        rules: [relative('absolute_only', 1)],
      }).status
    ).toBe('failed');
    expect(
      compareMappedTargets({ ...zeroInput, rules: [relative()] }).status
    ).toBe('partial');

    const baseRule: MappedRegressionRule = {
      metric: 'score',
      kind: 'maximum_increase',
      threshold: 1,
      thresholdType: 'absolute',
    };
    const cases = [
      {
        candidateAggregates: [],
        baselineAggregates: [aggregate('baseline', 1)],
      },
      {
        candidateAggregates: [aggregate('candidate', 1)],
        baselineAggregates: [],
      },
      {
        candidateAggregates: [
          aggregate('candidate', 1, { metricName: 'other' }),
        ],
        baselineAggregates: [aggregate('baseline', 1)],
      },
      {
        candidateAggregates: [aggregate('candidate', undefined)],
        baselineAggregates: [aggregate('baseline', 1)],
      },
      {
        candidateAggregates: [
          aggregate('candidate', 1, { quality: 'estimated' }),
        ],
        baselineAggregates: [aggregate('baseline', 1)],
        rule: { ...baseRule, minimumQuality: 'measured' as const },
      },
      {
        candidateAggregates: [aggregate('candidate', 1)],
        baselineAggregates: [
          aggregate('baseline', 1, { quality: 'unavailable' }),
        ],
      },
      {
        candidateAggregates: [aggregate('candidate', 1, { sampleSize: 1 })],
        baselineAggregates: [aggregate('baseline', 1, { sampleSize: 1 })],
        rule: { ...baseRule, minimumSamples: 2 },
      },
    ];
    for (const item of cases) {
      const result = compareMappedTargets({
        candidateAggregates: item.candidateAggregates,
        baselineAggregates: item.baselineAggregates,
        mapping,
        rules: [item.rule ?? baseRule],
      });
      expect(result.status).toBe('partial');
    }
    expect(
      compareMappedTargets({
        candidateAggregates: [],
        baselineAggregates: [aggregate('baseline', 1)],
        mapping,
        rules: [{ ...baseRule, insufficientDataBehavior: 'fail' }],
      }).status
    ).toBe('failed');
  });

  it('validates samples, filters scopes, summarizes empty findings, and detects index duplicates', () => {
    const mapping = {
      candidateTarget: 'candidate',
      baselineTarget: 'baseline',
    };
    for (const minimumSamples of [0, 1.5]) {
      expect(() =>
        compareMappedTargets({
          candidateAggregates: [aggregate('candidate', 1)],
          baselineAggregates: [aggregate('baseline', 1)],
          mapping,
          rules: [
            {
              metric: 'score',
              kind: 'maximum_increase',
              threshold: 0,
              thresholdType: 'absolute',
              minimumSamples,
            },
          ],
        })
      ).toThrow('score');
    }
    expect(
      compareMappedTargets({
        candidateAggregates: [aggregate('candidate', 1)],
        baselineAggregates: [aggregate('baseline', 1)],
        mapping,
        rules: [
          {
            metric: 'score',
            kind: 'minimum',
            threshold: 0,
            thresholdType: 'absolute',
            scopes: ['testcase_target'],
          },
        ],
      })
    ).toMatchObject({ status: 'passed', findings: [] });
    expect(
      compareMappedTargets({
        candidateAggregates: [aggregate('candidate', 1, { sampleSize: 0 })],
        baselineAggregates: [],
        mapping,
        rules: [
          {
            metric: 'score',
            kind: 'minimum',
            threshold: 0,
            thresholdType: 'absolute',
          },
        ],
      }).findings[0].message
    ).toContain('baseline 0');
    expect(
      compareMappedTargets({
        candidateAggregates: [aggregate('candidate', 1)],
        baselineAggregates: [],
        mapping,
        rules: [
          {
            metric: 'score',
            kind: 'minimum',
            threshold: 0,
            thresholdType: 'absolute',
          },
        ],
      }).findings[0]
    ).toEqual(
      expect.objectContaining({
        status: 'passed',
        candidate: 1,
        message: expect.not.stringContaining('baseline'),
      })
    );

    const duplicate = [aggregate('candidate', 1), aggregate('candidate', 2)];
    expect(() =>
      compareMappedTargets({
        candidateAggregates: duplicate,
        baselineAggregates: [],
        mapping,
        rules: [],
      })
    ).toThrow('duplicate projected aggregate');
    expect(() =>
      compareMappedTargets({
        candidateAggregates: [],
        baselineAggregates: [
          aggregate('baseline', 1),
          aggregate('baseline', 2),
        ],
        mapping,
        rules: [],
      })
    ).toThrow('duplicate projected aggregate');
  });
});

describe('regression loading, selection, compilation, and planning residual coverage', () => {
  let temporaryDirectory: string;
  let suiteFile: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-regression-')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'prompt.md'),
      'Prompt from a file'
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'evaluator.yaml'),
      'name: git-diff'
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.yaml'),
      [
        'version: 2',
        'kind: task',
        'name: Task',
        'description: ${DESCRIPTION}',
        'repo: https://example.test/repo.git',
        'branch: main',
        'task:',
        '  prompt_file: ./prompt.md',
        'evaluators:',
        '  - file: ./evaluator.yaml',
        '  - name: git-diff',
        '    config: {strict: true}',
        'setup:',
        '  cacheable: [npm-ci, npm-install, pnpm-install, yarn-install, bun-install]',
        '  per_attempt:',
        '    - command: node',
        '      args: [setup.js]',
        '      env: {MODE: test}',
        '      timeout_ms: 10',
        '      working_dir: subdir',
      ].join('\n')
    );
    suiteFile = path.join(temporaryDirectory, 'suite.yaml');
    await fs.writeFile(
      suiteFile,
      [
        'version: 2',
        'name: suite',
        'suite:',
        '  tasks: [{id: task, file: ./task.yaml}]',
        '  repetitions: 1',
        'profiles:',
        '  all:',
        "    tasks: '*'",
        '    targets: [candidate, baseline]',
        '    repetitions: 1',
        '    comparisons: [current]',
        '    rules: [rule]',
        'targets:',
        '  - id: candidate',
        '    agent: {type: codex-cli, model: model, config: {reasoning_effort: high}}',
        "    harness: {exact_version: '1.0.0'}",
        '  - id: baseline',
        '    agent: {type: codex-cli, model: old}',
        "    harness: {exact_version: '1.0.0'}",
        'execution:',
        '  provider: {type: host-trusted}',
        'regression:',
        '  default_candidate_target: candidate',
        '  comparisons:',
        '    - id: current',
        '      candidate_target: candidate',
        '      baseline: {source: current_run, target: baseline}',
        '  rules:',
        '    - id: rule',
        '      metric: score',
        '      scopes: [target]',
        '      minimum: 0.5',
        '      max_absolute_drop: 0.1',
        '      max_relative_increase: 0.2',
        '      minimum_samples: 1',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function loaded(): Promise<LoadedRegressionSuite> {
    return loadRegressionSuite(suiteFile, {
      ...defaultConfig,
      variables: { DESCRIPTION: 'resolved' },
    });
  }

  it('substitutes variables and compiles all setup and evaluator forms', async () => {
    const suite = await loaded();
    const compiled = compileRegressionTask(
      suite.tasks[0],
      suite.definition.targets[0],
      suite.globalConfig
    );
    expect(compiled.config.description).toBe('resolved');
    expect(compiled.config.agent.config).toMatchObject({
      reasoning_effort: 'high',
      prompt: 'Prompt from a file',
    });
    expect(compiled.config.pre_execution).toHaveLength(6);
    expect(compiled.config.evaluators).toHaveLength(2);
    expect(planRegressionSuite(suite, { profile: 'all' }).cells).toHaveLength(
      2
    );
  });

  it('covers selection defaults, errors, narrowing, and automatic comparison filtering', async () => {
    const suite = await loaded();
    expect(resolveRegressionSelection(suite).targetIds).toEqual(['candidate']);
    expect(
      resolveRegressionSelection(suite, {
        targetIds: ['candidate', 'baseline'],
      }).comparisonIds
    ).toEqual(['current']);
    expect(() =>
      resolveRegressionSelection(suite, { profile: 'missing' })
    ).toThrow('Unknown regression profile');
    expect(() =>
      resolveRegressionSelection(suite, { caseIds: ['missing'] })
    ).toThrow('broaden profile');
    expect(() =>
      resolveRegressionSelection(suite, {
        targetIds: ['missing', 'also-missing'],
      })
    ).toThrow('Unknown targets');
    expect(() =>
      resolveRegressionSelection(suite, { targetIds: ['missing'] })
    ).toThrow('Unknown target: missing');
    expect(() => resolveRegressionSelection(suite, { caseIds: [] })).toThrow(
      'Case selection is empty'
    );
    expect(() => resolveRegressionSelection(suite, { targetIds: [] })).toThrow(
      'Target selection is empty'
    );
    for (const repetitions of [0, 1.5]) {
      expect(() => resolveRegressionSelection(suite, { repetitions })).toThrow(
        'positive integer'
      );
    }
    expect(() =>
      resolveRegressionSelection(suite, {
        profile: 'all',
        targetIds: ['candidate'],
      })
    ).toThrow('requires selected baseline target');
    expect(() =>
      resolveRegressionSelection(suite, {
        profile: 'all',
        targetIds: ['baseline'],
      })
    ).toThrow('requires selected candidate target');
    expect(() =>
      resolveRegressionSelection(suite, {
        profile: 'all',
        targetIds: ['missing'],
      })
    ).toThrow('broaden profile');
  });

  it('handles missing loaded tasks, optional budgets, and absent defaults', async () => {
    const suite = await loaded();
    const missingTask = { ...suite, tasks: [] };
    expect(() => planRegressionSuite(missingTask)).toThrow(
      'Loaded task "task" is missing'
    );

    const noDefault = structuredClone(suite);
    noDefault.definition.regression.default_candidate_target = undefined;
    expect(() => resolveRegressionSelection(noDefault)).toThrow(
      'At least one target'
    );
    expect(
      resolveRegressionSelection(noDefault, { targetIds: ['candidate'] })
        .targetIds
    ).toEqual(['candidate']);

    const withBudget = structuredClone(suite);
    withBudget.definition.budget = {
      max_duration_minutes: 1,
      max_model_cost_usd: 2,
      max_sandbox_runtime_minutes: 3,
    };
    expect(planRegressionSuite(withBudget).budget).toEqual({
      max_duration_minutes: 1,
      max_cost_usd: 2,
      max_sandbox_runtime_minutes: 3,
    });
  });

  it('reports suite, task, and unresolved-variable failures with context', async () => {
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.yaml'),
      'version: 2'
    );
    await expect(
      loadRegressionSuite(suiteFile, {
        ...defaultConfig,
        variables: { DESCRIPTION: 'resolved' },
      })
    ).rejects.toThrow('task "task"');

    await fs.writeFile(suiteFile, 'version: 2\nname: bad');
    await expect(
      loadRegressionSuite(suiteFile, { ...defaultConfig })
    ).rejects.toThrow('invalid version 2 suite definition');

    await fs.writeFile(suiteFile, '${ONE}\n${TWO}');
    await expect(
      loadRegressionSuite(suiteFile, { ...defaultConfig })
    ).rejects.toThrow('unresolved configuration variables');

    await fs.rm(suiteFile);
    await expect(
      loadRegressionSuite(suiteFile, { ...defaultConfig })
    ).rejects.toThrow(suiteFile);
  });

  it('uses an empty variable map by default and reports one nested unresolved value', async () => {
    await expect(
      loadRegressionSuite(suiteFile, {
        ...defaultConfig,
        variables: undefined,
      })
    ).rejects.toThrow('unresolved configuration variable:');
    await fs.writeFile(
      suiteFile,
      [
        'version: 2',
        'name: ${ONLY_ONE}',
        'suite: {tasks: []}',
        'targets: []',
        'execution: {provider: {type: host-trusted}}',
        'regression: {}',
      ].join('\n')
    );
    await expect(
      loadRegressionSuite(suiteFile, { ...defaultConfig })
    ).rejects.toThrow('name: ${ONLY_ONE}');
  });
});
