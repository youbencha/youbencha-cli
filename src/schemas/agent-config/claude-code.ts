import { z } from 'zod';
import {
  agentIdentityShape,
  promptConfigShape,
  validatePromptSource,
} from './common.js';

const toolRulesSchema = z.array(z.string().min(1)).min(1);

export const claudeCodeConfigShape = {
  ...promptConfigShape,
  system_prompt: z.string().min(1).optional(),
  append_system_prompt: z.string().min(1).optional(),
  permission_mode: z
    .enum([
      'acceptEdits',
      'auto',
      'bypassPermissions',
      'manual',
      'dontAsk',
      'plan',
    ])
    .optional(),
  max_turns: z.number().int().positive().optional(),
  max_budget_usd: z.number().positive().optional(),
  effort: z
    .enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'])
    .optional(),
  fallback_model: z.string().min(1).optional(),
  setting_sources: z
    .array(z.enum(['user', 'project', 'local']))
    .min(1)
    .optional(),
  tools: toolRulesSchema.optional(),
  allowed_tools: toolRulesSchema.optional(),
  disallowed_tools: toolRulesSchema.optional(),
  max_tokens: z
    .never({
      message:
        '"max_tokens" is not a supported Claude Code CLI option; use max_turns or max_budget_usd.',
    })
    .optional(),
  temperature: z
    .never({
      message: '"temperature" is not a supported Claude Code CLI option.',
    })
    .optional(),
};

export function validateClaudeCodeConfig(
  config: z.infer<z.ZodObject<typeof claudeCodeConfigShape>>,
  context: z.RefinementCtx
): void {
  validatePromptSource(config, context);

  const overlap = new Set(config.allowed_tools ?? []);
  const conflictingTools = (config.disallowed_tools ?? []).filter((tool) =>
    overlap.has(tool)
  );
  if (conflictingTools.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Tools cannot be both allowed and disallowed: ${conflictingTools.join(', ')}`,
      path: ['disallowed_tools'],
    });
  }
}

export const claudeCodeConfigSchema = z
  .object(claudeCodeConfigShape)
  .strict()
  .superRefine(validateClaudeCodeConfig);

export const claudeCodeAgentConfigSchema = z
  .object({
    type: z.literal('claude-code'),
    ...agentIdentityShape,
    config: claudeCodeConfigSchema.optional(),
  })
  .strict();

export type ClaudeCodeConfig = z.infer<typeof claudeCodeConfigSchema>;
