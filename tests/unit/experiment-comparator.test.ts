import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import {
  compareExperimentAggregates,
  rulesFromExperimentPolicy,
  type RegressionRule,
} from '../../src/experiments/comparator.js';

type Aggregate = ExperimentResult['aggregates'][number];

function aggregate(
  value: number | undefined,
  overrides: Partial<Aggregate> = {}
): Aggregate {
  return {
    scope: 'experiment',
    metrics: {
      duration_ms_mean: {
        sample_size: value === undefined ? 0 : 2,
        ...(value === undefined ? {} : { value }),
        quality: value === undefined ? 'unavailable' : 'measured',
      },
      overall_pass_rate: {
        sample_size: value === undefined ? 0 : 2,
        ...(value === undefined ? {} : { value }),
        quality: value === undefined ? 'unavailable' : 'measured',
      },
    },
    ...overrides,
  };
}

describe('experiment comparison', () => {
  it('passes exact absolute and relative threshold boundaries', () => {
    const rules: RegressionRule[] = [
      {
        metric: 'duration_ms_mean',
        kind: 'maximum_increase',
        threshold: 10,
        thresholdType: 'absolute',
      },
      {
        metric: 'overall_pass_rate',
        kind: 'maximum_decrease',
        threshold: 0.1,
        thresholdType: 'absolute',
      },
    ];

    const result = compareExperimentAggregates(
      [aggregate(110)],
      [aggregate(100)],
      rules
    );
    expect(result.status).toBe('passed');
    expect(result.findings).toHaveLength(2);
  });

  it('fails values just beyond a configured threshold', () => {
    const result = compareExperimentAggregates(
      [aggregate(120.0001)],
      [aggregate(100)],
      [
        {
          metric: 'duration_ms_mean',
          kind: 'maximum_increase',
          threshold: 0.2,
          thresholdType: 'relative',
        },
      ]
    );

    expect(result.status).toBe('failed');
    expect(result.findings[0].message).toContain('experiment:*:*');
  });

  it.each([
    ['partial', 'partial'],
    ['fail', 'failed'],
    ['absolute_only', 'failed'],
  ] as const)(
    'applies %s zero-baseline semantics explicitly',
    (zeroBaselineBehavior, expected) => {
      const result = compareExperimentAggregates(
        [aggregate(5)],
        [aggregate(0)],
        [
          {
            metric: 'duration_ms_mean',
            kind: 'maximum_increase',
            threshold: 0.2,
            thresholdType: 'relative',
            zeroBaselineBehavior,
          },
        ]
      );
      expect(result.status).toBe(expected);
    }
  );

  it('marks unmatched scopes, missing metrics, and low-quality data partial', () => {
    const result = compareExperimentAggregates(
      [
        aggregate(1, {
          scope: 'variant',
          variant_name: 'candidate-only',
        }),
        {
          ...aggregate(undefined),
          scope: 'testcase',
          testcase_id: 'shared',
        },
      ],
      [
        aggregate(1, {
          scope: 'variant',
          variant_name: 'baseline-only',
        }),
        {
          ...aggregate(1),
          scope: 'testcase',
          testcase_id: 'shared',
        },
      ],
      [
        {
          metric: 'duration_ms_mean',
          kind: 'maximum_increase',
          threshold: 1,
          thresholdType: 'absolute',
        },
      ]
    );

    expect(result.status).toBe('partial');
    expect(result.findings).toHaveLength(3);
    expect(
      result.findings.every((finding) => finding.status === 'partial')
    ).toBe(true);
  });

  it('translates the public policy to rules for all scopes', () => {
    const rules = rulesFromExperimentPolicy({
      min_pass_rate: 0.8,
      max_pass_rate_drop: 0.05,
      max_duration_increase_percent: 20,
      zero_baseline_behavior: 'fail',
    });

    expect(rules).toHaveLength(3);
    expect(rules[1].kind).toBe('maximum_decrease');
    expect(rules[2]).toMatchObject({
      metric: 'duration_ms_mean',
      threshold: 0.2,
      thresholdType: 'relative',
      zeroBaselineBehavior: 'fail',
      scopes: ['experiment', 'testcase', 'variant', 'testcase_variant'],
    });
  });

  it.each([
    ['candidate', false],
    ['candidate reversed', true],
    ['baseline', false],
    ['baseline reversed', true],
  ])('rejects duplicate aggregate scopes in %s order', (label, reverse) => {
    const duplicates = [aggregate(100), aggregate(101)];
    if (reverse) duplicates.reverse();
    const candidate = label.startsWith('candidate')
      ? duplicates
      : [aggregate(100)];
    const baseline = label.startsWith('baseline')
      ? duplicates
      : [aggregate(100)];

    expect(() =>
      compareExperimentAggregates(candidate, baseline, [
        {
          metric: 'duration_ms_mean',
          kind: 'maximum_increase',
          threshold: 1,
          thresholdType: 'absolute',
        },
      ])
    ).toThrow(/duplicate aggregate scope experiment:\*:\*/i);
  });
});
