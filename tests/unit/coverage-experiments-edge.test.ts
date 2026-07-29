import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { experimentDefinitionSchema } from '../../src/schemas/experiment.schema.js';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema.js';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import {
  loadExperiment,
  resolveVariantTestCaseConfig,
} from '../../src/experiments/loader.js';
import { aggregateExperimentCells } from '../../src/experiments/aggregator.js';
import { compareExperimentAggregates } from '../../src/experiments/comparator.js';
import { OrchestratorSingleRunExecutor } from '../../src/experiments/orchestrator-executor.js';
import { normalizeExperimentProvenance } from '../../src/experiments/provenance.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import type { PlannedExperimentCell } from '../../src/experiments/single-run-executor.js';

const timestamp = '2026-07-29T12:00:00.000Z';
const hash = 'a'.repeat(64);

function bundle(workspace: string): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'fixture',
      config_file: 'case.yaml',
      config_hash: hash,
      repo: 'https://example.test/repo.git',
      branch: 'main',
      commit: 'abc',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 1,
      youbencha_version: 'test',
      environment: {
        os: 'test',
        node_version: '20',
        workspace_dir: workspace,
      },
    },
    agent: {
      type: 'codex-cli',
      youbencha_log_path: 'agent.json',
      status: 'success',
      exit_code: 0,
    },
    evaluators: [],
    summary: {
      total_evaluators: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      overall_status: 'passed',
    },
    artifacts: {
      agent_log: 'agent.json',
      reports: [],
      evaluator_artifacts: [],
    },
  };
}

function aggregate(value: number): ExperimentResult['aggregates'][number] {
  return {
    scope: 'experiment',
    cell_count: 1,
    metrics: {
      score: {
        value,
        unit: 'ratio',
        sample_size: 1,
        quality: 'measured',
      },
    },
  };
}

