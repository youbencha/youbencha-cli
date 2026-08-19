import { createHash } from 'crypto';
import {
  normalizeRemoteArtifactPath,
  validateArtifactPackage,
} from '../../src/e2b/artifacts.js';
import {
  E2BPolicyError,
  resolveEffectiveNetworkPolicy,
  resolvePhaseEnvironment,
  validateDeadlines,
  validateProviderSecurityCapabilities,
  validateTemplateForCell,
} from '../../src/e2b/policies.js';
import {
  E2B_CELL_MANIFEST_PATH,
  E2B_RUNNER_EXECUTABLE,
  runnerCommand,
} from '../../src/e2b/runner-protocol.js';
import { evaluateFixtureSnapshotEligibility } from '../../src/e2b/snapshot.js';

const limits = {
  max_files: 10,
  max_file_bytes: 20_000,
  max_compressed_bytes: 20_000,
  max_uncompressed_bytes: 50_000,
};

const template = {
  protocol_version: '1.2.0',
  runner_version: '0.1.5-beta',
  node_version: '22.17.0',
  git_version: '2.49.0',
  harnesses: [
    {
      type: 'codex-cli',
      version: '1.2.3',
      adapter_schema_versions: ['1.0.0'],
    },
    {
      type: 'claude-code',
      version: '2.0.0',
      adapter_schema_versions: ['1.0.0'],
    },
  ],
  template_id: 'coding-agents',
  build_id: 'build-42',
  artifact_protocol: { version: '1.1.0', limits },
  resources: { cpu_count: 2, memory_mb: 4096 },
  runs_as_root: false,
  public_service: false,
  runtime_package_installation: false,
};

const templateOptions = {
  protocolVersion: '1.0.0',
  artifactProtocolVersion: '1.0.0',
  templateId: 'coding-agents',
  expectedBuildId: 'build-42',
  expectedResources: { cpu_count: 2, memory_mb: 4096 },
  requiredCapabilities: [
    {
      component: 'agent',
      type: 'codex-cli',
      version: '1.2.3',
      adapter_schema_version: '1.0.0',
    },
    {
      component: 'judge',
      type: 'claude-code',
      version: '2.0.0',
      adapter_schema_version: '1.0.0',
    },
  ],
  strictReproducibility: true,
};

