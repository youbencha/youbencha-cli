import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  buildArtifactPackage,
  PhaseOrchestrator,
  validatePhaseEnvironment,
  type ArtifactArchiveWriter,
  type PhaseExecutionContext,
  type PhaseOperations,
  type ProcessBoundary,
} from '../../src/e2b/phase-orchestrator.js';
import type { E2BCellManifest } from '../../src/e2b/schemas.js';
import {
  redactRunnerArtifactFiles,
  runCellPhase,
} from '../../src/e2b/runner-cli.js';

function manifest(): E2BCellManifest {
  return {
    schema_version: '1.0.0',
    experiment_id: 'experiment-1',
    cell_id: 'a'.repeat(64),
    attempt_id: 'attempt-1',
    target: {
      id: 'candidate',
      agent_type: 'codex-cli',
      requested_model: 'test-model',
      expected_harness_version: '1.0.0',
      adapter_schema_version: '1.0.0',
      config: {
        prompt: 'Fix the test',
      },
    },
    task: {
      name: 'task',
      description: 'task description',
      repo: 'https://example.com/repo.git',
      evaluators: [{ name: 'git-diff' }],
    },
    template: {
      template_id: 'template',
      build_id: 'build-1',
    },
    required_capabilities: [
      {
        component: 'target',
        type: 'codex-cli',
        version: '1.0.0',
        adapter_schema_version: '1.0.0',
      },
    ],
    network: { inbound: 'none', outbound: 'none' },
    deadlines: {
      phases_ms: {
        prepare: 1000,
        agent: 1000,
        evaluate: 1000,
        post_evaluate: 1000,
        package: 1000,
      },
      collection_grace_ms: 100,
      cleanup_grace_ms: 100,
      sandbox_ttl_ms: 2000,
      watchdog_ms: 3000,
    },
    artifact_limits: {
      max_files: 10,
      max_file_bytes: 1024,
      max_compressed_bytes: 4096,
      max_uncompressed_bytes: 4096,
    },
    secret_references: [
      {
        id: 'model-key',
        source: { type: 'environment', name: 'LOCAL_MODEL_KEY' },
        inject_as: 'MODEL_API_KEY',
        targets: ['candidate'],
        components: ['target'],
        phases: ['agent'],
      },
    ],
  };
}

class FakeOperations implements PhaseOperations {
  readonly calls: string[] = [];
  agentError?: Error;

  async prepare(_context: PhaseExecutionContext): Promise<void> {
    this.calls.push('prepare');
  }
  async agent(_context: PhaseExecutionContext): Promise<void> {
    this.calls.push('agent');
    if (this.agentError !== undefined) throw this.agentError;
  }
  async evaluate(_context: PhaseExecutionContext): Promise<void> {
    this.calls.push('evaluate');
  }
  async postEvaluate(_context: PhaseExecutionContext): Promise<void> {
    this.calls.push('post-evaluate');
  }
  async package(_context: PhaseExecutionContext): Promise<void> {
    this.calls.push('package');
  }
}

const boundary: ProcessBoundary = {
  begin: async (): Promise<void> => undefined,
  cleanup: async (): Promise<void> => undefined,
};

function environment(
  additions: Record<string, string> = {}
): Record<string, string> {
  return {
    PATH: '/usr/bin:/bin',
    HOME: '/home/user',
    LANG: 'C.UTF-8',
    ...additions,
  };
}

