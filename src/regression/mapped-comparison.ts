import type { MeasurementQuality } from '../schemas/experiment-result.schema.js';
import {
  projectTargetAggregates,
  type LogicalTargetAggregate,
  type LogicalTargetScope,
} from './aggregate-projection.js';
import type { ExperimentResult } from '../schemas/experiment-result.schema.js';

type ExperimentAggregate = ExperimentResult['aggregates'][number];
type Finding = ExperimentResult['comparisons'][number];

export type InsufficientDataBehavior = 'partial' | 'fail';
export type ZeroBaselineBehavior = 'fail' | 'partial' | 'absolute_only';

export interface MappedRegressionRule {
  id?: string;
  metric: string;
  kind: 'minimum' | 'maximum_increase' | 'maximum_decrease';
  threshold: number;
  thresholdType: 'absolute' | 'relative';
  scopes?: LogicalTargetScope[];
  minimumSamples?: number;
  insufficientDataBehavior?: InsufficientDataBehavior;
  zeroBaselineBehavior?: ZeroBaselineBehavior;
  minimumQuality?: Exclude<MeasurementQuality, 'unavailable'>;
}

export interface TargetMapping {
  candidateTarget: string;
  baselineTarget: string;
}

export interface MappedComparisonInput {
  candidateAggregates: readonly ExperimentAggregate[];
  baselineAggregates: readonly ExperimentAggregate[];
  mapping: TargetMapping;
  rules: readonly MappedRegressionRule[];
}

export interface MappedComparisonResult {
  status: 'passed' | 'failed' | 'partial';
  mapping: TargetMapping;
  findings: Finding[];
}

function aggregateKey(aggregate: LogicalTargetAggregate): string {
  return aggregate.scope === 'target'
    ? 'target'
    : `testcase_target:${aggregate.testcase_id}`;
}

function indexProjection(
  label: string,
  aggregates: readonly LogicalTargetAggregate[]
): Map<string, LogicalTargetAggregate> {
  const indexed = new Map<string, LogicalTargetAggregate>();
  for (const aggregate of aggregates) {
    const key = aggregateKey(aggregate);
    if (indexed.has(key)) {
      throw new Error(`${label} contains duplicate projected aggregate ${key}`);
    }
    indexed.set(key, aggregate);
  }
  return indexed;
}

function qualityRank(quality: MeasurementQuality): number {
  return quality === 'measured' ? 2 : quality === 'estimated' ? 1 : 0;
}

function summarize(
  findings: readonly Finding[]
): MappedComparisonResult['status'] {
  if (findings.some((finding) => finding.status === 'failed')) return 'failed';
  if (findings.some((finding) => finding.status === 'partial'))
    return 'partial';
  return 'passed';
}

function insufficientFinding(
  rule: MappedRegressionRule,
  scope: string,
  message: string,
  candidate?: number,
  baseline?: number
): Finding {
  return {
    status:
      (rule.insufficientDataBehavior ?? 'partial') === 'fail'
        ? 'failed'
        : 'partial',
    metric: rule.metric,
    scope,
    threshold: rule.threshold,
    ...(candidate === undefined ? {} : { candidate }),
    ...(baseline === undefined ? {} : { baseline }),
    message,
  };
}

function evaluateRule(
  candidate: number,
  baseline: number | undefined,
  rule: MappedRegressionRule
): 'passed' | 'failed' | 'partial' {
  if (rule.kind === 'minimum') {
    return candidate >= rule.threshold ? 'passed' : 'failed';
  }
  if (baseline === undefined) return 'partial';

  const difference =
    rule.kind === 'maximum_decrease'
      ? baseline - candidate
      : candidate - baseline;
  if (rule.thresholdType === 'absolute') {
    return difference <= rule.threshold ? 'passed' : 'failed';
  }
  if (baseline === 0) {
    const behavior = rule.zeroBaselineBehavior ?? 'partial';
    if (behavior === 'fail') return 'failed';
    if (behavior === 'absolute_only') {
      return candidate <= rule.threshold ? 'passed' : 'failed';
    }
    return 'partial';
  }
  return difference / Math.abs(baseline) <= rule.threshold
    ? 'passed'
    : 'failed';
}

