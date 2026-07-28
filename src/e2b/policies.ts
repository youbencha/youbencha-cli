import type { E2BClientCapabilities } from './client.js';
import {
  e2bDeadlinesSchema,
  e2bNetworkPolicySchema,
  e2bSecretReferenceSchema,
  e2bTemplateManifestSchema,
  type E2BDeadlines,
  type E2BNetworkPolicy,
  type E2BRequiredHarnessCapability,
  type E2BResourceExpectation,
  type E2BSecretPhase,
  type E2BSecretReference,
  type E2BTemplateManifest,
} from './schemas.js';

export class E2BPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'E2BPolicyError';
  }
}

function majorVersion(value: string): string {
  const match = /^v?(\d+)(?:\.|$)/.exec(value);
  if (match?.[1] === undefined) {
    throw new E2BPolicyError(
      'invalid_version',
      `Version "${value}" does not start with a numeric major version`
    );
  }
  return match[1];
}

export interface TemplateValidationOptions {
  protocolVersion: string;
  artifactProtocolVersion: string;
  templateId: string;
  expectedBuildId?: string;
  expectedResources: E2BResourceExpectation;
  requiredCapabilities: readonly E2BRequiredHarnessCapability[];
  strictReproducibility: boolean;
}

export interface TemplateValidationResult {
  manifest: E2BTemplateManifest;
  warnings: string[];
}

export function validateTemplateForCell(
  value: unknown,
  options: TemplateValidationOptions
): TemplateValidationResult {
  const manifest = e2bTemplateManifestSchema.parse(value);
  const warnings: string[] = [];

  if (
    majorVersion(manifest.protocol_version) !==
    majorVersion(options.protocolVersion)
  ) {
    throw new E2BPolicyError(
      'runner_protocol_mismatch',
      `Runner protocol ${manifest.protocol_version} is incompatible with required ${options.protocolVersion}`
    );
  }
  if (
    majorVersion(manifest.artifact_protocol.version) !==
    majorVersion(options.artifactProtocolVersion)
  ) {
    throw new E2BPolicyError(
      'artifact_protocol_mismatch',
      `Artifact protocol ${manifest.artifact_protocol.version} is incompatible with required ${options.artifactProtocolVersion}`
    );
  }
  if (manifest.template_id !== options.templateId) {
    throw new E2BPolicyError(
      'template_identity_mismatch',
      `Resolved template ${manifest.template_id} does not match requested ${options.templateId}`
    );
  }
  if (
    options.expectedBuildId !== undefined &&
    manifest.build_id !== options.expectedBuildId
  ) {
    throw new E2BPolicyError(
      'template_build_mismatch',
      `Resolved build ${manifest.build_id} does not match expected ${options.expectedBuildId}`
    );
  }
  if (options.strictReproducibility && options.expectedBuildId === undefined) {
    throw new E2BPolicyError(
      'unresolved_template_build',
      'Strict reproducibility requires an immutable expected template build ID'
    );
  }
  if (
    manifest.resources.cpu_count !== options.expectedResources.cpu_count ||
    manifest.resources.memory_mb !== options.expectedResources.memory_mb
  ) {
    throw new E2BPolicyError(
      'template_resource_mismatch',
      'Resolved template resources do not match the declared CPU and memory expectations'
    );
  }
  if (manifest.runs_as_root) {
    throw new E2BPolicyError(
      'root_runner_forbidden',
      'The E2B runner and harness must operate as a non-root user'
    );
  }
  if (manifest.public_service) {
    throw new E2BPolicyError(
      'public_service_forbidden',
      'The E2B template must not expose a public service'
    );
  }
  if (options.strictReproducibility && manifest.runtime_package_installation) {
    throw new E2BPolicyError(
      'runtime_installation_forbidden',
      'Strict reproducibility forbids runtime package installation'
    );
  }

  for (const required of options.requiredCapabilities) {
    const installed = manifest.harnesses.find(
      (harness) => harness.type === required.type
    );
    if (installed === undefined) {
      throw new E2BPolicyError(
        'missing_harness_capability',
        `Template does not provide required ${required.component} harness ${required.type}`
      );
    }
    if (
      !installed.adapter_schema_versions.includes(
        required.adapter_schema_version
      )
    ) {
      throw new E2BPolicyError(
        'adapter_schema_mismatch',
        `Harness ${required.type} does not support adapter schema ${required.adapter_schema_version}`
      );
    }
    if (installed.version !== required.version) {
      if (options.strictReproducibility) {
        throw new E2BPolicyError(
          'harness_version_mismatch',
          `Harness ${required.type} version ${installed.version} does not match required ${required.version}`
        );
      }
      warnings.push(
        `Harness ${required.type} resolved to ${installed.version}; requested ${required.version}`
      );
    }
  }

  return { manifest, warnings };
}