describe('E2B phase orchestration', () => {
  let temporaryDirectory: string;
  let stateDirectory: string;
  let outputDirectory: string;
  let manifestPath: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-runner-')
    );
    stateDirectory = path.join(temporaryDirectory, 'state');
    outputDirectory = path.join(temporaryDirectory, 'output');
    manifestPath = path.join(temporaryDirectory, 'cell.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest()));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  function orchestrator(
    operations: FakeOperations,
    phaseEnvironment = environment()
  ): PhaseOrchestrator {
    return new PhaseOrchestrator(operations, {
      stateDirectory,
      outputDirectory,
      environment: phaseEnvironment,
      processBoundary: boundary,
    });
  }

  it('runs the closed phases in order and makes completed phases idempotent', async () => {
    const operations = new FakeOperations();
    const value = manifest();
    await orchestrator(operations).run('prepare', value, manifestPath);
    await orchestrator(operations).run('prepare', value, manifestPath);
    await orchestrator(
      operations,
      environment({ MODEL_API_KEY: 'phase-secret' })
    ).run('agent', value, manifestPath);
    await orchestrator(operations).run('evaluate', value, manifestPath);
    await orchestrator(operations).run('post-evaluate', value, manifestPath);
    const completed = await orchestrator(operations).run(
      'package',
      value,
      manifestPath
    );

    expect(operations.calls).toEqual([
      'prepare',
      'agent',
      'evaluate',
      'post-evaluate',
      'package',
    ]);
    expect(completed.phases.map((phase) => phase.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  });

  it('exposes a two-argument runner entry without executing manifest values as command text', async () => {
    const operations = new FakeOperations();
    await runCellPhase(['prepare', manifestPath], {
      operations,
      stateDirectory,
      outputDirectory,
      environment: environment(),
      processBoundary: boundary,
    });
    expect(operations.calls).toEqual(['prepare']);
    await expect(
      runCellPhase(['prepare'], {
        operations,
        stateDirectory,
        outputDirectory,
        environment: environment(),
        processBoundary: boundary,
      })
    ).rejects.toThrow('Usage: run-cell');
  });

  it('drops undeclared ambient variables at the runner entry boundary', async () => {
    let observed: Readonly<Record<string, string | undefined>> | undefined;
    const operations: PhaseOperations = {
      prepare: async (context): Promise<void> => {
        observed = context.environment;
      },
      agent: async (): Promise<void> => undefined,
      evaluate: async (): Promise<void> => undefined,
      postEvaluate: async (): Promise<void> => undefined,
      package: async (): Promise<void> => undefined,
    };
    await runCellPhase(['prepare', manifestPath], {
      operations,
      stateDirectory,
      outputDirectory,
      environment: environment({ UNDECLARED_LOGIN_VALUE: 'drop-me' }),
      processBoundary: boundary,
    });
    expect(observed).not.toHaveProperty('UNDECLARED_LOGIN_VALUE');
    expect(observed).toHaveProperty('PATH');
  });

  it('rejects out-of-order and changed-manifest execution', async () => {
    const operations = new FakeOperations();
    await expect(
      orchestrator(operations).run('agent', manifest(), manifestPath)
    ).rejects.toThrow('prepare must execute first');

    await orchestrator(operations).run('prepare', manifest(), manifestPath);
    const changed = manifest();
    changed.target.requested_model = 'different';
    await expect(
      orchestrator(operations, environment({ MODEL_API_KEY: 'secret' })).run(
        'agent',
        changed,
        manifestPath
      )
    ).rejects.toThrow('does not belong');
  });

  it('fails closed when credentials leak into the wrong phase', () => {
    expect(() =>
      validatePhaseEnvironment(
        manifest(),
        'prepare',
        environment({ MODEL_API_KEY: 'secret' })
      )
    ).toThrow('not scoped to phase prepare');
    expect(() =>
      validatePhaseEnvironment(
        manifest(),
        'package',
        environment({ E2B_API_KEY: 'never' })
      )
    ).toThrow('E2B_API_KEY is forbidden');
    expect(() =>
      validatePhaseEnvironment(
        manifest(),
        'agent',
        environment({ UNDECLARED_CREDENTIAL: 'secret' })
      )
    ).toThrow('not allowed');
  });

  it('redacts the active phase secret from durable failure state', async () => {
    const operations = new FakeOperations();
    operations.agentError = new Error('provider rejected phase-secret');
    await orchestrator(operations).run('prepare', manifest(), manifestPath);
    await expect(
      orchestrator(
        operations,
        environment({ MODEL_API_KEY: 'phase-secret' })
      ).run('agent', manifest(), manifestPath)
    ).rejects.toThrow('provider rejected [REDACTED]');

    const persisted = await fs.readFile(
      path.join(stateDirectory, 'phase-state.json'),
      'utf8'
    );
    expect(persisted).not.toContain('phase-secret');
    expect(persisted).toContain('[REDACTED]');
  });

  it('runs process cleanup even when a phase operation fails', async () => {
    const operations = new FakeOperations();
    operations.agentError = new Error('agent failed');
    let cleanupCalls = 0;
    const countedBoundary: ProcessBoundary = {
      begin: async (): Promise<void> => undefined,
      cleanup: async (): Promise<void> => {
        cleanupCalls += 1;
      },
    };
    await orchestrator(operations).run('prepare', manifest(), manifestPath);
    const agentOrchestrator = new PhaseOrchestrator(operations, {
      stateDirectory,
      outputDirectory,
      environment: environment({ MODEL_API_KEY: 'secret' }),
      processBoundary: countedBoundary,
    });
    await expect(
      agentOrchestrator.run('agent', manifest(), manifestPath)
    ).rejects.toThrow('agent failed');
    expect(cleanupCalls).toBe(1);
  });

  it('removes exact secret canaries from retained artifact bytes', async () => {
    const artifacts = path.join(temporaryDirectory, 'redaction-artifacts');
    await fs.mkdir(artifacts);
    const artifact = path.join(artifacts, 'agent.log');
    await fs.writeFile(
      artifact,
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from('secret-canary'),
        Buffer.from([3, 4]),
      ])
    );

    await redactRunnerArtifactFiles(artifacts, ['secret-canary']);
    const contents = await fs.readFile(artifact);
    expect(contents.includes(Buffer.from('secret-canary'))).toBe(false);
    expect(contents.includes(Buffer.from('[REDACTED]'))).toBe(true);
  });
});