describe('experiment residual edge coverage', () => {
  it('normalizes a non-Error experiment schema failure', async () => {
    const parse = jest
      .spyOn(experimentDefinitionSchema, 'parse')
      .mockImplementationOnce(() => {
        throw 'experiment parse';
      });
    try {
      await expect(
        loadExperiment('examples/experiment-basic.yaml', {
          ...defaultConfig,
        })
      ).rejects.toThrow('experiment parse');
    } finally {
      parse.mockRestore();
    }
  });

  it('normalizes a non-Error testcase resolution failure', async () => {
    const parse = jest
      .spyOn(testCaseConfigSchema, 'parse')
      .mockImplementationOnce(() => {
        throw 'testcase parse';
      });
    try {
      await expect(
        loadExperiment('examples/experiment-basic.yaml', {
          ...defaultConfig,
        })
      ).rejects.toThrow('testcase parse');
    } finally {
      parse.mockRestore();
    }
  });

  it('defaults missing evaluator observations during aggregation', () => {
    const aggregation = aggregateExperimentCells([
      {
        cell_id: 'cell',
        testcase_id: 'case',
        variant_name: 'target',
        repetition: 0,
        status: 'pending',
        attempts: [],
        usage_quality: 'unavailable',
      },
    ]);
    expect(
      aggregation.traces.find((trace) => trace.scope === 'experiment')?.metrics
        .evaluator_pass_rate.value
    ).toBeUndefined();
  });

  it('covers a failed minimum comparator and a filtered scope', () => {
    const minimum = compareExperimentAggregates(
      [aggregate(0)],
      [aggregate(1)],
      [
        {
          metric: 'score',
          kind: 'minimum',
          threshold: 1,
          thresholdType: 'absolute',
        },
      ]
    );
    expect(minimum.status).toBe('failed');
    const rules = [
      {
        metric: 'score',
        kind: 'minimum' as const,
        threshold: 1,
        thresholdType: 'absolute' as const,
      },
      {
        metric: 'score',
        kind: 'maximum_increase' as const,
        threshold: 0,
        thresholdType: 'absolute' as const,
      },
      {
        metric: 'score',
        kind: 'maximum_increase' as const,
        threshold: 1,
        thresholdType: 'relative' as const,
      },
    ];
    expect(
      compareExperimentAggregates([aggregate(2)], [aggregate(1)], rules).status
    ).toBe('failed');
    expect(
      compareExperimentAggregates(
        [aggregate(0.5)],
        [aggregate(0)],
        [
          {
            metric: 'score',
            kind: 'maximum_increase',
            threshold: 1,
            thresholdType: 'relative',
            zeroBaselineBehavior: 'absolute_only',
          },
        ]
      ).status
    ).toBe('passed');
    expect(
      compareExperimentAggregates(
        [aggregate(1)],
        [aggregate(0)],
        [
          {
            metric: 'score',
            kind: 'maximum_increase',
            threshold: 1,
            thresholdType: 'relative',
          },
        ]
      ).status
    ).toBe('partial');
    expect(
      compareExperimentAggregates(
        [aggregate(1)],
        [aggregate(1)],
        [
          {
            metric: 'score',
            kind: 'minimum',
            threshold: 0,
            thresholdType: 'absolute',
            scopes: ['variant'],
          },
        ]
      ).findings
    ).toEqual([]);

    const estimated = aggregate(1);
    estimated.metrics.score.quality = 'estimated';
    expect(
      compareExperimentAggregates(
        [estimated],
        [aggregate(1)],
        [
          {
            metric: 'score',
            kind: 'maximum_increase',
            threshold: 0,
            thresholdType: 'absolute',
            minimumQuality: 'estimated',
          },
        ]
      ).status
    ).toBe('passed');
    const unavailable = aggregate(1);
    unavailable.metrics.score.quality = 'unavailable';
    expect(
      compareExperimentAggregates(
        [unavailable],
        [aggregate(1)],
        [
          {
            metric: 'score',
            kind: 'maximum_increase',
            threshold: 0,
            thresholdType: 'absolute',
          },
        ]
      ).status
    ).toBe('partial');
  });

  it('falls back when an orchestrator result has no readable log', async () => {
    const result = bundle(path.join(os.tmpdir(), 'missing-workspace'));
    const executor = new OrchestratorSingleRunExecutor({
      configFiles: new Map([['case', 'case.yaml']]),
      orchestrator: {
        runEvaluation: async (): Promise<ResultsBundle> => result,
      },
    });
    const execution = await executor.execute(
      {
        cellId: 'cell',
        testcaseId: 'case',
        variantName: 'target',
        repetition: 0,
        configHash: hash,
        config: {},
      } as unknown as PlannedExperimentCell,
      {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
      }
    );
    expect(execution.usageQuality).toBe('unavailable');
    expect(
      () =>
        new OrchestratorSingleRunExecutor({
          configFiles: new Map(),
        })
    ).not.toThrow();
    await expect(
      executor.execute(
        {
          cellId: 'cell',
          testcaseId: 'case',
        } as PlannedExperimentCell,
        {
          experimentId: 'experiment',
          attemptId: 'attempt',
          attemptNumber: 1,
          signal: {
            aborted: true,
            reason: undefined,
          } as AbortSignal,
        }
      )
    ).rejects.toThrow('Experiment cancelled');

    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-log-without-cost-')
    );
    try {
      const artifacts = path.join(workspace, 'artifacts');
      await fs.mkdir(artifacts);
      await fs.writeFile(
        path.join(artifacts, 'agent.json'),
        JSON.stringify({
          version: '1.0.0',
          agent: { name: 'fake', version: '1', adapter_version: '1' },
          model: { name: 'model', provider: 'test', parameters: {} },
          execution: {
            started_at: timestamp,
            completed_at: timestamp,
            duration_ms: 0,
            exit_code: 0,
            status: 'success',
          },
          messages: [],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            measurement_source: 'measured',
          },
          errors: [],
          environment: {
            os: 'test',
            node_version: '20',
            youbencha_version: 'test',
            working_directory: workspace,
          },
        })
      );
      const noCost = bundle(workspace);
      const noCostExecutor = new OrchestratorSingleRunExecutor({
        configFiles: new Map([['case', 'case.yaml']]),
        orchestrator: {
          runEvaluation: async (): Promise<ResultsBundle> => noCost,
        },
      });
      await expect(
        noCostExecutor.execute(
          {
            cellId: 'cell',
            testcaseId: 'case',
          } as PlannedExperimentCell,
          {
            experimentId: 'experiment',
            attemptId: 'attempt',
            attemptNumber: 1,
          }
        )
      ).resolves.toMatchObject({
        costUsd: undefined,
        costQuality: 'unavailable',
      });
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('preserves malformed HTTP-looking config URLs in provenance', () => {
    const result = bundle('workspace');
    const normalized = normalizeExperimentProvenance([
      {
        cellId: 'cell',
        testcaseId: 'case',
        configHash: hash,
        config: {
          name: 'case',
          description: 'fixture',
          repo: 'https://example.test/repo.git',
          agent: {
            type: 'codex-cli',
            config: { endpoint: 'http://[' },
          },
          evaluators: [],
        } as never,
        result,
      },
    ]);
    expect(JSON.stringify(normalized)).toContain('http://[');
    result.execution.youbencha_version = ' ';
    result.test_case.commit = '';
    const unknown = normalizeExperimentProvenance([
      {
        cellId: 'unknown',
        testcaseId: 'case',
        configHash: hash,
        config: {
          name: 'case',
          description: 'fixture',
          repo: 'https://example.test/repo.git',
          agent: { type: 'codex-cli' },
          evaluators: [],
        } as never,
        result,
      },
    ]);
    expect(unknown.provenance.youbencha_version).toBe('unknown');
    expect(normalizeExperimentProvenance([]).provenance.youbencha_version).toBe(
      'unknown'
    );
    const committed = bundle('workspace');
    const uncommitted = bundle('workspace');
    uncommitted.test_case.commit = '';
    expect(
      normalizeExperimentProvenance([
        {
          cellId: 'z',
          testcaseId: 'case',
          configHash: hash,
          config: {
            name: 'case',
            description: 'fixture',
            repo: 'https://example.test/repo.git',
            agent: { type: 'codex-cli' },
            evaluators: [],
          } as never,
          result: uncommitted,
        },
        {
          cellId: 'a',
          testcaseId: 'case',
          configHash: hash,
          config: {
            name: 'case',
            description: 'fixture',
            repo: 'https://example.test/repo.git',
            agent: { type: 'codex-cli' },
            evaluators: [],
          } as never,
          result: committed,
        },
      ]).sources
    ).toHaveLength(2);
    expect(
      normalizeExperimentProvenance([
        {
          cellId: 'a',
          testcaseId: 'case',
          configHash: hash,
          config: {
            name: 'case',
            description: 'fixture',
            repo: 'https://example.test/repo.git',
            agent: { type: 'codex-cli' },
            evaluators: [],
          } as never,
          result: uncommitted,
        },
        {
          cellId: 'z',
          testcaseId: 'case',
          configHash: hash,
          config: {
            name: 'case',
            description: 'fixture',
            repo: 'https://example.test/repo.git',
            agent: { type: 'codex-cli' },
            evaluators: [],
          } as never,
          result: committed,
        },
      ]).sources
    ).toHaveLength(2);
  });

  it('uses the loader default global configuration branch', async () => {
    const loaded = await loadExperiment('examples/experiment-basic.yaml');
    expect(loaded.definition).toBeDefined();
  });

  it('merges absent and present testcase and variant adapter configs', () => {
    const testcase = {
      name: 'case',
      description: 'fixture',
      repo: 'https://example.test/repo.git',
      agent: { type: 'codex-cli' },
      evaluators: [{ name: 'git-diff' }],
    } as never;
    expect(
      resolveVariantTestCaseConfig(testcase, {
        name: 'without-config',
        agent: { type: 'codex-cli' },
      })
    ).toMatchObject({ agent: { config: undefined } });
    expect(
      resolveVariantTestCaseConfig(testcase, {
        name: 'with-config',
        agent: {
          type: 'codex-cli',
          config: { reasoning_effort: 'high' },
        },
      })
    ).toMatchObject({
      agent: { config: { reasoning_effort: 'high' } },
    });
  });
});
