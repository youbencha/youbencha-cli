import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { z } from 'zod';
import {
  e2bArtifactManifestSchema,
  e2bCellManifestSchema,
  e2bRunnerPhaseSchema,
  type E2BArtifactManifest,
  type E2BCellManifest,
  type E2BRunnerPhase,
} from './schemas.js';
import { canonicalJson, stableHash } from '../experiments/identity.js';

const PHASE_ORDER: readonly E2BRunnerPhase[] = [
  'prepare',
  'agent',
  'evaluate',
  'post-evaluate',
  'package',
];

const SAFE_BASE_ENVIRONMENT = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'PWD',
  'SHLVL',
  'TMPDIR',
  'TZ',
  '_',
]);

const phaseRecordSchema = z
  .object({
    phase: e2bRunnerPhaseSchema,
    status: z.enum(['running', 'completed', 'failed']),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
    error: z.string().optional(),
  })
  .strict();

const runnerPhaseStateSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    experiment_id: z.string().min(1),
    cell_id: z.string().regex(/^[a-f0-9]{64}$/),
    attempt_id: z.string().min(1),
    phases: z.array(phaseRecordSchema),
    updated_at: z.string().datetime(),
  })
  .strict();

export type RunnerPhaseState = z.infer<typeof runnerPhaseStateSchema>;

export interface PhaseExecutionContext {
  phase: E2BRunnerPhase;
  manifest: E2BCellManifest;
  manifestPath: string;
  stateDirectory: string;
  outputDirectory: string;
  environment: Readonly<Record<string, string | undefined>>;
}

export interface PhaseOperations {
  prepare(context: PhaseExecutionContext): Promise<void>;
  agent(context: PhaseExecutionContext): Promise<void>;
  evaluate(context: PhaseExecutionContext): Promise<void>;
  postEvaluate(context: PhaseExecutionContext): Promise<void>;
  package(context: PhaseExecutionContext): Promise<void>;
}

