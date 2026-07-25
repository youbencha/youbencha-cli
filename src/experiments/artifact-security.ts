import * as fs from 'fs/promises';
import * as path from 'path';
import {
  resultsBundleSchema,
  type ResultsBundle,
} from '../schemas/result.schema.js';

const SENSITIVE_KEY =
  /(authorization|proxy[_-]?authorization|authorization[_-]?code|auth[_-]?code|cookie|set[_-]?cookie|credential|password|passwd|secret|signature|(^|[_-])sig($|[_-])|(^|[_-])(auth|sas)($|[_-])|api[_-]?key|private[_-]?key|client[_-]?secret|(^|[_-])(access[_-]?token|refresh[_-]?token|token)($|[_-])|headers?)/i;

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

async function assertUnlinked(pathname: string): Promise<'missing' | 'exists'> {
  try {
    const stats = await fs.lstat(pathname);
    // On Windows, lstat reports directory junctions and other name-surrogate
    // reparse points as symbolic links. Never follow either for artifact writes.
    if (stats.isSymbolicLink()) {
      throw new Error(`Linked path component is not allowed: ${pathname}`);
    }
    return 'exists';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/**
 * Checks every existing component without following links. The trusted parent
 * must already be a directory; callers normally use a configured storage root
 * or, as a conservative fallback, the filesystem volume root.
 */
export async function assertLinkSafePath(
  trustedParent: string,
  target: string
): Promise<void> {
  const parent = path.resolve(trustedParent);
  const resolvedTarget = path.resolve(target);
  if (!isWithin(parent, resolvedTarget)) {
    throw new Error(
      `Artifact path escapes its trusted storage root: ${resolvedTarget}`
    );
  }
  const parentStats = await fs.lstat(parent);
  if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
    throw new Error(`Trusted artifact root is not a real directory: ${parent}`);
  }
  let current = parent;
  for (const segment of path
    .relative(parent, resolvedTarget)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if ((await assertUnlinked(current)) === 'missing') return;
  }
}

/**
 * Creates a directory one component at a time, validating each component with
 * lstat before continuing so recursive mkdir cannot traverse an existing link.
 */
export async function ensureLinkSafeDirectory(
  trustedParent: string,
  directory: string
): Promise<void> {
  const parent = path.resolve(trustedParent);
  const target = path.resolve(directory);
  await assertLinkSafePath(parent, target);
  let current = parent;
  for (const segment of path
    .relative(parent, target)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if ((await assertUnlinked(current)) === 'missing') {
      try {
        await fs.mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`Linked path component is not allowed: ${current}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(
        `Artifact directory component is not a directory: ${current}`
      );
    }
  }
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!/^(https?|ssh|git):$/i.test(url.protocol)) return value;
    if (url.username !== '') url.username = '[REDACTED]';
    if (url.password !== '') url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    if (url.hash !== '') url.hash = '#[REDACTED]';
    return url.toString();
  } catch {
    return value;
  }
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey),
      ])
    );
  }
  if (typeof value !== 'string') return value;
  const urlSafe = sanitizeUrl(value);
  if (urlSafe !== value || /^(https?|ssh|git):\/\//i.test(value)) {
    return urlSafe;
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return `<absolute-path>/${path.win32.basename(value)}`;
  }
  return value;
}

/**
 * Returns a schema-valid deep copy suitable for durable experiment artifacts.
 * The input object is never modified.
 */
export function sanitizeExperimentResultsBundle(
  input: ResultsBundle
): ResultsBundle {
  const parsed = resultsBundleSchema.parse(input);
  return resultsBundleSchema.parse(sanitizeValue(parsed));
}
