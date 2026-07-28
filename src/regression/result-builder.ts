import * as fs from 'fs/promises';
import * as path from 'path';
import {
  experimentResultSchema,
  type ExperimentResult,
} from '../schemas/experiment-result.schema.js';
import { resultsBundleSchema } from '../schemas/result.schema.js';
import { youBenchaLogSchema } from '../schemas/youbenchalog.schema.js';
import { aggregateExperimentCells } from '../experiments/aggregator.js';
import { normalizeExperimentProvenance } from '../experiments/provenance.js';
import type { RunExperimentResult } from '../experiments/runner.js';
import { BaselineChannelStore } from '../baselines/channel-store.js';
import type { RegressionSuiteDefinition } from '../schemas/suite-v2.schema.js';
import {
  compareMappedTargets,
  type MappedRegressionRule,
} from './mapped-comparison.js';
import type { LoadedRegressionSuite } from './suite-loader.js';
import type { RegressionPlan } from './suite-planner.js';

type RegressionComparison =
  RegressionSuiteDefinition['regression']['comparisons'][number];
type RegressionRuleDefinition =
  RegressionSuiteDefinition['regression']['rules'][number];

export interface BuildRegressionResultOptions {
  suite: LoadedRegressionSuite;
  plan: RegressionPlan;
  runtime: RunExperimentResult;
  baselineRoot: string;
  baselineTrustedParent: string;
  against?: string;
}

function mappedRules(rule: RegressionRuleDefinition): MappedRegressionRule[] {
  const common = {
    id: rule.id,
    metric: rule.metric,
    scopes: rule.scopes,
    minimumSamples: rule.minimum_samples,
    insufficientDataBehavior: rule.insufficient_samples,
  } as const;
  return [
    ...(rule.minimum === undefined
      ? []
      : [
          {
            ...common,
            kind: 'minimum' as const,
            threshold: rule.minimum,
            thresholdType: 'absolute' as const,
          },
        ]),
    ...(rule.max_absolute_drop === undefined
      ? []
      : [
          {
            ...common,
            kind: 'maximum_decrease' as const,
            threshold: rule.max_absolute_drop,
            thresholdType: 'absolute' as const,
          },
        ]),
    ...(rule.max_relative_increase === undefined
      ? []
      : [
          {
            ...common,
            kind: 'maximum_increase' as const,
            threshold: rule.max_relative_increase,
            thresholdType: 'relative' as const,
          },
        ]),
  ];
}

async function readResult(file: string): Promise<ExperimentResult> {
  return experimentResultSchema.parse(
    JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  );
}