export function resolveEffectiveNetworkPolicy(
  requirements: readonly E2BNetworkPolicy[],
  strictReproducibility: boolean
): E2BNetworkPolicy {
  const policies = requirements.map((policy) =>
    e2bNetworkPolicySchema.parse(policy)
  );
  const unrestricted = policies.some(
    (policy) => policy.outbound === 'unrestricted'
  );
  if (unrestricted) {
    if (strictReproducibility) {
      throw new E2BPolicyError(
        'unrestricted_egress_forbidden',
        'Strict reproducibility forbids unrestricted outbound network access'
      );
    }
    return {
      inbound: 'none',
      outbound: 'unrestricted',
      explicit_opt_in: true,
    };
  }

  const allow = new Set<string>();
  for (const policy of policies) {
    if (policy.outbound === 'allowlist') {
      for (const entry of policy.allow) allow.add(entry.toLowerCase());
    }
  }
  if (allow.size === 0) return { inbound: 'none', outbound: 'none' };
  return {
    inbound: 'none',
    outbound: 'allowlist',
    allow: [...allow].sort((left, right) => left.localeCompare(right, 'en')),
  };
}

export function validateProviderSecurityCapabilities(
  policy: E2BNetworkPolicy,
  capabilities: E2BClientCapabilities
): void {
  if (!capabilities.securedAccess) {
    throw new E2BPolicyError(
      'secured_access_unsupported',
      'The selected E2B client cannot enforce secured controller access'
    );
  }
  if (policy.outbound === 'none' && !capabilities.outboundDeny) {
    throw new E2BPolicyError(
      'outbound_deny_unsupported',
      'The selected E2B client cannot deny outbound internet access'
    );
  }
  if (policy.outbound === 'allowlist' && !capabilities.outboundAllowlist) {
    throw new E2BPolicyError(
      'outbound_allowlist_unsupported',
      'The selected E2B client cannot enforce the configured outbound allowlist'
    );
  }
}

export function validateDeadlines(value: unknown): E2BDeadlines {
  const deadlines = e2bDeadlinesSchema.parse(value);
  const totalPhaseMs = Object.values(deadlines.phases_ms).reduce(
    (total, timeout) => total + timeout,
    0
  );
  const minimumSandboxTtl = totalPhaseMs + deadlines.collection_grace_ms;
  if (deadlines.sandbox_ttl_ms < minimumSandboxTtl) {
    throw new E2BPolicyError(
      'sandbox_deadline_inconsistent',
      `Sandbox TTL must be at least ${minimumSandboxTtl}ms to cover phase deadlines and artifact collection`
    );
  }
  const minimumWatchdog = deadlines.sandbox_ttl_ms + deadlines.cleanup_grace_ms;
  if (deadlines.watchdog_ms < minimumWatchdog) {
    throw new E2BPolicyError(
      'watchdog_deadline_inconsistent',
      `Outer watchdog must be at least ${minimumWatchdog}ms to cover sandbox TTL and cleanup`
    );
  }
  return deadlines;
}

const MINIMAL_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
]);

export interface ResolvePhaseSecretsOptions {
  targetId: string;
  component: string;
  phase: E2BSecretPhase;
  environment?: NodeJS.ProcessEnv;
}

export interface ResolvedPhaseEnvironment {
  env: Record<string, string>;
  redactionNames: string[];
  redactionValues: string[];
}

export function resolvePhaseEnvironment(
  references: readonly E2BSecretReference[],
  options: ResolvePhaseSecretsOptions,
  baseEnvironment: Readonly<Record<string, string>> = {}
): ResolvedPhaseEnvironment {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnvironment)) {
    if (MINIMAL_ENVIRONMENT_KEYS.has(name) && value !== '') env[name] = value;
  }

  const sourceEnvironment = options.environment ?? process.env;
  const redactionNames: string[] = [];
  const redactionValues: string[] = [];
  const claimedNames = new Set<string>();

  for (const unparsed of references) {
    const reference = e2bSecretReferenceSchema.parse(unparsed);
    if (
      !reference.targets.includes(options.targetId) ||
      !reference.components.includes(options.component) ||
      !reference.phases.includes(options.phase)
    ) {
      continue;
    }
    if (claimedNames.has(reference.inject_as)) {
      throw new E2BPolicyError(
        'duplicate_secret_injection',
        `More than one secret is configured for ${reference.inject_as}`
      );
    }
    const value = sourceEnvironment[reference.source.name];
    if (value === undefined || value === '') {
      throw new E2BPolicyError(
        'missing_secret_source',
        `Required environment source ${reference.source.name} is not set`
      );
    }
    claimedNames.add(reference.inject_as);
    env[reference.inject_as] = value;
    redactionNames.push(reference.inject_as, reference.source.name);
    redactionValues.push(value);
  }

  return {
    env,
    redactionNames: [...new Set(redactionNames)].sort(),
    redactionValues: [...new Set(redactionValues)],
  };
}
