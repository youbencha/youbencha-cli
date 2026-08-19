import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resultsBundleSchema } from '../schemas/result.schema.js';
import {
  e2bArtifactLimitsSchema,
  e2bArtifactManifestSchema,
  type E2BArtifactLimits,
  type E2BArtifactManifest,
} from './schemas.js';

export class E2BArtifactError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'E2BArtifactError';
  }
}

export interface InspectedArchiveEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'hardlink';
  contents?: Uint8Array;
  linkTarget?: string;
  compressedSize?: number;
}

export interface ArtifactOwnership {
  experimentId: string;
  cellId: string;
  attemptId: string;
}

export interface ValidateArtifactPackageOptions {
  ownership: ArtifactOwnership;
  limits: E2BArtifactLimits;
  expectedArtifactProtocolVersion: string;
  validateResultSchema?: boolean;
}

export interface ValidatedArtifactPackage {
  manifest: E2BArtifactManifest;
  files: ReadonlyArray<{
    path: string;
    contents: Uint8Array;
  }>;
  result: unknown;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function protocolMajor(value: string): string {
  const match = /^v?(\d+)(?:\.|$)/.exec(value);
  if (match?.[1] === undefined) {
    throw new E2BArtifactError(
      'invalid_artifact_protocol',
      `Artifact protocol "${value}" has no numeric major version`
    );
  }
  return match[1];
}

export function normalizeRemoteArtifactPath(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('//') ||
    value.startsWith('\\\\') ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[./]|$)/i.test(value)
  ) {
    throw new E2BArtifactError(
      'unsafe_artifact_path',
      `Artifact path "${value}" is not a safe relative POSIX path`
    );
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    throw new E2BArtifactError(
      'unsafe_artifact_path',
      `Artifact path "${value}" contains an unsafe segment`
    );
  }
  return path.posix.normalize(value);
}

