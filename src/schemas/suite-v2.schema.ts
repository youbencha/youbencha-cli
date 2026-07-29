import { isIP } from 'net';
import { z } from 'zod';
import { agentConfigSchema } from './agent-config/index.js';
import { postEvaluationConfigSchema } from './post-evaluation.schema.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'Identifiers must start with an alphanumeric character and contain only letters, numbers, dots, underscores, and hyphens'
  );
const nonEmptyStringSchema = z.string().trim().min(1);
const safeRelativePathSchema = nonEmptyStringSchema.refine(
  (value) =>
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[a-zA-Z]:[\\/]/.test(value) &&
    !value.split(/[\\/]+/).includes('..'),
  'Path must be relative and cannot contain parent traversal'
);
const exactVersionSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'Harness version must be an exact semantic version'
  );

const publicRepositorySchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        (url.port !== '' && url.port !== '443')
      ) {
        return false;
      }
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
      ) {
        return false;
      }
      if (isIP(hostname) === 0) return true;
      if (isIP(hostname) === 6) {
        return !(
          hostname === '::' ||
          hostname === '::1' ||
          hostname.startsWith('fc') ||
          hostname.startsWith('fd') ||
          hostname.startsWith('fe8') ||
          hostname.startsWith('fe9') ||
          hostname.startsWith('fea') ||
          hostname.startsWith('feb')
        );
      }
      const octets = hostname.split('.').map(Number);
      // isIP(hostname) has already established the four-octet IPv4 shape.
      const first = octets[0];
      const second = octets[1];
      return !(
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        first >= 224
      );
    } catch {
      return false;
    }
  }, 'Repository must be a credential-free HTTPS URL to a public repository');

export const suiteV2EvaluatorSchema = z.union([
  z
    .object({
      name: nonEmptyStringSchema,
      config: z.record(z.unknown()).optional(),
      harness: z
        .object({
          type: z.enum(['copilot-cli', 'claude-code', 'codex-cli']).optional(),
          exact_version: exactVersionSchema,
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        (value.name === 'agentic-judge' ||
          value.name.startsWith('agentic-judge-') ||
          value.name.startsWith('agentic-judge:')) &&
        value.harness === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['harness'],
          message:
            'Agentic judge evaluators require an exact harness version in version 2 tasks',
        });
      }
    }),
  z
    .object({
      file: safeRelativePathSchema,
      harness: z
        .object({
          type: z.enum(['copilot-cli', 'claude-code', 'codex-cli']),
          exact_version: exactVersionSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

export const suiteV2SetupStepSchema = z.union([
  z.enum([
    'npm-ci',
    'npm-install',
    'pnpm-install',
    'yarn-install',
    'bun-install',
  ]),
  z
    .object({
      command: nonEmptyStringSchema,
      args: z.array(z.string()).default([]),
      env: z.record(z.string()).optional(),
      timeout_ms: z.number().int().positive().default(30000),
      working_dir: safeRelativePathSchema.optional(),
    })
    .strict(),
]);

const taskPromptSchema = z
  .object({
    prompt: z.string().min(1).max(50000).optional(),
    prompt_file: safeRelativePathSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.prompt === undefined) === (value.prompt_file === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Task must declare exactly one of prompt or prompt_file',
        path: ['prompt'],
      });
    }
  });

export const regressionTaskDefinitionSchema = z
  .object({
    version: z.literal(2),
    kind: z.literal('task'),
    name: nonEmptyStringSchema.max(200),
    description: nonEmptyStringSchema.max(1000),
    repo: publicRepositorySchema,
    branch: nonEmptyStringSchema.optional(),
    commit: nonEmptyStringSchema.optional(),
    task: taskPromptSchema,
    evaluators: z.array(suiteV2EvaluatorSchema).min(1),
    setup: z
      .object({
        cacheable: z.array(suiteV2SetupStepSchema).default([]),
        per_attempt: z.array(suiteV2SetupStepSchema).default([]),
      })
      .strict()
      .default({}),
    expected_source: z.literal('branch').optional(),
    expected: nonEmptyStringSchema.optional(),
    post_evaluation: z.array(postEvaluationConfigSchema).optional(),
    workspace_name: identifierSchema.optional(),
    timeout: z.number().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expected_source !== undefined && value.expected === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'When expected_source is provided, expected is required',
        path: ['expected'],
      });
    }
  });