describe('remote artifact package builder', () => {
  let temporaryDirectory: string;
  let artifactsDirectory: string;
  let outputDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-package-')
    );
    artifactsDirectory = path.join(temporaryDirectory, 'artifacts');
    outputDirectory = path.join(temporaryDirectory, 'output');
    await fs.mkdir(artifactsDirectory);
    await fs.writeFile(
      path.join(artifactsDirectory, 'results.json'),
      '{"version":"1.0.0"}'
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('writes a bounded manifest without packaging the mutable workspace', async () => {
    const writer: ArtifactArchiveWriter = {
      write: async (_source, destination): Promise<void> => {
        await fs.writeFile(destination, 'archive-bytes');
      },
    };
    const built = await buildArtifactPackage({
      manifest: manifest(),
      artifactsDirectory,
      outputDirectory,
      environment: environment(),
      redactionApplied: true,
      archiveWriter: writer,
    });

    expect(built.remote_result_path).toBe('results.json');
    expect(built.artifacts.map((entry) => entry.path)).toEqual([
      'results.json',
    ]);
    expect(built.archive.compressed_size).toBe(
      Buffer.byteLength('archive-bytes')
    );
    expect(built.completion.redaction_applied).toBe(true);
    await expect(
      fs.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8')
    ).resolves.toContain('"runner_status":"completed"');
  });

  it('rejects artifacts before invoking the archiver when limits are exceeded', async () => {
    await fs.writeFile(
      path.join(artifactsDirectory, 'oversized.log'),
      'x'.repeat(2048)
    );
    let invoked = false;
    const writer: ArtifactArchiveWriter = {
      write: async (): Promise<void> => {
        invoked = true;
      },
    };
    await expect(
      buildArtifactPackage({
        manifest: manifest(),
        artifactsDirectory,
        outputDirectory,
        environment: environment(),
        redactionApplied: true,
        archiveWriter: writer,
      })
    ).rejects.toThrow('per-file limit');
    expect(invoked).toBe(false);
  });
});
