import { z } from 'zod';

export const promptConfigShape = {
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(50000, 'Prompt exceeds maximum length of 50000 characters')
    .optional(),
  prompt_file: z.string().min(1, 'Prompt file path is required').optional(),
  max_output_bytes: z.number().int().positive().optional(),
};

export function validatePromptSource(
  value: { prompt?: string; prompt_file?: string },
  context: z.RefinementCtx
): void {
  if (value.prompt && value.prompt_file) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cannot specify both "prompt" and "prompt_file".',
      path: ['prompt_file'],
    });
  }
}

export const agentIdentityShape = {
  agent_name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
};
