import { z } from 'zod';

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'Must start with an alphanumeric character and contain only letters, numbers, dots, underscores, and hyphens'
  );

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const versionSchema = z.string().min(1).max(128);
const e2bTemplateRefSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      ![...value].some(
        (character) =>
          /\s/.test(character) ||
          character.charCodeAt(0) <= 0x1f ||
          character.charCodeAt(0) === 0x7f
      ) &&
      !value.startsWith('/') &&
      !value.endsWith('/') &&
      !value.includes('\\') &&
      !value.includes('//') &&
      !value
        .split('/')
        .some((segment) => segment === '.' || segment === '..') &&
      /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(
        value
      ),
    'Must be a bounded E2B template/build reference with optional namespace and tag'
  );

function isRepresentableNetworkEntry(value: string): boolean {
  if (
    value.length > 253 ||
    value.includes('://') ||
    value.includes('\\') ||
    value.includes('@') ||
    value.includes('?') ||
    value.includes('#') ||
    value.startsWith('.') ||
    value.endsWith('.')
  ) {
    return false;
  }

  const [address, prefix] = value.split('/');
  if (value.split('/').length > 2) return false;
  if (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) return false;
  if (address === undefined || address.length === 0) return false;

  // Hostnames, IPv4/IPv6 literals, and CIDRs are accepted. Wildcards and ports
  // are deliberately rejected because their provider semantics are ambiguous.
  return (
    !address.includes('*') &&
    (/^[a-zA-Z0-9.-]+$/.test(address) || /^[0-9a-fA-F:]+$/.test(address))
  );
}

export const e2bRunnerPhaseSchema = z.enum([
  'prepare',
  'agent',
  'evaluate',
  'post-evaluate',
  'package',
]);

export const e2bSecretPhaseSchema = z.enum([
  'source',
  'prepare',
  'agent',
  'evaluate',
  'post-evaluate',
]);

export const e2bLifecycleSchema = z.enum([
  'creating',
  'running',
  'collecting',
  'killing',
  'paused',
  'killed',
  'lost',
]);

export const e2bNetworkEntrySchema = z
  .string()
  .min(1)
  .refine(isRepresentableNetworkEntry, {
    message:
      'Network entries must be exact hostnames, IP addresses, or CIDRs without schemes, paths, ports, or wildcards',
  });

export const e2bNetworkPolicySchema = z.discriminatedUnion('outbound', [
  z
    .object({
      inbound: z.literal('none').default('none'),
      outbound: z.literal('none'),
    })
    .strict(),
  z
    .object({
      inbound: z.literal('none').default('none'),
      outbound: z.literal('allowlist'),
      allow: z.array(e2bNetworkEntrySchema).min(1),
    })
    .strict(),
  z
    .object({
      inbound: z.literal('none').default('none'),
      outbound: z.literal('unrestricted'),
      explicit_opt_in: z.literal(true),
    })
    .strict(),
]);

export const e2bResourceExpectationSchema = z
  .object({
    cpu_count: z.number().positive(),
    memory_mb: z.number().int().positive(),
  })
  .strict();

export const e2bArtifactLimitsSchema = z
  .object({
    max_files: z.number().int().positive(),
    max_file_bytes: z.number().int().positive(),
    max_compressed_bytes: z.number().int().positive(),
    max_uncompressed_bytes: z.number().int().positive(),
  })
  .strict()
  .superRefine((limits, context) => {
    if (limits.max_file_bytes > limits.max_uncompressed_bytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_file_bytes'],
        message: 'max_file_bytes cannot exceed max_uncompressed_bytes',
      });
    }
  });

export const e2bDeadlinesSchema = z
  .object({
    phases_ms: z
      .object({
        prepare: z.number().int().positive(),
        agent: z.number().int().positive(),
        evaluate: z.number().int().positive(),
        post_evaluate: z.number().int().positive(),
        package: z.number().int().positive(),
      })
      .strict(),
    collection_grace_ms: z.number().int().nonnegative(),
    cleanup_grace_ms: z.number().int().nonnegative(),
    sandbox_ttl_ms: z.number().int().positive(),
    watchdog_ms: z.number().int().positive(),
  })
  .strict();