const expectedResourcesSchema = z
  .object({
    cpu: z.number().positive(),
    memory_mb: z.number().int().positive(),
    disk_mb: z.number().int().positive().optional(),
  })
  .strict();

const templateReferenceSchema = z
  .object({
    ref: nonEmptyStringSchema,
    expected_build_id: nonEmptyStringSchema.optional(),
    expected_resources: expectedResourcesSchema.optional(),
  })
  .strict();

const targetNetworkSchema = z
  .object({
    outbound: z.enum(['none', 'allowlist', 'unrestricted']).default('none'),
    allow: z.array(nonEmptyStringSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outbound !== 'allowlist' && value.allow.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Network allow entries require outbound: allowlist',
        path: ['allow'],
      });
    }
    if (value.outbound === 'allowlist' && value.allow.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'outbound: allowlist requires at least one allow entry',
        path: ['allow'],
      });
    }
  });

export const regressionTargetSchema = z
  .object({
    id: identifierSchema,
    agent: agentConfigSchema,
    harness: z
      .object({
        exact_version: exactVersionSchema,
        e2b_template: templateReferenceSchema.optional(),
      })
      .strict(),
    runtime: z
      .object({
        network: targetNetworkSchema.default({}),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.agent.model === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Regression targets require an explicit requested model',
        path: ['agent', 'model'],
      });
    }
    const config = value.agent.config;
    if (
      config !== undefined &&
      ('prompt' in config || 'prompt_file' in config)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'The task owns the prompt; target agent config cannot declare one',
        path: ['agent', 'config'],
      });
    }
  });

const taskSelectionSchema = z.union([
  z.literal('*'),
  z.array(identifierSchema).min(1),
]);

export const regressionProfileSchema = z
  .object({
    tasks: taskSelectionSchema,
    targets: z.array(identifierSchema).min(1),
    repetitions: z.number().int().min(1),
    comparisons: z.array(identifierSchema).default([]),
    rules: z.array(identifierSchema).default([]),
  })
  .strict();

const persistedBaselineSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('channel'),
      channel: identifierSchema,
      target: identifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal('snapshot'),
      digest: nonEmptyStringSchema,
      target: identifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal('path'),
      path: nonEmptyStringSchema,
      target: identifierSchema,
    })
    .strict(),
  z
    .object({
      source: z.literal('current_run'),
      target: identifierSchema,
    })
    .strict(),
]);

export const regressionComparisonSchema = z
  .object({
    id: identifierSchema,
    candidate_target: identifierSchema,
    baseline: persistedBaselineSchema,
  })
  .strict();

export const regressionRuleSchema = z
  .object({
    id: identifierSchema,
    metric: nonEmptyStringSchema,
    scopes: z.array(z.enum(['target', 'testcase_target'])).min(1),
    minimum: z.number().optional(),
    max_absolute_drop: z.number().nonnegative().optional(),
    max_relative_increase: z.number().nonnegative().optional(),
    comparisons: z.array(identifierSchema).optional(),
    minimum_samples: z.number().int().min(1),
    insufficient_samples: z.enum(['fail', 'partial']).default('partial'),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minimum === undefined &&
      value.max_absolute_drop === undefined &&
      value.max_relative_increase === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A regression rule requires at least one threshold',
        path: ['metric'],
      });
    }
  });

const hostProviderSchema = z
  .object({ type: z.literal('host-trusted') })
  .strict();
