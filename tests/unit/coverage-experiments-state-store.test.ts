import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ExperimentStateStore } from '../../src/experiments/state-store.js';
import type { ExperimentPlan } from '../../src/experiments/planner.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

const hash = 'a'.repeat(64);
const cellHash = 'b'.repeat(64);
const timestamp = '2026-07-29T12:00:00.000Z';

function plan(): ExperimentPlan {
  return {
    definitionHash: hash,
    redactedEffectiveConfiguration: {},
    cellCount: 1,
    budget: undefined,
    cells: [
      {
        cellId: cellHash,
        testcaseId: 'case',
        variantName: 'target',
        repetition: 0,
        configHash: hash,
        config: {},
      },
    ],
  } as unknown as ExperimentPlan;
}

function bundle(workspace: string): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'fixture',
      config_file: 'case.yaml',
      config_hash: hash,
      repo: 'https://example.test/repo.git',
      branch: 'main',
      commit: 'abc',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 0,
      youbencha_version: 'test',
      environment: {
        os: 'test',
        node_version: '20',
        workspace_dir: workspace,
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

describe('experiment state store residual coverage', () => {
  let temporaryDirectory: string;
  let resultsDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-state-')
    );
    resultsDirectory = path.join(temporaryDirectory, 'results');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('validates identifiers and creates, saves, and loads state', async () => {
    expect(() => new ExperimentStateStore(resultsDirectory, '../bad')).toThrow(
      'Invalid experiment identifier'
    );
    const store = new ExperimentStateStore(resultsDirectory, 'experiment');
    const created = await store.create(plan(), timestamp);
    created.started_at = timestamp;
    await store.save(created);
    await expect(store.load(hash)).resolves.toMatchObject({
      manifest: { experiment_id: 'experiment', definition_hash: hash },
      state: {
        experiment_id: 'experiment',
        definition_hash: hash,
        started_at: timestamp,
      },
    });

    const invalid = { ...created, experiment_id: '' };
    await expect(store.save(invalid)).rejects.toThrow();
    await expect(store.save(created)).resolves.toBeUndefined();
  });

  it('rejects every persisted identity mismatch', async () => {
    const store = new ExperimentStateStore(resultsDirectory, 'experiment');
    await store.create(plan(), timestamp);
    await expect(store.load('c'.repeat(64))).rejects.toThrow(
      'does not match the requested definition'
    );

    const stateFile = path.join(store.experimentDirectory, 'state.json');
    const originalState = JSON.parse(
      await fs.readFile(stateFile, 'utf8')
    ) as Record<string, unknown>;
    await fs.writeFile(
      stateFile,
      JSON.stringify({ ...originalState, experiment_id: 'other' })
    );
    await expect(store.load(hash)).rejects.toThrow(
      'does not match the requested definition'
    );
  });

  it('persists and validates attempt results while rejecting unsafe paths', async () => {
    const store = new ExperimentStateStore(resultsDirectory, 'experiment');
    await store.create(plan(), timestamp);
    await expect(
      store.saveAttemptResult('invalid', 1, bundle(temporaryDirectory))
    ).rejects.toThrow('Invalid cell identifier');
    const relative = await store.saveAttemptResult(
      cellHash,
      1,
      bundle(temporaryDirectory)
    );
    expect(relative).toBe(`cells/${cellHash}/attempt-1/results.json`);
    await expect(
      store.validateAttemptResult(relative)
    ).resolves.toBeUndefined();
    await expect(
      store.validateAttemptResult(path.resolve(temporaryDirectory, 'absolute'))
    ).rejects.toThrow('must be relative');
    await expect(store.validateAttemptResult('../escape.json')).rejects.toThrow(
      'escapes experiment directory'
    );

    const resultFile = path.join(store.experimentDirectory, relative);
    await fs.writeFile(resultFile, '{}');
    await expect(store.validateAttemptResult(relative)).rejects.toThrow();
  });

  it('releases only its own lock and handles missing and malformed lock files', async () => {
    const store = new ExperimentStateStore(resultsDirectory, 'experiment');
    const release = await store.acquireRunLock();
    const lock = path.join(store.experimentDirectory, '.run.lock');
    await fs.writeFile(lock, JSON.stringify({ token: 'another' }));
    await release();
    await expect(fs.stat(lock)).resolves.toBeDefined();
    await fs.rm(lock);
    await expect(release()).resolves.toBeUndefined();

    const releaseMalformed = await store.acquireRunLock();
    await fs.writeFile(lock, '{');
    await expect(releaseMalformed()).rejects.toBeInstanceOf(SyntaxError);
  });

  it('refuses active and unreadable locks and recovers a stale process lock', async () => {
    const active = new ExperimentStateStore(resultsDirectory, 'active');
    await fs.mkdir(active.experimentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(active.experimentDirectory, '.run.lock'),
      JSON.stringify({ pid: process.pid, token: 'active' })
    );
    await expect(active.acquireRunLock()).rejects.toThrow('already running');

    const unreadable = new ExperimentStateStore(resultsDirectory, 'unreadable');
    await fs.mkdir(unreadable.experimentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(unreadable.experimentDirectory, '.run.lock'),
      '{'
    );
    await expect(unreadable.acquireRunLock()).rejects.toThrow(
      'already running'
    );

    const stale = new ExperimentStateStore(resultsDirectory, 'stale');
    await fs.mkdir(stale.experimentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(stale.experimentDirectory, '.run.lock'),
      JSON.stringify({ pid: 2_147_483_647, token: 'stale' })
    );
    const release = await stale.acquireRunLock();
    await release();

    const processCheck = stale as unknown as {
      isProcessActive: (pid: number) => boolean;
    };
    expect(processCheck.isProcessActive(process.pid)).toBe(true);
    expect(processCheck.isProcessActive(2_147_483_647)).toBe(false);
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    });
    try {
      expect(processCheck.isProcessActive(123)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  it('rejects linked result roots and linked attempt paths', async () => {
    const actual = path.join(temporaryDirectory, 'actual');
    const linked = path.join(temporaryDirectory, 'linked');
    await fs.mkdir(actual);
    await fs.symlink(actual, linked, 'junction');
    expect(() => new ExperimentStateStore(linked, 'experiment')).toThrow(
      'Linked path component'
    );

    const store = new ExperimentStateStore(resultsDirectory, 'safe');
    await store.create(plan(), timestamp);
    const target = path.join(temporaryDirectory, 'outside');
    await fs.mkdir(target);
    const linkedCell = path.join(store.experimentDirectory, 'cells', cellHash);
    await fs.symlink(target, linkedCell, 'junction');
    await expect(
      store.saveAttemptResult(cellHash, 1, bundle(temporaryDirectory))
    ).rejects.toThrow('Linked path component');

    const innerResults = path.join(temporaryDirectory, 'inner-results');
    const outsideExperiment = path.join(
      temporaryDirectory,
      'outside-experiment'
    );
    await fs.mkdir(innerResults);
    await fs.mkdir(outsideExperiment);
    await fs.symlink(
      outsideExperiment,
      path.join(innerResults, 'escaped'),
      'junction'
    );
    expect(() => new ExperimentStateStore(innerResults, 'escaped')).toThrow(
      'resolves outside'
    );
  });

  it('cleans up atomic write failures and recovers the save queue', async () => {
    const store = new ExperimentStateStore(resultsDirectory, 'atomic');
    const current = await store.create(plan(), timestamp);
    const stateFile = path.join(store.experimentDirectory, 'state.json');
    await fs.rm(stateFile);
    await fs.mkdir(stateFile);
    await expect(store.save(current)).rejects.toBeDefined();
    await fs.rm(stateFile, { recursive: true });
    await expect(store.save(current)).resolves.toBeUndefined();

    const target = path.join(temporaryDirectory, 'linked-state');
    await fs.mkdir(target);
    await fs.rm(stateFile);
    await fs.symlink(target, stateFile, 'junction');
    await expect(store.save(current)).rejects.toThrow('Linked path component');
    await fs.rm(stateFile);
    await expect(store.save(current)).resolves.toBeUndefined();
  });

  it('covers stale-lock acquisition and cleanup failure modes', async () => {
    async function staleStore(id: string): Promise<{
      store: ExperimentStateStore;
      recover: (acquire: () => Promise<void>) => Promise<void>;
      lock: string;
      recovery: string;
    }> {
      const store = new ExperimentStateStore(resultsDirectory, id);
      await fs.mkdir(store.experimentDirectory, { recursive: true });
      const lock = path.join(store.experimentDirectory, '.run.lock');
      await fs.writeFile(lock, JSON.stringify({ pid: 2_147_483_647 }));
      const recover = (
        store as unknown as {
          recoverStaleLock: (acquire: () => Promise<void>) => Promise<void>;
        }
      ).recoverStaleLock.bind(store);
      return { store, recover, lock, recovery: `${lock}.recovery` };
    }

    const collision = await staleStore('collision');
    await expect(
      collision.recover(async () => {
        throw Object.assign(new Error('collision'), { code: 'EEXIST' });
      })
    ).rejects.toThrow('already running');

    const acquisitionError = await staleStore('acquisition-error');
    await expect(
      acquisitionError.recover(async () => {
        throw Object.assign(new Error('acquire failed'), { code: 'EIO' });
      })
    ).rejects.toThrow('acquire failed');

    const missingRecovery = await staleStore('missing-recovery');
    await expect(
      missingRecovery.recover(async () => {
        await fs.rm(missingRecovery.recovery);
      })
    ).resolves.toBeUndefined();

    const changedRecovery = await staleStore('changed-recovery');
    await expect(
      changedRecovery.recover(async () => {
        await fs.writeFile(changedRecovery.recovery, 'changed');
      })
    ).resolves.toBeUndefined();
    await fs.rm(changedRecovery.recovery);

    const cleanupError = await staleStore('cleanup-error');
    await expect(
      cleanupError.recover(async () => {
        await fs.rm(cleanupError.recovery);
        await fs.mkdir(cleanupError.recovery);
      })
    ).rejects.toBeDefined();

    const missingPid = new ExperimentStateStore(
      resultsDirectory,
      'missing-pid'
    );
    await fs.mkdir(missingPid.experimentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(missingPid.experimentDirectory, '.run.lock'),
      '{}'
    );
    await expect(missingPid.acquireRunLock()).rejects.toThrow(
      'already running'
    );

    const recoveryCollision = new ExperimentStateStore(
      resultsDirectory,
      'recovery-collision'
    );
    await fs.mkdir(recoveryCollision.experimentDirectory, { recursive: true });
    const recoveryCollisionLock = path.join(
      recoveryCollision.experimentDirectory,
      '.run.lock'
    );
    await fs.writeFile(
      recoveryCollisionLock,
      JSON.stringify({ pid: 2_147_483_647 })
    );
    await fs.writeFile(`${recoveryCollisionLock}.recovery`, 'other');
    await expect(recoveryCollision.acquireRunLock()).rejects.toThrow(
      'already running'
    );

    const missingLockParent = new ExperimentStateStore(
      resultsDirectory,
      'missing-lock-parent'
    );
    (missingLockParent as unknown as { lockFile: string }).lockFile = path.join(
      missingLockParent.experimentDirectory,
      'missing',
      '.run.lock'
    );
    await expect(missingLockParent.acquireRunLock()).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const missingRecoveryParent = new ExperimentStateStore(
      resultsDirectory,
      'missing-recovery-parent'
    );
    (missingRecoveryParent as unknown as { lockFile: string }).lockFile =
      path.join(
        missingRecoveryParent.experimentDirectory,
        'missing',
        '.run.lock'
      );
    const recoverMissing = (
      missingRecoveryParent as unknown as {
        recoverStaleLock: (acquire: () => Promise<void>) => Promise<void>;
      }
    ).recoverStaleLock.bind(missingRecoveryParent);
    await expect(recoverMissing(async () => undefined)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