export const e2bSecretReferenceSchema = z
  .object({
    id: identifierSchema,
    source: z
      .object({
        type: z.literal('environment'),
        name: z.string().min(1).max(256),
      })
      .strict(),
    inject_as: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    targets: z.array(identifierSchema).min(1),
    components: z.array(identifierSchema).min(1),
    phases: z.array(e2bSecretPhaseSchema).min(1),
  })
  .strict()
  .superRefine((secret, context) => {
    if (
      secret.source.name.toUpperCase() === 'E2B_API_KEY' ||
      secret.inject_as.toUpperCase() === 'E2B_API_KEY'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'E2B_API_KEY cannot be selected as an in-sandbox secret',
      });
    }
  });

export const e2bTemplateReferenceSchema = z
  .object({
    template_id: e2bTemplateRefSchema,
    build_id: e2bTemplateRefSchema.optional(),
  })
  .strict();

export const e2bProviderConfigSchema = z
  .object({
    provider: z.literal('e2b'),
    template: e2bTemplateReferenceSchema,
    strict_reproducibility: z.boolean().default(true),
    secure_access: z.literal(true).default(true),
    network: e2bNetworkPolicySchema,
    expected_resources: e2bResourceExpectationSchema,
    deadlines: e2bDeadlinesSchema,
    artifact_limits: e2bArtifactLimitsSchema,
    runtime_package_installation: z.boolean().default(false),
    retention: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('kill') }).strict(),
        z
          .object({
            mode: z.literal('pause-on-failure'),
            reason: z.string().min(1).max(500),
            max_retention_ms: z.number().int().positive(),
          })
          .strict(),
      ])
      .default({ mode: 'kill' }),
  })
  .strict();

export const e2bHarnessCapabilitySchema = z
  .object({
    type: identifierSchema,
    version: versionSchema,
    adapter_schema_versions: z.array(versionSchema).min(1),
  })
  .strict();

export const e2bRequiredHarnessCapabilitySchema = z
  .object({
    component: identifierSchema,
    type: identifierSchema,
    version: versionSchema,
    adapter_schema_version: versionSchema,
  })
  .strict();

export const e2bTemplateManifestSchema = z
  .object({
    protocol_version: versionSchema,
    runner_version: versionSchema,
    node_version: versionSchema,
    git_version: versionSchema,
    harnesses: z.array(e2bHarnessCapabilitySchema),
    template_id: e2bTemplateRefSchema,
    build_id: e2bTemplateRefSchema,
    artifact_protocol: z
      .object({
        version: versionSchema,
        limits: e2bArtifactLimitsSchema,
      })
      .strict(),
    resources: e2bResourceExpectationSchema,
    runs_as_root: z.boolean(),
    public_service: z.boolean(),
    runtime_package_installation: z.boolean(),
  })
  .strict();

function containsForbiddenManifestKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenManifestKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) =>
      key.toUpperCase() === 'E2B_API_KEY' ||
      /(^|[_-])(secret|password|access[_-]?token|api[_-]?key)($|[_-])/i.test(
        key
      ) ||
      containsForbiddenManifestKey(child)
  );
}