const e2bProviderSchema = z
  .object({
    type: z.literal('e2b'),
    timeout_ms: z.number().int().positive(),
    collection_grace_ms: z.number().int().positive(),
    lifecycle: z
      .object({
        on_timeout: z.literal('kill').default('kill'),
        retain_on: z.enum(['never', 'failure']).default('never'),
        retention_reason: nonEmptyStringSchema.optional(),
        retention_max_minutes: z.number().int().positive().optional(),
      })
      .strict()
      .default({}),
    network_defaults: z
      .object({
        inbound: z.literal('none').default('none'),
        outbound: z.enum(['none', 'allowlist', 'unrestricted']).default('none'),
      })
      .strict()
      .default({}),
    fixture_cache: z
      .object({
        mode: z.enum(['none', 'snapshot']).default('none'),
        setup: z.literal('declared-cacheable-only').optional(),
      })
      .strict()
      .default({}),
    strict_reproducibility: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.lifecycle.retain_on === 'failure' &&
      (value.lifecycle.retention_reason === undefined ||
        value.lifecycle.retention_max_minutes === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Failure retention requires retention_reason and retention_max_minutes',
        path: ['lifecycle'],
      });
    }
  });

export const suiteV2SecretSchema = z
  .object({
    id: identifierSchema,
    source: z.object({ env: nonEmptyStringSchema }).strict(),
    expose_as: z.object({ env: nonEmptyStringSchema }).strict(),
    targets: z.array(identifierSchema).min(1),
    components: z
      .array(z.enum(['source', 'agent', 'evaluator', 'post_evaluation']))
      .optional(),
    phases: z
      .array(z.enum(['prepare', 'agent', 'evaluate', 'post_evaluate']))
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.source.env.toUpperCase() === 'E2B_API_KEY' ||
      value.expose_as.env.toUpperCase() === 'E2B_API_KEY'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'E2B_API_KEY cannot be exposed to a sandbox',
        path: ['source', 'env'],
      });
    }
  });

