import { z } from 'zod';
import {
  agentIdentityShape,
  promptConfigShape,
  validatePromptSource,
} from './common.js';

export const copilotCliConfigShape = {
  ...promptConfigShape,
  reasoning_effort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  max_ai_credits: z.number().int().nonnegative().optional(),
  log_level: z
    .enum(['none', 'error', 'warning', 'info', 'debug', 'all', 'default'])
    .optional(),
  allow_all_tools: z.boolean().optional(),
  allow_all_paths: z.boolean().optional(),
  legacy_text_output: z.boolean().optional(),
};

export const copilotCliConfigSchema = z
  .object(copilotCliConfigShape)
  .strict()
  .superRefine(validatePromptSource);

export const copilotCliAgentConfigSchema = z
  .object({
    type: z.literal('copilot-cli'),
    ...agentIdentityShape,
    config: copilotCliConfigSchema.optional(),
  })
  .strict();

export type CopilotCliConfig = z.infer<typeof copilotCliConfigSchema>;