export const e2bCellManifestSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    experiment_id: identifierSchema,
    cell_id: sha256Schema,
    attempt_id: identifierSchema,
    target: z
      .object({
        id: identifierSchema,
        agent_type: identifierSchema,
        requested_model: z.string().min(1).optional(),
        expected_harness_version: versionSchema,
        adapter_schema_version: versionSchema,
        config: z.record(z.unknown()),
      })
      .strict(),
    task: z.record(z.unknown()),
    template: e2bTemplateReferenceSchema.extend({
      build_id: identifierSchema,
    }),
    required_capabilities: z.array(e2bRequiredHarnessCapabilitySchema).min(1),
    network: e2bNetworkPolicySchema,
    deadlines: e2bDeadlinesSchema,
    artifact_limits: e2bArtifactLimitsSchema,
    secret_references: z.array(e2bSecretReferenceSchema).default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (containsForbiddenManifestKey(manifest.target.config)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target', 'config'],
        message:
          'Effective target config cannot contain secret values or E2B control credentials',
      });
    }
    if (containsForbiddenManifestKey(manifest.task)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['task'],
        message:
          'Effective task config cannot contain secret values or E2B control credentials',
      });
    }
  });

export const e2bProviderStateSchema = z
  .object({
    provider: z.literal('e2b'),
    lifecycle: e2bLifecycleSchema,
    sandbox_id: identifierSchema.optional(),
    ownership_nonce_hash: sha256Schema.optional(),
    created_at: z.string().datetime().optional(),
    last_observed_at: z.string().datetime().optional(),
    intended_expiry_at: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      ['running', 'collecting', 'killing', 'paused', 'killed'].includes(
        state.lifecycle
      ) &&
      state.sandbox_id === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sandbox_id'],
        message: `${state.lifecycle} state requires a sandbox_id`,
      });
    }
    if (
      state.lifecycle === 'paused' &&
      state.intended_expiry_at === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intended_expiry_at'],
        message: 'Paused state requires an intended_expiry_at',
      });
    }
  });

export const e2bArtifactEntrySchema = z
  .object({
    path: z.string().min(1).max(4096),
    uncompressed_size: z.number().int().nonnegative(),
    compressed_size: z.number().int().nonnegative().optional(),
    sha256: sha256Schema,
    truncated: z.boolean().default(false),
    redacted: z.boolean().default(false),
  })
  .strict();

export const e2bArtifactManifestSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    artifact_protocol_version: versionSchema,
    experiment_id: identifierSchema,
    cell_id: sha256Schema,
    attempt_id: identifierSchema,
    result_schema_version: versionSchema,
    remote_result_path: z.string().min(1).max(4096),
    runner_status: z.enum(['completed', 'failed']),
    artifacts: z.array(e2bArtifactEntrySchema),
    archive: z
      .object({
        sha256: sha256Schema,
        compressed_size: z.number().int().nonnegative(),
        uncompressed_size: z.number().int().nonnegative(),
      })
      .strict(),
    completion: z
      .object({
        redaction_applied: z.boolean(),
        truncation_applied: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type E2BRunnerPhase = z.infer<typeof e2bRunnerPhaseSchema>;
export type E2BSecretPhase = z.infer<typeof e2bSecretPhaseSchema>;
export type E2BLifecycle = z.infer<typeof e2bLifecycleSchema>;
export type E2BNetworkPolicy = z.infer<typeof e2bNetworkPolicySchema>;
export type E2BResourceExpectation = z.infer<
  typeof e2bResourceExpectationSchema
>;
export type E2BArtifactLimits = z.infer<typeof e2bArtifactLimitsSchema>;
export type E2BDeadlines = z.infer<typeof e2bDeadlinesSchema>;
export type E2BSecretReference = z.infer<typeof e2bSecretReferenceSchema>;
export type E2BProviderConfig = z.infer<typeof e2bProviderConfigSchema>;
export type E2BRequiredHarnessCapability = z.infer<
  typeof e2bRequiredHarnessCapabilitySchema
>;
export type E2BTemplateManifest = z.infer<typeof e2bTemplateManifestSchema>;
export type E2BCellManifest = z.infer<typeof e2bCellManifestSchema>;
export type E2BProviderState = z.infer<typeof e2bProviderStateSchema>;
export type E2BArtifactManifest = z.infer<typeof e2bArtifactManifestSchema>;
