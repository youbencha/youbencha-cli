import { z } from 'zod';

export const measurementQualitySchema = z.enum([
  'measured',
  'estimated',
  'unavailable',
]);

export const experimentCellStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'partial',
  'infrastructure_failed',
  'cancelled',
]);

export const experimentFinalStatusSchema = z.enum([
  'passed',
  'failed',
  'partial',
  'infrastructure_failed',
]);

export const experimentAttemptSchema = z
  .object({
    attempt_id: z.string().min(1),
    attempt_number: z.number().int().positive(),
    status: experimentCellStatusSchema.exclude(['pending']),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
    duration_ms: z.number().nonnegative().optional(),
    result_path: z.string().optional(),
    terminal_reason: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status !== 'running' &&
      (value.completed_at === undefined || value.duration_ms === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal attempts require completed_at and duration_ms',
      });
    }
  });

export const experimentCellResultSchema = z
  .object({
    cell_id: z.string().regex(/^[a-f0-9]{64}$/),
    testcase_id: z.string().min(1),
    variant_name: z.string().min(1),
    repetition: z.number().int().nonnegative(),
    status: experimentCellStatusSchema,
    attempts: z.array(experimentAttemptSchema),
    result_path: z.string().optional(),
    terminal_reason: z.string().optional(),
    duration_ms: z.number().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    token_count: z.number().int().nonnegative().optional(),
    usage_quality: measurementQualitySchema.default('unavailable'),
    token_quality: measurementQualitySchema.optional(),
    cost_quality: measurementQualitySchema.optional(),
  })
  .strict();

export const aggregateMetricSchema = z
  .object({
    sample_size: z.number().int().nonnegative(),
    value: z.number().optional(),
    quality: measurementQualitySchema,
    unavailable_reason: z.string().optional(),
    source_cell_ids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
    quality_counts: z
      .object({
        measured: z.number().int().nonnegative(),
        estimated: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const experimentAggregateSchema = z
  .object({
    scope: z.enum(['experiment', 'testcase', 'variant', 'testcase_variant']),
    testcase_id: z.string().min(1).optional(),
    variant_name: z.string().min(1).optional(),
    metrics: z.record(aggregateMetricSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const requiresTestcase =
      value.scope === 'testcase' || value.scope === 'testcase_variant';
    const requiresVariant =
      value.scope === 'variant' || value.scope === 'testcase_variant';
    if (requiresTestcase !== (value.testcase_id !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testcase_id'],
        message: `${value.scope} scope ${requiresTestcase ? 'requires' : 'forbids'} testcase_id`,
      });
    }
    if (requiresVariant !== (value.variant_name !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variant_name'],
        message: `${value.scope} scope ${requiresVariant ? 'requires' : 'forbids'} variant_name`,
      });
    }
  });

export const experimentAggregatesSchema = z
  .array(experimentAggregateSchema)
  .superRefine((aggregates, context) => {
    const seen = new Set<string>();
    aggregates.forEach((aggregate, index) => {
      const key = [
        aggregate.scope,
        aggregate.testcase_id ?? '',
        aggregate.variant_name ?? '',
      ].join('\u0000');
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate aggregate scope tuple for ${aggregate.scope}`,
        });
      }
      seen.add(key);
    });
  });

export const experimentComparisonFindingSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'partial']),
    metric: z.string().min(1),
    scope: z.string().min(1),
    threshold: z.number().optional(),
    candidate: z.number().optional(),
    baseline: z.number().optional(),
    message: z.string().min(1),
  })
  .strict();

export const experimentResultSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    experiment_version: z.literal(1),
    experiment_id: z.string().min(1),
    definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime(),
    final_status: experimentFinalStatusSchema,
    exit_code: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    effective_configuration: z.unknown(),
    sources: z.array(
      z
        .object({
          testcase_id: z.string().min(1),
          config_hash: z.string().regex(/^[a-f0-9]{64}$/),
          commit_sha: z.string().optional(),
        })
        .strict()
    ),
    provenance: z
      .object({
        youbencha_version: z.string().min(1),
        agent_cli_versions: z.record(z.string()),
        requested_models: z.record(z.string().optional()),
        resolved_models: z.record(z.string().optional()),
        youbencha_versions: z.record(z.string()).optional(),
        cells: z
          .array(
            z
              .object({
                cell_id: z.string().regex(/^[a-f0-9]{64}$/),
                testcase_id: z.string().min(1),
                config_hash: z.string().regex(/^[a-f0-9]{64}$/),
                source_commit_sha: z.string().optional(),
                agent_type: z.string().min(1),
                agent_cli_version: z.string().optional(),
                requested_model: z.string().optional(),
                resolved_model: z.string().optional(),
                youbencha_version: z.string().min(1),
                effective_config: z.unknown(),
              })
              .strict()
          )
          .optional(),
      })
      .strict(),
    cells: z.array(experimentCellResultSchema),
    aggregates: experimentAggregatesSchema,
    baseline: z
      .object({
        name: z.string().min(1),
        content_hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    comparisons: z.array(experimentComparisonFindingSchema),
    artifacts: z
      .object({
        json: z.string().optional(),
        markdown: z.string().optional(),
        junit: z.string().optional(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

export const experimentStateSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    experiment_id: z.string().min(1),
    definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['pending', 'running', 'completed', 'cancelled']),
    started_at: z.string().datetime().optional(),
    updated_at: z.string().datetime(),
    cells: z.array(experimentCellResultSchema),
    budget: z
      .object({
        duration_ms_used: z.number().nonnegative(),
        cost_usd_used: z.number().nonnegative(),
        stop_reason: z.enum(['duration', 'cost', 'cancelled']).optional(),
      })
      .strict(),
  })
  .strict();

export type ExperimentResult = z.infer<typeof experimentResultSchema>;
export type ExperimentState = z.infer<typeof experimentStateSchema>;
export type ExperimentCellResult = z.infer<typeof experimentCellResultSchema>;
export type ExperimentCellStatus = z.infer<typeof experimentCellStatusSchema>;
export type ExperimentAttempt = z.infer<typeof experimentAttemptSchema>;
export type MeasurementQuality = z.infer<typeof measurementQualitySchema>;
