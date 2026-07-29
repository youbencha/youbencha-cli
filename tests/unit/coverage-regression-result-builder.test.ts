import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import {
  buildRegressionResult,
  loadRegressionSuite,
  planRegressionSuite,
} from '../../src/regression/index.js';
import { runExperiment } from '../../src/experiments/runner.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';
import type { RunExperimentResult } from '../../src/experiments/index.js';
import { BaselineSnapshotStore } from '../../src/baselines/snapshot-store.js';
import { BaselineChannelStore } from '../../src/baselines/channel-store.js';

const timestamp = '2026-07-29T12:00:00.000Z';

function bundle(workspace: string): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'task',
      description: 'fixture',
      config_file: 'task.yaml',
      config_hash: 'a'.repeat(64),
      repo: 'https://example.test/repo.git',
      branch: 'main',
      commit: 'abc123',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 100,
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
      total_evaluators: 1,
      passed: 1,
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

describe('regression result builder residual coverage', () => {
  let temporaryDirectory: string;
  let runtime: RunExperimentResult;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-result-builder-')
    );
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    runtime = await runExperiment({
      plan,
      resultsDirectory: path.join(temporaryDirectory, 'experiments'),
      retry: {
        max_attempts: 1,
        on: [],
        backoff_ms: 0,
        jitter: 'none',
      },
      executor: {
        execute: async (cell) => ({
          result: bundle(
            path.join(temporaryDirectory, 'missing-workspace', cell.cellId)
          ),
          resultPath: 'unused',
          usageQuality: 'unavailable',
        }),
      },
      now: (): Date => new Date(timestamp),
    });
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('builds current-run comparisons and absolute minimum gates', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    suite.definition.regression.rules.push({
      id: 'minimum-pass',
      metric: 'overall_pass_rate',
      scopes: ['target'],
      minimum: 1,
      comparisons: ['current-overlap'],
      minimum_samples: 1,
      insufficient_samples: 'partial',
    });
    suite.definition.regression.rules.push({
      id: 'all-threshold-forms',
      metric: 'overall_pass_rate',
      scopes: ['target'],
      max_relative_increase: 0,
      minimum_samples: 1,
      insufficient_samples: 'fail',
    });
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    plan.selection.ruleIds.push('minimum-pass', 'all-threshold-forms');
    const result = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(result.final_status).toBe('passed');
    expect(result.comparisons.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reads path, explicit file, and explicit directory baselines', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    const first = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    suite.sourceFile = path.join(temporaryDirectory, 'suite.yaml');
    const baselineFile = path.join(
      path.dirname(suite.sourceFile),
      'coverage-baseline-results.json'
    );
    const explicitFile = path.join(temporaryDirectory, 'baseline.json');
    const explicitDirectory = path.join(temporaryDirectory, 'baseline-dir');
    await fs.writeFile(baselineFile, JSON.stringify(first));
    await fs.writeFile(explicitFile, JSON.stringify(first));
    await fs.mkdir(explicitDirectory);
    await fs.writeFile(
      path.join(explicitDirectory, 'results.json'),
      JSON.stringify(first)
    );
    try {
      suite.definition.regression.comparisons[0].baseline = {
        source: 'path',
        path: './coverage-baseline-results.json',
        target: 'production',
      };
      await expect(
        buildRegressionResult({
          suite,
          plan,
          runtime,
          baselineRoot: path.join(temporaryDirectory, 'baselines'),
          baselineTrustedParent: temporaryDirectory,
        })
      ).resolves.toMatchObject({ final_status: 'passed' });
      await expect(
        buildRegressionResult({
          suite,
          plan,
          runtime,
          baselineRoot: path.join(temporaryDirectory, 'baselines'),
          baselineTrustedParent: temporaryDirectory,
          against: explicitFile,
        })
      ).resolves.toMatchObject({ final_status: 'passed' });
      await expect(
        buildRegressionResult({
          suite,
          plan,
          runtime,
          baselineRoot: path.join(temporaryDirectory, 'baselines'),
          baselineTrustedParent: temporaryDirectory,
          against: explicitDirectory,
        })
      ).resolves.toMatchObject({ final_status: 'passed' });
      suite.definition.regression.comparisons[0].baseline = {
        source: 'channel',
        channel: 'unused-because-against-is-explicit',
      };
      await expect(
        buildRegressionResult({
          suite,
          plan,
          runtime,
          baselineRoot: path.join(temporaryDirectory, 'baselines'),
          baselineTrustedParent: temporaryDirectory,
          against: explicitFile,
        })
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(baselineFile, { force: true });
    }
  });

  it('turns missing, invalid, and unresolvable comparisons into partial results', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    suite.definition.regression.comparisons[0].baseline = {
      source: 'channel',
      channel: 'missing',
    };
    const missing = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(missing).toMatchObject({ final_status: 'partial', exit_code: 3 });
    expect(missing.warnings.join(' ')).toContain('does not exist');

    const invalid = path.join(temporaryDirectory, 'invalid.json');
    await fs.writeFile(invalid, '{');
    const invalidResult = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
      against: invalid,
    });
    expect(invalidResult.final_status).toBe('partial');

    suite.definition.regression.comparisons[0].baseline = {
      source: 'snapshot',
      digest: undefined as unknown as string,
    };
    const unresolved = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(unresolved.final_status).toBe('partial');
    expect(unresolved.warnings.join(' ')).toContain('no resolvable baseline');
  });

  it('resolves channel baselines and records their digest', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    const configured = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'unused'),
      baselineTrustedParent: temporaryDirectory,
    });
    const baselineRoot = path.join(temporaryDirectory, 'baselines');
    const snapshots = new BaselineSnapshotStore(baselineRoot, {
      trustedParentDirectory: temporaryDirectory,
    });
    const snapshot = await snapshots.write(configured);
    const channels = new BaselineChannelStore(baselineRoot, {
      trustedParentDirectory: temporaryDirectory,
      snapshotStore: snapshots,
      now: (): Date => new Date(timestamp),
    });
    await channels.promote({
      channel: 'production',
      snapshotDigest: snapshot.digest,
      defaultTarget: 'production',
      sourceExperiment: configured.experiment_id,
      targetMapping: { candidateTarget: 'candidate' },
    });
    suite.definition.regression.comparisons[0].baseline = {
      source: 'channel',
      channel: 'production',
    };
    const result = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot,
      baselineTrustedParent: temporaryDirectory,
    });
    expect(result.baseline).toEqual({
      name: 'configured',
      content_hash: snapshot.digest,
    });

    suite.definition.regression.comparisons[0].baseline = {
      source: 'channel',
      channel: 'production',
      target: 'candidate',
    };
    await expect(
      buildRegressionResult({
        suite,
        plan,
        runtime,
        baselineRoot,
        baselineTrustedParent: temporaryDirectory,
      })
    ).resolves.toBeDefined();

    suite.definition.regression.comparisons[0].baseline = {
      source: 'snapshot',
      digest: snapshot.digest,
    };
    await expect(
      buildRegressionResult({
        suite,
        plan,
        runtime,
        baselineRoot,
        baselineTrustedParent: temporaryDirectory,
      })
    ).resolves.toBeDefined();
  });

  it('maps failed and partial comparison outcomes to regression exit codes', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    const comparisonFailedRuntime = structuredClone(runtime);
    for (const cell of comparisonFailedRuntime.state.cells) {
      if (cell.variant_name === 'candidate') cell.status = 'failed';
    }
    const comparisonFailed = await buildRegressionResult({
      suite,
      plan,
      runtime: comparisonFailedRuntime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(comparisonFailed).toMatchObject({
      final_status: 'failed',
      exit_code: 2,
    });
    suite.definition.regression.comparisons.push({
      id: 'missing-after-failure',
      candidate_target: 'candidate',
      baseline: { source: 'channel', channel: 'missing-after-failure' },
    });
    plan.selection.comparisonIds.push('missing-after-failure');
    const failedWithWarning = await buildRegressionResult({
      suite,
      plan,
      runtime: comparisonFailedRuntime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(failedWithWarning.final_status).toBe('failed');
    expect(failedWithWarning.warnings.join(' ')).toContain(
      'missing-after-failure'
    );

    suite.definition.regression.rules.push({
      id: 'fail-minimum',
      metric: 'overall_pass_rate',
      scopes: ['target'],
      minimum: 2,
      minimum_samples: 1,
      insufficient_samples: 'fail',
    });
    plan.selection.ruleIds.push('fail-minimum');
    const failed = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(failed).toMatchObject({ final_status: 'failed', exit_code: 2 });

    const comparisonPartialSuite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    comparisonPartialSuite.definition.regression.rules[0].minimum_samples = 100;
    const comparisonPartialPlan = planRegressionSuite(comparisonPartialSuite, {
      profile: 'overlap',
    });
    const comparisonPartial = await buildRegressionResult({
      suite: comparisonPartialSuite,
      plan: comparisonPartialPlan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(comparisonPartial).toMatchObject({
      final_status: 'partial',
      exit_code: 3,
    });

    const alreadyFailed = structuredClone(runtime);
    alreadyFailed.exitCode = 1;
    alreadyFailed.finalStatus = 'failed';
    const preserved = await buildRegressionResult({
      suite,
      plan,
      runtime: alreadyFailed,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(preserved.exit_code).toBe(1);

    const noStartedAt = structuredClone(runtime);
    noStartedAt.state.started_at = undefined;
    await expect(
      buildRegressionResult({
        suite,
        plan,
        runtime: noStartedAt,
        baselineRoot: path.join(temporaryDirectory, 'baselines'),
        baselineTrustedParent: temporaryDirectory,
      })
    ).resolves.toMatchObject({ started_at: timestamp });

    suite.definition.regression.rules = [
      {
        id: 'partial-minimum',
        metric: 'overall_pass_rate',
        scopes: ['target'],
        minimum: 0,
        minimum_samples: 100,
        insufficient_samples: 'partial',
      },
    ];
    plan.selection.comparisonIds = [];
    plan.selection.ruleIds = ['partial-minimum'];
    const partial = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(temporaryDirectory, 'baselines'),
      baselineTrustedParent: temporaryDirectory,
    });
    expect(partial).toMatchObject({ final_status: 'partial', exit_code: 3 });
  });

  it('rejects escaping result paths and ignores unknown or resultless cells', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    const escaped = structuredClone(runtime);
    escaped.state.cells[0].result_path = '../escape.json';
    await expect(
      buildRegressionResult({
        suite,
        plan,
        runtime: escaped,
        baselineRoot: path.join(temporaryDirectory, 'baselines'),
        baselineTrustedParent: temporaryDirectory,
      })
    ).rejects.toThrow('escapes experiment directory');

    const ignored = structuredClone(runtime);
    ignored.state.cells.push({
      ...ignored.state.cells[0],
      cell_id: 'c'.repeat(64),
      result_path: undefined,
    });
    ignored.state.cells.push({
      ...ignored.state.cells[0],
      cell_id: 'd'.repeat(64),
    });
    await expect(
      buildRegressionResult({
        suite,
        plan,
        runtime: ignored,
        baselineRoot: path.join(temporaryDirectory, 'baselines'),
        baselineTrustedParent: temporaryDirectory,
      })
    ).resolves.toBeDefined();
  });

  it('normalizes a non-Error comparison rejection', async () => {
    const suite = await loadRegressionSuite(
      path.resolve('examples/regression/suite.yaml'),
      { ...defaultConfig }
    );
    const plan = planRegressionSuite(suite, { profile: 'overlap' });
    suite.definition.regression.comparisons[0].baseline = {
      source: 'channel',
      channel: 'mocked',
    };
    const resolve = jest
      .spyOn(BaselineChannelStore.prototype, 'resolve')
      .mockRejectedValue('string failure');
    try {
      const result = await buildRegressionResult({
        suite,
        plan,
        runtime,
        baselineRoot: path.join(temporaryDirectory, 'baselines'),
        baselineTrustedParent: temporaryDirectory,
      });
      expect(result.warnings.join(' ')).toContain('string failure');
    } finally {
      resolve.mockRestore();
    }
  });
});