async function baselineForComparison(
  comparison: RegressionComparison,
  options: BuildRegressionResultOptions,
  currentAggregates: ExperimentResult['aggregates']
): Promise<{
  aggregates: ExperimentResult['aggregates'];
  target: string;
  digest?: string;
}> {
  if (comparison.baseline.source === 'current_run') {
    return {
      aggregates: currentAggregates,
      target: comparison.baseline.target,
    };
  }

  const reference =
    options.against ??
    (comparison.baseline.source === 'channel'
      ? comparison.baseline.channel
      : comparison.baseline.source === 'snapshot'
        ? comparison.baseline.digest
        : undefined);
  if (comparison.baseline.source === 'path' && options.against === undefined) {
    const result = await readResult(
      path.resolve(
        path.dirname(options.suite.sourceFile),
        comparison.baseline.path
      )
    );
    return {
      aggregates: result.aggregates,
      target: comparison.baseline.target,
    };
  }
  if (reference === undefined) {
    throw new Error(
      `Comparison "${comparison.id}" has no resolvable baseline reference`
    );
  }

  const explicit = path.resolve(
    path.dirname(options.suite.sourceFile),
    reference
  );
  try {
    const stat = await fs.stat(explicit);
    const result = await readResult(
      stat.isDirectory() ? path.join(explicit, 'results.json') : explicit
    );
    const target =
      'target' in comparison.baseline && comparison.baseline.target !== undefined
        ? comparison.baseline.target
        : comparison.candidate_target;
    return { aggregates: result.aggregates, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const resolved = await new BaselineChannelStore(options.baselineRoot, {
    trustedParentDirectory: options.baselineTrustedParent,
  }).resolve(reference);
  const target =
    'target' in comparison.baseline && comparison.baseline.target !== undefined
      ? comparison.baseline.target
      : (resolved.channel?.default_target ?? comparison.candidate_target);
  return {
    aggregates: resolved.snapshot.result.aggregates,
    target,
    digest: resolved.snapshot.digest,
  };
}

export async function buildRegressionResult(
  options: BuildRegressionResultOptions
): Promise<ExperimentResult> {
  const planned = new Map(
    options.plan.cells.map((cell) => [cell.cellId, cell])
  );
  const inputs = [];
  for (const cell of options.runtime.state.cells) {
    if (cell.result_path === undefined) continue;
    const cellPlan = planned.get(cell.cell_id);
    if (cellPlan === undefined) continue;
    const resultFile = path.resolve(
      options.runtime.experimentDirectory,
      cell.result_path
    );
    if (
      !resultFile.startsWith(
        `${path.resolve(options.runtime.experimentDirectory)}${path.sep}`
      )
    ) {
      throw new Error(`Cell result path escapes experiment directory`);
    }
    const result = resultsBundleSchema.parse(
      JSON.parse(await fs.readFile(resultFile, 'utf8')) as unknown
    );
    let log;
    try {
      log = youBenchaLogSchema.parse(
        JSON.parse(
          await fs.readFile(
            path.join(
              result.execution.environment.workspace_dir,
              'artifacts',
              result.artifacts.agent_log
            ),
            'utf8'
          )
        ) as unknown
      );
    } catch {
      log = undefined;
    }
    inputs.push({
      cellId: cell.cell_id,
      testcaseId: cell.testcase_id,
      configHash: cellPlan.configHash,
      config: cellPlan.config,
      result,
      log,
    });
  }
  const evaluatorCounts = new Map(
    inputs.map((input) => [
      input.cellId,
      {
        evaluator_passed: input.result.summary.passed,
        evaluator_failed: input.result.summary.failed,
      },
    ])
  );
  const aggregation = aggregateExperimentCells(
    options.runtime.state.cells.map((cell) => ({
      ...cell,
      ...evaluatorCounts.get(cell.cell_id),
    }))
  );
  const provenance = normalizeExperimentProvenance(inputs);
  const findings: ExperimentResult['comparisons'] = [];
  const warnings = [...aggregation.warnings, ...provenance.warnings];
  let comparisonStatus: 'passed' | 'failed' | 'partial' = 'passed';
  let baselineDigest: string | undefined;
  const selectedRules = options.suite.definition.regression.rules.filter(
    (rule) => options.plan.selection.ruleIds.includes(rule.id)
  );
  const selectedComparisons =
    options.suite.definition.regression.comparisons.filter((comparison) =>
      options.plan.selection.comparisonIds.includes(comparison.id)
    );

  for (const comparison of selectedComparisons) {
    try {
      const baseline = await baselineForComparison(
        comparison,
        options,
        aggregation.aggregates
      );
      baselineDigest ??= baseline.digest;
      const rules = selectedRules
        .filter(
          (rule) =>
            rule.comparisons === undefined ||
            rule.comparisons.includes(comparison.id)
        )
        .flatMap(mappedRules)
        .filter((rule) => rule.kind !== 'minimum');
      const result = compareMappedTargets({
        candidateAggregates: aggregation.aggregates,
        baselineAggregates: baseline.aggregates,
        mapping: {
          candidateTarget: comparison.candidate_target,
          baselineTarget: baseline.target,
        },
        rules,
      });
      findings.push(...result.findings);
      if (result.status === 'failed') comparisonStatus = 'failed';
      else if (
        result.status === 'partial' &&
        comparisonStatus === 'passed'
      ) {
        comparisonStatus = 'partial';
      }
    } catch (error) {
      comparisonStatus =
        comparisonStatus === 'failed' ? 'failed' : 'partial';
      warnings.push(
        `Comparison "${comparison.id}" is partial: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const absoluteRules = selectedRules
    .filter(
      (rule) =>
        rule.minimum !== undefined &&
        (rule.comparisons === undefined ||
          rule.comparisons.some((comparison) =>
            options.plan.selection.comparisonIds.includes(comparison)
          ))
    )
    .flatMap(mappedRules)
    .filter((rule) => rule.kind === 'minimum');
  if (absoluteRules.length > 0) {
    for (const target of options.plan.selection.targetIds) {
      const result = compareMappedTargets({
        candidateAggregates: aggregation.aggregates,
        baselineAggregates: aggregation.aggregates,
        mapping: { candidateTarget: target, baselineTarget: target },
        rules: absoluteRules,
      });
      findings.push(...result.findings);
      if (result.status === 'failed') comparisonStatus = 'failed';
      else if (
        result.status === 'partial' &&
        comparisonStatus === 'passed'
      ) {
        comparisonStatus = 'partial';
      }
    }
  }

  let finalStatus = options.runtime.finalStatus;
  let exitCode = options.runtime.exitCode;
  if (exitCode !== 1 && comparisonStatus === 'failed') {
    finalStatus = 'failed';
    exitCode = 2;
  } else if (exitCode === 0 && comparisonStatus === 'partial') {
    finalStatus = 'partial';
    exitCode = 3;
  }
  const completedAt = options.runtime.state.updated_at;
  return experimentResultSchema.parse({
    schema_version: '1.0.0',
    experiment_version: 2,
    experiment_id: options.runtime.experimentId,
    definition_hash: options.plan.definitionHash,
    started_at: options.runtime.state.started_at ?? completedAt,
    completed_at: completedAt,
    final_status: finalStatus,
    exit_code: exitCode,
    effective_configuration: options.plan.redactedEffectiveConfiguration,
    sources: provenance.sources,
    provenance: provenance.provenance,
    cells: options.runtime.state.cells,
    aggregates: aggregation.aggregates,
    ...(baselineDigest === undefined
      ? {}
      : {
          baseline: {
            name: options.against ?? 'configured',
            content_hash: baselineDigest,
          },
        }),
    comparisons: findings,
    artifacts: {
      json: 'results.json',
      markdown: 'report.md',
      junit: 'junit.xml',
    },
    warnings,
  });
}
