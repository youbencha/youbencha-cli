import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, lstatSync, realpathSync } from 'fs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  experimentStateSchema,
  type ExperimentState,
} from '../schemas/experiment-result.schema.js';
import {
  resultsBundleSchema,
  type ResultsBundle,
} from '../schemas/result.schema.js';
import type { ExperimentPlan } from './planner.js';

const experimentIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const manifestSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    experiment_id: z.string().regex(experimentIdentifier),
    definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.string().datetime(),
    effective_configuration: z.unknown(),
    cells: z.array(
      z
        .object({
          cell_id: z.string().regex(/^[a-f0-9]{64}$/),
          testcase_id: z.string().min(1),
          variant_name: z.string().min(1),
          repetition: z.number().int().nonnegative(),
          config_hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
    ),
  })
  .strict();

export type ExperimentManifest = z.infer<typeof manifestSchema>;

function assertIdentifier(identifier: string): void {
  if (!experimentIdentifier.test(identifier)) {
    throw new Error(`Invalid experiment identifier "${identifier}"`);
  }
}

function containedPath(parent: string, ...segments: string[]): string {
  const resolvedParent = path.resolve(parent);
  const target = path.resolve(resolvedParent, ...segments);
  if (
    target !== resolvedParent &&
    !target.startsWith(`${resolvedParent}${path.sep}`)
  ) {
    throw new Error(`Path escapes experiment directory: ${target}`);
  }
  return target;
}

