import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BaselineStore } from '../../src/experiments/baseline-store.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';

function result(experimentId = 'experiment-1'): ExperimentResult {
  const now = '2026-07-24T12:00:00.000Z';
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: experimentId,
    definition_hash: 'a'.repeat(64),
    started_at: now,
    completed_at: now,
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

describe('immutable baseline store', () => {
  let temporaryDirectory: string;
  let store: BaselineStore;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-baselines-')
    );
    store = new BaselineStore(temporaryDirectory, {
      now: (): Date => new Date('2026-07-24T12:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('stores canonical content by hash and supports idempotent approval', async () => {
    const first = await store.approve('last-approved', result());
    const second = await store.approve('last-approved', result());
    const loaded = await store.read('last-approved');

    expect(second).toEqual(first);
    expect(loaded.manifest).toEqual(first);
    expect(loaded.result).toEqual(result());
    expect(
      await fs.readFile(
        path.join(temporaryDirectory, 'objects', `${first.content_hash}.json`),
        'utf8'
      )
    ).toContain('"experiment_id":"experiment-1"');
  });

  it('rejects unsafe names and silent repointing', async () => {
    await expect(store.approve('../escape', result())).rejects.toThrow(
      'Unsafe baseline name'
    );
    await store.approve('stable', result());
    await expect(
      store.approve('stable', result('different-experiment'))
    ).rejects.toThrow('cannot be repointed');
  });

  it('detects modified baseline objects', async () => {
    const manifest = await store.approve('stable', result());
    await fs.writeFile(
      path.join(temporaryDirectory, 'objects', `${manifest.content_hash}.json`),
      '{}\n'
    );

    await expect(store.read('stable')).rejects.toThrow('content hash mismatch');
  });

  it('detects a manifest that was redirected by hand', async () => {
    await store.approve('stable', result());
    const manifestPath = path.join(temporaryDirectory, 'names', 'stable.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      content_hash: string;
    };
    manifest.content_hash = 'b'.repeat(64);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(store.read('stable')).rejects.toThrow();
  });

  it('rejects linked baseline storage directories', async () => {
    const objects = path.join(temporaryDirectory, 'objects');
    await fs.mkdir(objects);
    await fs.symlink(
      objects,
      path.join(temporaryDirectory, 'names'),
      'junction'
    );

    await expect(store.approve('stable', result())).rejects.toThrow(
      'Linked path component is not allowed'
    );
  });

  it('rejects a linked baseline root anchored to its trusted parent', async () => {
    const actual = path.join(temporaryDirectory, 'actual-root');
    const linked = path.join(temporaryDirectory, 'linked-root');
    await fs.mkdir(actual);
    await fs.symlink(actual, linked, 'junction');
    const linkedStore = new BaselineStore(linked, {
      trustedParentDirectory: temporaryDirectory,
    });

    await expect(linkedStore.approve('stable', result())).rejects.toThrow(
      'Linked path component is not allowed'
    );
    await expect(fs.readdir(actual)).resolves.toEqual([]);
  });

  it('rejects a linked ancestor between the trusted parent and root', async () => {
    const actual = path.join(temporaryDirectory, 'actual-parent');
    const linked = path.join(temporaryDirectory, 'linked-parent');
    await fs.mkdir(actual);
    await fs.symlink(actual, linked, 'junction');
    const linkedStore = new BaselineStore(path.join(linked, 'baselines'), {
      trustedParentDirectory: temporaryDirectory,
    });

    await expect(linkedStore.approve('stable', result())).rejects.toThrow(
      'Linked path component is not allowed'
    );
    await expect(fs.readdir(actual)).resolves.toEqual([]);
  });
});
