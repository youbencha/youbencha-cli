import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { compress as compressZstd } from '@mongodb-js/zstd';
import type {
  PlannedExperimentCell,
  RemoteAttemptLifecycleEvent,
  SingleRunExecutionContext,
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
  e2bExecutorTesting,
} from '../../src/e2b/executor.js';
import {
  E2B_OUTPUT_ARCHIVE_PATH,
  E2B_OUTPUT_MANIFEST_PATH,
} from '../../src/e2b/runner-protocol.js';
import type {
  E2BArtifactManifest,
  E2BArtifactLimits,
  E2BProviderConfig,
  E2BTemplateManifest,
} from '../../src/e2b/schemas.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

const timestamp = '2026-07-29T12:00:00.000Z';
const limits: E2BArtifactLimits = {
  max_files: 10,
  max_file_bytes: 100_000,
  max_compressed_bytes: 100_000,
  max_uncompressed_bytes: 200_000,
};
const provider: E2BProviderConfig = {
  provider: 'e2b',
  template: { template_id: 'template', build_id: 'build' },
  strict_reproducibility: true,
  secure_access: true,
  network: { inbound: 'none', outbound: 'none' },
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
  artifact_limits: limits,
  runtime_package_installation: false,
  retention: { mode: 'kill' },
};
const baseTemplate: E2BTemplateManifest = {
  protocol_version: '1.0.0',
  runner_version: 'test',
  node_version: '22.0.0',
  git_version: '2.49.0',
  harnesses: [
    {
      type: 'codex-cli',
      version: '1.2.3',
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
const cell: PlannedExperimentCell = {
  cellId: 'a'.repeat(64),
  testcaseId: 'case',
  variantName: 'candidate',
  repetition: 0,
  configHash: 'b'.repeat(64),
  config: {
    name: 'case',
    description: 'fixture',
    repo: 'https://example.test/repo.git',
    commit: 'c'.repeat(40),
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

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function resultBundle(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'fixture',
      config_file: 'case.yaml',
      config_hash: 'hash',
      repo: 'https://example.test/repo.git',
      branch: 'main',
      commit: 'c'.repeat(40),
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 1,
      youbencha_version: 'test',
      environment: {
        os: 'linux',
        node_version: '22',
        workspace_dir: '/remote',
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
}

function logBytes(options: {
  estimatedCost?: number;
  omitCost?: boolean;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: '1.0.0',
      agent: {
        name: 'Codex CLI',
        version: '1.2.3',
        adapter_version: '1.0.0',
      },
      model: { name: 'gpt-5', provider: 'OpenAI', parameters: {} },
      execution: {
        started_at: timestamp,
        completed_at: timestamp,
        duration_ms: 1,
        exit_code: 0,
        status: 'success',
      },
      messages: [],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        ...(options.omitCost
          ? {}
          : { estimated_cost_usd: options.estimatedCost ?? 0.25 }),
      },
      errors: [],
      environment: {
        os: 'Linux',
        node_version: '22',
        youbencha_version: 'test',
        working_directory: '/remote',
      },
    })
  );
}

function writeOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number
): void {
  target.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1);
  target[offset + length - 1] = 0;
}

function tarHeader(name: string, type: number, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'ascii');
  writeOctal(header, 124, 12, size);
  header.fill(0x20, 148, 156);
  header[156] = type;
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeOctal(header, 148, 8, checksum);
  return header;
}

