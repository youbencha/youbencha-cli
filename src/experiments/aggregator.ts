import type {
  ExperimentCellResult,
  ExperimentResult,
  MeasurementQuality,
} from '../schemas/experiment-result.schema.js';

export type AggregateQuality = MeasurementQuality | 'mixed';
type ExperimentAggregate = ExperimentResult['aggregates'][number];

export interface AggregateCellInput extends ExperimentCellResult {
  evaluator_passed?: number;
  evaluator_failed?: number;
}

export interface AggregateMetricTrace {
  sampleSize: number;
  value?: number;
  quality: AggregateQuality;
  qualityCounts: Record<MeasurementQuality, number>;
  sourceCellIds: string[];
  unavailableReason?: string;
}

export interface AggregateTrace {
  scope: ExperimentAggregate['scope'];
  testcaseId?: string;
  variantName?: string;
  cellIds: string[];
  metrics: Record<string, AggregateMetricTrace>;
}

export interface AggregationResult {
  aggregates: ExperimentAggregate[];
  traces: AggregateTrace[];
  warnings: string[];
}

const TERMINAL_RESULT_STATUSES = new Set(['passed', 'failed', 'partial']);

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function legacyUsageQuality(cell: AggregateCellInput): MeasurementQuality {
  return cell.usage_quality;
}

function qualityCounts(
  cells: readonly AggregateCellInput[],
  selector: (
    cell: AggregateCellInput
  ) => MeasurementQuality = legacyUsageQuality
): Record<MeasurementQuality, number> {
  const counts = { measured: 0, estimated: 0, unavailable: 0 };
  for (const cell of cells) {
    counts[selector(cell)] += 1;
  }
  return counts;
}

function combinedQuality(
  counts: Record<MeasurementQuality, number>
): AggregateQuality {
  const present = Object.values(counts).filter((count) => count > 0).length;
  if (present > 1) {
    return 'mixed';
  }
  if (counts.measured > 0) {
    return 'measured';
  }
  if (counts.estimated > 0) {
    return 'estimated';
  }
  return 'unavailable';
}