async function assertNoLinkedComponents(
  root: string,
  target: string
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = containedPath(
    resolvedRoot,
    path.relative(resolvedRoot, target)
  );
  const filesystemRoot = path.parse(resolvedRoot).root;
  const relative = path.relative(filesystemRoot, resolvedTarget);
  let current = filesystemRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Linked path component is not allowed: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

function assertNoLinkedExistingComponentsSync(target: string): void {
  const resolved = path.resolve(target);
  const filesystemRoot = path.parse(resolved).root;
  const relative = path.relative(filesystemRoot, resolved);
  let current = filesystemRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`Linked path component is not allowed: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export class ExperimentStateStore {
  public readonly experimentDirectory: string;
  private readonly stateFile: string;
  private readonly manifestFile: string;
  private readonly lockFile: string;
  private saveQueue: Promise<void> = Promise.resolve();

  public constructor(
    resultsDirectory: string,
    public readonly experimentId: string
  ) {
    assertIdentifier(experimentId);
    const root = path.resolve(resultsDirectory);
    assertNoLinkedExistingComponentsSync(root);
    this.experimentDirectory = containedPath(root, experimentId);
    if (existsSync(root) && existsSync(this.experimentDirectory)) {
      const realRoot = realpathSync(root);
      const realExperimentDirectory = realpathSync(this.experimentDirectory);
      if (
        realExperimentDirectory !== realRoot &&
        !realExperimentDirectory.startsWith(`${realRoot}${path.sep}`)
      ) {
        throw new Error(
          `Experiment ${experimentId} resolves outside the results directory`
        );
      }
    }
    this.stateFile = containedPath(this.experimentDirectory, 'state.json');
    this.manifestFile = containedPath(
      this.experimentDirectory,
      'experiment.json'
    );
    this.lockFile = containedPath(this.experimentDirectory, '.run.lock');
  }

  public async acquireRunLock(): Promise<() => Promise<void>> {
    await assertNoLinkedComponents(
      path.dirname(this.experimentDirectory),
      this.experimentDirectory
    );
    await fs.mkdir(this.experimentDirectory, { recursive: true });
    const token = randomUUID();
    const writeLock = async (): Promise<void> => {
      const handle = await fs.open(this.lockFile, 'wx');
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token })}\n`,
          'utf8'
        );
      } finally {
        await handle.close();
      }
    };
    try {
      await writeLock();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await this.recoverStaleLock(writeLock);
    }
    return async (): Promise<void> => {
      try {
        const owner = JSON.parse(await fs.readFile(this.lockFile, 'utf8')) as {
          token?: unknown;
        };
        if (owner.token === token) {
          await fs.unlink(this.lockFile);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    };
  }

  private async recoverStaleLock(acquire: () => Promise<void>): Promise<void> {
    const recoveryFile = `${this.lockFile}.recovery`;
    const recoveryToken = randomUUID();
    let recoveryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      recoveryHandle = await fs.open(recoveryFile, 'wx');
      await recoveryHandle.writeFile(recoveryToken, 'utf8');
    } catch (error) {
      await recoveryHandle?.close();
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Experiment ${this.experimentId} is already running in another process`
        );
      }
      throw error;
    }

    const staleFile = `${this.lockFile}.stale.${randomUUID()}`;
    let operationError: unknown;
    try {
      let owner: { pid?: unknown } = {};
      try {
        owner = JSON.parse(await fs.readFile(this.lockFile, 'utf8')) as {
          pid?: unknown;
        };
      } catch {
        throw new Error(
          `Experiment ${this.experimentId} is already running in another process`
        );
      }
      const pid = typeof owner.pid === 'number' ? owner.pid : undefined;
      if (pid === undefined || this.isProcessActive(pid)) {
        throw new Error(
          `Experiment ${this.experimentId} is already running in another process`
        );
      }

      await fs.rename(this.lockFile, staleFile);
      try {
        await acquire();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `Experiment ${this.experimentId} is already running in another process`
          );
        }
        throw error;
      }
    } catch (error) {
      operationError = error;
    }

    let cleanupError: unknown;
    try {
      await recoveryHandle.close();
      await fs.rm(staleFile, { force: true });
      try {
        const currentToken = await fs.readFile(recoveryFile, 'utf8');
        if (currentToken === recoveryToken) {
          await fs.unlink(recoveryFile);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } catch (error) {
      cleanupError = error;
    }
    if (operationError !== undefined) {
      throw operationError;
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  }

  private isProcessActive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  public async create(
    plan: ExperimentPlan,
    createdAt: string
  ): Promise<ExperimentState> {
    await assertNoLinkedComponents(
      path.dirname(this.experimentDirectory),
      this.experimentDirectory
    );
    await fs.mkdir(containedPath(this.experimentDirectory, 'cells'), {
      recursive: true,
    });
    const manifest: ExperimentManifest = {
      schema_version: '1.0.0',
      experiment_id: this.experimentId,
      definition_hash: plan.definitionHash,
      created_at: createdAt,
      effective_configuration: plan.redactedEffectiveConfiguration,
      cells: plan.cells.map((cell) => ({
        cell_id: cell.cellId,
        testcase_id: cell.testcaseId,
        variant_name: cell.variantName,
        repetition: cell.repetition,
        config_hash: cell.configHash,
      })),
    };
    const state: ExperimentState = {
      schema_version: '1.0.0',
      experiment_id: this.experimentId,
      definition_hash: plan.definitionHash,
      status: 'pending',
      updated_at: createdAt,
      cells: plan.cells.map((cell) => ({
        cell_id: cell.cellId,
        testcase_id: cell.testcaseId,
        variant_name: cell.variantName,
        repetition: cell.repetition,
        status: 'pending',
        attempts: [],
        usage_quality: 'unavailable',
      })),
      budget: {
        duration_ms_used: 0,
        cost_usd_used: 0,
        sandbox_runtime_ms_used: 0,
      },
    };
    await atomicJson(this.manifestFile, manifestSchema.parse(manifest));
    await this.save(state);
    return state;
  }

  public async load(
    expectedDefinitionHash: string
  ): Promise<{ manifest: ExperimentManifest; state: ExperimentState }> {
    await Promise.all([
      assertNoLinkedComponents(this.experimentDirectory, this.manifestFile),
      assertNoLinkedComponents(this.experimentDirectory, this.stateFile),
    ]);
    const [manifestText, stateText] = await Promise.all([
      fs.readFile(this.manifestFile, 'utf8'),
      fs.readFile(this.stateFile, 'utf8'),
    ]);
    const manifest = manifestSchema.parse(JSON.parse(manifestText));
    const state = experimentStateSchema.parse(JSON.parse(stateText));
    if (
      manifest.experiment_id !== this.experimentId ||
      state.experiment_id !== this.experimentId ||
      manifest.definition_hash !== expectedDefinitionHash ||
      state.definition_hash !== expectedDefinitionHash
    ) {
      throw new Error(
        `Experiment ${this.experimentId} does not match the requested definition`
      );
    }
    return { manifest, state };
  }

  public async save(state: ExperimentState): Promise<void> {
    const persistedState = experimentStateSchema.parse(state);
    const operation = this.saveQueue.then(async () => {
      await assertNoLinkedComponents(this.experimentDirectory, this.stateFile);
      await atomicJson(this.stateFile, persistedState);
    });
    this.saveQueue = operation.catch(() => undefined);
    await operation;
  }

  public async saveAttemptResult(
    cellId: string,
    attemptNumber: number,
    result: ResultsBundle
  ): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(cellId)) {
      throw new Error(`Invalid cell identifier "${cellId}"`);
    }
    const relative = path.join(
      'cells',
      cellId,
      `attempt-${attemptNumber}`,
      'results.json'
    );
    const target = containedPath(this.experimentDirectory, relative);
    await assertNoLinkedComponents(this.experimentDirectory, target);
    await atomicJson(target, resultsBundleSchema.parse(result));
    return relative.replace(/\\/g, '/');
  }

  public async validateAttemptResult(relativePath: string): Promise<void> {
    if (path.isAbsolute(relativePath)) {
      throw new Error('Persisted result path must be relative');
    }
    const target = containedPath(this.experimentDirectory, relativePath);
    await assertNoLinkedComponents(this.experimentDirectory, target);
    const content = await fs.readFile(target, 'utf8');
    resultsBundleSchema.parse(JSON.parse(content));
  }
}
