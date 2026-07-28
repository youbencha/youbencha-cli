import {
  e2bCellManifestSchema,
  e2bProviderConfigSchema,
  e2bProviderStateSchema,
  e2bSecretReferenceSchema,
  e2bTemplateManifestSchema,
} from '../../src/e2b/schemas.js';

const deadlines = {
  phases_ms: {
    prepare: 1_000,
    agent: 2_000,
    evaluate: 1_000,
    post_evaluate: 1_000,
    package: 1_000,
  },
  collection_grace_ms: 1_000,
  cleanup_grace_ms: 1_000,
  sandbox_ttl_ms: 7_000,
  watchdog_ms: 8_000,
};

const artifactLimits = {
  max_files: 20,
  max_file_bytes: 1_000_000,
  max_compressed_bytes: 2_000_000,
  max_uncompressed_bytes: 5_000_000,
};

describe('E2B public schemas', () => {
  test('parses a strict provider policy with safe defaults', () => {
    const provider = e2bProviderConfigSchema.parse({
      provider: 'e2b',
      template: { template_id: 'codex-template', build_id: 'build-42' },
      network: {
        outbound: 'allowlist',
        allow: ['api.openai.com', 'github.com'],
      },
      expected_resources: { cpu_count: 2, memory_mb: 4096 },
      deadlines,
      artifact_limits: artifactLimits,
    });

    expect(provider.secure_access).toBe(true);
    expect(provider.strict_reproducibility).toBe(true);
    expect(provider.retention).toEqual({ mode: 'kill' });
    expect(provider.network.inbound).toBe('none');
  });

  test('accepts namespaced E2B template tags and rejects unsafe references', () => {
    const base = {
      provider: 'e2b',
      network: { outbound: 'none' },
      expected_resources: { cpu_count: 2, memory_mb: 4096 },
      deadlines,
      artifact_limits: artifactLimits,
    };
    expect(
      e2bProviderConfigSchema.parse({
        ...base,
        template: {
          template_id: 'team/codex-template:v1',
          build_id: 'team/codex-template:build-42',
        },
      }).template
    ).toEqual({
      template_id: 'team/codex-template:v1',
      build_id: 'team/codex-template:build-42',
    });
    expect(() =>
      e2bProviderConfigSchema.parse({
        ...base,
        template: { template_id: '../other/template:v1' },
      })
    ).toThrow(/template\/build reference/);
    expect(() =>
      e2bProviderConfigSchema.parse({
        ...base,
        template: { template_id: 'team/template:bad tag' },
      })
    ).toThrow(/template\/build reference/);
  });

  test('rejects ambiguous network entries and unrestricted egress without opt-in', () => {
    const base = {
      provider: 'e2b',
      template: { template_id: 'template' },
      expected_resources: { cpu_count: 2, memory_mb: 4096 },
      deadlines,
      artifact_limits: artifactLimits,
    };

    expect(() =>
      e2bProviderConfigSchema.parse({
        ...base,
        network: {
          outbound: 'allowlist',
          allow: ['https://api.openai.com/v1'],
        },
      })
    ).toThrow();
    expect(() =>
      e2bProviderConfigSchema.parse({
        ...base,
        network: { outbound: 'unrestricted' },
      })
    ).toThrow();
  });

  test('prohibits selecting the E2B control key for a sandbox phase', () => {
    expect(() =>
      e2bSecretReferenceSchema.parse({
        id: 'control-key',
        source: { type: 'environment', name: 'E2B_API_KEY' },
        inject_as: 'MODEL_TOKEN',
        targets: ['candidate'],
        components: ['agent'],
        phases: ['agent'],
      })
    ).toThrow(/E2B_API_KEY/);
  });

  test('rejects secret-bearing keys in serialized cell configuration', () => {
    expect(() =>
      e2bCellManifestSchema.parse({
        schema_version: '1.0.0',
        experiment_id: 'experiment',
        cell_id: 'a'.repeat(64),
        attempt_id: 'attempt-1',
        target: {
          id: 'candidate',
          agent_type: 'codex-cli',
          expected_harness_version: '1.2.3',
          adapter_schema_version: '1.0.0',
          config: { api_key: 'must-not-serialize' },
        },
        task: { prompt: 'fix it' },
        template: { template_id: 'template', build_id: 'build-42' },
        required_capabilities: [
          {
            component: 'agent',
            type: 'codex-cli',
            version: '1.2.3',
            adapter_schema_version: '1.0.0',
          },
        ],
        network: { outbound: 'none' },
        deadlines,
        artifact_limits: artifactLimits,
      })
    ).toThrow(/secret values/);
  });

  test('requires owned identity for active and retained lifecycle states', () => {
    expect(() =>
      e2bProviderStateSchema.parse({
        provider: 'e2b',
        lifecycle: 'running',
      })
    ).toThrow(/sandbox_id/);
    expect(() =>
      e2bProviderStateSchema.parse({
        provider: 'e2b',
        lifecycle: 'paused',
        sandbox_id: 'sandbox-1',
      })
    ).toThrow(/intended_expiry_at/);
  });

  test('template manifest advertises immutable identity and exact capabilities', () => {
    const parsed = e2bTemplateManifestSchema.parse({
      protocol_version: '1.0.0',
      runner_version: '0.1.5-beta',
      node_version: '22.17.0',
      git_version: '2.49.0',
      harnesses: [
        {
          type: 'codex-cli',
          version: '1.2.3',
          adapter_schema_versions: ['1.0.0'],
        },
      ],
      template_id: 'codex-template',
      build_id: 'build-42',
      artifact_protocol: { version: '1.0.0', limits: artifactLimits },
      resources: { cpu_count: 2, memory_mb: 4096 },
      runs_as_root: false,
      public_service: false,
      runtime_package_installation: false,
    });

    expect(parsed.build_id).toBe('build-42');
    expect(parsed.harnesses[0]?.version).toBe('1.2.3');
  });
});
