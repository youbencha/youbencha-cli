import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { compress as compressZstd } from '@mongodb-js/zstd';
import { TokenBucket } from '../../src/experiments/token-bucket.js';
import { TargetUnavailableError } from '../../src/experiments/target-circuit-breaker.js';
import { ExperimentExecutionError } from '../../src/experiments/retry.js';
import type {
  PlannedExperimentCell,
  RemoteAttemptLifecycleEvent,
} from '../../src/experiments/single-run-executor.js';
import type {
  E2BClient,
  E2BCreateSandboxRequest,
  E2BListSandboxFilter,
  E2BRemoteCommand,
  E2BRemoteCommandResult,
  E2BSandboxHandle,
  E2BSandboxInfo,
} from '../../src/e2b/client.js';
import {
  E2BSingleRunExecutor,
  inspectTarZstdArchive,
} from '../../src/e2b/executor.js';
import {
  E2B_CELL_MANIFEST_PATH,
  E2B_OUTPUT_ARCHIVE_PATH,
  E2B_OUTPUT_MANIFEST_PATH,
} from '../../src/e2b/runner-protocol.js';
import type {
  E2BArtifactManifest,
  E2BProviderConfig,
  E2BTemplateManifest,
} from '../../src/e2b/schemas.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

function hash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const result: ResultsBundle = {
  version: '1.0.0',
  test_case: {
    name: 'test',
    description: 'test',
    config_file: 'task.yaml',
    config_hash: 'config-hash',
    repo: 'https://github.com/example/repo.git',
    branch: 'main',
    commit: 'a'.repeat(40),
  },
  execution: {
    started_at: '2026-07-27T00:00:00.000Z',
    completed_at: '2026-07-27T00:00:01.000Z',
    duration_ms: 1000,
    youbencha_version: '0.1.5-beta',
    environment: {
      os: 'linux',
      node_version: '22.0.0',
      workspace_dir: '/work/repo',
    },
  },
  agent: {
    type: 'codex-cli',
    youbencha_log_path: 'agent.json',
    status: 'success',
    exit_code: 0,
  },
  evaluators: [],
  summary: {
    total_evaluators: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    overall_status: 'passed',
  },
  artifacts: {
    agent_log: 'agent.json',
    reports: [],
    evaluator_artifacts: [],
  },
};

const provider: E2BProviderConfig = {
  provider: 'e2b',
  template: {
    template_id: 'codex-template',
    build_id: 'build-42',
  },
  strict_reproducibility: true,
  secure_access: true,
  network: {
    inbound: 'none',
    outbound: 'allowlist',
    allow: ['api.openai.com'],
  },
  expected_resources: { cpu_count: 2, memory_mb: 4096 },
  deadlines: {
    phases_ms: {
      prepare: 100,
      agent: 100,
      evaluate: 100,
      post_evaluate: 100,
      package: 100,
    },
    collection_grace_ms: 100,
    cleanup_grace_ms: 100,
    sandbox_ttl_ms: 600,
    watchdog_ms: 700,
  },
  artifact_limits: {
    max_files: 10,
    max_file_bytes: 100_000,
    max_compressed_bytes: 100_000,
    max_uncompressed_bytes: 200_000,
  },
  runtime_package_installation: false,
  retention: { mode: 'kill' },
};

const templateManifest: E2BTemplateManifest = {
  protocol_version: '1.0.0',
  runner_version: '0.1.5-beta',
  node_version: '22.0.0',
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
  artifact_protocol: {
    version: '1.0.0',
    limits: provider.artifact_limits,
  },
  resources: { cpu_count: 2, memory_mb: 4096 },
  runs_as_root: false,
  public_service: false,
  runtime_package_installation: false,
};

const cell: PlannedExperimentCell = {
  cellId: 'a'.repeat(64),
  testcaseId: 'fix-auth',
  variantName: 'candidate',
  repetition: 0,
  configHash: 'b'.repeat(64),
  config: {
    name: 'Fix auth',
    description: 'Fix auth',
    repo: 'https://github.com/example/repo.git',
    commit: 'a'.repeat(40),
    agent: {
      type: 'codex-cli',
      model: 'gpt-5',
      config: {
        prompt: 'fix it',
        sandbox: 'workspace-write',
        approval_policy: 'never',
        ephemeral: true,
        ignore_user_config: true,
        ignore_rules: false,
        search: false,
      },
    },
    evaluators: [{ name: 'git-diff' }],
  },
};

