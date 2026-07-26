import { z } from 'zod';
import { validatePromptSource } from './common.js';

export const CODEX_OUTPUT_LIMIT_MAX_BYTES = 16 * 1024 * 1024;

export const safeRelativePathSchema = z
  .string()
  .min(1, 'Prompt file path is required')
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.split(/[\\/]+/).includes('..'),
    'prompt_file must be a safe relative path without parent traversal'
  );

export const codexReasoningEffortSchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

export const codexCliConfigShape = {
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(50000, 'Prompt exceeds maximum length of 50000 characters')
    .optional(),
  prompt_file: safeRelativePathSchema.optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
  approval_policy: z.literal('never').default('never'),
  ephemeral: z.boolean().default(true),
  ignore_user_config: z.boolean().default(true),
  ignore_rules: z.boolean().default(false),
  profile: z.string().min(1).optional(),
  reasoning_effort: codexReasoningEffortSchema.optional(),
  search: z.boolean().default(false),
  output_limit_bytes: z
    .number()
    .int()
    .positive()
    .max(CODEX_OUTPUT_LIMIT_MAX_BYTES)
    .optional(),
};

export const codexCliConfigSchema = z
  .object(codexCliConfigShape)
  .strict()
  .superRefine(validatePromptSource);

export const codexCliAgentConfigSchema = z
  .object({
    type: z.literal('codex-cli'),
    agent_name: z
      .never({
        message:
          'codex-cli does not support agent_name; use config.profile for a Codex profile or put task-specific skill instructions in the prompt.',
      })
      .optional(),
    model: z.string().min(1).optional(),
    config: codexCliConfigSchema.optional(),
  })
  .strict();

export type CodexCliConfig = z.infer<typeof codexCliConfigSchema>;