function traceMetric(
  cells: readonly AggregateCellInput[],
  sampleSize: number,
  value: number | undefined,
  quality: AggregateQuality,
  unavailableReason?: string,
  qualitySelector?: (cell: AggregateCellInput) => MeasurementQuality
): AggregateMetricTrace {
  return {
    sampleSize,
    ...(value === undefined ? {} : { value }),
    quality,
    qualityCounts: qualityCounts(cells, qualitySelector),
    sourceCellIds: cells.map((cell) => cell.cell_id).sort(compareText),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

function percentile95(sorted: readonly number[]): number {
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

function statistics(
  cells: readonly AggregateCellInput[],
  selector: (cell: AggregateCellInput) => number | undefined,
  prefix: string,
  quality: AggregateQuality = 'measured'
): Record<string, AggregateMetricTrace> {
  const contributing = cells.filter((cell) => selector(cell) !== undefined);
  const values = contributing
    .map((cell) => selector(cell) as number)
    .sort((left, right) => left - right);
  const n = values.length;
  if (n === 0) {
    const unavailable = traceMetric(
      [],
      0,
      undefined,
      'unavailable',
      `No ${prefix.replace(/_/g, ' ')} observations were available`
    );
    return {
      [`${prefix}_count`]: traceMetric([], 0, 0, 'measured'),
      [`${prefix}_min`]: unavailable,
      [`${prefix}_median`]: unavailable,
      [`${prefix}_mean`]: unavailable,
      [`${prefix}_p95`]: unavailable,
      [`${prefix}_max`]: unavailable,
      [`${prefix}_stddev`]: unavailable,
      [`${prefix}_range`]: unavailable,
    };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const middle = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const metric = (value: number): AggregateMetricTrace =>
    traceMetric(contributing, n, value, quality);

  return {
    [`${prefix}_count`]: traceMetric(contributing, n, n, quality),
    [`${prefix}_min`]: metric(values[0]),
    [`${prefix}_median`]: metric(median),
    [`${prefix}_mean`]: metric(mean),
    [`${prefix}_p95`]:
      n >= 20
        ? metric(percentile95(values))
        : traceMetric(
            contributing,
            n,
            undefined,
            'unavailable',
            'p95 requires at least 20 observations'
          ),
    [`${prefix}_max`]: metric(values[n - 1]),
    [`${prefix}_stddev`]: metric(Math.sqrt(variance)),
    [`${prefix}_range`]: metric(values[n - 1] - values[0]),
  };
}

function rateMetric(
  cells: readonly AggregateCellInput[],
  numerator: number,
  denominator: number,
  unavailableReason: string
): AggregateMetricTrace {
  return denominator === 0
    ? traceMetric([], 0, undefined, 'unavailable', unavailableReason)
    : traceMetric(cells, denominator, numerator / denominator, 'measured');
}

function totalMetric(
  cells: readonly AggregateCellInput[],
  selector: (cell: AggregateCellInput) => number | undefined,
  label: string,
  qualitySelector: (cell: AggregateCellInput) => MeasurementQuality
): AggregateMetricTrace {
  const contributing = cells.filter((cell) => selector(cell) !== undefined);
  const counts = qualityCounts(cells, qualitySelector);
  const quality = combinedQuality(counts);
  if (contributing.length === 0 || quality === 'unavailable') {
    return traceMetric(
      cells,
      0,
      undefined,
      'unavailable',
      `No ${label} measurements were available`
    );
  }
  const metric = traceMetric(
    contributing,
    contributing.length,
    contributing.reduce((sum, cell) => sum + (selector(cell) as number), 0),
    quality,
    quality === 'mixed'
      ? `${label} combines measured, estimated, or unavailable cells`
      : undefined,
    qualitySelector
  );
  return { ...metric, qualityCounts: counts };
}

function aggregateGroup(
  scope: ExperimentAggregate['scope'],
  cells: readonly AggregateCellInput[],
  testcaseId?: string,
  variantName?: string
): AggregateTrace {
  const sorted = [...cells].sort((left, right) =>
    compareText(left.cell_id, right.cell_id)
  );
  const completed = sorted.filter((cell) =>
    TERMINAL_RESULT_STATUSES.has(cell.status)
  );
  const passed = sorted.filter((cell) => cell.status === 'passed');
  const evaluatorPassed = sorted.reduce(
    (sum, cell) => sum + (cell.evaluator_passed ?? 0),
    0
  );
  const evaluatorFailed = sorted.reduce(
    (sum, cell) => sum + (cell.evaluator_failed ?? 0),
    0
  );
  const usageCounts = qualityCounts(sorted);

  return {
    scope,
    ...(testcaseId === undefined ? {} : { testcaseId }),
    ...(variantName === undefined ? {} : { variantName }),
    cellIds: sorted.map((cell) => cell.cell_id),
    metrics: {
      cell_count: traceMetric(sorted, sorted.length, sorted.length, 'measured'),
      completion_rate: rateMetric(
        sorted,
        completed.length,
        sorted.length,
        'The scope contains no required cells'
      ),
      overall_pass_rate: rateMetric(
        completed,
        passed.length,
        completed.length,
        'No cells produced comparable results'
      ),
      evaluator_pass_rate: rateMetric(
        sorted.filter(
          (cell) =>
            (cell.evaluator_passed ?? 0) + (cell.evaluator_failed ?? 0) > 0
        ),
        evaluatorPassed,
        evaluatorPassed + evaluatorFailed,
        'No evaluator pass/fail observations were available'
      ),
      ...statistics(sorted, (cell) => cell.duration_ms, 'duration_ms'),
      ...statistics(
        sorted,
        (cell) => cell.sandbox_runtime_ms,
        'sandbox_runtime_ms'
      ),
      token_total: totalMetric(
        sorted,
        (cell) => cell.token_count,
        'token',
        (cell) => cell.token_quality ?? cell.usage_quality
      ),
      cost_usd_total: totalMetric(
        sorted,
        (cell) => cell.cost_usd,
        'cost',
        (cell) => cell.cost_quality ?? cell.usage_quality
      ),
      sandbox_cost_usd_total: totalMetric(
        sorted,
        (cell) => cell.sandbox_cost_usd,
        'sandbox cost',
        (cell) => cell.sandbox_cost_quality ?? 'unavailable'
      ),
      usage_measured_count: traceMetric(
        sorted.filter((cell) => cell.usage_quality === 'measured'),
        usageCounts.measured,
        usageCounts.measured,
        'measured'
      ),
      usage_estimated_count: traceMetric(
        sorted.filter((cell) => cell.usage_quality === 'estimated'),
        usageCounts.estimated,
        usageCounts.estimated,
        'estimated'
      ),
      usage_unavailable_count: traceMetric(
        sorted.filter((cell) => cell.usage_quality === 'unavailable'),
        usageCounts.unavailable,
        usageCounts.unavailable,
        'unavailable'
      ),
    },
  };
}

function schemaQuality(metric: AggregateMetricTrace): MeasurementQuality {
  return metric.quality === 'mixed' ? 'estimated' : metric.quality;
}

function toSchemaAggregate(trace: AggregateTrace): ExperimentAggregate {
  return {
    scope: trace.scope,
    ...(trace.testcaseId === undefined
      ? {}
      : { testcase_id: trace.testcaseId }),
    ...(trace.variantName === undefined
      ? {}
      : { variant_name: trace.variantName }),
    metrics: Object.fromEntries(
      Object.entries(trace.metrics)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, metric]) => [
          name,
          {
            sample_size: metric.sampleSize,
            ...(metric.value === undefined ? {} : { value: metric.value }),
            quality: schemaQuality(metric),
            ...(metric.unavailableReason === undefined
              ? {}
              : { unavailable_reason: metric.unavailableReason }),
            source_cell_ids: metric.sourceCellIds,
            quality_counts: metric.qualityCounts,
          },
        ])
    ),
  };
}

function uniqueSorted(
  cells: readonly AggregateCellInput[],
  selector: (cell: AggregateCellInput) => string
): string[] {
  return [...new Set(cells.map(selector))].sort(compareText);
}

export function aggregateExperimentCells(
  input: readonly AggregateCellInput[]
): AggregationResult {
  const cells = [...input].sort((left, right) =>
    compareText(left.cell_id, right.cell_id)
  );
  const traces: AggregateTrace[] = [aggregateGroup('experiment', cells)];
  const testcases = uniqueSorted(cells, (cell) => cell.testcase_id);
  const variants = uniqueSorted(cells, (cell) => cell.variant_name);

  for (const testcaseId of testcases) {
    traces.push(
      aggregateGroup(
        'testcase',
        cells.filter((cell) => cell.testcase_id === testcaseId),
        testcaseId
      )
    );
  }
  for (const variantName of variants) {
    traces.push(
      aggregateGroup(
        'variant',
        cells.filter((cell) => cell.variant_name === variantName),
        undefined,
        variantName
      )
    );
  }
  for (const testcaseId of testcases) {
    for (const variantName of variants) {
      const pair = cells.filter(
        (cell) =>
          cell.testcase_id === testcaseId && cell.variant_name === variantName
      );
      if (pair.length > 0) {
        traces.push(
          aggregateGroup('testcase_variant', pair, testcaseId, variantName)
        );
      }
    }
  }

  const warnings = traces.flatMap((trace) =>
    Object.entries(trace.metrics)
      .filter(([, metric]) => metric.quality === 'mixed')
      .map(
        ([metric]) =>
          `${trace.scope}:${trace.testcaseId ?? '*'}:${trace.variantName ?? '*'} ${metric} has mixed measurement quality`
      )
  );
  return {
    aggregates: traces.map(toSchemaAggregate),
    traces,
    warnings,
  };
}