class FakeSandbox implements E2BSandboxHandle {
  public readonly sandboxId = 'sandbox-1';
  public readonly commands: E2BRemoteCommand[] = [];
  public readonly terminated: string[] = [];
  private readonly activeGroups = new Set<string>();
  public cellManifest: unknown;
  public phaseFailure?: { phase: string; exitCode: number; output: string };
  private artifactManifest?: E2BArtifactManifest;
  private readonly archive = Buffer.from('archive transport');
  private readonly resultBytes = Buffer.from(JSON.stringify(result));
  private readonly logBytes = Buffer.from(
    JSON.stringify({
      version: '1.0.0',
      agent: {
        name: 'Codex CLI',
        version: '1.2.3',
        adapter_version: '1.0.0',
      },
      model: { name: 'gpt-5', provider: 'OpenAI', parameters: {} },
      execution: {
        started_at: '2026-07-27T00:00:00.000Z',
        completed_at: '2026-07-27T00:00:01.000Z',
        duration_ms: 1000,
        exit_code: 0,
        status: 'success',
      },
      messages: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        cost_usd: 0.01,
        measurement_source: 'measured',
      },
      errors: [],
      environment: {
        os: 'Linux',
        node_version: '22.0.0',
        youbencha_version: '0.1.5-beta',
        working_directory: '/work/repo',
      },
    })
  );

  public constructor(
    private readonly request: E2BCreateSandboxRequest,
    private readonly resources = { cpu_count: 2, memory_mb: 4096 }
  ) {}

  public async getInfo(): Promise<E2BSandboxInfo> {
    return {
      sandboxId: this.sandboxId,
      templateId: 'codex-template',
      buildId: 'build-42',
      lifecycle: 'running',
      secureAccess: true,
      resources: this.resources,
      network: this.request.network,
      metadata: this.request.metadata,
      createdAt: '2026-07-27T00:00:00.000Z',
    };
  }

  public async writeFile(file: string, contents: Uint8Array): Promise<void> {
    expect(file).toBe(E2B_CELL_MANIFEST_PATH);
    this.cellManifest = JSON.parse(Buffer.from(contents).toString('utf8'));
  }

  public async readFile(file: string, _maxBytes: number): Promise<Uint8Array> {
    if (file === '/opt/youbencha/manifest.json') {
      return Buffer.from(JSON.stringify(templateManifest));
    }
    if (file === E2B_OUTPUT_MANIFEST_PATH) {
      if (this.artifactManifest === undefined) {
        throw new Error('Artifacts were not packaged');
      }
      return Buffer.from(JSON.stringify(this.artifactManifest));
    }
    if (file === E2B_OUTPUT_ARCHIVE_PATH) return this.archive;
    throw new Error(`Unexpected read ${file}`);
  }

  public async runCommand(
    command: E2BRemoteCommand
  ): Promise<E2BRemoteCommandResult> {
    this.commands.push(command);
    const phase = command.args[0];
    if (phase === 'package') {
      const manifest = this.cellManifest as {
        experiment_id: string;
        cell_id: string;
        attempt_id: string;
      };
      this.artifactManifest = {
        schema_version: '1.0.0',
        artifact_protocol_version: '1.0.0',
        experiment_id: manifest.experiment_id,
        cell_id: manifest.cell_id,
        attempt_id: manifest.attempt_id,
        result_schema_version: '1.0.0',
        remote_result_path: 'results.json',
        runner_status: 'completed',
        artifacts: [
          {
            path: 'results.json',
            uncompressed_size: this.resultBytes.byteLength,
            sha256: hash(this.resultBytes),
            redacted: true,
            truncated: false,
          },
          {
            path: 'agent.json',
            uncompressed_size: this.logBytes.byteLength,
            sha256: hash(this.logBytes),
            redacted: true,
            truncated: false,
          },
        ],
        archive: {
          sha256: hash(this.archive),
          compressed_size: this.archive.byteLength,
          uncompressed_size:
            this.resultBytes.byteLength + this.logBytes.byteLength,
        },
        completion: {
          redaction_applied: true,
          truncation_applied: false,
        },
      };
    }
    const failure =
      this.phaseFailure?.phase === phase ? this.phaseFailure : undefined;
    const processGroupId = `process-${phase}`;
    this.activeGroups.add(processGroupId);
    return {
      exitCode: failure?.exitCode ?? 0,
      stdout: failure?.output ?? '',
      stderr: '',
      startedAt: '2026-07-27T00:00:00.000Z',
      completedAt: '2026-07-27T00:00:01.000Z',
      processGroupId,
    };
  }

  public async terminateProcessGroup(id: string): Promise<void> {
    this.terminated.push(id);
    this.activeGroups.delete(id);
  }

  public async isProcessGroupRunning(id: string): Promise<boolean> {
    return this.activeGroups.has(id);
  }

  public artifactEntries(): Array<{
    path: string;
    type: 'file';
    contents: Uint8Array;
  }> {
    return [
      { path: 'results.json', type: 'file', contents: this.resultBytes },
      { path: 'agent.json', type: 'file', contents: this.logBytes },
    ];
  }
}

