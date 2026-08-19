import { createHash } from 'crypto';
import * as path from 'path';

const SENSITIVE_KEY =
  /(authorization|credential|password|secret|signature|(^|[_-])sig($|[_-])|(^|[_-])(auth|code|sas)($|[_-])|api[_-]?key|private[_-]?key|(^|[_-])(access[_-]?token|refresh[_-]?token|token)($|[_-]))/i;

const PATH_KEY =
  /(^|[_-])(dir|directory|file|filename|path|workspace|working_directory)($|[_-])/i;

function normalizeString(value: string, key: string): string {
  if (
    PATH_KEY.test(key) &&
    (path.isAbsolute(value) || path.win32.isAbsolute(value))
  ) {
    return `<absolute-path>/${path.win32.basename(value)}`;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username !== '') url.username = '[REDACTED]';
      if (url.password !== '') url.password = '[REDACTED]';
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_KEY.test(key)) {
          url.searchParams.set(key, '[REDACTED]');
        }
      }
      if (url.hash !== '') {
        url.hash = '#[REDACTED]';
      }
      return url.toString();
    } catch {
      // Preserve malformed strings so their declaring schema can reject them.
    }
  }
  return PATH_KEY.test(key) ? value.replace(/\\/g, '/') : value;
}

export function redactSensitiveValues(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveValues(entryValue, entryKey),
      ])
    );
  }
  return typeof value === 'string' ? normalizeString(value, key) : value;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([entryKey, entryValue]) => [entryKey, canonicalValue(entryValue)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function identitySafeValue(value: unknown): unknown {
  return redactSensitiveValues(value);
}
