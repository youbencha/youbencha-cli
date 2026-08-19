import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createRequire, syncBuiltinESMExports } from 'module';
import { BaselineStore } from '../../src/experiments/baseline-store.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';

type MutableFsPromises = typeof import('fs/promises') & {
  link: typeof fs.link;
  unlink: typeof fs.unlink;
};

const localRequire = createRequire(path.join(process.cwd(), 'package.json'));
const mutableFs = localRequire('fs/promises') as MutableFsPromises;
const originalLink = mutableFs.link;
const originalUnlink = mutableFs.unlink;

function result(id: string): ExperimentResult {
  const timestamp = '2026-07-29T12:00:00.000Z';
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: id,
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

describe('immutable experiment baseline residual coverage', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-coverage-experiment-baseline-')
    );
  });

  afterEach(async () => {
    mutableFs.link = originalLink;
    mutableFs.unlink = originalUnlink;
    syncBuiltinESMExports();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('uses default options and rejects an escaped trusted parent', async () => {
    const store = new BaselineStore(path.join(temporaryDirectory, 'default'));
    const manifest = await store.approve('default', result('default'));
    expect(Date.parse(manifest.approved_at)).not.toBeNaN();
    expect(
      () =>
        new BaselineStore(path.resolve(temporaryDirectory, '..', 'outside'), {
          trustedParentDirectory: temporaryDirectory,
        })
    ).toThrow('escapes its trusted parent');
  });

  it('rejects every unsafe boundary name', async () => {
    const store = new BaselineStore(temporaryDirectory, {
      trustedParentDirectory: temporaryDirectory,
    });
    for (const name of [
      '',
      '.',
      '..',
      '-bad',
      'bad-',
      '../bad',
      'a'.repeat(129),
    ]) {
      await expect(store.approve(name, result('invalid'))).rejects.toThrow(
        'Unsafe baseline name'
      );
    }
  });

  it('rejects malformed manifest shapes before integrity validation', async () => {
    const store = new BaselineStore(temporaryDirectory, {
      trustedParentDirectory: temporaryDirectory,
    });
    await store.approve('shape', result('shape'));
    const manifestPath = path.join(temporaryDirectory, 'names', 'shape.json');
    const invalidValues: unknown[] = [
      null,
      [],
      {},
      { schema_version: 'wrong' },
      {
        schema_version: '1.0.0',
        name: 'wrong',
        content_hash: 'bad',
        approved_at: 1,
        manifest_hash: 1,
      },
    ];
    for (const value of invalidValues) {
      await fs.writeFile(manifestPath, JSON.stringify(value));
      await expect(store.read('shape')).rejects.toThrow('invalid or tampered');
    }
  });

  it('detects a tampered object during idempotent approval', async () => {
    const store = new BaselineStore(temporaryDirectory, {
      trustedParentDirectory: temporaryDirectory,
    });
    const manifest = await store.approve('stable', result('stable'));
    await fs.writeFile(
      path.join(temporaryDirectory, 'objects', `${manifest.content_hash}.json`),
      '{}'
    );
    await expect(store.approve('stable', result('stable'))).rejects.toThrow(
      'invalid or tampered'
    );
  });

  it('rethrows a non-collision hard-link failure and tolerates cleanup failure', async () => {
    const root = path.join(temporaryDirectory, 'exclusive');
    const linkError = Object.assign(new Error('injected hard-link failure'), {
      code: 'EPERM',
    });
    mutableFs.link = async (): Promise<never> => {
      throw linkError;
    };
    mutableFs.unlink = async (): Promise<never> => {
      throw new Error('injected cleanup failure');
    };
    syncBuiltinESMExports();

    const store = new BaselineStore(root, {
      trustedParentDirectory: temporaryDirectory,
    });
    await expect(store.approve('failure', result('failure'))).rejects.toBe(
      linkError
    );
  });
});