/**
 * Compares differently named targets through a target-only projection.
 * Minimum rules are absolute candidate gates; change rules require both sides.
 */
export function compareMappedTargets(
  input: MappedComparisonInput
): MappedComparisonResult {
  const candidate = indexProjection(
    'Candidate',
    projectTargetAggregates(
      input.candidateAggregates,
      input.mapping.candidateTarget
    )
  );
  const baseline = indexProjection(
    'Baseline',
    projectTargetAggregates(
      input.baselineAggregates,
      input.mapping.baselineTarget
    )
  );
  const findings: Finding[] = [];

  for (const rule of input.rules) {
    const keys = [
      ...new Set(
        rule.kind === 'minimum'
          ? candidate.keys()
          : [...candidate.keys(), ...baseline.keys()]
      ),
    ].sort((left, right) => left.localeCompare(right, 'en'));

    for (const key of keys) {
      const candidateAggregate = candidate.get(key);
      const baselineAggregate = baseline.get(key);
      const scope = candidateAggregate?.scope ?? baselineAggregate?.scope;
      if (
        scope === undefined ||
        (rule.scopes !== undefined && !rule.scopes.includes(scope))
      ) {
        continue;
      }

      const candidateMetric = candidateAggregate?.metrics[rule.metric];
      const baselineMetric = baselineAggregate?.metrics[rule.metric];
      const baselineRequired = rule.kind !== 'minimum';
      if (
        candidateAggregate === undefined ||
        candidateMetric === undefined ||
        (baselineRequired &&
          (baselineAggregate === undefined || baselineMetric === undefined))
      ) {
        findings.push(
          insufficientFinding(
            rule,
            key,
            `Cannot compare ${rule.metric} at ${key}: required candidate or baseline scope/metric is unmatched`,
            candidateMetric?.value,
            baselineMetric?.value
          )
        );
        continue;
      }

      const minimumQuality = rule.minimumQuality ?? 'estimated';
      if (
        candidateMetric.value === undefined ||
        qualityRank(candidateMetric.quality) < qualityRank(minimumQuality) ||
        (baselineRequired &&
          (baselineMetric?.value === undefined ||
            qualityRank(baselineMetric.quality) < qualityRank(minimumQuality)))
      ) {
        findings.push(
          insufficientFinding(
            rule,
            key,
            `Cannot compare ${rule.metric} at ${key}: measurement is missing or below ${minimumQuality} quality`,
            candidateMetric.value,
            baselineMetric?.value
          )
        );
        continue;
      }

      const minimumSamples = rule.minimumSamples ?? 1;
      if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
        throw new Error(
          `Regression rule "${rule.id ?? rule.metric}" minimumSamples must be a positive integer`
        );
      }
      if (
        candidateMetric.sample_size < minimumSamples ||
        (baselineRequired &&
          (baselineMetric?.sample_size ?? 0) < minimumSamples)
      ) {
        findings.push(
          insufficientFinding(
            rule,
            key,
            `Cannot compare ${rule.metric} at ${key}: minimum ${minimumSamples} samples required (candidate ${candidateMetric.sample_size}, baseline ${baselineMetric?.sample_size ?? 0})`,
            candidateMetric.value,
            baselineMetric?.value
          )
        );
        continue;
      }

      const status = evaluateRule(
        candidateMetric.value,
        baselineMetric?.value,
        rule
      );
      findings.push({
        status,
        metric: rule.metric,
        scope: key,
        threshold: rule.threshold,
        candidate: candidateMetric.value,
        ...(baselineMetric?.value === undefined
          ? {}
          : { baseline: baselineMetric.value }),
        message: `${rule.metric} at ${key}: candidate ${candidateMetric.value}${baselineMetric?.value === undefined ? '' : `, baseline ${baselineMetric.value}`} (${status})`,
      });
    }
  }

  return {
    status: summarize(findings),
    mapping: input.mapping,
    findings,
  };
}
