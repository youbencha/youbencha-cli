import { z } from 'zod';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmpty = z.string().trim().min(1).max(200);

export const baselineTargetMappingSchema = z
  .object({
    candidate_target: nonEmpty,
    baseline_target: nonEmpty.optional(),
  })
  .strict();

export const baselineChannelAuditSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    channel: nonEmpty,
    generation: z.number().int().positive(),
    old_digest: digestSchema.optional(),
    new_digest: digestSchema,
    old_target: nonEmpty.optional(),
    new_target: nonEmpty,
    actor: nonEmpty.optional(),
    context: nonEmpty.optional(),
    timestamp: z.string().datetime(),
    source_experiment: nonEmpty,
    target_mapping: baselineTargetMappingSchema,
    previous_audit_hash: digestSchema.optional(),
    audit_hash: digestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const initial = value.generation === 1;
    for (const [field, present] of [
      ['old_digest', value.old_digest !== undefined],
      ['old_target', value.old_target !== undefined],
      ['previous_audit_hash', value.previous_audit_hash !== undefined],
    ] as const) {
      if (initial === present) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: initial
            ? `${field} is forbidden for the initial channel generation`
            : `${field} is required after the initial channel generation`,
        });
      }
    }
  });

export type BaselineTargetMapping = z.infer<typeof baselineTargetMappingSchema>;
export type BaselineChannelAudit = z.infer<typeof baselineChannelAuditSchema>;
