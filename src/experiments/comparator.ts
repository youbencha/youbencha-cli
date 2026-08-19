import type {
  ExperimentResult,
  MeasurementQuality,
} from '../schemas/experiment-result.schema.js';
import type { ExperimentDefinition } from '../schemas/experiment.schema.js';

export type ComparisonScope = ExperimentAggregate['scope'];
type ExperimentAggregate = ExperimentResult['aggregates'][number];
type ExperimentComparisonFinding = ExperimentResult['comparisons'][number];
export type ZeroBaselineBehavior = 'fail' | 'partial' | 'absolute_only';

export interface RegressionRule {
  metric: string;
  kind: 'minimum' | 'maximum_increase' | 'maximum_decrease';
  threshold: number;
  thresholdType: 'absolute' | 'relative';
  scopes?: ComparisonScope[];
  zeroBaselineBehavior?: ZeroBaselineBehavior;
  minimumQuality?: Exclude<MeasurementQuality, 'unavailable'>;
}

export interface ComparisonResult {
  status: 'passed' | 'failed' | 'partial';
  findings: ExperimentComparisonFinding[];
}

function scopeKey(aggregate: ExperimentAggregate): string {
  return [
    aggregate.scope,
    aggregate.testcase_id ?? '*',
    aggregate.variant_name ?? '*',
  ].join(':');
}

function aggregatesByScope(
  label: string,
  aggregates: readonly ExperimentAggregate[]
): Map<string, ExperimentAggregate> {
  const indexed = new Map<string, ExperimentAggregate>();
  for (const aggregate of aggregates) {
    const key = scopeKey(aggregate);
    if (indexed.has(key)) {
      throw new Error(`${label} contains duplicate aggregate scope ${key}`);
    }
    indexed.set(key, aggregate);
  }
  return indexed;
}

function findingStatus(
  candidate: number,
  baseline: number,
  rule: RegressionRule
): 'passed' | 'failed' | 'partial' {
  if (rule.kind === 'minimum') {
    return candidate >= rule.threshold ? 'passed' : 'failed';
  }
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

function qualityRank(quality: MeasurementQuality): number {
  return quality === 'measured' ? 2 : quality === 'estimated' ? 1 : 0;
}

function summarizeStatus(
  findings: readonly ExperimentComparisonFinding[]
): ComparisonResult['status'] {
  if (findings.some((finding) => finding.status === 'failed')) return 'failed';
  if (findings.some((finding) => finding.status === 'partial'))
    return 'partial';
  return 'passed';
}

export function compareExperimentAggregates(
  candidateAggregates: readonly ExperimentAggregate[],
  baselineAggregates: readonly ExperimentAggregate[],
  rules: readonly RegressionRule[]
): ComparisonResult {
  const candidate = aggregatesByScope('Candidate', candidateAggregates);
  const baseline = aggregatesByScope('Baseline', baselineAggregates);
  const keys = [...new Set([...candidate.keys(), ...baseline.keys()])].sort();
  const findings: ExperimentComparisonFinding[] = [];

  for (const rule of rules) {
    for (const key of keys) {
      const candidateAggregate = candidate.get(key);
      const baselineAggregate = baseline.get(key);
      const scope = candidateAggregate?.scope ?? baselineAggregate?.scope;
      if (rule.scopes !== undefined && !rule.scopes.includes(scope!)) {
        continue;
      }
      const candidateMetric = candidateAggregate?.metrics[rule.metric];
      const baselineMetric = baselineAggregate?.metrics[rule.metric];
      if (
        candidateAggregate === undefined ||
        baselineAggregate === undefined ||
        candidateMetric === undefined ||
        baselineMetric === undefined
      ) {
        findings.push({
          status: 'partial',
          metric: rule.metric,
          scope: key,
          threshold: rule.threshold,
          message: `Cannot compare ${rule.metric} at ${key}: candidate or baseline scope/metric is unmatched`,
        });
        continue;
      }
      const minimumQuality = rule.minimumQuality ?? 'estimated';
      if (
        candidateMetric.value === undefined ||
        baselineMetric.value === undefined ||
        qualityRank(candidateMetric.quality) < qualityRank(minimumQuality) ||
        qualityRank(baselineMetric.quality) < qualityRank(minimumQuality)
      ) {
        findings.push({
          status: 'partial',
          metric: rule.metric,
          scope: key,
          threshold: rule.threshold,
          candidate: candidateMetric.value,
          baseline: baselineMetric.value,
          message: `Cannot compare ${rule.metric} at ${key}: measurement is missing or below ${minimumQuality} quality`,
        });
        continue;
      }
      const status = findingStatus(
        candidateMetric.value,
        baselineMetric.value,
        rule
      );
      const thresholdDescription =
        rule.thresholdType === 'relative'
          ? `${rule.threshold * 100}% relative increase`
          : rule.kind === 'minimum'
            ? `minimum ${rule.threshold}`
            : `${rule.threshold} absolute ${rule.kind === 'maximum_decrease' ? 'decrease' : 'increase'}`;
      findings.push({
        status,
        metric: rule.metric,
        scope: key,
        threshold: rule.threshold,
        candidate: candidateMetric.value,
        baseline: baselineMetric.value,
        message: `${rule.metric} at ${key}: candidate ${candidateMetric.value}, baseline ${baselineMetric.value}, policy ${thresholdDescription} (${status})`,
      });
    }
  }
  return { status: summarizeStatus(findings), findings };
}

export function rulesFromExperimentPolicy(
  policy: NonNullable<ExperimentDefinition['regression']>,
  scopes: ComparisonScope[] = [
    'experiment',
    'testcase',
    'variant',
    'testcase_variant',
  ]
): RegressionRule[] {
  const rules: RegressionRule[] = [];
  if (policy.min_pass_rate !== undefined) {
    rules.push({
      metric: 'overall_pass_rate',
      kind: 'minimum',
      threshold: policy.min_pass_rate,
      thresholdType: 'absolute',
      scopes,
    });
  }
  if (policy.max_pass_rate_drop !== undefined) {
    rules.push({
      metric: 'overall_pass_rate',
      kind: 'maximum_decrease',
      threshold: policy.max_pass_rate_drop,
      thresholdType: 'absolute',
      scopes,
    });
  }
  if (policy.max_duration_increase_percent !== undefined) {
    rules.push({
      metric: 'duration_ms_mean',
      kind: 'maximum_increase',
      threshold: policy.max_duration_increase_percent / 100,
      thresholdType: 'relative',
      zeroBaselineBehavior: policy.zero_baseline_behavior,
      scopes,
    });
  }
  return rules;
}
