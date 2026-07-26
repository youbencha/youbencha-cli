import { z } from 'zod';
import {
  claudeCodeConfigShape,
  validateClaudeCodeConfig,
} from './agent-config/claude-code.js';
import { copilotCliConfigShape } from './agent-config/copilot-cli.js';
import { validatePromptSource } from './agent-config/common.js';

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
    ...claudeCodeConfigShape,
    ...copilotCliConfigShape,
    'instructions-file': z.string().min(1).optional(),
    assertions: z.record(z.string(), z.string().min(1)).optional(),
    criteria: z
      .union([
        z.array(z.string().min(1)).min(1),
        z.record(z.string(), z.string().min(1)),
      ])
      .optional(),
  })
  .strict()
  .superRefine((config, context) => {
    validatePromptSource(config, context);
    if (config.type === 'claude-code') {
      validateClaudeCodeConfig(config, context);
    }

    const claudeOnlyKeys = [
      'system_prompt',
      'append_system_prompt',
      'permission_mode',
      'max_turns',
      'max_budget_usd',
      'effort',
      'fallback_model',
      'setting_sources',
      'tools',
      'allowed_tools',
      'disallowed_tools',
    ] as const;
    const copilotOnlyKeys = [
      'reasoning_effort',
      'max_ai_credits',
      'log_level',
      'allow_all_tools',
      'allow_all_paths',
    ] as const;
    const incompatibleKeys =
      config.type === 'claude-code'
        ? copilotOnlyKeys.filter((key) => config[key] !== undefined)
        : config.type === 'copilot-cli'
          ? claudeOnlyKeys.filter((key) => config[key] !== undefined)
          : [];
    if (incompatibleKeys.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${config.type} does not support: ${incompatibleKeys.join(', ')}`,
        path: [incompatibleKeys[0]],
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
