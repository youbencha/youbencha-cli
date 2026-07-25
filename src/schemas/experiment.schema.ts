import { z } from 'zod';
import { agentConfigSchema } from './testcase.schema.js';

const nonEmptyName = z.string().trim().min(1).max(200);

export const experimentTestCaseSchema = z
  .object({
    id: nonEmptyName,
    file: z.string().trim().min(1),
  })
  .strict();

export const experimentVariantSchema = z
  .object({
    name: nonEmptyName,
    agent: agentConfigSchema,
  })
  .strict();

export const retryReasonSchema = z.enum(['infrastructure_failure', 'timeout']);

export const experimentDefinitionSchema = z
  .object({
    version: z.literal(1),
    name: nonEmptyName,
    testcases: z.array(experimentTestCaseSchema).min(1),
    variants: z.array(experimentVariantSchema).min(1),
    repetitions: z.number().int().min(1).default(1),
    execution: z
      .object({
        max_concurrent: z.number().int().min(1).default(1),
        retry: z
          .object({
            max_attempts: z.number().int().min(1).default(1),
            on: z.array(retryReasonSchema).default([]),
            backoff_ms: z.number().int().nonnegative().default(0),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    budget: z
      .object({
        max_duration_minutes: z.number().positive().optional(),
        max_cost_usd: z.number().nonnegative().optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.max_duration_minutes !== undefined ||
          value.max_cost_usd !== undefined,
        'At least one experiment budget must be configured'
      )
      .optional(),
    baseline: z
      .object({
        name: nonEmptyName,
      })
      .strict()
      .optional(),
    regression: z
      .object({
        min_pass_rate: z.number().min(0).max(1).optional(),
        max_pass_rate_drop: z.number().min(0).max(1).optional(),
        max_duration_increase_percent: z.number().nonnegative().optional(),
        zero_baseline_behavior: z
          .enum(['fail', 'partial', 'absolute_only'])
          .default('partial'),
      })
      .strict()
      .refine(
        (value) =>
          value.min_pass_rate !== undefined ||
          value.max_pass_rate_drop !== undefined ||
          value.max_duration_increase_percent !== undefined,
        'At least one regression threshold must be configured'
      )
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const testcaseIds = new Set<string>();
    value.testcases.forEach((testcase, index) => {
      if (testcaseIds.has(testcase.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate test case ID "${testcase.id}"`,
          path: ['testcases', index, 'id'],
        });
      }
      testcaseIds.add(testcase.id);
    });

    const variantNames = new Set<string>();
    value.variants.forEach((variant, index) => {
      if (variantNames.has(variant.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate variant name "${variant.name}"`,
          path: ['variants', index, 'name'],
        });
      }
      variantNames.add(variant.name);
    });
  });

export type ExperimentDefinition = z.infer<typeof experimentDefinitionSchema>;
export type ExperimentTestCase = z.infer<typeof experimentTestCaseSchema>;
export type ExperimentVariant = z.infer<typeof experimentVariantSchema>;
export type RetryReason = z.infer<typeof retryReasonSchema>;
