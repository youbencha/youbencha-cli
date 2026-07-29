import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  PlannedExperimentCell,
  SingleRunExecutionContext,
} from '../../src/experiments/single-run-executor.js';
import { stableHash } from '../../src/experiments/identity.js';
import {
  e2bExecutorTesting,
  E2BPhaseExecutionError,
  E2BSingleRunExecutor,
} from '../../src/e2b/executor.js';
import {
  buildArtifactPackage,
  isolatePhaseEnvironment,
  LinuxSandboxProcessBoundary,
  PhaseOrchestrator,
  phaseOrchestratorTesting,
  TarZstdArchiveWriter,
  validatePhaseEnvironment,
} from '../../src/e2b/phase-orchestrator.js';
import {
  createRunnerPhaseOrchestrator,
  markRunnerFailed,
  redactRunnerArtifactFiles,
  isMainModule,
  runCellPhase,
  runCellPhaseMain,
  runnerCliTesting,
  SandboxPhaseOperations,
  writeRunnerError,
} from '../../src/e2b/runner-cli.js';
import type {
  E2BArtifactLimits,
  E2BCellManifest,
  E2BProviderConfig,
  E2BTemplateManifest,
} from '../../src/e2b/schemas.js';
import type { PhaseExecutionContext } from '../../src/e2b/phase-orchestrator.js';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

function manifest(overrides: Partial<E2BCellManifest> = {}): E2BCellManifest {
  return {
    schema_version: '1.0.0',
    experiment_id: 'experiment',
    cell_id: 'a'.repeat(64),
    attempt_id: 'attempt',
    target: {
      id: 'target',
      agent_type: 'codex-cli',
      expected_harness_version: '1',
      adapter_schema_version: '1',
      config: { prompt: 'do work' },
    },
    task: {
      name: 'task',
      description: 'task',
      repo: 'https://example.test/repo.git',
      evaluators: [{ name: 'git-diff' }],
    },
    template: { template_id: 'template', build_id: 'build' },
    required_capabilities: [
      {
        component: 'agent',
        type: 'codex-cli',
        version: '1',
        adapter_schema_version: '1',
      },
    ],
    network: { inbound: 'none', outbound: 'none' },
    deadlines: {
      phases_ms: {
        prepare: 100,
        agent: 100,
        evaluate: 100,
        post_evaluate: 100,
        package: 100,
      },
      collection_grace_ms: 0,
      cleanup_grace_ms: 0,
      sandbox_ttl_ms: 500,
      watchdog_ms: 500,
    },
    artifact_limits: {
      max_files: 10,
      max_file_bytes: 10_000,
      max_compressed_bytes: 10_000,
      max_uncompressed_bytes: 20_000,
    },
    secret_references: [],
    ...overrides,
  };
}

function phaseContext(
  root: string,
  value: E2BCellManifest,
  phase: PhaseExecutionContext['phase'] = 'prepare'
): PhaseExecutionContext {
  return {
    phase,
    manifest: value,
    manifestPath: path.join(root, 'cell.json'),
    stateDirectory: path.join(root, 'state'),
    outputDirectory: path.join(root, 'output'),
    environment: {},
  };
}

function fakeChild(
  stdout: string,
  stderr: string,
  code: number | null = 0,
  error?: Error
): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    pid: 999,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (error) child.emit('error', error);
    else child.emit('close', code);
  });
  return child;
}

const limits: E2BArtifactLimits = {
  max_files: 5,
  max_file_bytes: 1024,
  max_compressed_bytes: 1024,
  max_uncompressed_bytes: 2048,
};

function tarEntry(
  name: string,
  type: string,
  contents = Buffer.alloc(0),
  linkTarget = '',
  prefix = ''
): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(contents.length.toString(8).padStart(11, '0'), 124, 11, 'ascii');
  header[135] = 0;
  header.write(type, 156, 1, 'ascii');
  header.write(linkTarget, 157, 100, 'utf8');
  header.write(prefix, 345, 155, 'utf8');
  header.fill(0x20, 148, 156);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc(
    Math.ceil(contents.length / 512) * 512 - contents.length
  );
  return Buffer.concat([header, contents, padding]);
}

