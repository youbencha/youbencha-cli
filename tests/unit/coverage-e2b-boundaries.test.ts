import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeRemoteArtifactPath,
  validateArtifactPackage,
  writeValidatedArtifactPackage,
  type InspectedArchiveEntry,
} from '../../src/e2b/artifacts.js';
import {
  resolveEffectiveNetworkPolicy,
  resolvePhaseEnvironment,
  validateProviderSecurityCapabilities,
  validateTemplateForCell,
} from '../../src/e2b/policies.js';
import {
  e2bArtifactLimitsSchema,
  e2bCellManifestSchema,
  e2bNetworkEntrySchema,
  e2bProviderStateSchema,
  e2bSecretReferenceSchema,
  e2bTemplateReferenceSchema,
} from '../../src/e2b/schemas.js';
import { evaluateFixtureSnapshotEligibility } from '../../src/e2b/snapshot.js';
import { E2BSandboxService } from '../../src/e2b/reconciliation.js';
import type { E2BClient } from '../../src/e2b/client.js';

function hash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const limits = {
  max_files: 4,
  max_file_bytes: 100,
  max_compressed_bytes: 100,
  max_uncompressed_bytes: 200,
};

function artifactFixture() {
  const contents = Buffer.from('{"ok":true}');
  const archive = Buffer.from('archive');
  return {
    contents,
    archive,
    manifest: {
      schema_version: '1.0.0',
      artifact_protocol_version: '1.0.0',
      experiment_id: 'experiment',
      cell_id: 'a'.repeat(64),
      attempt_id: 'attempt',
      result_schema_version: '1.0.0',
      remote_result_path: 'nested/results.json',
      runner_status: 'completed',
      artifacts: [
        {
          path: 'nested/results.json',
          uncompressed_size: contents.byteLength,
          compressed_size: 5,
          sha256: hash(contents),
        },
      ],
      archive: {
        sha256: hash(archive),
        compressed_size: archive.byteLength,
        uncompressed_size: contents.byteLength,
      },
      completion: {
        redaction_applied: true,
        truncation_applied: false,
      },
    },
    entries: [
      { path: 'nested', type: 'directory' as const },
      {
        path: 'nested/results.json',
        type: 'file' as const,
        contents,
        compressedSize: 5,
      },
    ],
  };
}

const ownership = {
  experimentId: 'experiment',
  cellId: 'a'.repeat(64),
  attemptId: 'attempt',
};

function validate(
  manifest: unknown,
  archive: Uint8Array,
  entries: readonly InspectedArchiveEntry[]
) {
  return validateArtifactPackage(manifest, archive, entries, {
    ownership,
    limits,
    expectedArtifactProtocolVersion: '1.0.0',
    validateResultSchema: false,
  });
}

const template = {
  protocol_version: '1.0.0',
  runner_version: '1.0.0',
  node_version: '22',
  git_version: '2',
  harnesses: [
    {
      type: 'codex-cli',
      version: '1.0.0',
      adapter_schema_versions: ['1.0.0'],
    },
  ],
  template_id: 'template',
  build_id: 'build',
  artifact_protocol: { version: '1.0.0', limits },
  resources: { cpu_count: 2, memory_mb: 4096 },
  runs_as_root: false,
  public_service: false,
  runtime_package_installation: false,
};

const templateOptions = {
  protocolVersion: '1.0.0',
  artifactProtocolVersion: '1.0.0',
  templateId: 'template',
  expectedBuildId: 'build',
  expectedResources: { cpu_count: 2, memory_mb: 4096 },
  requiredCapabilities: [
    {
      component: 'agent',
      type: 'codex-cli',
      version: '1.0.0',
      adapter_schema_version: '1.0.0',
    },
  ],
  strictReproducibility: true,
};

