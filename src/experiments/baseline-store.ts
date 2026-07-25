import { randomUUID } from 'crypto';
import { link, readFile, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import type { ExperimentResult } from '../schemas/experiment-result.schema.js';
import { experimentResultSchema } from '../schemas/experiment-result.schema.js';
import { canonicalJson, stableHash } from './identity.js';
import {
  assertLinkSafePath,
  ensureLinkSafeDirectory,
} from './artifact-security.js';

const BASELINE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export interface BaselineManifest {
  schema_version: '1.0.0';
  name: string;
  content_hash: string;
  approved_at: string;
  manifest_hash: string;
}

export interface ApprovedBaseline {
  manifest: BaselineManifest;
  result: ExperimentResult;
}

export interface BaselineStoreOptions {
  now?: () => Date;
  trustedParentDirectory?: string;
}

function validateName(name: string): void {
  if (
    !BASELINE_NAME.test(name) ||
    name === '.' ||
    name === '..' ||
    path.basename(name) !== name
  ) {
    throw new Error(
      `Unsafe baseline name "${name}"; use 1-128 letters, numbers, dots, underscores, or hyphens`
    );
  }
}

async function writeExclusiveAtomic(
  destination: string,
  contents: string
): Promise<boolean> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
  try {
    await link(temporary, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function parseManifest(
  contents: string,
  expectedName: string
): BaselineManifest {
  const value: unknown = JSON.parse(contents);
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>).schema_version !== '1.0.0' ||
    (value as Record<string, unknown>).name !== expectedName ||
    typeof (value as Record<string, unknown>).content_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(
      (value as Record<string, unknown>).content_hash as string
    ) ||
    typeof (value as Record<string, unknown>).approved_at !== 'string' ||
    typeof (value as Record<string, unknown>).manifest_hash !== 'string'
  ) {
    throw new Error(
      `Baseline manifest "${expectedName}" is invalid or tampered`
    );
  }
  const manifest = value as BaselineManifest;
  const { manifest_hash: manifestHash, ...unsigned } = manifest;
  if (stableHash(unsigned) !== manifestHash) {
    throw new Error(
      `Baseline manifest "${expectedName}" integrity check failed`
    );
  }
  return manifest;
}

export class BaselineStore {
  private readonly now: () => Date;
  private readonly root: string;
  private readonly trustedParent: string;

  constructor(rootDirectory: string, options: BaselineStoreOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
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

  async approve(
    name: string,
    resultInput: ExperimentResult
  ): Promise<BaselineManifest> {
    validateName(name);
    const result = experimentResultSchema.parse(resultInput);
    const content = canonicalJson(result);
    const contentHash = stableHash(result);
    const objectDirectory = path.join(this.root, 'objects');
    const nameDirectory = path.join(this.root, 'names');
    await ensureLinkSafeDirectory(this.trustedParent, this.root);
    await Promise.all([
      ensureLinkSafeDirectory(this.trustedParent, objectDirectory),
      ensureLinkSafeDirectory(this.trustedParent, nameDirectory),
    ]);

    const objectPath = path.join(objectDirectory, `${contentHash}.json`);
    await assertLinkSafePath(this.trustedParent, objectPath);
    const objectCreated = await writeExclusiveAtomic(
      objectPath,
      `${content}\n`
    );
    if (!objectCreated) {
      await assertLinkSafePath(this.trustedParent, objectPath);
      const existing = await readFile(objectPath, 'utf8');
      const parsed: unknown = JSON.parse(existing);
      if (
        stableHash(parsed) !== contentHash ||
        canonicalJson(parsed) !== content
      ) {
        throw new Error(
          `Baseline object ${contentHash} is invalid or tampered`
        );
      }
    }

    const unsignedManifest = {
      schema_version: '1.0.0',
      name,
      content_hash: contentHash,
      approved_at: this.now().toISOString(),
    } as const;
    const manifest: BaselineManifest = {
      ...unsignedManifest,
      manifest_hash: stableHash(unsignedManifest),
    };
    const manifestPath = path.join(nameDirectory, `${name}.json`);
    await assertLinkSafePath(this.trustedParent, manifestPath);
    const manifestCreated = await writeExclusiveAtomic(
      manifestPath,
      `${canonicalJson(manifest)}\n`
    );
    if (!manifestCreated) {
      await assertLinkSafePath(this.trustedParent, manifestPath);
      const existing = parseManifest(
        await readFile(manifestPath, 'utf8'),
        name
      );
      if (existing.content_hash !== contentHash) {
        throw new Error(
          `Baseline "${name}" already points to ${existing.content_hash}; named baselines cannot be repointed`
        );
      }
      await this.read(name);
      return existing;
    }
    return manifest;
  }

  async read(name: string): Promise<ApprovedBaseline> {
    validateName(name);
    const manifestPath = path.join(this.root, 'names', `${name}.json`);
    await assertLinkSafePath(this.trustedParent, manifestPath);
    const manifest = parseManifest(await readFile(manifestPath, 'utf8'), name);
    const objectPath = path.join(
      this.root,
      'objects',
      `${manifest.content_hash}.json`
    );
    await assertLinkSafePath(this.trustedParent, objectPath);
    const raw = await readFile(objectPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (stableHash(parsed) !== manifest.content_hash) {
      throw new Error(
        `Baseline "${name}" content hash mismatch; expected ${manifest.content_hash}`
      );
    }
    return {
      manifest,
      result: experimentResultSchema.parse(parsed),
    };
  }
}