function tarArchive(...entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

describe('remaining E2B deterministic boundaries', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'yb-e2b-final-'));
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  test('covers executor identifiers, policies, JSON, abort, and safe roots', async () => {
    expect(
      e2bExecutorTesting.exactNetworkMatch(
        { inbound: 'none', outbound: 'none' },
        { inbound: 'none', outbound: 'unrestricted' }
      )
    ).toBe(false);
    expect(
      e2bExecutorTesting.exactNetworkMatch(
        { inbound: 'none', outbound: 'allowlist', allow: ['B', 'a'] },
        { inbound: 'none', outbound: 'allowlist', allow: ['A', 'b'] }
      )
    ).toBe(true);
    expect(
      e2bExecutorTesting.exactNetworkMatch(
        { inbound: 'none', outbound: 'none' },
        { inbound: 'none', outbound: 'none' }
      )
    ).toBe(true);
    expect(
      e2bExecutorTesting.ownershipNonceHash('o', 'p', 'e', 'c', 'a')
    ).toHaveLength(64);
    expect(
      e2bExecutorTesting.parseJson(Buffer.from('{"x":1}'), 'value')
    ).toEqual({ x: 1 });
    expect(() =>
      e2bExecutorTesting.parseJson(Buffer.from('{'), 'value')
    ).toThrow(/not valid JSON/);
    const provider = {
      deadlines: manifest().deadlines,
    } as E2BProviderConfig;
    for (const phase of [
      'prepare',
      'agent',
      'evaluate',
      'post-evaluate',
      'package',
    ] as const) {
      expect(e2bExecutorTesting.phaseTimeout(provider, phase)).toBe(100);
      expect(e2bExecutorTesting.defaultPhaseComponent(phase)).toEqual(
        expect.any(String)
      );
    }
    for (const error of [
      Object.assign(new Error('rate'), { name: 'RateLimitError' }),
      { status: 429 },
      { statusCode: 429 },
      { code: 429 },
    ]) {
      expect(e2bExecutorTesting.isProviderRateLimit(error)).toBe(true);
    }
    expect(e2bExecutorTesting.isProviderRateLimit(null)).toBe(false);
    expect(e2bExecutorTesting.isProviderRateLimit('x')).toBe(false);
    expect(e2bExecutorTesting.isProviderRateLimit({ status: 500 })).toBe(false);

    const controller = new AbortController();
    const combined = e2bExecutorTesting.combinedSignal(
      controller.signal,
      10_000
    );
    controller.abort(new Error('cancelled'));
    expect(() => e2bExecutorTesting.throwIfAborted(combined.signal)).toThrow(
      'cancelled'
    );
    combined.dispose();
    const already = new AbortController();
    already.abort();
    const combinedAlready = e2bExecutorTesting.combinedSignal(
      already.signal,
      10_000
    );
    expect(combinedAlready.signal.aborted).toBe(true);
    combinedAlready.dispose();
    const active = e2bExecutorTesting.combinedSignal(undefined, 10_000);
    expect(() =>
      e2bExecutorTesting.throwIfAborted(active.signal)
    ).not.toThrow();
    active.dispose();

    const safeRoot = path.join(root, 'one', 'two');
    await expect(
      e2bExecutorTesting.ensureSafeArtifactRoot(safeRoot)
    ).resolves.toBe(path.resolve(safeRoot));
    await expect(
      e2bExecutorTesting.ensureSafeArtifactRoot(safeRoot)
    ).resolves.toBe(path.resolve(safeRoot));
    const unsafeFile = path.join(root, 'file');
    await fs.writeFile(unsafeFile, 'x');
    await expect(
      e2bExecutorTesting.ensureSafeArtifactRoot(path.join(unsafeFile, 'child'))
    ).rejects.toThrow(/symlink or non-directory/);
  });

  test('covers executor manifest and attempt path validation', () => {
    const cell: PlannedExperimentCell = {
      cellId: 'a'.repeat(64),
      testcaseId: 'case',
      variantName: 'variant',
      repetition: 0,
      configHash: 'b'.repeat(64),
      config: {
        name: 'task',
        description: 'task',
        repo: 'https://example.test/repo.git',
        agent: {
          type: 'codex-cli',
          model: 'model',
          config: { prompt: 'work' },
        },
        evaluators: [],
      },
    };
    const context: SingleRunExecutionContext = {
      experimentId: 'experiment',
      attemptId: 'attempt',
      attemptNumber: 1,
    };
    const provider = {
      deadlines: manifest().deadlines,
      artifact_limits: manifest().artifact_limits,
    } as E2BProviderConfig;
    const template = {
      template_id: 'template',
      build_id: 'build',
    } as E2BTemplateManifest;
    const policy = {
      requiredCapabilities: [
        {
          component: 'agent',
          type: 'codex-cli',
          version: '1',
          adapter_schema_version: '1',
        },
      ],
      adapterSchemaVersion: 'override',
      secretReferences: [],
    };
    expect(
      e2bExecutorTesting.buildCellManifest(
        cell,
        context,
        template,
        provider,
        { inbound: 'none', outbound: 'none' },
        policy
      ).target.adapter_schema_version
    ).toBe('override');
    expect(() =>
      e2bExecutorTesting.buildCellManifest(
        cell,
        context,
        template,
        provider,
        { inbound: 'none', outbound: 'none' },
        { requiredCapabilities: [] }
      )
    ).toThrow(/lacks an agent capability/);
    expect(
      e2bExecutorTesting.attemptArtifactsDirectory(root, cell, context)
    ).toContain('attempt-1-attempt');
    for (const invalid of [
      { context: { ...context, experimentId: '../bad' }, cell },
      { context: { ...context, attemptId: '../bad' }, cell },
      { context, cell: { ...cell, cellId: 'bad' } },
    ]) {
      expect(() =>
        e2bExecutorTesting.attemptArtifactsDirectory(
          root,
          invalid.cell,
          invalid.context
        )
      ).toThrow(/Invalid/);
    }
    expect(new E2BPhaseExecutionError('agent', 2)).toMatchObject({
      name: 'E2BPhaseExecutionError',
      phase: 'agent',
      exitCode: 2,
    });
  });

  test('covers interrupted executor ownership and cancellation branches', async () => {
    const provider: E2BProviderConfig = {
      provider: 'e2b',
      template: { template_id: 'template', build_id: 'build' },
      strict_reproducibility: true,
      secure_access: true,
      network: { inbound: 'none', outbound: 'none' },
      expected_resources: { cpu_count: 1, memory_mb: 512 },
      deadlines: manifest().deadlines,
      artifact_limits: manifest().artifact_limits,
      runtime_package_installation: false,
      retention: { mode: 'kill' },
    };
    const killed: string[] = [];
    let candidates: Array<{
      sandboxId: string;
      metadata: {
        owner: string;
        project: string;
        experimentId: string;
        cellId: string;
        attemptId: string;
        targetId: string;
        ownershipNonceHash: string;
      };
    }> = [];
    const executor = new E2BSingleRunExecutor({
      client: {
        sdkVersion: 'test',
        capabilities: {
          secureAccess: true,
          networkNone: true,
          networkAllowlist: true,
          networkUnrestricted: true,
          processGroups: true,
          pauseResume: true,
          snapshots: true,
        },
        createSandbox: async () => {
          throw new Error('not called');
        },
        connectSandbox: async () => {
          throw new Error('not called');
        },
        listSandboxes: async () => candidates as never,
        killSandbox: async (sandboxId) => {
          killed.push(sandboxId);
        },
        pauseSandbox: async () => undefined,
      },
      provider,
      owner: 'owner',
      project: 'project',
      artifactsDirectory: root,
      resolveCellPolicy: () => ({ requiredCapabilities: [] }),
    });
    const interrupted = {
      experimentId: 'experiment',
      attemptId: 'attempt',
      cellId: 'cell',
      targetId: 'target',
    };
    await expect(
      executor.reconcileInterrupted({
        ...interrupted,
        signal: { aborted: true, reason: undefined } as AbortSignal,
      })
    ).rejects.toThrow(/cancelled/);
    candidates = [
      {
        sandboxId: 'conflict',
        metadata: {
          owner: 'owner',
          project: 'project',
          experimentId: 'experiment',
          cellId: 'other',
          attemptId: 'attempt',
          targetId: 'target',
          ownershipNonceHash: 'nonce',
        },
      },
    ];
    await expect(executor.reconcileInterrupted(interrupted)).rejects.toThrow(
      /conflicting ownership/
    );
    candidates = ['one', 'two'].map((sandboxId) => ({
      sandboxId,
      metadata: {
        owner: 'owner',
        project: 'project',
        experimentId: 'experiment',
        cellId: 'cell',
        attemptId: 'attempt',
        targetId: 'target',
        ownershipNonceHash: 'nonce',
      },
    }));
    await expect(executor.reconcileInterrupted(interrupted)).rejects.toThrow(
      /multiple sandboxes/
    );
    expect(killed).toEqual(expect.arrayContaining(['one', 'two']));
    candidates = [];
    await expect(executor.reconcileInterrupted(interrupted)).resolves.toBe(
      undefined
    );
  });

  test('covers the executor watchdog callback', () => {
    jest.useFakeTimers();
    try {
      const combined = e2bExecutorTesting.combinedSignal(undefined, 10);
      jest.advanceTimersByTime(10);
      expect(combined.signal.aborted).toBe(true);
      combined.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  test('covers raw tar validation paths', () => {
    const empty = Buffer.alloc(12, 0);
    expect(e2bExecutorTesting.tarString(Buffer.from(' x\0 '), 0, 5)).toBe('x');
    expect(e2bExecutorTesting.tarNumber(empty, 0, 12)).toBe(0);
    expect(() =>
      e2bExecutorTesting.tarNumber(Buffer.from('9'.repeat(12)), 0, 12)
    ).toThrow(/Invalid tar numeric/);
    const base256 = Buffer.alloc(12);
    base256[0] = 0x80;
    expect(() => e2bExecutorTesting.tarNumber(base256, 0, 12)).toThrow(
      /Base-256/
    );
    const badChecksum = Buffer.alloc(512);
    badChecksum.write('0000000\0', 148, 'ascii');
    badChecksum[0] = 1;
    expect(() => e2bExecutorTesting.verifyTarChecksum(badChecksum)).toThrow(
      /checksum/
    );
    expect(() => e2bExecutorTesting.parseTar(Buffer.alloc(0), limits)).toThrow(
      /no valid end marker/
    );
    const invalidTrailing = Buffer.alloc(1024);
    invalidTrailing[600] = 1;
    expect(() => e2bExecutorTesting.parseTar(invalidTrailing, limits)).toThrow(
      /non-zero data/
    );

    const complete = tarArchive(
      tarEntry('./file.txt', '0', Buffer.from('x'), '', 'prefix'),
      tarEntry('hard', '1', Buffer.alloc(0), 'file.txt'),
      tarEntry('symbolic', '2', Buffer.alloc(0), 'file.txt'),
      tarEntry('directory/', '5'),
      tarEntry('', '5')
    );
    expect(e2bExecutorTesting.parseTar(complete, limits)).toMatchObject([
      { path: 'prefix/./file.txt', type: 'file' },
      { path: 'hard', type: 'hardlink', linkTarget: 'file.txt' },
      { path: 'symbolic', type: 'symlink', linkTarget: 'file.txt' },
      { path: 'directory', type: 'directory' },
    ]);
    expect(() =>
      e2bExecutorTesting.parseTar(
        tarArchive(tarEntry('large', '0', Buffer.from('xx'))),
        { ...limits, max_file_bytes: 1 }
      )
    ).toThrow(/per-file/);
    expect(() =>
      e2bExecutorTesting.parseTar(
        tarEntry('truncated', '0', Buffer.alloc(600)),
        limits
      )
    ).toThrow(/Truncated tar entry|no valid end marker/);
    expect(() =>
      e2bExecutorTesting.parseTar(
        tarArchive(tarEntry('unsupported', '7')),
        limits
      )
    ).toThrow(/Unsupported tar entry type/);
    expect(() =>
      e2bExecutorTesting.parseTar(
        tarArchive(
          ...Array.from({ length: 5 }, (_, index) =>
            tarEntry(`file-${index}`, '0')
          )
        ),
        { ...limits, max_files: 1 }
      )
    ).toThrow(/too many entries/);
  });

  test('covers zstd frame preflight failures and valid content sizes', () => {
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(Buffer.alloc(2), 100)
    ).toThrow(/not one standard/);
    const frame = (descriptor: number, tail: number[]): Buffer => {
      const bytes = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, descriptor, ...tail]);
      return bytes;
    };
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0x18, [0]), 100)
    ).toThrow(/reserved descriptor/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0, [0]), 100)
    ).toThrow(/declare its content size/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0x60, [0]), 100)
    ).toThrow(/Truncated zstd frame header/);
    expect(
      e2bExecutorTesting.readFrameContentSize(frame(0x20, [0, 1, 0, 0]), 100)
    ).toBe(0);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0x20, [101, 1, 0, 0]), 100)
    ).toThrow(/above the artifact limit/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0x20, [0, 7, 0, 0]), 100)
    ).toThrow(/reserved block type/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(frame(0x20, [0, 0, 0, 0]), 100)
    ).toThrow(/Truncated zstd block/);
    const block = (last: boolean, type: number, size: number): number[] => {
      const value = (last ? 1 : 0) | (type << 1) | (size << 3);
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
    };
    expect(
      e2bExecutorTesting.readFrameContentSize(
        frame(0x80, [0, 1, 0, 0, 0, ...block(true, 0, 0)]),
        100
      )
    ).toBe(1);
    expect(
      e2bExecutorTesting.readFrameContentSize(
        frame(0xc0, [0, 1, 0, 0, 0, 0, 0, 0, 0, ...block(true, 1, 0), 0]),
        100
      )
    ).toBe(1);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(
        frame(0x20, [0, ...block(true, 0, 131_073)]),
        200_000
      )
    ).toThrow(/block exceeds/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(
        frame(0x20, [1, ...block(true, 0, 2), 1]),
        100
      )
    ).toThrow(/block payload/);
    expect(() =>
      e2bExecutorTesting.readFrameContentSize(
        frame(0x24, [0, ...block(true, 0, 0)]),
        100
      )
    ).toThrow(/trailing data/);
  });

  test('covers runner pure path, environment, redaction, and state helpers', async () => {
    const value = manifest();
    expect(runnerCliTesting.compileTestCase(value).agent.type).toBe(
      'codex-cli'
    );
    expect(
      runnerCliTesting.compileTestCase({
        ...value,
        target: { ...value.target, requested_model: 'model' },
      }).agent.model
    ).toBe('model');
    expect(() =>
      runnerCliTesting.compileTestCase({
        ...value,
        task: { ...value.task, agent: {} } as never,
      })
    ).toThrow(/must not contain an agent/);
    expect(runnerCliTesting.isWithin(root, root)).toBe(true);
    expect(runnerCliTesting.isWithin(root, path.join(root, 'child'))).toBe(
      true
    );
    expect(runnerCliTesting.isWithin(root, path.dirname(root))).toBe(false);
    expect(
      runnerCliTesting.partitionArtifacts([
        'codex-cli-logs/events',
        'youbencha.log.json',
        'results.json',
        'evaluation.json',
      ])
    ).toEqual({
      agent: ['codex-cli-logs/events'],
      evaluator: ['evaluation.json'],
    });
    expect(
      runnerCliTesting.definedEnvironment({ A: 'x', B: undefined })
    ).toEqual({ A: 'x' });
    const secretManifest = manifest({
      secret_references: [
        {
          source: 'TOKEN',
          inject_as: 'TOKEN',
          phases: ['source', 'prepare', 'agent'],
          target_id: 'target',
          component: 'agent',
        },
        {
          source: 'TOKEN_TWO',
          inject_as: 'TOKEN_TWO',
          phases: ['source', 'prepare', 'agent'],
          target_id: 'target',
          component: 'agent',
        },
      ],
    });
    const secretContext = {
      ...phaseContext(root, secretManifest),
      environment: { TOKEN: 'secret', TOKEN_TWO: 'longer-secret' },
    };
    expect(runnerCliTesting.phaseSecretValues(secretContext)).toEqual([
      'longer-secret',
      'secret',
    ]);
    expect(
      runnerCliTesting.phaseSecretValues({
        ...secretContext,
        phase: 'agent',
      })
    ).toEqual(['longer-secret', 'secret']);
    expect(
      runnerCliTesting.redactValue(
        { text: 'secret', list: ['secret', 1], nil: null },
        ['secret']
      )
    ).toEqual({ text: '[REDACTED]', list: ['[REDACTED]', 1], nil: null });
    expect(
      runnerCliTesting
        .redactBuffer(Buffer.from('secret x secret'), ['secret'])
        .toString()
    ).toBe('[REDACTED] x [REDACTED]');
    expect(
      runnerCliTesting.redactBuffer(Buffer.from('clean'), ['secret']).toString()
    ).toBe('clean');

    const state = {
      schema_version: '1.0.0',
      manifest_hash: 'b'.repeat(64),
      started_at: '2026-01-01T00:00:00.000Z',
      workspace: {
        runId: 'attempt',
        paths: {
          root,
          runDir: root,
          modifiedDir: root,
          artifactsDir: root,
          evaluatorArtifactsDir: root,
          lockFile: path.join(root, '.lock'),
        },
        repo: value.task.repo,
        modifiedCommit: 'commit',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await fs.mkdir(path.join(root, 'state'), { recursive: true });
    await fs.writeFile(
      runnerCliTesting.runtimeStatePath(phaseContext(root, value)),
      JSON.stringify(state)
    );
    await expect(
      runnerCliTesting.loadRuntimeState(phaseContext(root, value), root)
    ).rejects.toThrow(/does not match/);
    expect(() =>
      runnerCliTesting.assertRuntimePaths(
        {
          ...state,
          workspace: {
            ...state.workspace,
            paths: { ...state.workspace.paths, root: path.dirname(root) },
          },
        } as never,
        root
      )
    ).toThrow(/escapes/);
  });

  test('covers recursive artifact redaction and unsafe links', async () => {
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'secret.txt'), 'secret');
    await redactRunnerArtifactFiles(root, []);
    await redactRunnerArtifactFiles(root, ['secret']);
    await expect(
      fs.readFile(path.join(nested, 'secret.txt'), 'utf8')
    ).resolves.toBe('[REDACTED]');
    const link = path.join(root, 'link');
    try {
      await fs.symlink(nested, link, 'junction');
      await expect(redactRunnerArtifactFiles(root, ['x'])).rejects.toThrow(
        /links are forbidden/
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  });

  test('covers phase process inspection and archive subprocess outcomes', async () => {
    mockSpawn.mockImplementationOnce(() => fakeChild('1 2 nope 999', ''));
    await expect(
      phaseOrchestratorTesting.listLinuxProcesses()
    ).resolves.toEqual(new Set([1, 2]));
    const originalPath = process.env.PATH;
    try {
      delete process.env.PATH;
      mockSpawn.mockImplementationOnce(() => fakeChild('1', ''));
      await expect(
        phaseOrchestratorTesting.listLinuxProcesses()
      ).resolves.toEqual(new Set([1]));
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    mockSpawn.mockImplementationOnce(() => fakeChild('', 'failed', 1));
    await expect(phaseOrchestratorTesting.listLinuxProcesses()).rejects.toThrow(
      /failed/
    );
    mockSpawn.mockImplementationOnce(() =>
      fakeChild('', '', null, new Error('spawn failed'))
    );
    await expect(phaseOrchestratorTesting.listLinuxProcesses()).rejects.toThrow(
      'spawn failed'
    );

    const writer = new TarZstdArchiveWriter();
    mockSpawn.mockImplementationOnce(() => fakeChild('', 'x'.repeat(20_000)));
    await expect(writer.write(root, path.join(root, 'ok'), {})).resolves.toBe(
      undefined
    );
    mockSpawn.mockImplementationOnce(() => fakeChild('', 'tar error', 2));
    await expect(
      writer.write(root, path.join(root, 'bad'), {})
    ).rejects.toThrow(/code 2/);
    mockSpawn.mockImplementationOnce(() =>
      fakeChild('', '', null, new Error('tar spawn'))
    );
    await expect(
      writer.write(root, path.join(root, 'bad'), {})
    ).rejects.toThrow('tar spawn');
  });

  test('covers process-boundary state guards without live processes', async () => {
    const boundary = new LinuxSandboxProcessBoundary();
    await expect(boundary.cleanup()).rejects.toThrow(
      /without a phase baseline/
    );
    const original = process.platform;
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32',
    });
    await expect(boundary.begin()).rejects.toThrow(/only on Linux/);
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: original,
    });
  });

  test('covers phase environment, ownership, ordering, and cleanup failures', async () => {
    const value = manifest({
      secret_references: [
        {
          source: 'TOKEN',
          inject_as: 'TOKEN',
          phases: ['agent'],
          target_id: 'target',
          component: 'agent',
        },
        {
          source: 'TOKEN_TWO',
          inject_as: 'TOKEN_TWO',
          phases: ['agent'],
          target_id: 'target',
          component: 'agent',
        },
      ],
    });
    expect(() =>
      validatePhaseEnvironment(value, 'prepare', { TOKEN: 'secret' })
    ).toThrow(/not scoped/);
    expect(() =>
      isolatePhaseEnvironment(value, 'agent', { E2B_API_KEY: 'secret' })
    ).toThrow(/forbidden/);
    expect(
      isolatePhaseEnvironment(value, 'agent', {
        PATH: 'path',
        TOKEN: 'secret',
        TOKEN_TWO: 'longer-secret',
        EXTRA: 'dropped',
      })
    ).toEqual({
      PATH: 'path',
      TOKEN: 'secret',
      TOKEN_TWO: 'longer-secret',
    });
    expect(
      validatePhaseEnvironment(value, 'agent', { PATH: undefined })
    ).toEqual({});
    expect(phaseOrchestratorTesting.secretValues(value, {})).toEqual([]);
    expect(
      phaseOrchestratorTesting.secretValues(value, {
        TOKEN: 'secret',
        TOKEN_TWO: 'longer-secret',
      })
    ).toEqual(['longer-secret', 'secret']);
    expect(
      phaseOrchestratorTesting.redactMessage('secret value', ['secret'])
    ).toBe('[REDACTED] value');
    expect([
      ...phaseOrchestratorTesting.allowedSecretPhases('prepare'),
    ]).toEqual(['source', 'prepare']);
    expect([...phaseOrchestratorTesting.allowedSecretPhases('agent')]).toEqual([
      'agent',
    ]);
    const missingState = path.join(root, 'missing.json');
    await expect(
      phaseOrchestratorTesting.readState(missingState)
    ).resolves.toBeUndefined();
    await fs.writeFile(missingState, '{');
    await expect(
      phaseOrchestratorTesting.readState(missingState)
    ).rejects.toBeDefined();

    const operations = {
      prepare: async (): Promise<void> => undefined,
      agent: async (): Promise<void> => undefined,
      evaluate: async (): Promise<void> => undefined,
      postEvaluate: async (): Promise<void> => undefined,
      package: async (): Promise<void> => undefined,
    };
    expect(
      new PhaseOrchestrator(operations, {
        stateDirectory: path.join(root, 'default-environment-state'),
        outputDirectory: path.join(root, 'default-environment-output'),
      })
    ).toBeInstanceOf(PhaseOrchestrator);
    const orchestrator = new PhaseOrchestrator(operations, {
      stateDirectory: path.join(root, 'phase-state'),
      outputDirectory: path.join(root, 'phase-output'),
      environment: {},
    });
    await expect(
      orchestrator.run('agent', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow(/prepare must execute first/);
    const ordered = new PhaseOrchestrator(operations, {
      stateDirectory: path.join(root, 'ordered-state'),
      outputDirectory: path.join(root, 'ordered-output'),
      environment: {},
    });
    await ordered.run('prepare', manifest(), path.join(root, 'cell.json'));
    await expect(
      ordered.run('evaluate', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow(/out of order/);

    const exhaustedStateDirectory = path.join(root, 'exhausted-state');
    await fs.mkdir(exhaustedStateDirectory);
    const exhaustedManifest = manifest();
    await fs.writeFile(
      path.join(exhaustedStateDirectory, 'phase-state.json'),
      JSON.stringify({
        schema_version: '1.0.0',
        manifest_hash: stableHash(exhaustedManifest),
        experiment_id: exhaustedManifest.experiment_id,
        cell_id: exhaustedManifest.cell_id,
        attempt_id: exhaustedManifest.attempt_id,
        phases: Array.from({ length: 5 }, () => ({
          phase: 'prepare',
          status: 'completed',
          started_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:00:00.001Z',
        })),
        updated_at: '2026-01-01T00:00:00.001Z',
      })
    );
    const exhausted = new PhaseOrchestrator(operations, {
      stateDirectory: exhaustedStateDirectory,
      outputDirectory: path.join(root, 'exhausted-output'),
      environment: {},
    });
    await expect(
      exhausted.run('agent', exhaustedManifest, path.join(root, 'cell.json'))
    ).rejects.toThrow(/expected no further phase/);

    const cleanupBoundary = {
      begin: async (): Promise<void> => undefined,
      cleanup: async (): Promise<void> => {
        throw 'cleanup string';
      },
    };
    const failing = new PhaseOrchestrator(
      {
        ...operations,
        prepare: async (): Promise<void> => {
          throw 'operation string';
        },
      },
      {
        stateDirectory: path.join(root, 'failed-state'),
        outputDirectory: path.join(root, 'failed-output'),
        environment: {},
        processBoundary: cleanupBoundary,
      }
    );
    await expect(
      failing.run('prepare', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow(/operation string.*cleanup string/);
    await expect(
      failing.run('prepare', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow(/already failed/);

    const errorCleanup = new PhaseOrchestrator(
      {
        ...operations,
        prepare: async (): Promise<void> => {
          throw new Error('operation error');
        },
      },
      {
        stateDirectory: path.join(root, 'error-cleanup-state'),
        outputDirectory: path.join(root, 'error-cleanup-output'),
        environment: {},
        processBoundary: {
          cleanup: async (): Promise<void> => {
            throw new Error('cleanup error');
          },
        },
      }
    );
    await expect(
      errorCleanup.run('prepare', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow(/operation error.*cleanup error/);

    const stringFailure = new PhaseOrchestrator(
      {
        ...operations,
        prepare: async (): Promise<void> => {
          throw 'plain string failure';
        },
      },
      {
        stateDirectory: path.join(root, 'string-failure-state'),
        outputDirectory: path.join(root, 'string-failure-output'),
        environment: {},
        processBoundary: {
          cleanup: async (): Promise<void> => undefined,
        },
      }
    );
    await expect(
      stringFailure.run('prepare', manifest(), path.join(root, 'cell.json'))
    ).rejects.toThrow('plain string failure');
  });

  test('covers Linux phase cleanup signals, ESRCH, and survivors', async () => {
    const originalPlatform = process.platform;
    const kill = jest.spyOn(process, 'kill');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    });
    try {
      mockSpawn
        .mockImplementationOnce(() => fakeChild('1 2 999', ''))
        .mockImplementationOnce(() => fakeChild('1 2', ''))
        .mockImplementationOnce(() => fakeChild('1 2', ''))
        .mockImplementationOnce(() => fakeChild('1 2', ''));
      const empty = new LinuxSandboxProcessBoundary();
      await empty.begin();
      await empty.cleanup();

      mockSpawn
        .mockImplementationOnce(() => fakeChild('1 999', ''))
        .mockImplementationOnce(() => fakeChild('1 3', ''))
        .mockImplementationOnce(() => fakeChild('1 3', ''))
        .mockImplementationOnce(() => fakeChild('1', ''));
      kill.mockImplementation(() => true);
      const terminating = new LinuxSandboxProcessBoundary();
      await terminating.begin();
      await terminating.cleanup();
      expect(kill).toHaveBeenCalledWith(3, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(3, 'SIGKILL');

      mockSpawn
        .mockImplementationOnce(() => fakeChild('1 999', ''))
        .mockImplementationOnce(() => fakeChild('1 4', ''))
        .mockImplementationOnce(() => fakeChild('1 4', ''))
        .mockImplementationOnce(() => fakeChild('1 4', ''));
      kill.mockImplementation(() => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      });
      const survivor = new LinuxSandboxProcessBoundary();
      await survivor.begin();
      await expect(survivor.cleanup()).rejects.toThrow(/PIDs 4/);

      mockSpawn
        .mockImplementationOnce(() => fakeChild('1 999', ''))
        .mockImplementationOnce(() => fakeChild('1 5', ''));
      kill.mockImplementation(() => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      });
      const termDenied = new LinuxSandboxProcessBoundary();
      await termDenied.begin();
      await expect(termDenied.cleanup()).rejects.toThrow('denied');

      mockSpawn
        .mockImplementationOnce(() => fakeChild('1 999', ''))
        .mockImplementationOnce(() => fakeChild('1 6', ''))
        .mockImplementationOnce(() => fakeChild('1 6', ''));
      kill.mockImplementation((_, signal) => {
        if (signal === 'SIGKILL') {
          throw Object.assign(new Error('kill denied'), { code: 'EACCES' });
        }
        return true;
      });
      const killDenied = new LinuxSandboxProcessBoundary();
      await killDenied.begin();
      await expect(killDenied.cleanup()).rejects.toThrow('kill denied');
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  test('covers artifact tree and package archive failure boundaries', async () => {
    const artifacts = path.join(root, 'artifacts');
    const output = path.join(root, 'output');
    await fs.mkdir(artifacts);
    await fs.writeFile(path.join(artifacts, 'results.json'), '{}');
    await fs.writeFile(path.join(artifacts, 'extra.txt'), 'x');
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(artifacts, 10, 10, 10)
    ).resolves.toHaveLength(2);
    const nested = path.join(artifacts, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'nested.txt'), 'x');
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(artifacts, 10, 10, 10)
    ).resolves.toHaveLength(3);
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(artifacts, 1, 10, 10)
    ).rejects.toThrow(/file-count/);
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(artifacts, 10, 0, 10)
    ).rejects.toThrow(/per-file/);
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(artifacts, 10, 10, 1)
    ).rejects.toThrow(/total uncompressed/);
    const specialLstat = jest.fn(async (file: string) => {
      const stat = await fs.lstat(file);
      return file.endsWith('extra.txt')
        ? {
            ...stat,
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => false,
          }
        : stat;
    }) as unknown as typeof fs.lstat;
    await expect(
      phaseOrchestratorTesting.inspectArtifactTree(
        artifacts,
        10,
        10,
        10,
        specialLstat
      )
    ).rejects.toThrow(/Unsupported artifact type/);
    const link = path.join(artifacts, 'linked');
    try {
      await fs.symlink(nested, link, 'junction');
      await expect(
        phaseOrchestratorTesting.inspectArtifactTree(artifacts, 10, 10, 10)
      ).rejects.toThrow(/link is forbidden/);
      await fs.unlink(link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
    const withoutResults = path.join(root, 'without-results');
    await fs.mkdir(withoutResults);
    await fs.writeFile(path.join(withoutResults, 'other.txt'), 'x');
    await expect(
      buildArtifactPackage({
        manifest: manifest(),
        artifactsDirectory: withoutResults,
        outputDirectory: output,
        environment: {},
        redactionApplied: true,
        archiveWriter: { write: async () => undefined },
      })
    ).rejects.toThrow(/without results.json/);

    await expect(
      buildArtifactPackage({
        manifest: manifest(),
        artifactsDirectory: artifacts,
        outputDirectory: output,
        environment: {},
        redactionApplied: true,
        archiveWriter: {
          write: async () => {
            throw new Error('archive failed');
          },
        },
      })
    ).rejects.toThrow('archive failed');

    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'artifacts.tar.zst'), 'archive');
    mockSpawn.mockImplementationOnce(() => fakeChild('', ''));
    await expect(
      buildArtifactPackage({
        manifest: manifest(),
        artifactsDirectory: artifacts,
        outputDirectory: output,
        environment: {},
        redactionApplied: true,
      })
    ).resolves.toMatchObject({
      experiment_id: 'experiment',
      completion: { redaction_applied: true },
    });

    await expect(
      buildArtifactPackage({
        manifest: {
          ...manifest(),
          artifact_limits: {
            ...manifest().artifact_limits,
            max_compressed_bytes: 1,
          },
        },
        artifactsDirectory: artifacts,
        outputDirectory: output,
        environment: {},
        redactionApplied: true,
        archiveWriter: {
          write: async (_source, destination) => {
            await fs.writeFile(destination, 'large');
          },
        },
      })
    ).rejects.toThrow(/Compressed artifact/);
  });

  test('covers injected prepare and package operations', async () => {
    const value = manifest({
      task: {
        ...manifest().task,
        pre_execution: [
          { name: 'script', config: { command: 'test', args: [] } },
        ],
      },
    });
    const workspace = {
      runId: 'attempt',
      paths: {
        root,
        runDir: root,
        modifiedDir: root,
        artifactsDir: path.join(root, 'artifacts'),
        evaluatorArtifactsDir: path.join(root, 'artifacts', 'evaluators'),
        lockFile: path.join(root, '.lock'),
      },
      repo: value.task.repo,
      modifiedCommit: 'commit',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.mkdir(workspace.paths.artifactsDir, { recursive: true });
    let packaged = false;
    const operations = new SandboxPhaseOperations({
      workspaceRoot: root,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      workspaceManagerFactory: () => ({
        createWorkspace: async () => workspace as never,
      }),
      preExecutionFactory: () => ({
        checkPreconditions: async () => true,
        execute: async () => ({
          pre_executor: 'script',
          status: 'success',
          message: 'ok',
          duration_ms: 0,
          timestamp: '2026-01-01T00:00:00.000Z',
        }),
      }),
      artifactPackageBuilder: async () => {
        packaged = true;
        return {} as never;
      },
    });
    const context = phaseContext(root, value);
    await operations.prepare(context);
    await operations.package({ ...context, phase: 'package' });
    expect(packaged).toBe(true);

    const noHooksValue = manifest();
    const noHooks = new SandboxPhaseOperations({
      workspaceRoot: root,
      workspaceManagerFactory: () => ({
        createWorkspace: async () => workspace as never,
      }),
    });
    await expect(
      noHooks.prepare(phaseContext(root, noHooksValue))
    ).resolves.toBeUndefined();

    const preconditionFailure = new SandboxPhaseOperations({
      workspaceRoot: root,
      workspaceManagerFactory: () => ({
        createWorkspace: async () => workspace as never,
      }),
      preExecutionFactory: () => ({
        checkPreconditions: async () => false,
        execute: async () => {
          throw new Error('not called');
        },
      }),
    });
    await expect(preconditionFailure.prepare(context)).rejects.toThrow(
      /preconditions/
    );
    const executionFailure = new SandboxPhaseOperations({
      workspaceRoot: root,
      workspaceManagerFactory: () => ({
        createWorkspace: async () => workspace as never,
      }),
      preExecutionFactory: () => ({
        checkPreconditions: async () => true,
        execute: async () => ({
          pre_executor: 'script',
          status: 'failed',
          message: 'bad',
          duration_ms: 0,
          timestamp: '2026-01-01T00:00:00.000Z',
        }),
      }),
    });
    await expect(executionFailure.prepare(context)).rejects.toThrow(
      /Pre-execution failed/
    );
  });

  test('covers runner default factories, entry detection, and ambient isolation', async () => {
    const defaults = new SandboxPhaseOperations() as unknown as {
      now(): Date;
      workspaceManagerFactory(workspaceRoot: string, timeout: number): unknown;
      preExecutionFactory(): unknown;
    };
    expect(defaults.now()).toBeInstanceOf(Date);
    expect(defaults.workspaceManagerFactory(root, 100)).toBeDefined();
    expect(defaults.preExecutionFactory()).toBeDefined();

    expect(createRunnerPhaseOrchestrator({}, {})).toBeInstanceOf(
      PhaseOrchestrator
    );
    expect(
      createRunnerPhaseOrchestrator(
        {
          operations: {
            prepare: async () => undefined,
            agent: async () => undefined,
            evaluate: async () => undefined,
            postEvaluate: async () => undefined,
            package: async () => undefined,
          },
          stateDirectory: path.join(root, 'resolved-state'),
          outputDirectory: path.join(root, 'resolved-output'),
          processBoundary: {
            cleanup: async () => undefined,
          },
        },
        {}
      )
    ).toBeInstanceOf(PhaseOrchestrator);

    const originalArgv = [...process.argv];
    try {
      process.argv = [process.execPath];
      expect(isMainModule()).toBe(false);
      process.argv = [process.execPath, path.join(root, 'run-cell')];
      expect(isMainModule()).toBe(true);
      process.argv = [process.execPath, path.join(root, 'other')];
      expect(isMainModule()).toBe(false);
    } finally {
      process.argv = originalArgv;
    }

    const run = jest.fn(async () => undefined);
    const writeError = jest.fn();
    const markFailed = jest.fn();
    await runCellPhaseMain(['value'], run, writeError, markFailed);
    expect(run).toHaveBeenCalledWith(['value']);
    await runCellPhaseMain([], run, writeError, markFailed, false);
    expect(run).toHaveBeenCalledTimes(1);
    await runCellPhaseMain(
      [],
      async () => {
        throw new Error('main error');
      },
      writeError,
      markFailed
    );
    await runCellPhaseMain(
      [],
      async () => {
        throw 'main string error';
      },
      writeError,
      markFailed
    );
    expect(writeError).toHaveBeenCalledWith('run-cell failed: main error\n');
    expect(writeError).toHaveBeenCalledWith(
      'run-cell failed: main string error\n'
    );
    expect(markFailed).toHaveBeenCalledTimes(2);

    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    try {
      writeRunnerError('runner error\n');
      markRunnerFailed();
      expect(stderrWrite).toHaveBeenCalledWith('runner error\n');
      expect(process.exitCode).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      process.exitCode = originalExitCode;
    }

    await expect(runCellPhase([])).rejects.toThrow(/Usage/);
    const value = manifest();
    const manifestPath = path.join(root, 'ambient-cell.json');
    await fs.writeFile(manifestPath, JSON.stringify(value));
    const originalEnvironment = { ...process.env };
    try {
      process.env.EXTRA_RUNNER_VALUE = 'drop';
      await runCellPhase(['prepare', manifestPath], {
        operations: {
          prepare: async () => undefined,
          agent: async () => undefined,
          evaluate: async () => undefined,
          postEvaluate: async () => undefined,
          package: async () => undefined,
        },
        stateDirectory: path.join(root, 'ambient-state'),
        outputDirectory: path.join(root, 'ambient-output'),
        processBoundary: {
          begin: async () => undefined,
          cleanup: async () => undefined,
        },
      });
      expect(process.env.EXTRA_RUNNER_VALUE).toBeUndefined();
    } finally {
      for (const name of Object.keys(process.env)) delete process.env[name];
      Object.assign(process.env, originalEnvironment);
    }
  });

  test('covers runner agent, evaluator, post-evaluator, and bundle outcomes', async () => {
    const value = manifest({
      task: {
        ...manifest().task,
        evaluators: [
          { name: 'git-diff' },
          {
            name: 'expected-diff',
            config: { prompt_file: 'judge-prompt.md' },
          },
          {
            name: 'agentic-judge',
            config: {
              assertions: { quality: 'good' },
              prompt: 'judge prompt',
            },
          },
        ],
        post_evaluation: [
          {
            name: 'webhook',
            config: { url: 'https://example.test/hook' },
          },
          {
            name: 'database',
            config: {
              type: 'json-file',
              output_path: 'results.jsonl',
            },
          },
          { name: 'script', config: { command: 'test' } },
          { name: 'script', config: { command: 'test again' } },
        ],
      },
    });
    const workspace = {
      runId: 'attempt',
      paths: {
        root,
        runDir: root,
        modifiedDir: path.join(root, 'modified'),
        artifactsDir: path.join(root, 'artifacts'),
        evaluatorArtifactsDir: path.join(root, 'artifacts', 'evaluators'),
        lockFile: path.join(root, '.lock'),
      },
      repo: value.task.repo,
      branch: 'main',
      modifiedCommit: 'commit',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await Promise.all([
      fs.mkdir(workspace.paths.modifiedDir, { recursive: true }),
      fs.mkdir(workspace.paths.artifactsDir, { recursive: true }),
      fs.mkdir(path.join(root, 'state'), { recursive: true }),
      fs.writeFile(path.join(root, 'judge-prompt.md'), 'judge from file'),
      fs.writeFile(path.join(root, 'agent-prompt.md'), 'agent from file'),
    ]);
    const runtimePath = runnerCliTesting.runtimeStatePath(
      phaseContext(root, value)
    );
    const baseState = {
      schema_version: '1.0.0',
      manifest_hash: stableHash(value),
      started_at: '2026-01-01T00:00:00.000Z',
      workspace,
    };
    await fs.writeFile(runtimePath, JSON.stringify(baseState));

    const unavailable = new SandboxPhaseOperations({
      workspaceRoot: root,
      adapterFactory: () => ({
        name: 'codex-cli',
        version: '1',
        checkAvailability: async () => false,
        execute: async () => {
          throw new Error('not called');
        },
        normalizeLog: () => {
          throw new Error('not called');
        },
      }),
    });
    await expect(
      unavailable.agent({
        ...phaseContext(root, value),
        phase: 'agent',
      })
    ).rejects.toThrow(/not available/);

    const normalizedLog = {
      version: '1.0.0',
      agent: { name: 'codex', version: '1', adapter_version: '1' },
      model: { name: 'model', provider: 'OpenAI', parameters: {} },
      execution: {
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:00:00.010Z',
        duration_ms: 10,
        exit_code: 0,
        status: 'success',
      },
      messages: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        measurement_source: 'unavailable',
      },
      errors: [],
      environment: {
        os: 'test',
        node_version: process.version,
        youbencha_version: 'test',
        working_directory: root,
      },
    } as const;
    let scriptExecution = 0;
    const operations = new SandboxPhaseOperations({
      workspaceRoot: root,
      now: () => new Date('2026-01-01T00:00:01.000Z'),
      maxConcurrentEvaluators: 1,
      adapterFactory: () => ({
        name: 'codex-cli',
        version: '1',
        checkAvailability: async () => true,
        execute: async () => ({
          status: 'success',
          exitCode: 0,
          output: 'done',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:00.010Z',
          durationMs: 10,
          errors: [],
        }),
        normalizeLog: () => normalizedLog,
      }),
      evaluatorFactory: (name) => ({
        name,
        description: name,
        requiresExpectedReference: false,
        checkPreconditions: async () => true,
        evaluate: async () => {
          if (name === 'expected-diff') throw 'evaluator string';
          if (name === 'git-diff') throw new Error('evaluator error');
          return {
            evaluator: name,
            status: 'passed',
            metrics: {},
            message: 'ok',
            duration_ms: 0,
            timestamp: '2026-01-01T00:00:01.000Z',
          };
        },
      }),
      postEvaluatorFactory: (name) => {
        if (name === 'webhook') return undefined;
        return {
          name,
          description: name,
          checkPreconditions: async () => name !== 'database',
          execute: async () => {
            scriptExecution += 1;
            if (scriptExecution > 1) throw new Error('post error');
            throw 'post string';
          },
        };
      },
    });
    await operations.agent({
      ...phaseContext(root, value),
      phase: 'agent',
    });
    const originalAgentState = await fs.readFile(runtimePath, 'utf8');
    const filePromptValue = manifest({
      target: {
        ...manifest().target,
        config: { prompt_file: 'agent-prompt.md' },
      },
    });
    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        ...baseState,
        manifest_hash: stableHash(filePromptValue),
      })
    );
    await operations.agent({
      ...phaseContext(root, filePromptValue),
      phase: 'agent',
    });
    await fs.writeFile(runtimePath, originalAgentState);
    await operations.evaluate({
      ...phaseContext(root, value),
      phase: 'evaluate',
    });
    await operations.postEvaluate({
      ...phaseContext(root, value),
      phase: 'post-evaluate',
    });
    await expect(
      fs.readFile(
        path.join(workspace.paths.artifactsDir, 'post-evaluation-results.json'),
        'utf8'
      )
    ).resolves.toContain('post string');
    const stateWithResults = JSON.parse(
      await fs.readFile(runtimePath, 'utf8')
    ) as typeof baseState & {
      agent: {
        log_path: string;
        status: 'success';
        exit_code: number;
      };
      results_path: string;
    };
    const taskWithoutPostEvaluation = { ...value.task };
    delete taskWithoutPostEvaluation.post_evaluation;
    const noPostEvaluationValue = manifest({
      task: taskWithoutPostEvaluation,
    });
    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        ...stateWithResults,
        manifest_hash: stableHash(noPostEvaluationValue),
      })
    );
    await operations.postEvaluate({
      ...phaseContext(root, noPostEvaluationValue),
      phase: 'post-evaluate',
    });
    const state = JSON.parse(await fs.readFile(runtimePath, 'utf8')) as {
      results_path?: string;
    };
    expect(state.results_path).toBeDefined();
    await expect(
      fs.readFile(
        path.join(workspace.paths.artifactsDir, 'post-evaluation-results.json'),
        'utf8'
      )
    ).resolves.toBe('[]\n');

    await fs.writeFile(runtimePath, JSON.stringify(baseState));
    await expect(
      operations.evaluate({
        ...phaseContext(root, value),
        phase: 'evaluate',
      })
    ).rejects.toThrow(/Agent phase output is unavailable/);
    await expect(
      operations.postEvaluate({
        ...phaseContext(root, value),
        phase: 'post-evaluate',
      })
    ).rejects.toThrow(/Evaluation results are unavailable/);

    const privateOperations = operations as unknown as {
      buildResultsBundle(
        config: ReturnType<typeof runnerCliTesting.compileTestCase>,
        state: typeof baseState & {
          agent?: {
            log_path: string;
            status: 'success';
            exit_code: number;
          };
        },
        evaluations: Array<{
          evaluator: string;
          status: 'passed' | 'failed' | 'skipped';
          metrics: Record<string, number>;
          message: string;
          duration_ms: number;
          timestamp: string;
        }>,
        manifestPath: string
      ): Promise<{ summary: { overall_status: string } }>;
    };
    const passedEvaluation = {
      evaluator: 'git-diff',
      status: 'passed' as const,
      metrics: {},
      message: 'passed',
      duration_ms: 0,
      timestamp: '2026-01-01T00:00:01.000Z',
    };
    await expect(
      privateOperations.buildResultsBundle(
        runnerCliTesting.compileTestCase(value),
        stateWithResults,
        [passedEvaluation],
        path.join(root, 'cell.json')
      )
    ).resolves.toMatchObject({
      summary: { overall_status: 'passed' },
    });
    await expect(
      privateOperations.buildResultsBundle(
        runnerCliTesting.compileTestCase(value),
        stateWithResults,
        [{ ...passedEvaluation, status: 'failed' as const }],
        path.join(root, 'cell.json')
      )
    ).resolves.toMatchObject({
      summary: { overall_status: 'failed' },
    });
    await expect(
      privateOperations.buildResultsBundle(
        runnerCliTesting.compileTestCase(value),
        baseState,
        [],
        path.join(root, 'cell.json')
      )
    ).rejects.toThrow(/Agent phase output is unavailable/);
  });
});
