import { z } from 'zod';
import {
  claudeCodeConfigShape,
  validateClaudeCodeConfig,
} from './agent-config/claude-code.js';
import { copilotCliConfigShape } from './agent-config/copilot-cli.js';
import {
  CODEX_OUTPUT_LIMIT_MAX_BYTES,
  safeRelativePathSchema,
} from './agent-config/codex-cli.js';
import { validatePromptSource } from './agent-config/common.js';

const nonNegativeThreshold = z.number().nonnegative();
const agenticJudgeAdapterTypeSchema = z.enum([
  'copilot-cli',
  'claude-code',
  'codex-cli',
]);

export type AgenticJudgeAdapterType = z.infer<
  typeof agenticJudgeAdapterTypeSchema
>;

export function resolveAgenticJudgeAdapterType(
  config: Record<string, unknown> | undefined,
  inheritedAgentType?: string
): string | undefined {
  return typeof config?.type === 'string' ? config.type : inheritedAgentType;
}

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
    type: agenticJudgeAdapterTypeSchema.optional(),
    agent_name: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    timeout: z.number().positive().optional(),
    ...claudeCodeConfigShape,
    ...copilotCliConfigShape,
    reasoning_effort: z
      .enum([
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
        'ultra',
      ])
      .optional(),
    sandbox: z.enum(['read-only', 'workspace-write']).optional(),
    approval_policy: z.literal('never').optional(),
    ephemeral: z.boolean().optional(),
    ignore_user_config: z.boolean().optional(),
    ignore_rules: z.boolean().optional(),
    profile: z.string().min(1).optional(),
    search: z.boolean().optional(),
    output_limit_bytes: z
      .number()
      .int()
      .positive()
      .max(CODEX_OUTPUT_LIMIT_MAX_BYTES)
      .optional(),
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
      if (config.reasoning_effort !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'claude-code does not support reasoning_effort; use effort instead.',
          path: ['reasoning_effort'],
        });
      }
    }
    if (config.type === 'copilot-cli' && config.reasoning_effort === 'ultra') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'copilot-cli reasoning_effort must be none, minimal, low, medium, high, xhigh, or max.',
        path: ['reasoning_effort'],
      });
    }
    if (config.type === 'codex-cli' && config.agent_name !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'codex-cli does not support agent_name; use profile for a Codex profile or put task-specific skill instructions in the prompt.',
        path: ['agent_name'],
      });
    }
    if (
      config.type === 'codex-cli' &&
      (config.reasoning_effort === 'none' ||
        config.reasoning_effort === 'minimal')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'codex-cli reasoning_effort must be low, medium, high, xhigh, max, or ultra.',
        path: ['reasoning_effort'],
      });
    }
    if (
      config.type === 'codex-cli' &&
      config.prompt_file !== undefined &&
      !safeRelativePathSchema.safeParse(config.prompt_file).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'codex-cli prompt_file must be a safe relative path without parent traversal.',
        path: ['prompt_file'],
      });
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
      'max_ai_credits',
      'log_level',
      'allow_all_tools',
      'allow_all_paths',
      'legacy_text_output',
    ] as const;
    const codexOnlyKeys = [
      'sandbox',
      'approval_policy',
      'ephemeral',
      'ignore_user_config',
      'ignore_rules',
      'profile',
      'search',
      'output_limit_bytes',
    ] as const;
    const incompatibleKeys =
      config.type === 'claude-code'
        ? [...copilotOnlyKeys, ...codexOnlyKeys].filter(
            (key) => config[key] !== undefined
          )
        : config.type === 'copilot-cli'
          ? [...claudeOnlyKeys, ...codexOnlyKeys].filter(
              (key) => config[key] !== undefined
            )
          : config.type === 'codex-cli'
            ? [...claudeOnlyKeys, ...copilotOnlyKeys].filter(
                (key) => config[key] !== undefined
              )
            : [];
    if (incompatibleKeys.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${config.type} does not support: ${incompatibleKeys.join(', ')}`,
        path: [incompatibleKeys[0]],
      });
    }
    if (config.type === 'codex-cli' && config.max_output_bytes !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'codex-cli does not support max_output_bytes; use output_limit_bytes instead.',
        path: ['max_output_bytes'],
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
  options: {
    requireAgentType?: boolean;
    inheritedAgentType?: string;
  } = {}
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
    const resolvedType = resolveAgenticJudgeAdapterType(
      value,
      options.inheritedAgentType
    );
    const parsed = agenticJudgeEvaluatorConfigSchema.parse(
      resolvedType === undefined ? value : { ...value, type: resolvedType }
    );
    if (options.requireAgentType && !parsed.type) {
      throw new Error(
        `Evaluator "${name}" requires config.type for eval-only runs.`
      );
    }
    return parsed;
  }

  return value;
}