describe('E2B boundary coverage', () => {
  test.each([
    '',
    'a\0b',
    'a\\b',
    '/absolute',
    'C:\\absolute',
    'C:relative',
    '//server/path',
    '\\\\server\\path',
    'NUL',
    'a/',
    './a',
    'a/../b',
  ])('rejects remote path %j', (value) => {
    expect(() => normalizeRemoteArtifactPath(value)).toThrow();
  });

  test('rejects each artifact package invariant', () => {
    const base = artifactFixture();
    const mutate = (
      mutation: (fixture: ReturnType<typeof artifactFixture>) => void,
      entries?: readonly InspectedArchiveEntry[]
    ): void => {
      const fixture = artifactFixture();
      mutation(fixture);
      expect(() =>
        validate(fixture.manifest, fixture.archive, entries ?? fixture.entries)
      ).toThrow();
    };

    mutate((fixture) => {
      fixture.manifest.artifact_protocol_version = 'invalid';
    });
    expect(() =>
      validateArtifactPackage(base.manifest, base.archive, base.entries, {
        ownership,
        limits,
        expectedArtifactProtocolVersion: 'v2',
        validateResultSchema: false,
      })
    ).toThrow(/protocol/);
    mutate((fixture) => {
      fixture.manifest.archive.compressed_size = 101;
    });
    mutate((fixture) => {
      fixture.manifest.archive.compressed_size += 1;
    });
    mutate((fixture) => {
      fixture.manifest.archive.sha256 = 'b'.repeat(64);
    });
    mutate((fixture) => {
      fixture.manifest.archive.uncompressed_size = 201;
    });
    mutate((fixture) => {
      fixture.manifest.artifacts[0].uncompressed_size = 101;
      fixture.manifest.archive.uncompressed_size = 101;
    });
    mutate((fixture) => {
      fixture.manifest.archive.uncompressed_size += 1;
    });
    mutate(
      () => undefined,
      [
        ...base.entries,
        {
          path: 'NESTED/RESULTS.JSON',
          type: 'file',
          contents: base.contents,
        },
      ]
    );
    mutate(() => undefined, [{ path: 'nested/results.json', type: 'file' }]);
    mutate(
      () => undefined,
      [
        {
          path: 'nested/results.json',
          type: 'file',
          contents: Buffer.from('different'),
        },
      ]
    );
    mutate(
      () => undefined,
      [
        {
          path: 'nested/results.json',
          type: 'file',
          contents: base.contents,
          compressedSize: 6,
        },
      ]
    );
    mutate(
      () => undefined,
      [
        {
          path: 'nested/results.json',
          type: 'file',
          contents: Buffer.from('{"no":true}'),
          compressedSize: 5,
        },
      ]
    );
    mutate(() => undefined, []);
    mutate((fixture) => {
      fixture.manifest.remote_result_path = 'missing.json';
    });
    mutate((fixture) => {
      const invalid = Buffer.from('not-json');
      fixture.contents = invalid;
      fixture.manifest.artifacts[0].uncompressed_size = invalid.byteLength;
      fixture.manifest.artifacts[0].sha256 = hash(invalid);
      fixture.manifest.archive.uncompressed_size = invalid.byteLength;
      fixture.entries[1].contents = invalid;
    });
  });

  test('writes validated files without following unsafe parents', async () => {
    const fixture = artifactFixture();
    const validated = validate(
      fixture.manifest,
      fixture.archive,
      fixture.entries
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-artifact-'));
    try {
      await writeValidatedArtifactPackage(validated, root);
      await expect(
        fs.readFile(path.join(root, 'nested', 'results.json'), 'utf8')
      ).resolves.toBe('{"ok":true}');
      await expect(
        writeValidatedArtifactPackage(validated, root)
      ).rejects.toThrow();

      const unsafeRoot = path.join(root, 'unsafe');
      await fs.symlink(root, unsafeRoot, 'junction');
      await expect(
        writeValidatedArtifactPackage(validated, unsafeRoot)
      ).rejects.toThrow(/real directory/);

      const linkedParentRoot = path.join(root, 'linked-parent');
      await fs.mkdir(linkedParentRoot);
      await fs.symlink(root, path.join(linkedParentRoot, 'nested'), 'junction');
      await expect(
        writeValidatedArtifactPackage(validated, linkedParentRoot)
      ).rejects.toThrow(/symlink/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('validates template mismatch and non-strict warning paths', () => {
    for (const [change, optionChange] of [
      [{ protocol_version: '2.0.0' }, {}],
      [{}, { protocolVersion: 'invalid' }],
      [
        { artifact_protocol: { ...template.artifact_protocol, version: '2' } },
        {},
      ],
      [{ template_id: 'other' }, {}],
      [{ build_id: 'other' }, {}],
      [{ resources: { cpu_count: 3, memory_mb: 4096 } }, {}],
      [{ resources: { cpu_count: 2, memory_mb: 2048 } }, {}],
      [{ runs_as_root: true }, {}],
      [{ public_service: true }, {}],
      [{ runtime_package_installation: true }, {}],
      [
        {
          harnesses: [
            { ...template.harnesses[0], adapter_schema_versions: ['2'] },
          ],
        },
        {},
      ],
    ] as const) {
      expect(() =>
        validateTemplateForCell(
          { ...template, ...change },
          { ...templateOptions, ...optionChange }
        )
      ).toThrow();
    }
    expect(
      validateTemplateForCell(
        {
          ...template,
          harnesses: [{ ...template.harnesses[0], version: '1.1.0' }],
        },
        { ...templateOptions, strictReproducibility: false }
      ).warnings
    ).toHaveLength(1);
  });

  test('covers provider policies and phase secret failures', () => {
    expect(
      resolveEffectiveNetworkPolicy(
        [
          {
            inbound: 'none',
            outbound: 'unrestricted',
            explicit_opt_in: true,
          },
        ],
        false
      )
    ).toMatchObject({ outbound: 'unrestricted' });
    expect(resolveEffectiveNetworkPolicy([], true)).toMatchObject({
      outbound: 'none',
    });
    const capabilities = {
      securedAccess: true,
      outboundDeny: true,
      outboundAllowlist: true,
      immutableBuildSelection: true,
      snapshots: true,
    };
    expect(() =>
      validateProviderSecurityCapabilities(
        { inbound: 'none', outbound: 'none' },
        { ...capabilities, securedAccess: false }
      )
    ).toThrow(/secured/);
    expect(() =>
      validateProviderSecurityCapabilities(
        { inbound: 'none', outbound: 'none' },
        { ...capabilities, outboundDeny: false }
      )
    ).toThrow(/deny/);
    validateProviderSecurityCapabilities(
      { inbound: 'none', outbound: 'none' },
      capabilities
    );

    const reference = {
      id: 'secret',
      source: { type: 'environment' as const, name: 'SOURCE' },
      inject_as: 'TOKEN',
      targets: ['target'],
      components: ['agent'],
      phases: ['agent' as const],
    };
    expect(() =>
      resolvePhaseEnvironment([reference], {
        targetId: 'target',
        component: 'agent',
        phase: 'agent',
        environment: {},
      })
    ).toThrow(/not set/);
    expect(() =>
      resolvePhaseEnvironment([reference, { ...reference, id: 'secret2' }], {
        targetId: 'target',
        component: 'agent',
        phase: 'agent',
        environment: { SOURCE: 'value' },
      })
    ).toThrow(/More than one/);
    expect(
      resolvePhaseEnvironment(
        [reference],
        {
          targetId: 'other',
          component: 'agent',
          phase: 'agent',
          environment: { SOURCE: 'value' },
        },
        { PATH: '', HOME: '/home' }
      ).env
    ).toEqual({ HOME: '/home' });

    const previous = process.env.COVERAGE_E2B_SECRET;
    process.env.COVERAGE_E2B_SECRET = 'ambient-value';
    try {
      expect(
        resolvePhaseEnvironment(
          [
            {
              ...reference,
              source: {
                type: 'environment',
                name: 'COVERAGE_E2B_SECRET',
              },
            },
          ],
          {
            targetId: 'target',
            component: 'agent',
            phase: 'agent',
          }
        ).env
      ).toMatchObject({ TOKEN: 'ambient-value' });
    } finally {
      if (previous === undefined) delete process.env.COVERAGE_E2B_SECRET;
      else process.env.COVERAGE_E2B_SECRET = previous;
    }
  });

  test('kills a verified owned sandbox through the managed service', async () => {
    const killSandbox = jest.fn().mockResolvedValue(undefined);
    const client = {
      listSandboxes: jest.fn().mockResolvedValue([
        {
          sandboxId: 'owned',
          metadata: {
            owner: 'owner',
            project: 'project',
          },
        },
      ]),
      killSandbox,
    } as unknown as E2BClient;
    const service = new E2BSandboxService(client, {
      owner: 'owner',
      project: 'project',
    });
    await service.kill('owned');
    expect(killSandbox).toHaveBeenCalledWith('owned');
  });

  test('exercises E2B schema refinements', () => {
    for (const value of [
      'x'.repeat(254),
      'https://host',
      'host\\path',
      'user@host',
      'host?query',
      'host#fragment',
      '.host',
      'host.',
      'host/a/b',
      'host/not-a-prefix',
      '',
      '*.host',
      'host:443',
    ]) {
      expect(e2bNetworkEntrySchema.safeParse(value).success).toBe(false);
    }
    expect(
      e2bArtifactLimitsSchema.safeParse({
        ...limits,
        max_file_bytes: 201,
      }).success
    ).toBe(false);
    for (const secret of [
      {
        id: 'secret',
        source: { type: 'environment', name: 'E2B_API_KEY' },
        inject_as: 'TOKEN',
        targets: ['target'],
        components: ['agent'],
        phases: ['agent'],
      },
      {
        id: 'secret',
        source: { type: 'environment', name: 'SOURCE' },
        inject_as: 'e2b_api_key',
        targets: ['target'],
        components: ['agent'],
        phases: ['agent'],
      },
    ]) {
      expect(e2bSecretReferenceSchema.safeParse(secret).success).toBe(false);
    }
    for (const reference of ['/root', 'root/', 'a\\b', 'a//b', 'a/../b']) {
      expect(
        e2bTemplateReferenceSchema.safeParse({ template_id: reference }).success
      ).toBe(false);
    }
  });

  test('rejects nested forbidden manifest keys and invalid provider states', () => {
    const baseManifest = {
      schema_version: '1.0.0',
      experiment_id: 'experiment',
      cell_id: 'a'.repeat(64),
      attempt_id: 'attempt',
      target: {
        id: 'target',
        agent_type: 'codex-cli',
        expected_harness_version: '1',
        adapter_schema_version: '1',
        config: {},
      },
      task: {},
      template: { template_id: 'template', build_id: 'build' },
      required_capabilities: [
        {
          component: 'agent',
          type: 'codex-cli',
          version: '1',
          adapter_schema_version: '1',
        },
      ],
      network: { outbound: 'none' },
      deadlines: {
        phases_ms: {
          prepare: 1,
          agent: 1,
          evaluate: 1,
          post_evaluate: 1,
          package: 1,
        },
        collection_grace_ms: 0,
        cleanup_grace_ms: 0,
        sandbox_ttl_ms: 5,
        watchdog_ms: 5,
      },
      artifact_limits: limits,
      secret_references: [],
    };
    expect(
      e2bCellManifestSchema.safeParse({
        ...baseManifest,
        target: {
          ...baseManifest.target,
          config: { nested: [{ password: 'secret' }] },
        },
      }).success
    ).toBe(false);
    expect(
      e2bCellManifestSchema.safeParse({
        ...baseManifest,
        task: { API_KEY: 'secret' },
      }).success
    ).toBe(false);
    expect(
      e2bProviderStateSchema.safeParse({
        provider: 'e2b',
        lifecycle: 'running',
      }).success
    ).toBe(false);
    expect(
      e2bProviderStateSchema.safeParse({
        provider: 'e2b',
        lifecycle: 'paused',
        sandbox_id: 'sandbox',
      }).success
    ).toBe(false);
  });

  test('reports every fixture snapshot ineligibility reason', () => {
    const result = evaluateFixtureSnapshotEligibility({
      templateBuildId: undefined,
      sourceCommit: 'commit',
      testConfigHash: 'test',
      cacheableSetupConfigHash: 'setup',
      runnerProtocolVersion: '1',
      allSetupStepsCacheable: false,
      targetSecretExposed: true,
      sourceOrSetupCredentialExposed: true,
      residualProcessCount: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(5);
  });
});