export const regressionSuiteDefinitionSchema = z
  .object({
    version: z.literal(2),
    name: identifierSchema,
    suite: z
      .object({
        tasks: z
          .array(
            z
              .object({
                id: identifierSchema,
                file: safeRelativePathSchema,
              })
              .strict()
          )
          .min(1),
        repetitions: z.number().int().min(1).default(1),
      })
      .strict(),
    profiles: z.record(identifierSchema, regressionProfileSchema).default({}),
    targets: z.array(regressionTargetSchema).min(1),
    execution: z
      .object({
        max_concurrent: z.number().int().min(1).default(1),
        max_creations_per_second: z.number().positive().default(1),
        schedule: z
          .object({
            order: z.literal('round_robin').default('round_robin'),
            seed: nonEmptyStringSchema.default('youbencha-v2'),
            ramp_up: z
              .object({
                initial_cells_per_target: z.number().int().min(1).default(1),
                release_after: z
                  .literal('target_capability_confirmed')
                  .default('target_capability_confirmed'),
              })
              .strict()
              .default({}),
          })
          .strict()
          .default({}),
        retry: z
          .object({
            max_attempts: z.number().int().min(1).default(1),
            on: z
              .array(
                z.enum([
                  'infrastructure_failure',
                  'timeout',
                  'provider_rate_limit',
                ])
              )
              .default([]),
            backoff_ms: z.number().int().nonnegative().default(0),
            jitter: z.enum(['none', 'full']).default('none'),
          })
          .strict()
          .default({}),
        provider: z
          .union([hostProviderSchema, e2bProviderSchema])
          .default({ type: 'host-trusted' }),
        secrets: z.array(suiteV2SecretSchema).default([]),
      })
      .strict()
      .default({}),
    budget: z
      .object({
        max_duration_minutes: z.number().positive().optional(),
        max_model_cost_usd: z.number().nonnegative().optional(),
        max_sandbox_runtime_minutes: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    regression: z
      .object({
        default_candidate_target: identifierSchema.optional(),
        comparisons: z.array(regressionComparisonSchema).default([]),
        rules: z.array(regressionRuleSchema).default([]),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    const taskIds = validateUniqueIds(
      value.suite.tasks,
      'id',
      ['suite', 'tasks'],
      context
    );
    const targetIds = validateUniqueIds(
      value.targets,
      'id',
      ['targets'],
      context
    );
    const comparisonIds = validateUniqueIds(
      value.regression.comparisons,
      'id',
      ['regression', 'comparisons'],
      context
    );
    const ruleIds = validateUniqueIds(
      value.regression.rules,
      'id',
      ['regression', 'rules'],
      context
    );

    validateReference(
      value.regression.default_candidate_target,
      targetIds,
      ['regression', 'default_candidate_target'],
      'target',
      context
    );
    value.regression.comparisons.forEach((comparison, index) => {
      validateReference(
        comparison.candidate_target,
        targetIds,
        ['regression', 'comparisons', index, 'candidate_target'],
        'target',
        context
      );
      if (comparison.baseline.source === 'current_run') {
        validateReference(
          comparison.baseline.target,
          targetIds,
          ['regression', 'comparisons', index, 'baseline', 'target'],
          'target',
          context
        );
      }
    });
    value.regression.rules.forEach((rule, index) => {
      rule.comparisons?.forEach((comparison, comparisonIndex) =>
        validateReference(
          comparison,
          comparisonIds,
          ['regression', 'rules', index, 'comparisons', comparisonIndex],
          'comparison',
          context
        )
      );
    });
    Object.entries(value.profiles).forEach(([name, profile]) => {
      if (profile.tasks !== '*') {
        profile.tasks.forEach((task, index) =>
          validateReference(
            task,
            taskIds,
            ['profiles', name, 'tasks', index],
            'task',
            context
          )
        );
      }
      profile.targets.forEach((target, index) =>
        validateReference(
          target,
          targetIds,
          ['profiles', name, 'targets', index],
          'target',
          context
        )
      );
      profile.comparisons.forEach((comparison, index) =>
        validateReference(
          comparison,
          comparisonIds,
          ['profiles', name, 'comparisons', index],
          'comparison',
          context
        )
      );
      profile.rules.forEach((rule, index) =>
        validateReference(
          rule,
          ruleIds,
          ['profiles', name, 'rules', index],
          'rule',
          context
        )
      );
    });
    value.execution.secrets.forEach((secret, secretIndex) => {
      secret.targets.forEach((target, targetIndex) =>
        validateReference(
          target,
          targetIds,
          ['execution', 'secrets', secretIndex, 'targets', targetIndex],
          'target',
          context
        )
      );
    });
    if (
      value.execution.provider.type === 'e2b' &&
      value.execution.provider.strict_reproducibility
    ) {
      value.targets.forEach((target, index) => {
        if (target.harness.e2b_template?.expected_build_id === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Strict reproducibility requires an expected immutable E2B build ID',
            path: [
              'targets',
              index,
              'harness',
              'e2b_template',
              'expected_build_id',
            ],
          });
        }
        if (target.runtime.network.outbound === 'unrestricted') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Strict reproducibility does not allow unrestricted egress',
            path: ['targets', index, 'runtime', 'network', 'outbound'],
          });
        }
      });
    }
  });

function validateUniqueIds<T extends Record<K, string>, K extends keyof T>(
  values: readonly T[],
  key: K,
  path: (string | number)[],
  context: z.RefinementCtx
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const id = value[key];
    if (ids.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ID "${id}"`,
        path: [...path, index, key as string],
      });
    }
    ids.add(id);
  });
  return ids;
}

function validateReference(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  path: (string | number)[],
  label: string,
  context: z.RefinementCtx
): void {
  if (value !== undefined && !allowed.has(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown ${label} "${value}"`,
      path,
    });
  }
}

export type RegressionTaskDefinition = z.infer<
  typeof regressionTaskDefinitionSchema
>;
export type RegressionSuiteDefinition = z.infer<
  typeof regressionSuiteDefinitionSchema
>;
export type RegressionTarget = z.infer<typeof regressionTargetSchema>;
export type RegressionProfile = z.infer<typeof regressionProfileSchema>;
export type SuiteV2SetupStep = z.infer<typeof suiteV2SetupStepSchema>;
