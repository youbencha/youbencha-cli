import {
  aggregateExperimentCells,
  type AggregateCellInput,
} from '../../src/experiments/aggregator.js';

function cell(
  index: number,
  overrides: Partial<AggregateCellInput> = {}
): AggregateCellInput {
  return {
    cell_id: index.toString(16).padStart(64, '0'),
    testcase_id: index % 2 === 0 ? 'task-b' : 'task-a',
    variant_name: index % 3 === 0 ? 'variant-b' : 'variant-a',
    repetition: index,
    status: 'passed',
    attempts: [],
    duration_ms: index + 1,
    cost_usd: index / 10,
    token_count: index * 10,
    usage_quality: 'measured',
    evaluator_passed: 1,
    evaluator_failed: 0,
    ...overrides,
  };
}

describe('experiment aggregation', () => {
  it('is independent of completion order at every supported scope', () => {
    const cells = Array.from({ length: 8 }, (_, index) => cell(index));
    const forward = aggregateExperimentCells(cells);
    const reverse = aggregateExperimentCells([...cells].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.aggregates.map((aggregate) => aggregate.scope)).toEqual([
      'experiment',
      'testcase',
      'testcase',
      'variant',
      'variant',
      'testcase_variant',
      'testcase_variant',
      'testcase_variant',
      'testcase_variant',
    ]);
  });

  it('computes rates, population dispersion, and suppresses small-sample p95', () => {
    const result = aggregateExperimentCells([
      cell(0, { status: 'passed', duration_ms: 10 }),
      cell(1, {
        status: 'failed',
        duration_ms: 20,
        evaluator_passed: 0,
        evaluator_failed: 1,
      }),
      cell(2, {
        status: 'cancelled',
        duration_ms: undefined,
        evaluator_passed: undefined,
      }),
    ]);
    const metrics = result.traces[0].metrics;

    expect(metrics.completion_rate.value).toBe(2 / 3);
    expect(metrics.overall_pass_rate.value).toBe(0.5);
    expect(metrics.evaluator_pass_rate.value).toBe(0.5);
    expect(metrics.duration_ms_count.value).toBe(2);
    expect(metrics.duration_ms_min.value).toBe(10);
    expect(metrics.duration_ms_median.value).toBe(15);
    expect(metrics.duration_ms_mean.value).toBe(15);
    expect(metrics.duration_ms_max.value).toBe(20);
    expect(metrics.duration_ms_stddev.value).toBe(5);
    expect(metrics.duration_ms_range.value).toBe(10);
    expect(metrics.duration_ms_p95.value).toBeUndefined();
    expect(metrics.duration_ms_p95.unavailableReason).toContain('20');
  });

  it('uses nearest-rank p95 once at least twenty observations exist', () => {
    const result = aggregateExperimentCells(
      Array.from({ length: 20 }, (_, index) =>
        cell(index, { duration_ms: index + 1 })
      )
    );

    expect(result.traces[0].metrics.duration_ms_p95.value).toBe(19);
  });

  it('retains cell-level usage trace and never labels mixed totals measured', () => {
    const result = aggregateExperimentCells([
      cell(1, {
        token_count: 100,
        cost_usd: 1,
        usage_quality: 'measured',
      }),
      cell(2, {
        token_count: 50,
        cost_usd: 0.5,
        usage_quality: 'estimated',
      }),
      cell(3, {
        token_count: undefined,
        cost_usd: undefined,
        usage_quality: 'unavailable',
      }),
    ]);
    const trace = result.traces[0].metrics.token_total;
    const persisted = result.aggregates[0].metrics.token_total;

    expect(trace.value).toBe(150);
    expect(trace.quality).toBe('mixed');
    expect(trace.qualityCounts).toEqual({
      measured: 1,
      estimated: 1,
      unavailable: 1,
    });
    expect(trace.sourceCellIds).toHaveLength(2);
    expect(persisted.quality).toBe('estimated');
    expect(persisted.unavailable_reason).toContain('combines');
    expect(persisted.source_cell_ids).toEqual(trace.sourceCellIds);
    expect(persisted.quality_counts).toEqual(trace.qualityCounts);
    expect(result.warnings).toContain(
      'experiment:*:* token_total has mixed measurement quality'
    );
  });

  it('tracks token and cost measurement quality independently', () => {
    const result = aggregateExperimentCells([
      cell(1, {
        token_count: 100,
        cost_usd: 1,
        usage_quality: 'estimated',
        token_quality: 'measured',
        cost_quality: 'estimated',
      }),
    ]);
    const metrics = result.aggregates[0].metrics;

    expect(metrics.token_total.quality).toBe('measured');
    expect(metrics.token_total.quality_counts).toEqual({
      measured: 1,
      estimated: 0,
      unavailable: 0,
    });
    expect(metrics.cost_usd_total.quality).toBe('estimated');
    expect(metrics.cost_usd_total.quality_counts).toEqual({
      measured: 0,
      estimated: 1,
      unavailable: 0,
    });
  });
});
