import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as baselines from '../../src/baselines/index.js';
import { BaselineChannelStore } from '../../src/baselines/channel-store.js';
import { BaselineSnapshotStore } from '../../src/baselines/snapshot-store.js';
import {
  validateStoreName,
  writeExclusiveAtomic,
} from '../../src/baselines/storage-utils.js';
import { canonicalJson, stableHash } from '../../src/experiments/identity.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';

function result(experimentId: string): ExperimentResult {
  const timestamp = '2026-07-29T12:00:00.000Z';
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: experimentId,
    definition_hash: 'a'.repeat(64),
    started_at: timestamp,
    completed_at: timestamp,
    final_status: 'passed',
    exit_code: 0,
    effective_configuration: {},
    sources: [],
    provenance: {
      youbencha_version: 'test',
      agent_cli_versions: {},
      requested_models: {},
      resolved_models: {},
    },
    cells: [],
    aggregates: [],
    comparisons: [],
    artifacts: {},
    warnings: [],
  };
}

describe('baseline storage residual coverage', () => {
  let temporaryDirectory: string;
  let root: string;
  let snapshots: BaselineSnapshotStore;
  let channels: BaselineChannelStore;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-baselines-')
    );
    root = path.join(temporaryDirectory, 'store');
    snapshots = new BaselineSnapshotStore(root, {
      trustedParentDirectory: temporaryDirectory,
    });
    channels = new BaselineChannelStore(root, {
      trustedParentDirectory: temporaryDirectory,
      snapshotStore: snapshots,
      now: (): Date => new Date('2026-07-29T12:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('loads every public baseline export', () => {
    expect(Object.keys(baselines).sort()).toEqual([
      'BaselineChannelStore',
      'BaselineSnapshotStore',
    ]);
  });

  it('validates names and exercises both exclusive-write outcomes', async () => {
    expect(() => validateStoreName('channel', 'a')).not.toThrow();
    expect(() => validateStoreName('channel', 'a-b_c.1')).not.toThrow();
    for (const invalid of [
      '',
      '.',
      '..',
      '-bad',
      'bad-',
      '../escape',
      'a'.repeat(129),
    ]) {
      expect(() => validateStoreName('channel', invalid)).toThrow(
        'Unsafe channel'
      );
    }

    const destination = path.join(temporaryDirectory, 'exclusive.json');
    await expect(writeExclusiveAtomic(destination, 'first')).resolves.toBe(
      true
    );
    await expect(writeExclusiveAtomic(destination, 'second')).resolves.toBe(
      false
    );
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe('first');
  });

  it('rejects roots outside their trusted parent', () => {
    const outside = path.resolve(temporaryDirectory, '..', 'outside-store');
    expect(
      () =>
        new BaselineSnapshotStore(outside, {
          trustedParentDirectory: temporaryDirectory,
        })
    ).toThrow('escapes its trusted parent');
    expect(
      () =>
        new BaselineChannelStore(outside, {
          trustedParentDirectory: temporaryDirectory,
        })
    ).toThrow('escapes its trusted parent');
  });

  it('uses default store options and the default clock', async () => {
    const defaultRoot = path.join(temporaryDirectory, 'defaults');
    const defaultSnapshots = new BaselineSnapshotStore(defaultRoot);
    const snapshot = await defaultSnapshots.write(result('defaults'));
    const defaultChannels = new BaselineChannelStore(defaultRoot);
    const promoted = await defaultChannels.promote({
      channel: 'default',
      snapshotDigest: snapshot.digest,
      defaultTarget: 'candidate',
      sourceExperiment: 'defaults',
      targetMapping: { candidateTarget: 'candidate' },
    });
    expect(Date.parse(promoted.channel.updated_at)).not.toBeNaN();
  });

  it('covers snapshot validation, collision verification, and parse failure', async () => {
    const snapshot = await snapshots.write(result('same'));
    await expect(snapshots.write(result('same'))).resolves.toEqual(snapshot);
    await expect(snapshots.read('not-a-digest')).rejects.toThrow(
      'Invalid baseline snapshot digest'
    );

    const objectPath = path.join(root, 'objects', `${snapshot.digest}.json`);
    await fs.writeFile(objectPath, `${canonicalJson(result('different'))}\n`);
    await expect(snapshots.write(result('same'))).rejects.toThrow(
      'invalid or tampered'
    );

    await fs.writeFile(objectPath, '{');
    await expect(snapshots.read(snapshot.digest)).rejects.toBeInstanceOf(
      SyntaxError
    );
  });

  it('validates every promotion input and handles absent or invalid channels', async () => {
    const snapshot = await snapshots.write(result('validation'));
    const base = {
      channel: 'production',
      snapshotDigest: snapshot.digest,
      defaultTarget: 'candidate',
      sourceExperiment: 'experiment',
      targetMapping: { candidateTarget: 'candidate' },
    };
    await expect(
      channels.promote({ ...base, snapshotDigest: 'bad' })
    ).rejects.toThrow('Invalid baseline snapshot digest');
    await expect(
      channels.promote({ ...base, defaultTarget: ' ' })
    ).rejects.toThrow('Default target must not be empty');
    await expect(
      channels.promote({ ...base, sourceExperiment: '' })
    ).rejects.toThrow('Source experiment must not be empty');
    await expect(
      channels.promote({
        ...base,
        targetMapping: { candidateTarget: '\t' },
      })
    ).rejects.toThrow('Candidate target must not be empty');
    await expect(
      channels.promote({
        ...base,
        targetMapping: {
          candidateTarget: 'candidate',
          baselineTarget: '',
        },
      })
    ).rejects.toThrow('Baseline target must not be empty');
    await expect(
      channels.promote({ ...base, expectedDigest: 'invalid' })
    ).rejects.toThrow('Invalid expected baseline digest');
    await expect(
      channels.promote({ ...base, expectedDigest: snapshot.digest })
    ).rejects.toThrow('found no current digest');
    await channels.promote(base);
    await expect(
      channels.promote({ ...base, expectedDigest: null })
    ).rejects.toThrow('expected no current digest');

    await expect(channels.read('missing')).resolves.toBeUndefined();
    await expect(channels.resolve('missing')).rejects.toThrow('does not exist');
    const emptyChannel = path.join(root, 'channels', 'empty');
    await fs.mkdir(emptyChannel, { recursive: true });
    await fs.writeFile(path.join(emptyChannel, 'README'), 'ignored');
    await expect(channels.read('empty')).resolves.toBeUndefined();

    const blocked = path.join(root, 'channels', 'blocked');
    await fs.writeFile(blocked, 'not a directory');
    await expect(channels.read('blocked')).rejects.toMatchObject({
      code: expect.stringMatching(/ENOTDIR|EACCES/),
    });
  });

  it('resolves snapshots directly and accepts an identical concurrent winner', async () => {
    const snapshot = await snapshots.write(result('race'));
    await expect(channels.resolve(snapshot.digest)).resolves.toEqual({
      snapshot,
    });
    const input = {
      channel: 'race',
      snapshotDigest: snapshot.digest,
      defaultTarget: 'candidate',
      sourceExperiment: 'race',
      targetMapping: { candidateTarget: 'candidate' },
      expectedDigest: null,
    };
    const outcomes = await Promise.all([
      channels.promote(input),
      channels.promote(input),
    ]);
    expect(outcomes[0]).toEqual(outcomes[1]);
  });

  it('detects each second-generation audit-chain inconsistency', async () => {
    const first = await snapshots.write(result('first'));
    const second = await snapshots.write(result('second'));
    await channels.promote({
      channel: 'history',
      snapshotDigest: first.digest,
      defaultTarget: 'one',
      sourceExperiment: 'first',
      targetMapping: { candidateTarget: 'one' },
    });
    await channels.promote({
      channel: 'history',
      snapshotDigest: second.digest,
      defaultTarget: 'two',
      sourceExperiment: 'second',
      targetMapping: { candidateTarget: 'two', baselineTarget: 'one' },
      expectedDigest: first.digest,
    });
    const generationPath = path.join(
      root,
      'channels',
      'history',
      '000000000002.json'
    );
    const original = JSON.parse(
      await fs.readFile(generationPath, 'utf8')
    ) as Record<string, unknown>;
    const mutations: Array<(record: Record<string, unknown>) => void> = [
      (record): void => {
        record.channel = 'other';
      },
      (record): void => {
        record.generation = 3;
      },
      (record): void => {
        record.previous_audit_hash = 'b'.repeat(64);
      },
      (record): void => {
        record.old_digest = 'b'.repeat(64);
      },
      (record): void => {
        record.old_target = 'other';
      },
    ];
    for (const mutate of mutations) {
      const changed = { ...original };
      mutate(changed);
      const unsigned = { ...changed };
      delete unsigned.audit_hash;
      changed.audit_hash = stableHash(unsigned);
      await fs.writeFile(generationPath, `${canonicalJson(changed)}\n`);
      await expect(channels.read('history')).rejects.toThrow(
        'audit chain is invalid or tampered'
      );
    }
  });
});