export interface ProcessBoundary {
  begin?(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface PhaseOrchestratorOptions {
  stateDirectory: string;
  outputDirectory: string;
  environment?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  processBoundary?: ProcessBoundary;
}

function secretValues(
  manifest: E2BCellManifest,
  environment: Readonly<Record<string, string | undefined>>
): string[] {
  return manifest.secret_references
    .map((reference) => environment[reference.inject_as])
    .filter((value): value is string => value !== undefined && value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function redactMessage(message: string, values: readonly string[]): string {
  return values.reduce(
    (redacted, value) => redacted.split(value).join('[REDACTED]'),
    message
  );
}

function allowedSecretPhases(phase: E2BRunnerPhase): Set<string> {
  return phase === 'prepare'
    ? new Set(['source', 'prepare'])
    : new Set([phase]);
}

/**
 * Fail closed if the phase environment is broader than the documented base
 * allowlist plus secret variables explicitly scoped to this phase.
 */
export function validatePhaseEnvironment(
  manifest: E2BCellManifest,
  phase: E2BRunnerPhase,
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  if (Object.prototype.hasOwnProperty.call(environment, 'E2B_API_KEY')) {
    throw new Error('E2B_API_KEY is forbidden inside the sandbox');
  }
  const allowedPhases = allowedSecretPhases(phase);
  const allowedSecretNames = new Set(
    manifest.secret_references
      .filter((reference) =>
        reference.phases.some((item) => allowedPhases.has(item))
      )
      .map((reference) => reference.inject_as)
  );

  for (const reference of manifest.secret_references) {
    if (
      !allowedSecretNames.has(reference.inject_as) &&
      environment[reference.inject_as] !== undefined
    ) {
      throw new Error(
        `Secret variable ${reference.inject_as} is not scoped to phase ${phase}`
      );
    }
  }

  const minimal: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (!SAFE_BASE_ENVIRONMENT.has(name) && !allowedSecretNames.has(name)) {
      throw new Error(
        `Environment variable ${name} is not allowed in runner phase ${phase}`
      );
    }
    minimal[name] = value;
  }
  return minimal;
}

/**
 * Selects the phase's minimal environment from the ambient sandbox process.
 * The runner entry point also replaces process.env with this result so
 * adapters cannot reintroduce template login variables when they spawn.
 */
export function isolatePhaseEnvironment(
  manifest: E2BCellManifest,
  phase: E2BRunnerPhase,
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  if (Object.prototype.hasOwnProperty.call(environment, 'E2B_API_KEY')) {
    throw new Error('E2B_API_KEY is forbidden inside the sandbox');
  }
  const allowedPhases = allowedSecretPhases(phase);
  const allowed = new Set(SAFE_BASE_ENVIRONMENT);
  for (const reference of manifest.secret_references) {
    if (reference.phases.some((item) => allowedPhases.has(item))) {
      allowed.add(reference.inject_as);
    }
  }
  return validatePhaseEnvironment(
    manifest,
    phase,
    Object.fromEntries(
      Object.entries(environment).filter(
        ([name, value]) => value !== undefined && allowed.has(name)
      )
    )
  );
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await fs.rename(temporary, file);
}

async function readState(file: string): Promise<RunnerPhaseState | undefined> {
  try {
    return runnerPhaseStateSchema.parse(
      JSON.parse(await fs.readFile(file, 'utf8'))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertStateOwnership(
  state: RunnerPhaseState,
  manifest: E2BCellManifest
): void {
  const manifestHash = stableHash(manifest);
  if (
    state.manifest_hash !== manifestHash ||
    state.experiment_id !== manifest.experiment_id ||
    state.cell_id !== manifest.cell_id ||
    state.attempt_id !== manifest.attempt_id
  ) {
    throw new Error(
      'Runner state does not belong to the selected manifest and attempt'
    );
  }
}

function expectedNextPhase(
  state: RunnerPhaseState
): E2BRunnerPhase | undefined {
  const completed = state.phases.filter(
    (record) => record.status === 'completed'
  ).length;
  return PHASE_ORDER[completed];
}

/**
 * Durable, one-phase-at-a-time runner orchestration.
 *
 * A crashed "running" phase is deliberately not retried: the controller must
 * reconcile or replace the sandbox so an agent cannot execute twice.
 */
export class PhaseOrchestrator {
  private readonly now: () => Date;
  private readonly environment: Readonly<Record<string, string | undefined>>;

  constructor(
    private readonly operations: PhaseOperations,
    private readonly options: PhaseOrchestratorOptions
  ) {
    this.now = options.now ?? ((): Date => new Date());
    this.environment = options.environment ?? process.env;
  }

  async run(
    phaseInput: E2BRunnerPhase,
    manifestInput: unknown,
    manifestPath: string
  ): Promise<RunnerPhaseState> {
    const phase = e2bRunnerPhaseSchema.parse(phaseInput);
    const manifest = e2bCellManifestSchema.parse(manifestInput);
    validatePhaseEnvironment(manifest, phase, this.environment);

    const statePath = path.join(
      this.options.stateDirectory,
      'phase-state.json'
    );
    let state = await readState(statePath);
    if (state === undefined) {
      if (phase !== 'prepare') {
        throw new Error('Runner phase prepare must execute first');
      }
      state = {
        schema_version: '1.0.0',
        manifest_hash: stableHash(manifest),
        experiment_id: manifest.experiment_id,
        cell_id: manifest.cell_id,
        attempt_id: manifest.attempt_id,
        phases: [],
        updated_at: this.now().toISOString(),
      };
    } else {
      assertStateOwnership(state, manifest);
    }

    const existing = state.phases.find((record) => record.phase === phase);
    if (existing?.status === 'completed') return state;
    if (existing !== undefined) {
      throw new Error(
        `Runner phase ${phase} is already ${existing.status}; sandbox reconciliation is required`
      );
    }
    const next = expectedNextPhase(state);
    if (next !== phase) {
      throw new Error(
        `Runner phase ${phase} is out of order; expected ${next ?? 'no further phase'}`
      );
    }

    const startedAt = this.now().toISOString();
    state = {
      ...state,
      phases: [
        ...state.phases,
        { phase, status: 'running', started_at: startedAt },
      ],
      updated_at: startedAt,
    };
    await writeAtomic(statePath, state);

    const context: PhaseExecutionContext = {
      phase,
      manifest,
      manifestPath: path.resolve(manifestPath),
      stateDirectory: path.resolve(this.options.stateDirectory),
      outputDirectory: path.resolve(this.options.outputDirectory),
      environment: validatePhaseEnvironment(manifest, phase, this.environment),
    };
    const values = secretValues(manifest, this.environment);

    try {
      await this.options.processBoundary?.begin?.();
      try {
        await this.execute(phase, context);
      } catch (operationError) {
        try {
          await this.options.processBoundary?.cleanup();
        } catch (cleanupError) {
          throw new Error(
            `${
              operationError instanceof Error
                ? operationError.message
                : String(operationError)
            }; phase process cleanup also failed: ${
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            }`
          );
        }
        throw operationError;
      }
      await this.options.processBoundary?.cleanup();
      const completedAt = this.now().toISOString();
      state = {
        ...state,
        phases: state.phases.map((record) =>
          record.phase === phase
            ? {
                ...record,
                status: 'completed' as const,
                completed_at: completedAt,
              }
            : record
        ),
        updated_at: completedAt,
      };
      await writeAtomic(statePath, state);
      return state;
    } catch (error) {
      const completedAt = this.now().toISOString();
      const safeMessage = redactMessage(
        error instanceof Error ? error.message : String(error),
        values
      );
      state = {
        ...state,
        phases: state.phases.map((record) =>
          record.phase === phase
            ? {
                ...record,
                status: 'failed' as const,
                completed_at: completedAt,
                error: safeMessage,
              }
            : record
        ),
        updated_at: completedAt,
      };
      await writeAtomic(statePath, state);
      throw new Error(safeMessage);
    }
  }

  private async execute(
    phase: E2BRunnerPhase,
    context: PhaseExecutionContext
  ): Promise<void> {
    switch (phase) {
      case 'prepare':
        return this.operations.prepare(context);
      case 'agent':
        return this.operations.agent(context);
      case 'evaluate':
        return this.operations.evaluate(context);
      case 'post-evaluate':
        return this.operations.postEvaluate(context);
      case 'package':
        return this.operations.package(context);
    }
  }
}

async function listLinuxProcesses(): Promise<Set<number>> {
  return new Promise((resolve, reject) => {
    const child = spawn('ps', ['-e', '-o', 'pid='], {
      shell: false,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Unable to inspect sandbox processes: ${stderr}`));
        return;
      }
      const processes = new Set(
        stdout
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
          .filter(Number.isSafeInteger)
      );
      if (child.pid !== undefined) processes.delete(child.pid);
      resolve(processes);
    });
  });
}

/**
 * Sandboxes are single-cell guests, so every process created during a phase
 * is terminated before a differently credentialed phase can begin. Capturing
 * all PIDs also catches children that double-fork and are reparented to init.
 */
export class LinuxSandboxProcessBoundary implements ProcessBoundary {
  private baseline?: Set<number>;

  async begin(): Promise<void> {
    if (process.platform !== 'linux') {
      throw new Error('The E2B process boundary is supported only on Linux');
    }
    this.baseline = await listLinuxProcesses();
  }

  async cleanup(): Promise<void> {
    if (this.baseline === undefined) {
      throw new Error('Process cleanup was requested without a phase baseline');
    }
    const created = [...(await listLinuxProcesses())].filter(
      (pid) => pid !== process.pid && !this.baseline?.has(pid)
    );
    for (const pid of created) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    if (created.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const remaining = [...(await listLinuxProcesses())].filter((pid) =>
      created.includes(pid)
    );
    for (const pid of remaining) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    if (remaining.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const survivors = [...(await listLinuxProcesses())].filter((pid) =>
      remaining.includes(pid)
    );
    if (survivors.length > 0) {
      throw new Error(
        `Phase process cleanup failed for PIDs ${survivors.join(', ')}`
      );
    }
    this.baseline = undefined;
  }
}

export interface ArtifactArchiveWriter {
  write(
    sourceDirectory: string,
    destination: string,
    environment: Readonly<Record<string, string>>
  ): Promise<void>;
}

export class TarZstdArchiveWriter implements ArtifactArchiveWriter {
  async write(
    sourceDirectory: string,
    destination: string,
    environment: Readonly<Record<string, string>>
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'tar',
        ['--zstd', '-cf', destination, '-C', sourceDirectory, '.'],
        {
          shell: false,
          env: { ...environment },
          stdio: ['ignore', 'ignore', 'pipe'],
        }
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 16 * 1024) stderr = stderr.slice(-16 * 1024);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`tar packaging failed with code ${code}: ${stderr}`)
          );
      });
    });
  }
}

interface PackageEntry {
  path: string;
  size: number;
  sha256: string;
}

async function inspectArtifactTree(
  root: string,
  maximumFiles: number,
  maximumFileBytes: number,
  maximumTotalBytes: number
): Promise<PackageEntry[]> {
  const entries: PackageEntry[] = [];
  let total = 0;

  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Artifact link is forbidden: ${relative}`);
      }
      if (stat.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Unsupported artifact type: ${relative}`);
      }
      if (stat.size > maximumFileBytes) {
        throw new Error(`Artifact exceeds per-file limit: ${relative}`);
      }
      total += stat.size;
      if (total > maximumTotalBytes) {
        throw new Error('Artifacts exceed the total uncompressed size limit');
      }
      if (entries.length + 1 > maximumFiles) {
        throw new Error('Artifacts exceed the file-count limit');
      }
      entries.push({
        path: relative,
        size: stat.size,
        sha256: createHash('sha256')
          .update(await fs.readFile(absolute))
          .digest('hex'),
      });
    }
  }

  await visit(root);
  return entries.sort((left, right) =>
    left.path.localeCompare(right.path, 'en')
  );
}

export interface BuildArtifactPackageInput {
  manifest: E2BCellManifest;
  artifactsDirectory: string;
  outputDirectory: string;
  environment: Readonly<Record<string, string>>;
  redactionApplied: boolean;
  archiveWriter?: ArtifactArchiveWriter;
}

/**
 * Produces the bounded remote artifact package. It refuses links and special
 * files before the archiver sees them and never includes the mutable repository.
 */
export async function buildArtifactPackage(
  input: BuildArtifactPackageInput
): Promise<E2BArtifactManifest> {
  const limits = input.manifest.artifact_limits;
  const entries = await inspectArtifactTree(
    input.artifactsDirectory,
    limits.max_files,
    limits.max_file_bytes,
    limits.max_uncompressed_bytes
  );
  if (!entries.some((entry) => entry.path === 'results.json')) {
    throw new Error('Cannot package artifacts without results.json');
  }

  await fs.mkdir(input.outputDirectory, { recursive: true });
  const archivePath = path.join(input.outputDirectory, 'artifacts.tar.zst');
  await (input.archiveWriter ?? new TarZstdArchiveWriter()).write(
    input.artifactsDirectory,
    archivePath,
    input.environment
  );
  const archive = await fs.readFile(archivePath);
  if (archive.byteLength > limits.max_compressed_bytes) {
    throw new Error('Compressed artifact archive exceeds the configured limit');
  }

  const manifest = e2bArtifactManifestSchema.parse({
    schema_version: '1.0.0',
    artifact_protocol_version: '1.0.0',
    experiment_id: input.manifest.experiment_id,
    cell_id: input.manifest.cell_id,
    attempt_id: input.manifest.attempt_id,
    result_schema_version: '1.0.0',
    remote_result_path: 'results.json',
    runner_status: 'completed',
    artifacts: entries.map((entry) => ({
      path: entry.path,
      uncompressed_size: entry.size,
      sha256: entry.sha256,
      truncated: false,
      redacted: false,
    })),
    archive: {
      sha256: createHash('sha256').update(archive).digest('hex'),
      compressed_size: archive.byteLength,
      uncompressed_size: entries.reduce((sum, entry) => sum + entry.size, 0),
    },
    completion: {
      redaction_applied: input.redactionApplied,
      truncation_applied: false,
    },
  });
  await writeAtomic(
    path.join(input.outputDirectory, 'manifest.json'),
    manifest
  );
  return manifest;
}
