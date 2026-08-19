import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import { projectTargetAggregates } from '../../src/regression/aggregate-projection.js';
import {
  compareMappedTargets,
  type MappedRegressionRule,
} from '../../src/regression/mapped-comparison.js';

type Aggregate = ExperimentResult['aggregates'][number];

function metric(value: number, sampleSize = 3): Aggregate['metrics'][string] {
  return {
    sample_size: sampleSize,
    value,
    quality: 'measured' as const,
  };
}

function aggregate(
  scope: Aggregate['scope'],
  value: number,
  options: {
    testcase?: string;
    target?: string;
    sampleSize?: number;
  } = {}
): Aggregate {
  return {
    scope,
    ...(options.testcase === undefined
      ? {}
      : { testcase_id: options.testcase }),
    ...(options.target === undefined ? {} : { variant_name: options.target }),
    metrics: {
      overall_pass_rate: metric(value, options.sampleSize),
      duration_ms_mean: metric(value, options.sampleSize),
    },
  };
}

describe('mapped target aggregate projection', () => {
  it('projects only the selected target-specific scopes', () => {
    const projected = projectTargetAggregates(
      [
        aggregate('experiment', 0.1),
        aggregate('testcase', 0.2, { testcase: 'case-a' }),
        aggregate('variant', 0.8, { target: 'candidate' }),
        aggregate('variant', 0.9, { target: 'unrelated' }),
        aggregate('testcase_variant', 0.7, {
          testcase: 'case-a',
          target: 'candidate',
        }),
        aggregate('testcase_variant', 1, {
          testcase: 'case-a',
          target: 'unrelated',
        }),
      ],
      'candidate'
    );

    expect(projected).toEqual([
      {
        scope: 'target',
        target_id: 'candidate',
        metrics: expect.any(Object),
      },
      {
        scope: 'testcase_target',
        target_id: 'candidate',
        testcase_id: 'case-a',
        metrics: expect.any(Object),
      },
    ]);
  });

  it('compares differently named targets without including unrelated aggregates', () => {
    const result = compareMappedTargets({
      candidateAggregates: [
        aggregate('experiment', 0),
        aggregate('variant', 0.9, { target: 'replacement' }),
        aggregate('variant', 0, { target: 'unrelated-candidate' }),
        aggregate('testcase_variant', 0.8, {
          testcase: 'case-a',
          target: 'replacement',
        }),
      ],
      baselineAggregates: [
        aggregate('experiment', 1),
        aggregate('variant', 0.85, { target: 'retired-model' }),
        aggregate('variant', 1, { target: 'unrelated-baseline' }),
        aggregate('testcase_variant', 0.75, {
          testcase: 'case-a',
          target: 'retired-model',
        }),
      ],
      mapping: {
        candidateTarget: 'replacement',
        baselineTarget: 'retired-model',
      },
      rules: [
        {
          metric: 'overall_pass_rate',
          kind: 'maximum_decrease',
          threshold: 0,
          thresholdType: 'absolute',
          minimumSamples: 3,
        },
      ],
    });

    expect(result.status).toBe('passed');
    expect(result.findings.map((finding) => finding.scope)).toEqual([
      'target',
      'testcase_target:case-a',
    ]);
    expect(
      result.findings.some((finding) => finding.scope.includes('unrelated'))
    ).toBe(false);
  });

  it('uses recorded sample sizes and defaults insufficient data to partial', () => {
    const rules: MappedRegressionRule[] = [
      {
        metric: 'duration_ms_mean',
        kind: 'maximum_increase',
        threshold: 0.2,
        thresholdType: 'relative',
        minimumSamples: 3,
      },
    ];
    const result = compareMappedTargets({
      candidateAggregates: [
        aggregate('variant', 110, {
          target: 'candidate',
          sampleSize: 2,
        }),
      ],
      baselineAggregates: [
        aggregate('variant', 100, {
          target: 'baseline',
          sampleSize: 10,
        }),
      ],
      mapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'baseline',
      },
      rules,
    });

    expect(result.status).toBe('partial');
    expect(result.findings[0].message).toContain('candidate 2, baseline 10');
  });

  it('can fail closed on insufficient data', () => {
    const result = compareMappedTargets({
      candidateAggregates: [
        aggregate('variant', 110, {
          target: 'candidate',
          sampleSize: 2,
        }),
      ],
      baselineAggregates: [
        aggregate('variant', 100, {
          target: 'baseline',
          sampleSize: 2,
        }),
      ],
      mapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'baseline',
      },
      rules: [
        {
          metric: 'duration_ms_mean',
          kind: 'maximum_increase',
          threshold: 0.2,
          thresholdType: 'relative',
          minimumSamples: 3,
          insufficientDataBehavior: 'fail',
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.findings[0].status).toBe('failed');
  });

  it('checks only the candidate sample floor for an absolute minimum rule', () => {
    const result = compareMappedTargets({
      candidateAggregates: [
        aggregate('variant', 0.9, {
          target: 'candidate',
          sampleSize: 3,
        }),
      ],
      baselineAggregates: [
        aggregate('variant', 0.5, {
          target: 'baseline',
          sampleSize: 1,
        }),
      ],
      mapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'baseline',
      },
      rules: [
        {
          metric: 'overall_pass_rate',
          kind: 'minimum',
          threshold: 0.8,
          thresholdType: 'absolute',
          minimumSamples: 3,
        },
      ],
    });

    expect(result.status).toBe('passed');
    expect(result.findings[0].baseline).toBe(0.5);
  });

  it('marks a missing testcase on either side partial for relative rules', () => {
    const result = compareMappedTargets({
      candidateAggregates: [
        aggregate('testcase_variant', 1, {
          testcase: 'candidate-only',
          target: 'candidate',
        }),
      ],
      baselineAggregates: [
        aggregate('testcase_variant', 1, {
          testcase: 'baseline-only',
          target: 'baseline',
        }),
      ],
      mapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'baseline',
      },
      rules: [
        {
          metric: 'overall_pass_rate',
          kind: 'maximum_decrease',
          threshold: 0,
          thresholdType: 'absolute',
        },
      ],
    });

    expect(result.status).toBe('partial');
    expect(result.findings).toHaveLength(2);
  });
});
