import { z } from 'zod';

const nonNegativeThreshold = z.number().nonnegative();

export const gitDiffEvaluatorConfigSchema = z
  .object({
    base_commit: z.string().min(1).optional(),
    assertions: z
      .object({
        max_files_changed: nonNegativeThreshold.optional(),
        max_lines_added: nonNegativeThreshold.optional(),
        max_lines_removed: nonNegativeThreshold.optional(),
        max_total_changes: nonNegativeThreshold.optional(),
        min_change_entropy: nonNegativeThreshold.optional(),
        max_change_entropy: nonNegativeThreshold.optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough();

export const expectedDiffEvaluatorConfigSchema = z
  .object({
    threshold: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const agenticJudgeEvaluatorConfigSchema = z
  .object({
    type: z.enum(['copilot-cli', 'claude-code']).optional(),
    agent_name: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    timeout: z.number().positive().optional(),
    prompt: z.string().min(1).optional(),
    prompt_file: z.string().min(1).optional(),
    'instructions-file': z.string().min(1).optional(),
    assertions: z.record(z.string(), z.string().min(1)).optional(),
    criteria: z
      .union([
        z.array(z.string().min(1)).min(1),
        z.record(z.string(), z.string().min(1)),
      ])
      .optional(),
  })
  .passthrough()
  .superRefine((config, context) => {
    if (config.prompt && config.prompt_file) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cannot specify both "prompt" and "prompt_file".',
        path: ['prompt_file'],
      });
    }
    if (!config.assertions && !config.criteria) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'agentic-judge requires assertions or criteria.',
        path: ['assertions'],
      });
    }
  });

export function parseEvaluatorConfig(
  name: string,
  config: Record<string, unknown> | undefined,
  options: { requireAgentType?: boolean } = {}
): Record<string, unknown> {
  const value = config ?? {};

  if (name === 'git-diff') {
    return gitDiffEvaluatorConfigSchema.parse(value);
  }
  if (name === 'expected-diff') {
    return expectedDiffEvaluatorConfigSchema.parse(value);
  }
  if (
    name === 'agentic-judge' ||
    name.startsWith('agentic-judge-') ||
    name.startsWith('agentic-judge:')
  ) {
    const parsed = agenticJudgeEvaluatorConfigSchema.parse(value);
    if (options.requireAgentType && !parsed.type) {
      throw new Error(
        `Evaluator "${name}" requires config.type for eval-only runs.`
      );
    }
    return parsed;
  }

  return value;
}
