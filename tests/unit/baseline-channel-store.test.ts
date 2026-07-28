import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BaselineChannelStore } from '../../src/baselines/channel-store.js';
import { BaselineSnapshotStore } from '../../src/baselines/snapshot-store.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';

function result(experimentId: string): ExperimentResult {
  const timestamp = '2026-07-27T12:00:00.000Z';
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

describe('baseline snapshots and channels', () => {
  let temporaryDirectory: string;
  let snapshots: BaselineSnapshotStore;
  let channels: BaselineChannelStore;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-channels-')
    );
    snapshots = new BaselineSnapshotStore(temporaryDirectory, {
      trustedParentDirectory: temporaryDirectory,
    });
    channels = new BaselineChannelStore(temporaryDirectory, {
      trustedParentDirectory: temporaryDirectory,
      snapshotStore: snapshots,
      now: (): Date => new Date('2026-07-27T12:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('stores immutable snapshots and resolves a promoted channel', async () => {
    const first = await snapshots.write(result('first'));
    const duplicate = await snapshots.write(result('first'));
    expect(duplicate.digest).toBe(first.digest);

    const promoted = await channels.promote({
      channel: 'production',
      snapshotDigest: first.digest,
      defaultTarget: 'candidate',
      sourceExperiment: 'first',
      targetMapping: {
        candidateTarget: 'candidate',
        baselineTarget: 'incumbent',
      },
      expectedDigest: null,
      actor: 'ci',
      context: 'release approval',
    });
    const resolved = await channels.resolve('production');

    expect(promoted.channel).toMatchObject({
      name: 'production',
      snapshot_digest: first.digest,
      default_target: 'candidate',
      generation: 1,
    });
    expect(promoted.audit[0]).toMatchObject({
      source_experiment: 'first',
      target_mapping: {
        candidate_target: 'candidate',
        baseline_target: 'incumbent',
      },
      actor: 'ci',
      context: 'release approval',
    });
    expect(resolved.snapshot.result.experiment_id).toBe('first');
    expect(resolved.channel?.snapshot_digest).toBe(first.digest);
  });

  it('advances with compare-and-swap and preserves both snapshots', async () => {
    const first = await snapshots.write(result('first'));
    const second = await snapshots.write(result('second'));
    await channels.promote({
      channel: 'production',
      snapshotDigest: first.digest,
      defaultTarget: 'incumbent',
      sourceExperiment: 'first',
      targetMapping: { candidateTarget: 'incumbent' },
      expectedDigest: null,
    });
    const promoted = await channels.promote({
      channel: 'production',
      snapshotDigest: second.digest,
      defaultTarget: 'replacement',
      sourceExperiment: 'second',
      targetMapping: {
        candidateTarget: 'replacement',
        baselineTarget: 'incumbent',
      },
      expectedDigest: first.digest,
    });

    expect(promoted.channel.generation).toBe(2);
    expect(promoted.audit[1]).toMatchObject({
      old_digest: first.digest,
      new_digest: second.digest,
      old_target: 'incumbent',
      new_target: 'replacement',
      previous_audit_hash: promoted.audit[0].audit_hash,
    });
    await expect(snapshots.read(first.digest)).resolves.toMatchObject({
      digest: first.digest,
    });
    await expect(snapshots.read(second.digest)).resolves.toMatchObject({
      digest: second.digest,
    });
  });

  it('rejects stale compare-and-swap preconditions', async () => {
    const first = await snapshots.write(result('first'));
    const second = await snapshots.write(result('second'));
    await channels.promote({
      channel: 'production',
      snapshotDigest: first.digest,
      defaultTarget: 'incumbent',
      sourceExperiment: 'first',
      targetMapping: { candidateTarget: 'incumbent' },
    });

    await expect(
      channels.promote({
        channel: 'production',
        snapshotDigest: second.digest,
        defaultTarget: 'candidate',
        sourceExperiment: 'second',
        targetMapping: { candidateTarget: 'candidate' },
        expectedDigest: 'b'.repeat(64),
      })
    ).rejects.toThrow('compare-and-swap failed');
  });

  it('allows only one concurrent writer for a channel generation', async () => {
    const first = await snapshots.write(result('first'));
    const second = await snapshots.write(result('second'));
    const third = await snapshots.write(result('third'));
    await channels.promote({
      channel: 'production',
      snapshotDigest: first.digest,
      defaultTarget: 'incumbent',
      sourceExperiment: 'first',
      targetMapping: { candidateTarget: 'incumbent' },
    });

    const outcomes = await Promise.allSettled(
      [
        { snapshot: second, target: 'second' },
        { snapshot: third, target: 'third' },
      ].map(({ snapshot, target }) =>
        channels.promote({
          channel: 'production',
          snapshotDigest: snapshot.digest,
          defaultTarget: target,
          sourceExperiment: target,
          targetMapping: {
            candidateTarget: target,
            baselineTarget: 'incumbent',
          },
          expectedDigest: first.digest,
        })
      )
    );

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected')
    ).toHaveLength(1);
    expect((await channels.read('production'))?.channel.generation).toBe(2);
  });

  it('detects audit and snapshot tampering', async () => {
    const snapshot = await snapshots.write(result('first'));
    await channels.promote({
      channel: 'production',
      snapshotDigest: snapshot.digest,
      defaultTarget: 'candidate',
      sourceExperiment: 'first',
      targetMapping: { candidateTarget: 'candidate' },
    });
    const auditPath = path.join(
      temporaryDirectory,
      'channels',
      'production',
      '000000000001.json'
    );
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8')) as {
      new_target: string;
    };
    audit.new_target = 'tampered';
    await fs.writeFile(auditPath, JSON.stringify(audit));
    await expect(channels.read('production')).rejects.toThrow(
      'audit chain is invalid or tampered'
    );

    const objectPath = path.join(
      temporaryDirectory,
      'objects',
      `${snapshot.digest}.json`
    );
    await fs.writeFile(objectPath, '{}\n');
    await expect(snapshots.read(snapshot.digest)).rejects.toThrow(
      'content hash mismatch'
    );
  });

  it('rejects unsafe channel names and unknown snapshot digests', async () => {
    await expect(channels.read('../escape')).rejects.toThrow(
      'Unsafe baseline channel'
    );
    await expect(
      channels.promote({
        channel: 'production',
        snapshotDigest: 'b'.repeat(64),
        defaultTarget: 'candidate',
        sourceExperiment: 'missing',
        targetMapping: { candidateTarget: 'candidate' },
      })
    ).rejects.toThrow();
  });
});