class FakeClient implements E2BClient {
  public readonly sdkVersion = 'fake';
  public readonly capabilities = {
    securedAccess: true,
    outboundDeny: true,
    outboundAllowlist: true,
    immutableBuildSelection: true,
    snapshots: true,
  };
  public created: E2BCreateSandboxRequest[] = [];
  public killed: string[] = [];
  public paused: string[] = [];
  public existing: E2BSandboxInfo[] = [];
  public sandbox?: FakeSandbox;
  public resources = { cpu_count: 2, memory_mb: 4096 };
  public createError?: Error;

  public async createSandbox(
    request: E2BCreateSandboxRequest
  ): Promise<E2BSandboxHandle> {
    if (this.createError !== undefined) throw this.createError;
    this.created.push(request);
    this.sandbox = new FakeSandbox(request, this.resources);
    return this.sandbox;
  }

  public async connectSandbox(_sandboxId: string): Promise<E2BSandboxHandle> {
    if (this.sandbox === undefined) throw new Error('No sandbox');
    return this.sandbox;
  }

  public async listSandboxes(
    _filter: E2BListSandboxFilter
  ): Promise<E2BSandboxInfo[]> {
    return this.existing;
  }

  public async killSandbox(sandboxId: string): Promise<void> {
    this.killed.push(sandboxId);
  }

  public async pauseSandbox(sandboxId: string): Promise<void> {
    this.paused.push(sandboxId);
  }
}

