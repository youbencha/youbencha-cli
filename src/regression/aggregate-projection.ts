import type { ExperimentResult } from '../schemas/experiment-result.schema.js';

type ExperimentAggregate = ExperimentResult['aggregates'][number];
type AggregateMetric = ExperimentAggregate['metrics'][string];

export type LogicalTargetScope = 'target' | 'testcase_target';

export interface LogicalTargetAggregate {
  scope: LogicalTargetScope;
  target_id: string;
  testcase_id?: string;
  metrics: Record<string, AggregateMetric>;
}

function projectionKey(aggregate: LogicalTargetAggregate): string {
  return [aggregate.scope, aggregate.testcase_id ?? '*'].join(':');
}

/**
 * Builds the only safe aggregate projection for a mapped target comparison.
 *
 * Experiment-wide and testcase-only aggregates are deliberately excluded:
 * they can contain cells from targets other than the one being compared.
 */
export function projectTargetAggregates(
  aggregates: readonly ExperimentAggregate[],
  targetId: string
): LogicalTargetAggregate[] {
  if (targetId.trim() === '') {
    throw new Error('A non-empty target ID is required for projection');
  }

  const projected: LogicalTargetAggregate[] = [];
  const keys = new Set<string>();

  for (const aggregate of aggregates) {
    if (aggregate.variant_name !== targetId) continue;
    if (
      aggregate.scope !== 'variant' &&
      aggregate.scope !== 'testcase_variant'
    ) {
      continue;
    }

    const projection: LogicalTargetAggregate =
      aggregate.scope === 'variant'
        ? {
            scope: 'target',
            target_id: targetId,
            metrics: aggregate.metrics,
          }
        : {
            scope: 'testcase_target',
            target_id: targetId,
            testcase_id: aggregate.testcase_id,
            metrics: aggregate.metrics,
          };
    const key = projectionKey(projection);
    if (keys.has(key)) {
      throw new Error(
        `Target "${targetId}" contains duplicate projected aggregate ${key}`
      );
    }
    keys.add(key);
    projected.push(projection);
  }

  return projected.sort((left, right) =>
    projectionKey(left).localeCompare(projectionKey(right), 'en')
  );
}