export function validateArtifactPackage(
  manifestValue: unknown,
  archiveBytes: Uint8Array,
  inspectedEntries: readonly InspectedArchiveEntry[],
  options: ValidateArtifactPackageOptions
): ValidatedArtifactPackage {
  const manifest = e2bArtifactManifestSchema.parse(manifestValue);
  const limits = e2bArtifactLimitsSchema.parse(options.limits);

  if (
    manifest.experiment_id !== options.ownership.experimentId ||
    manifest.cell_id !== options.ownership.cellId ||
    manifest.attempt_id !== options.ownership.attemptId
  ) {
    throw new E2BArtifactError(
      'artifact_ownership_mismatch',
      'Remote artifact ownership does not match the selected attempt'
    );
  }
  if (
    protocolMajor(manifest.artifact_protocol_version) !==
    protocolMajor(options.expectedArtifactProtocolVersion)
  ) {
    throw new E2BArtifactError(
      'artifact_protocol_mismatch',
      `Artifact protocol ${manifest.artifact_protocol_version} is incompatible with ${options.expectedArtifactProtocolVersion}`
    );
  }
  if (
    archiveBytes.byteLength > limits.max_compressed_bytes ||
    manifest.archive.compressed_size > limits.max_compressed_bytes
  ) {
    throw new E2BArtifactError(
      'artifact_archive_too_large',
      'Compressed artifact archive exceeds the configured limit'
    );
  }
  if (archiveBytes.byteLength !== manifest.archive.compressed_size) {
    throw new E2BArtifactError(
      'artifact_archive_size_mismatch',
      'Downloaded archive size does not match its manifest'
    );
  }
  if (sha256(archiveBytes) !== manifest.archive.sha256) {
    throw new E2BArtifactError(
      'artifact_archive_hash_mismatch',
      'Downloaded archive hash does not match its manifest'
    );
  }
  if (
    manifest.archive.uncompressed_size > limits.max_uncompressed_bytes ||
    manifest.artifacts.length > limits.max_files
  ) {
    throw new E2BArtifactError(
      'artifact_limits_exceeded',
      'Declared artifacts exceed configured count or uncompressed-size limits'
    );
  }

  const declared = new Map<string, E2BArtifactManifest['artifacts'][number]>();
  const caseInsensitivePaths = new Set<string>();
  let declaredTotal = 0;
  for (const artifact of manifest.artifacts) {
    const normalized = normalizeRemoteArtifactPath(artifact.path);
    const folded = normalized.toLocaleLowerCase('en-US');
    if (declared.has(normalized) || caseInsensitivePaths.has(folded)) {
      throw new E2BArtifactError(
        'duplicate_artifact_path',
        `Duplicate or case-colliding artifact path "${artifact.path}"`
      );
    }
    if (artifact.uncompressed_size > limits.max_file_bytes) {
      throw new E2BArtifactError(
        'artifact_file_too_large',
        `Artifact "${artifact.path}" exceeds the per-file limit`
      );
    }
    declared.set(normalized, artifact);
    caseInsensitivePaths.add(folded);
    declaredTotal += artifact.uncompressed_size;
  }
  if (
    declaredTotal !== manifest.archive.uncompressed_size ||
    declaredTotal > limits.max_uncompressed_bytes
  ) {
    throw new E2BArtifactError(
      'artifact_total_size_mismatch',
      'Declared artifact sizes do not match the archive total'
    );
  }

  const files = new Map<string, Uint8Array>();
  const archivePaths = new Set<string>();
  for (const entry of inspectedEntries) {
    const normalized = normalizeRemoteArtifactPath(entry.path);
    const folded = normalized.toLocaleLowerCase('en-US');
    if (archivePaths.has(folded)) {
      throw new E2BArtifactError(
        'duplicate_archive_path',
        `Archive contains a duplicate or case-colliding path "${entry.path}"`
      );
    }
    archivePaths.add(folded);
    if (entry.type === 'symlink' || entry.type === 'hardlink') {
      throw new E2BArtifactError(
        'artifact_link_forbidden',
        `Archive link "${entry.path}" is forbidden`
      );
    }
    if (entry.type === 'directory') continue;
    const expected = declared.get(normalized);
    if (expected === undefined) {
      throw new E2BArtifactError(
        'undeclared_artifact',
        `Archive file "${entry.path}" was not declared`
      );
    }
    const contents = entry.contents;
    if (contents === undefined) {
      throw new E2BArtifactError(
        'missing_artifact_contents',
        `Archive file "${entry.path}" has no inspected contents`
      );
    }
    if (
      contents.byteLength !== expected.uncompressed_size ||
      contents.byteLength > limits.max_file_bytes
    ) {
      throw new E2BArtifactError(
        'artifact_file_size_mismatch',
        `Archive file "${entry.path}" has an unexpected size`
      );
    }
    if (
      expected.compressed_size !== undefined &&
      entry.compressedSize !== undefined &&
      expected.compressed_size !== entry.compressedSize
    ) {
      throw new E2BArtifactError(
        'artifact_compressed_size_mismatch',
        `Archive file "${entry.path}" has an unexpected compressed size`
      );
    }
    if (sha256(contents) !== expected.sha256) {
      throw new E2BArtifactError(
        'artifact_file_hash_mismatch',
        `Archive file "${entry.path}" has an unexpected hash`
      );
    }
    files.set(normalized, contents);
  }

  for (const declaredPath of declared.keys()) {
    if (!files.has(declaredPath)) {
      throw new E2BArtifactError(
        'missing_declared_artifact',
        `Declared artifact "${declaredPath}" is missing from the archive`
      );
    }
  }

  const resultPath = normalizeRemoteArtifactPath(manifest.remote_result_path);
  const resultContents = files.get(resultPath);
  if (resultContents === undefined) {
    throw new E2BArtifactError(
      'missing_remote_result',
      'The declared remote result is missing from the artifact archive'
    );
  }
  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(Buffer.from(resultContents).toString('utf8'));
  } catch {
    throw new E2BArtifactError(
      'invalid_remote_result_json',
      'The remote result is not valid JSON'
    );
  }
  if (options.validateResultSchema !== false) {
    resultsBundleSchema.parse(parsedResult);
  }

  return {
    manifest,
    files: [...files].map(([filePath, contents]) => ({
      path: filePath,
      contents,
    })),
    result: parsedResult,
  };
}

async function assertNoSymlinkParents(
  destinationRoot: string,
  targetParent: string
): Promise<void> {
  const relative = path.relative(destinationRoot, targetParent);
  let current = destinationRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new E2BArtifactError(
          'unsafe_local_artifact_parent',
          'Artifact destination contains a symlink or non-directory parent'
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(current);
    }
  }
}

export async function writeValidatedArtifactPackage(
  artifactPackage: ValidatedArtifactPackage,
  destinationDirectory: string
): Promise<void> {
  const root = path.resolve(destinationDirectory);
  await fs.mkdir(root, { recursive: true });
  const rootStats = await fs.lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new E2BArtifactError(
      'unsafe_local_artifact_root',
      'Artifact destination must be a real directory'
    );
  }

  for (const file of artifactPackage.files) {
    const relativePath = normalizeRemoteArtifactPath(file.path);
    const target = path.resolve(root, ...relativePath.split('/'));
    await assertNoSymlinkParents(root, path.dirname(target));
    const handle = await fs.open(target, 'wx', 0o600);
    try {
      await handle.writeFile(file.contents);
    } finally {
      await handle.close();
    }
  }
}