describe('E2BSingleRunExecutor', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-e2b-executor-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function createExecutor(
    client: FakeClient,
    overrides: Partial<E2BProviderConfig> = {}
  ): E2BSingleRunExecutor {
    return new E2BSingleRunExecutor({
      client,
      provider: { ...provider, ...overrides },
      owner: 'team',
      project: 'project',
      artifactsDirectory: root,
      creationLimiter: new TokenBucket({ tokensPerSecond: 100 }),
      environment: {
        HOST_MODEL_KEY: 'agent-secret-canary',
        E2B_API_KEY: 'control-plane-only',
      },
      basePhaseEnvironment: {
        PATH: '/usr/bin',
        HOME: '/home/user',
        CI_TOKEN: 'do-not-forward',
      },
      resolveCellPolicy: () => ({
        requiredCapabilities: [
          {
            component: 'agent',
            type: 'codex-cli',
            version: '1.2.3',
            adapter_schema_version: '1.0.0',
          },
        ],
        secretReferences: [
          {
            id: 'model-key',
            source: { type: 'environment', name: 'HOST_MODEL_KEY' },
            inject_as: 'MODEL_API_KEY',
            targets: ['candidate'],
            components: ['agent'],
            phases: ['agent'],
          },
        ],
      }),
      inspectArchive: async (): Promise<
        ReturnType<FakeSandbox['artifactEntries']>
      > => {
        if (client.sandbox === undefined) throw new Error('No sandbox');
        return client.sandbox.artifactEntries();
      },
    });
  }

  test('runs fixed phases, scopes secrets, validates artifacts, and kills by default', async () => {
    const client = new FakeClient();
    const events: RemoteAttemptLifecycleEvent[] = [];
    const execution = await createExecutor(client).execute(cell, {
      experimentId: 'experiment',
      attemptId: 'attempt-1',
      attemptNumber: 1,
      reportLifecycle: async (event) => {
        events.push(event);
      },
    });

    expect(execution.result.summary.overall_status).toBe('passed');
    expect(execution.result.execution.environment.workspace_dir).toContain(
      path.join('experiment', 'cells', cell.cellId)
    );
    expect(execution.tokenCount).toBe(30);
    expect(execution.costUsd).toBe(0.01);
    expect(execution.tokenQuality).toBe('measured');
    await expect(fs.readFile(execution.resultPath, 'utf8')).resolves.toContain(
      '"version":"1.0.0"'
    );
    const retainedRawResult = JSON.parse(
      await fs.readFile(execution.resultPath, 'utf8')
    ) as ResultsBundle;
    expect(retainedRawResult.execution.environment.workspace_dir).toBe(
      '/work/repo'
    );
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.secureAccess).toBe(true);
    expect(client.created[0]).not.toHaveProperty('env');
    expect(client.sandbox?.commands.map((command) => command.args[0])).toEqual([
      'prepare',
      'agent',
      'evaluate',
      'post-evaluate',
      'package',
    ]);
    const agentCommand = client.sandbox?.commands[1];
    expect(agentCommand?.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/user',
      MODEL_API_KEY: 'agent-secret-canary',
    });
    for (const [index, command] of (client.sandbox?.commands ?? []).entries()) {
      expect(command.env).not.toHaveProperty('E2B_API_KEY');
      expect(command.env).not.toHaveProperty('CI_TOKEN');
      if (index !== 1)
        expect(JSON.stringify(command.env)).not.toContain(
          'agent-secret-canary'
        );
    }
    expect(client.sandbox?.terminated).toHaveLength(5);
    expect(client.killed).toEqual(['sandbox-1']);
    expect(events.map((event) => event.lifecycleState)).toEqual([
      'creating',
      'running',
      'running',
      'collecting',
      'killing',
      'killed',
    ]);
    expect(events.at(-1)).toMatchObject({
      lifecycleState: 'killed',
      sdkVersion: 'fake',
      secureAccess: true,
      resources: { cpu_count: 2, memory_mb: 4096 },
      networkPolicy: {
        outbound: 'allowlist',
        allow: ['api.openai.com'],
      },
      runnerProtocol: '1.0.0',
      artifactProtocol: '1.0.0',
    });
  });

  test('reconciles an owned sandbox from an interrupted persisted attempt', async () => {
    const client = new FakeClient();
    client.existing = [
      {
        sandboxId: 'sandbox-old',
        templateId: 'codex-template',
        buildId: 'build-42',
        lifecycle: 'running',
        secureAccess: true,
        resources: { cpu_count: 2, memory_mb: 4096 },
        network: provider.network,
        metadata: {
          owner: 'team',
          project: 'project',
          experimentId: 'experiment',
          cellId: cell.cellId,
          attemptId: 'attempt-old',
          targetId: 'candidate',
          ownershipNonceHash: 'c'.repeat(64),
        },
      },
    ];

    await createExecutor(client).reconcileInterrupted({
      experimentId: 'experiment',
      cellId: cell.cellId,
      targetId: 'candidate',
      attemptId: 'attempt-old',
      sandboxId: 'sandbox-old',
    });
    expect(client.killed).toEqual(['sandbox-old']);
  });

  test('classifies provider creation throttling for bounded retries', async () => {
    const client = new FakeClient();
    const rateLimit = new Error('too many sandboxes');
    rateLimit.name = 'RateLimitError';
    client.createError = rateLimit;

    await expect(
      createExecutor(client).execute(cell, {
        experimentId: 'experiment',
        attemptId: 'attempt-rate-limit',
        attemptNumber: 1,
      })
    ).rejects.toMatchObject<Partial<ExperimentExecutionError>>({
      retryReason: 'provider_rate_limit',
    });
  });

  test('classifies model unavailability and pauses only when explicitly configured', async () => {
    const client = new FakeClient();
    const executor = createExecutor(client, {
      retention: {
        mode: 'pause-on-failure',
        reason: 'debug retirement',
        max_retention_ms: 60_000,
      },
    });
    const promise = executor.execute(cell, {
      experimentId: 'experiment',
      attemptId: 'attempt-1',
      attemptNumber: 1,
    });
    await Promise.resolve();
    // Creation occurs after an async reconciliation list.
    while (client.sandbox === undefined) await Promise.resolve();
    client.sandbox.phaseFailure = {
      phase: 'agent',
      exitCode: 1,
      output: 'requested model not found',
    };

    await expect(promise).rejects.toBeInstanceOf(TargetUnavailableError);
    expect(client.paused).toEqual(['sandbox-1']);
    expect(client.killed).toEqual([]);
  });

  test('kills on cancellation even when failure retention is enabled', async () => {
    const client = new FakeClient();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      createExecutor(client, {
        retention: {
          mode: 'pause-on-failure',
          reason: 'debug',
          max_retention_ms: 60_000,
        },
      }).execute(cell, {
        experimentId: 'experiment',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        signal: controller.signal,
      })
    ).rejects.toThrow('cancelled');
    expect(client.created).toEqual([]);
  });

  test('rejects and kills a sandbox whose actual resources drift from policy', async () => {
    const client = new FakeClient();
    client.resources = { cpu_count: 1, memory_mb: 2048 };
    await expect(
      createExecutor(client).execute(cell, {
        experimentId: 'experiment',
        attemptId: 'attempt-1',
        attemptNumber: 1,
      })
    ).rejects.toThrow(/resources/);
    expect(client.killed).toEqual(['sandbox-1']);
    expect(client.sandbox?.commands).toEqual([]);
  });
});