describe('E2B runner and policy contracts', () => {
  test('runner commands use only the closed phase and fixed manifest path', () => {
    expect(runnerCommand('agent')).toEqual({
      executable: E2B_RUNNER_EXECUTABLE,
      args: ['agent', E2B_CELL_MANIFEST_PATH],
      cwd: '/work',
    });
  });

  test('validates the complete target and judge capability set', () => {
    const result = validateTemplateForCell(template, templateOptions);
    expect(result.warnings).toEqual([]);

    expect(() =>
      validateTemplateForCell(
        {
          ...template,
          harnesses: template.harnesses.slice(0, 1),
        },
        templateOptions
      )
    ).toThrow(/judge harness/);
  });

  test('strict mode requires an immutable build and exact harness version', () => {
    expect(() =>
      validateTemplateForCell(template, {
        ...templateOptions,
        expectedBuildId: undefined,
      })
    ).toThrow(/immutable expected template build/);
    expect(() =>
      validateTemplateForCell(
        {
          ...template,
          harnesses: [
            { ...template.harnesses[0], version: '1.2.4' },
            template.harnesses[1],
          ],
        },
        templateOptions
      )
    ).toThrow(/does not match required/);
  });

  test('unions target network requirements and fails closed on unsupported controls', () => {
    expect(
      resolveEffectiveNetworkPolicy(
        [
          { inbound: 'none', outbound: 'none' },
          {
            inbound: 'none',
            outbound: 'allowlist',
            allow: ['api.openai.com', 'github.com'],
          },
          {
            inbound: 'none',
            outbound: 'allowlist',
            allow: ['API.OPENAI.COM'],
          },
        ],
        true
      )
    ).toEqual({
      inbound: 'none',
      outbound: 'allowlist',
      allow: ['api.openai.com', 'github.com'],
    });

    expect(() =>
      validateProviderSecurityCapabilities(
        {
          inbound: 'none',
          outbound: 'allowlist',
          allow: ['api.openai.com'],
        },
        {
          securedAccess: true,
          outboundDeny: true,
          outboundAllowlist: false,
          immutableBuildSelection: true,
          snapshots: true,
        }
      )
    ).toThrow(/cannot enforce/);
    expect(() =>
      resolveEffectiveNetworkPolicy(
        [
          {
            inbound: 'none',
            outbound: 'unrestricted',
            explicit_opt_in: true,
          },
        ],
        true
      )
    ).toThrow(E2BPolicyError);
  });

  test('injects only component/target/phase secrets into a minimal environment', () => {
    const resolved = resolvePhaseEnvironment(
      [
        {
          id: 'agent-token',
          source: { type: 'environment', name: 'HOST_AGENT_TOKEN' },
          inject_as: 'MODEL_TOKEN',
          targets: ['candidate'],
          components: ['agent'],
          phases: ['agent'],
        },
        {
          id: 'judge-token',
          source: { type: 'environment', name: 'HOST_JUDGE_TOKEN' },
          inject_as: 'JUDGE_TOKEN',
          targets: ['candidate'],
          components: ['judge'],
          phases: ['evaluate'],
        },
      ],
      {
        targetId: 'candidate',
        component: 'agent',
        phase: 'agent',
        environment: {
          HOST_AGENT_TOKEN: 'agent-canary',
          HOST_JUDGE_TOKEN: 'judge-canary',
        },
      },
      {
        PATH: '/bin',
        HOME: '/home/user',
        CI_JOB_TOKEN: 'must-not-forward',
      }
    );

    expect(resolved.env).toEqual({
      PATH: '/bin',
      HOME: '/home/user',
      MODEL_TOKEN: 'agent-canary',
    });
    expect(resolved.redactionValues).toEqual(['agent-canary']);
    expect(JSON.stringify(resolved)).not.toContain('judge-canary');
  });

  test('rejects inconsistent phase, sandbox, and watchdog deadlines', () => {
    const base = {
      phases_ms: {
        prepare: 100,
        agent: 200,
        evaluate: 100,
        post_evaluate: 100,
        package: 100,
      },
      collection_grace_ms: 100,
      cleanup_grace_ms: 50,
      sandbox_ttl_ms: 700,
      watchdog_ms: 750,
    };
    expect(validateDeadlines(base)).toEqual(base);
    expect(() => validateDeadlines({ ...base, sandbox_ttl_ms: 699 })).toThrow(
      /Sandbox TTL/
    );
    expect(() => validateDeadlines({ ...base, watchdog_ms: 749 })).toThrow(
      /watchdog/
    );
  });

  test('only creates a fixture snapshot identity for secret-free clean setup', () => {
    const candidate = {
      templateBuildId: 'build-42',
      sourceCommit: 'a'.repeat(40),
      testConfigHash: 'b'.repeat(64),
      cacheableSetupConfigHash: 'c'.repeat(64),
      runnerProtocolVersion: '1.0.0',
      allSetupStepsCacheable: true,
      targetSecretExposed: false,
      sourceOrSetupCredentialExposed: false,
      residualProcessCount: 0,
    };
    const eligible = evaluateFixtureSnapshotEligibility(candidate);
    expect(eligible.eligible).toBe(true);
    expect(eligible.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(
      evaluateFixtureSnapshotEligibility({
        ...candidate,
        targetSecretExposed: true,
      })
    ).toEqual({
      eligible: false,
      reasons: ['A target secret has already been exposed'],
    });
  });
});

describe('remote artifact validation', () => {
  function hash(value: Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
  }

  function fixture(
    path = 'results.json',
    result: unknown = { ok: true }
  ): {
    manifest: unknown;
    archive: Uint8Array;
    entries: Array<{
      path: string;
      type: 'file';
      contents: Uint8Array;
    }>;
  } {
    const contents = Buffer.from(JSON.stringify(result));
    const archive = Buffer.from('bounded archive transport bytes');
    return {
      manifest: {
        schema_version: '1.0.0',
        artifact_protocol_version: '1.0.0',
        experiment_id: 'experiment',
        cell_id: 'a'.repeat(64),
        attempt_id: 'attempt-1',
        result_schema_version: '1.0.0',
        remote_result_path: path,
        runner_status: 'completed',
        artifacts: [
          {
            path,
            uncompressed_size: contents.byteLength,
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
      archive,
      entries: [{ path, type: 'file', contents }],
    };
  }

  const options = {
    ownership: {
      experimentId: 'experiment',
      cellId: 'a'.repeat(64),
      attemptId: 'attempt-1',
    },
    limits,
    expectedArtifactProtocolVersion: '1.0.0',
    validateResultSchema: false,
  };

  test('accepts a bounded, owned, hash-consistent package', () => {
    const { manifest, archive, entries } = fixture();
    const validated = validateArtifactPackage(
      manifest,
      archive,
      entries,
      options
    );
    expect(validated.result).toEqual({ ok: true });
    expect(validated.files).toHaveLength(1);
  });

  test.each([
    '../escape.json',
    '/absolute.json',
    'C:/device.json',
    'nested\\windows.json',
    'nested//empty.json',
    'con/output.json',
  ])('rejects unsafe artifact path %s', (unsafePath) => {
    expect(() => normalizeRemoteArtifactPath(unsafePath)).toThrow(
      /safe|unsafe|normalized/
    );
  });

  test('rejects links, undeclared files, ownership mismatch, and hash mismatch', () => {
    const fixtureValue = fixture();
    expect(() =>
      validateArtifactPackage(
        fixtureValue.manifest,
        fixtureValue.archive,
        [
          {
            path: 'results.json',
            type: 'symlink',
            linkTarget: '../../secret',
          },
        ],
        options
      )
    ).toThrow(/link/);
    expect(() =>
      validateArtifactPackage(
        fixtureValue.manifest,
        fixtureValue.archive,
        [
          ...fixtureValue.entries,
          {
            path: 'extra.txt',
            type: 'file',
            contents: Buffer.from('extra'),
          },
        ],
        options
      )
    ).toThrow(/not declared/);
    expect(() =>
      validateArtifactPackage(
        fixtureValue.manifest,
        fixtureValue.archive,
        fixtureValue.entries,
        {
          ...options,
          ownership: { ...options.ownership, attemptId: 'attempt-2' },
        }
      )
    ).toThrow(/ownership/);
    expect(() =>
      validateArtifactPackage(
        fixtureValue.manifest,
        Buffer.from('tampered'),
        fixtureValue.entries,
        options
      )
    ).toThrow(/size|hash/);
  });

  test('rejects duplicate case-colliding paths and invalid result schema by default', () => {
    const contents = Buffer.from('{}');
    const archive = Buffer.from('archive');
    const manifest = {
      schema_version: '1.0.0',
      artifact_protocol_version: '1.0.0',
      experiment_id: 'experiment',
      cell_id: 'a'.repeat(64),
      attempt_id: 'attempt-1',
      result_schema_version: '1.0.0',
      remote_result_path: 'results.json',
      runner_status: 'completed',
      artifacts: [
        {
          path: 'results.json',
          uncompressed_size: contents.byteLength,
          sha256: hash(contents),
        },
        {
          path: 'RESULTS.JSON',
          uncompressed_size: contents.byteLength,
          sha256: hash(contents),
        },
      ],
      archive: {
        sha256: hash(archive),
        compressed_size: archive.byteLength,
        uncompressed_size: contents.byteLength * 2,
      },
      completion: {
        redaction_applied: true,
        truncation_applied: false,
      },
    };
    expect(() =>
      validateArtifactPackage(
        manifest,
        archive,
        [
          { path: 'results.json', type: 'file', contents },
          { path: 'RESULTS.JSON', type: 'file', contents },
        ],
        options
      )
    ).toThrow(/case-colliding/);

    const invalidResultFixture = fixture();
    expect(() =>
      validateArtifactPackage(
        invalidResultFixture.manifest,
        invalidResultFixture.archive,
        invalidResultFixture.entries,
        { ...options, validateResultSchema: true }
      )
    ).toThrow();
  });
});
