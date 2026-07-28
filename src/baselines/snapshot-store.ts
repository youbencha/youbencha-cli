import { readFile } from 'fs/promises';
import * as path from 'path';
import {
  experimentResultSchema,
  type ExperimentResult,
} from '../schemas/experiment-result.schema.js';
import { canonicalJson, stableHash } from '../experiments/identity.js';
import {
  assertLinkSafePath,
  ensureLinkSafeDirectory,
} from '../experiments/artifact-security.js';
import { SHA256, writeExclusiveAtomic } from './storage-utils.js';

export interface BaselineSnapshot {
  digest: string;
  result: ExperimentResult;
}

export interface BaselineSnapshotStoreOptions {
  trustedParentDirectory?: string;
}

/** Content-addressed immutable experiment-result storage. */
export class BaselineSnapshotStore {
  private readonly root: string;
  private readonly trustedParent: string;

  constructor(
    rootDirectory: string,
    options: BaselineSnapshotStoreOptions = {}
  ) {
    this.root = path.resolve(rootDirectory);
    this.trustedParent = path.resolve(
      options.trustedParentDirectory ?? path.parse(this.root).root
    );
    const relative = path.relative(this.trustedParent, this.root);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Baseline storage root escapes its trusted parent: ${this.root}`
      );
    }
  }

  async write(resultInput: ExperimentResult): Promise<BaselineSnapshot> {
    const result = experimentResultSchema.parse(resultInput);
    const digest = stableHash(result);
    const content = `${canonicalJson(result)}\n`;
    const objectDirectory = path.join(this.root, 'objects');
    await ensureLinkSafeDirectory(this.trustedParent, this.root);
    await ensureLinkSafeDirectory(this.trustedParent, objectDirectory);
    const objectPath = path.join(objectDirectory, `${digest}.json`);
    await assertLinkSafePath(this.trustedParent, objectPath);

    if (!(await writeExclusiveAtomic(objectPath, content))) {
      const existing = await readFile(objectPath, 'utf8');
      const parsed: unknown = JSON.parse(existing);
      if (
        stableHash(parsed) !== digest ||
        canonicalJson(parsed) !== canonicalJson(result)
      ) {
        throw new Error(`Baseline snapshot ${digest} is invalid or tampered`);
      }
    }
    return { digest, result };
  }

  async read(digest: string): Promise<BaselineSnapshot> {
    if (!SHA256.test(digest)) {
      throw new Error(`Invalid baseline snapshot digest "${digest}"`);
    }
    const objectPath = path.join(this.root, 'objects', `${digest}.json`);
    await assertLinkSafePath(this.trustedParent, objectPath);
    const parsed: unknown = JSON.parse(await readFile(objectPath, 'utf8'));
    if (stableHash(parsed) !== digest) {
      throw new Error(`Baseline snapshot ${digest} content hash mismatch`);
    }
    return { digest, result: experimentResultSchema.parse(parsed) };
  }
}