describe('bounded tar.zst inspection', () => {
  function writeOctal(
    target: Buffer,
    offset: number,
    length: number,
    value: number
  ): void {
    const encoded = value.toString(8).padStart(length - 1, '0');
    target.write(encoded, offset, length - 1, 'ascii');
    target[offset + length - 1] = 0;
  }

  function tarFixture(extraZeroBlocks = 0): Buffer {
    const contents = Buffer.from('result');
    const header = Buffer.alloc(512);
    header.write('./results.json', 0, 'ascii');
    writeOctal(header, 100, 8, 0o600);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, contents.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    const checksum = header.reduce((total, byte) => total + byte, 0);
    const checksumText = checksum.toString(8).padStart(6, '0');
    header.write(checksumText, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    return Buffer.concat([
      header,
      contents,
      Buffer.alloc(512 - contents.byteLength),
      Buffer.alloc(1024 + extraZeroBlocks * 512),
    ]);
  }

  test('preflights a declared zstd size before parsing normalized tar paths', async () => {
    const archive = await compressZstd(tarFixture());
    await expect(
      inspectTarZstdArchive(archive, {
        max_files: 2,
        max_file_bytes: 100,
        max_compressed_bytes: 100_000,
        max_uncompressed_bytes: 100,
      })
    ).resolves.toMatchObject([
      {
        path: 'results.json',
        type: 'file',
        contents: Buffer.from('result'),
      },
    ]);

    const oversized = await compressZstd(tarFixture(10));
    await expect(
      inspectTarZstdArchive(oversized, {
        max_files: 1,
        max_file_bytes: 100,
        max_compressed_bytes: 100_000,
        max_uncompressed_bytes: 1,
      })
    ).rejects.toThrow(/declares output above/);
    await expect(
      inspectTarZstdArchive(Buffer.concat([archive, archive]), {
        max_files: 2,
        max_file_bytes: 100,
        max_compressed_bytes: 100_000,
        max_uncompressed_bytes: 100,
      })
    ).rejects.toThrow(/Concatenated/);
  });
});