function tarArchive(files: ReadonlyArray<[string, Buffer]>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, contents] of files) {
    chunks.push(tarHeader(name, '0'.charCodeAt(0), contents.byteLength));
    chunks.push(contents);
    const padding = (512 - (contents.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

class Sandbox implements E2BSandboxHandle {
  public readonly sandboxId = 'sandbox';
  public createdAt: string | undefined = timestamp;
  public getInfoError: unknown;
  public runtimePackageInstallation = false;
  public harnessVersion = '1.2.3';
  public residualProcess = false;
  public phaseFailure: string | undefined;
  public log = logBytes({});
  public archive = Buffer.from('transport');
  public artifactManifest: E2BArtifactManifest | undefined;
  private cellManifest:
    | { experiment_id: string; cell_id: string; attempt_id: string }
    | undefined;

  public constructor(private readonly request: E2BCreateSandboxRequest) {}

  public async getInfo(): Promise<E2BSandboxInfo> {
    if (this.getInfoError !== undefined) throw this.getInfoError;
    return {
      sandboxId: this.sandboxId,
      templateId: 'template',
      buildId: 'build',
      lifecycle: 'running',
      secureAccess: true,
      resources: { cpu_count: 2, memory_mb: 4096 },
      network: this.request.network,
      metadata: this.request.metadata,
      createdAt: this.createdAt,
    };
  }

  public async writeFile(_file: string, contents: Uint8Array): Promise<void> {
    this.cellManifest = JSON.parse(
      Buffer.from(contents).toString('utf8')
    ) as typeof this.cellManifest;
  }

  public async readFile(file: string, _maxBytes: number): Promise<Uint8Array> {
    if (file === '/opt/youbencha/manifest.json') {
      return Buffer.from(
        JSON.stringify({
          ...baseTemplate,
          runtime_package_installation: this.runtimePackageInstallation,
          harnesses: baseTemplate.harnesses.map((harness) => ({
            ...harness,
            version: this.harnessVersion,
          })),
        })
      );
    }
    if (file === E2B_OUTPUT_MANIFEST_PATH) {
      if (this.artifactManifest === undefined) {
        throw new Error('missing artifact manifest');
      }
      return Buffer.from(JSON.stringify(this.artifactManifest));
    }
    if (file === E2B_OUTPUT_ARCHIVE_PATH) return this.archive;
    throw new Error(`Unexpected read ${file}`);
  }

  public async runCommand(
    command: E2BRemoteCommand
  ): Promise<E2BRemoteCommandResult> {
    if (command.args[0] === 'package') this.packageArtifacts();
    return {
      exitCode: command.args[0] === this.phaseFailure ? 2 : 0,
      stdout: '',
      stderr: '',
      startedAt: timestamp,
      completedAt: timestamp,
      processGroupId:
        command.args[0] === 'prepare' && this.residualProcess
          ? 'residual'
          : undefined,
    };
  }

  public async terminateProcessGroup(_id: string): Promise<void> {}

  public async isProcessGroupRunning(_id: string): Promise<boolean> {
    return this.residualProcess;
  }

  public entries(): Array<{
    path: string;
    type: 'file';
    contents: Uint8Array;
  }> {
    return [
      {
        path: 'results.json',
        type: 'file',
        contents: Buffer.from(JSON.stringify(resultBundle())),
      },
      { path: 'agent.json', type: 'file', contents: this.log },
    ];
  }

  public async useRealArchive(): Promise<void> {
    const entries = this.entries();
    const tar = tarArchive(
      entries.map((entry) => [entry.path, Buffer.from(entry.contents)])
    );
    this.archive = await compressZstd(tar);
  }

  private packageArtifacts(): void {
    if (this.cellManifest === undefined)
      throw new Error('missing cell manifest');
    const entries = this.entries();
    this.artifactManifest = {
      schema_version: '1.0.0',
      artifact_protocol_version: '1.0.0',
      experiment_id: this.cellManifest.experiment_id,
      cell_id: this.cellManifest.cell_id,
      attempt_id: this.cellManifest.attempt_id,
      result_schema_version: '1.0.0',
      remote_result_path: 'results.json',
      runner_status: 'completed',
      artifacts: entries.map((entry) => ({
        path: entry.path,
        uncompressed_size: entry.contents.byteLength,
        sha256: digest(entry.contents),
        redacted: true,
        truncated: false,
      })),
      archive: {
        sha256: digest(this.archive),
        compressed_size: this.archive.byteLength,
        uncompressed_size: entries.reduce(
          (total, entry) => total + entry.contents.byteLength,
          0
        ),
      },
      completion: {
        redaction_applied: true,
        truncation_applied: false,
      },
    };
  }
}

class Client implements E2BClient {
  public readonly sdkVersion = 'test';
  public readonly capabilities = {
    securedAccess: true,
    outboundDeny: true,
    outboundAllowlist: true,
    immutableBuildSelection: true,
    snapshots: true,
  };
  public sandbox: Sandbox | undefined;
  public killError: unknown;
  public paused: string[] = [];
  public killed: string[] = [];
  public configureSandbox: (sandbox: Sandbox) => void = (): void => undefined;

  public async createSandbox(
    request: E2BCreateSandboxRequest
  ): Promise<E2BSandboxHandle> {
    this.sandbox = new Sandbox(request);
    this.configureSandbox(this.sandbox);
    return this.sandbox;
  }

  public async connectSandbox(_sandboxId: string): Promise<E2BSandboxHandle> {
    if (this.sandbox === undefined) throw new Error('missing sandbox');
    return this.sandbox;
  }

  public async listSandboxes(
    _filter: E2BListSandboxFilter
  ): Promise<E2BSandboxInfo[]> {
    return [];
  }

  public async killSandbox(sandboxId: string): Promise<void> {
    this.killed.push(sandboxId);
    if (this.killError !== undefined) throw this.killError;
  }

  public async pauseSandbox(sandboxId: string): Promise<void> {
    this.paused.push(sandboxId);
  }
}

function context(
  suffix: string,
  events?: RemoteAttemptLifecycleEvent[]
): SingleRunExecutionContext {
  return {
    experimentId: 'experiment',
    attemptId: `attempt-${suffix}`,
    attemptNumber: 1,
    reportLifecycle:
      events === undefined
        ? undefined
        : async (event): Promise<void> => {
            events.push(event);
          },
  };
}

function executor(
  root: string,
  client: Client,
  options: {
    retention?: E2BProviderConfig['retention'];
    snapshotId?: string;
    inspect?: boolean;
    warnings?: string[];
    strictReproducibility?: boolean;
  } = {}
): E2BSingleRunExecutor {
  return new E2BSingleRunExecutor({
    client,
    provider: {
      ...provider,
      retention: options.retention ?? provider.retention,
      strict_reproducibility:
        options.strictReproducibility ?? provider.strict_reproducibility,
    },
    owner: 'owner',
    project: 'project',
    artifactsDirectory: root,
    resolveCellPolicy: () => ({
      requiredCapabilities: [
        {
          component: 'agent',
          type: 'codex-cli',
          version: '1.2.3',
          adapter_schema_version: '1.0.0',
        },
      ],
      snapshotId: options.snapshotId,
    }),
    ...(options.inspect === false
      ? {}
      : {
          inspectArchive: async (): Promise<ReturnType<Sandbox['entries']>> => {
            if (client.sandbox === undefined)
              throw new Error('missing sandbox');
            return client.sandbox.entries();
          },
        }),
    onWarning:
      options.warnings === undefined
        ? undefined
        : (warning): void => {
            options.warnings?.push(warning);
          },
    now: (): Date => new Date(timestamp),
  });
}

describe('E2B executor final deterministic coverage', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-e2b-executor-')
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('covers residual tar and safe-root boundaries', async () => {
    expect(e2bExecutorTesting.tarNumber(new Uint8Array(), 0, 0)).toBe(0);

    const truncated = tarHeader('file', '0'.charCodeAt(0), 1);
    expect(() => e2bExecutorTesting.parseTar(truncated, limits)).toThrow(
      'Truncated tar entry'
    );

    const nullFile = Buffer.concat([
      tarHeader('empty', 0, 0),
      Buffer.alloc(512),
    ]);
    expect(e2bExecutorTesting.parseTar(nullFile, limits)).toMatchObject([
      { path: 'empty', type: 'file' },
    ]);

    const declaredOneByteFrame = Buffer.from([
      0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x01, 0x01, 0, 0,
    ]);
    await expect(
      e2bExecutorTesting.inspectTarZstdArchiveWith(
        declaredOneByteFrame,
        limits,
        async (): Promise<Buffer> => Buffer.alloc(0)
      )
    ).rejects.toThrow('does not match');

    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
    await expect(
      e2bExecutorTesting.ensureSafeArtifactRoot('C:\\injected', {
        lstat: async (): Promise<never> => {
          throw missing;
        },
        mkdir: async (): Promise<never> => {
          throw denied;
        },
      })
    ).rejects.toBe(denied);

    let lstatCalls = 0;
    await expect(
      e2bExecutorTesting.ensureSafeArtifactRoot('C:\\injected', {
        lstat: async () =>
          (++lstatCalls === 1
            ? Promise.reject(missing)
            : {
                isSymbolicLink: (): boolean => true,
                isDirectory: (): boolean => false,
              }) as ReturnType<typeof fs.lstat>,
        mkdir: async (): Promise<string | undefined> => undefined,
      })
    ).rejects.toThrow('not a safe directory');
  });

  test('covers fallback abort reasons and manifest defaults', () => {
    const listeners: Array<() => void> = [];
    const fakeSignal = {
      aborted: true,
      reason: undefined,
      addEventListener: (
        _name: string,
        listener: EventListenerOrEventListenerObject
      ): void => {
        listeners.push(listener as () => void);
      },
      removeEventListener: (): void => undefined,
    } as unknown as AbortSignal;
    const combined = e2bExecutorTesting.combinedSignal(fakeSignal, 100);
    expect(combined.signal.reason).toBeInstanceOf(Error);
    combined.dispose();
    expect(listeners).toHaveLength(1);

    expect(() =>
      e2bExecutorTesting.throwIfAborted({
        aborted: true,
        reason: undefined,
      } as AbortSignal)
    ).toThrow('E2B execution cancelled');

    const noConfigCell = structuredClone(cell);
    delete noConfigCell.config.agent.config;
    const manifest = e2bExecutorTesting.buildCellManifest(
      noConfigCell,
      context('manifest'),
      baseTemplate,
      provider,
      provider.network,
      {
        requiredCapabilities: [
          {
            component: 'agent',
            type: 'codex-cli',
            version: '1.2.3',
            adapter_schema_version: '1.0.0',
          },
        ],
      }
    );
    expect(manifest.target.config).toEqual({});
    expect(manifest.secret_references).toEqual([]);
  });

  test('rejects a residual process and a prohibited runtime-install template', async () => {
    const residualClient = new Client();
    residualClient.configureSandbox = (sandbox): void => {
      sandbox.createdAt = undefined;
      sandbox.residualProcess = true;
    };
    await expect(
      executor(root, residualClient, { snapshotId: 'snapshot' }).execute(
        cell,
        context('residual')
      )
    ).rejects.toThrow('Residual process group');

    const runtimeClient = new Client();
    const warnings: string[] = [];
    runtimeClient.configureSandbox = (sandbox): void => {
      sandbox.runtimePackageInstallation = true;
      sandbox.harnessVersion = '9.9.9';
    };
    await expect(
      executor(root, runtimeClient, {
        strictReproducibility: false,
        warnings,
      }).execute(cell, context('runtime'))
    ).rejects.toThrow('runtime package installation');
    expect(warnings).toEqual([expect.stringContaining('resolved to 9.9.9')]);

    const failedPhaseClient = new Client();
    failedPhaseClient.configureSandbox = (sandbox): void => {
      sandbox.phaseFailure = 'prepare';
    };
    await expect(
      executor(root, failedPhaseClient).execute(cell, context('phase-failure'))
    ).rejects.toThrow('phase prepare exited with code 2');
  });

  test('uses the default archive inspector and reports successful cleanup failure', async () => {
    const client = new Client();
    const warnings: string[] = [];
    client.killError = new Error('kill failed');
    client.configureSandbox = (sandbox): void => {
      sandbox.log = logBytes({ omitCost: true });
      const useArchive = sandbox.useRealArchive();
      sandbox.runCommand = async (
        command: E2BRemoteCommand
      ): Promise<E2BRemoteCommandResult> => {
        await useArchive;
        if (command.args[0] === 'package') {
          (
            sandbox as unknown as { packageArtifacts: () => void }
          ).packageArtifacts();
        }
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          startedAt: timestamp,
          completedAt: timestamp,
        };
      };
    };
    const events: RemoteAttemptLifecycleEvent[] = [];
    const execution = await executor(root, client, {
      inspect: false,
      warnings,
    }).execute(cell, context('default-inspect', events));
    expect(execution.costUsd).toBeUndefined();
    expect(execution.costQuality).toBe('unavailable');
    expect(events.at(-1)?.lifecycleState).toBe('lost');
    expect(warnings).toEqual([
      expect.stringContaining('requires reconciliation'),
      'kill failed',
    ]);
  });

  test('uses estimated cost and stringifies a non-Error cleanup failure', async () => {
    const client = new Client();
    const warnings: string[] = [];
    client.killError = 'string cleanup failure';
    client.configureSandbox = (sandbox): void => {
      sandbox.log = logBytes({ estimatedCost: 0.5 });
    };
    const execution = await executor(root, client, { warnings }).execute(
      cell,
      context('estimated')
    );
    expect(execution).toMatchObject({
      costUsd: 0.5,
      tokenQuality: 'unavailable',
      costQuality: 'unavailable',
    });
    expect(warnings).toContain('string cleanup failure');
  });

  test('reports started and unstarted pause, kill, and lost lifecycles', async () => {
    const pauseEvents: RemoteAttemptLifecycleEvent[] = [];
    const pauseClient = new Client();
    pauseClient.configureSandbox = (sandbox): void => {
      sandbox.getInfoError = new Error('info failed');
    };
    await expect(
      executor(root, pauseClient, {
        retention: {
          mode: 'pause-on-failure',
          reason: 'debug',
          max_retention_ms: 1_000,
        },
      }).execute(cell, context('pause-unstarted', pauseEvents))
    ).rejects.toThrow('info failed');
    expect(pauseEvents.at(-1)).toMatchObject({ lifecycleState: 'paused' });
    expect(pauseEvents.at(-1)).not.toHaveProperty('sandboxStartedAt');

    const startedPauseEvents: RemoteAttemptLifecycleEvent[] = [];
    const startedPauseClient = new Client();
    startedPauseClient.configureSandbox = (sandbox): void => {
      sandbox.runtimePackageInstallation = true;
    };
    await expect(
      executor(root, startedPauseClient, {
        retention: {
          mode: 'pause-on-failure',
          reason: 'debug',
          max_retention_ms: 1_000,
        },
      }).execute(cell, context('pause-started', startedPauseEvents))
    ).rejects.toThrow('runtime package installation');
    expect(startedPauseEvents.at(-1)).toMatchObject({
      lifecycleState: 'paused',
      sandboxStartedAt: timestamp,
    });

    const killEvents: RemoteAttemptLifecycleEvent[] = [];
    const killClient = new Client();
    killClient.configureSandbox = (sandbox): void => {
      sandbox.getInfoError = new Error('info failed');
    };
    await expect(
      executor(root, killClient).execute(
        cell,
        context('kill-unstarted', killEvents)
      )
    ).rejects.toThrow('info failed');
    expect(killEvents.slice(-2).map((event) => event.lifecycleState)).toEqual([
      'killing',
      'killed',
    ]);
    expect(killEvents.at(-1)).not.toHaveProperty('sandboxStartedAt');

    const lostEvents: RemoteAttemptLifecycleEvent[] = [];
    const lostClient = new Client();
    lostClient.killError = new Error('cleanup failed');
    lostClient.configureSandbox = (sandbox): void => {
      sandbox.getInfoError = new Error('info failed');
    };
    await expect(
      executor(root, lostClient).execute(
        cell,
        context('lost-unstarted', lostEvents)
      )
    ).rejects.toThrow('info failed');
    expect(lostEvents.at(-1)).toMatchObject({ lifecycleState: 'lost' });
    expect(lostEvents.at(-1)).not.toHaveProperty('sandboxStartedAt');
  });
});
