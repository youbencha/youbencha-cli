import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  experimentResultSchema,
  type ExperimentResult,
} from '../schemas/experiment-result.schema.js';
import { redactSensitiveValues } from '../experiments/identity.js';
import {
  assertLinkSafePath,
  ensureLinkSafeDirectory,
} from '../experiments/artifact-security.js';

export interface ExperimentReportPaths {
  json: string;
  markdown: string;
  junit: string;
}

export function getExperimentReportPaths(
  outputDirectory: string
): ExperimentReportPaths {
  const directory = path.resolve(outputDirectory);
  return {
    json: path.join(directory, 'results.json'),
    markdown: path.join(directory, 'report.md'),
    junit: path.join(directory, 'junit.xml'),
  };
}

export async function writeReportFile(
  outputPath: string,
  content: string,
  trustedParentDirectory?: string
): Promise<void> {
  const resolved = path.resolve(outputPath);
  const directory = path.dirname(resolved);
  const trustedParent = path.resolve(
    trustedParentDirectory ?? path.parse(directory).root
  );
  await ensureLinkSafeDirectory(trustedParent, directory);
  await assertLinkSafePath(trustedParent, resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function compareText(
  left: string | undefined,
  right: string | undefined
): number {
  return (left ?? '').localeCompare(right ?? '', 'en');
}

function omitStacks(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitStacks);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        /^(stack|stack_trace)$/i.test(key)
          ? '[OMITTED]'
          : omitStacks(entryValue),
      ])
    );
  }
  return value;
}

export function normalizeExperimentResult(
  input: ExperimentResult
): ExperimentResult {
  const result = experimentResultSchema.parse(input);
  return {
    ...result,
    effective_configuration: omitStacks(
      redactSensitiveValues(result.effective_configuration)
    ),
    sources: [...result.sources].sort((left, right) =>
      compareText(left.testcase_id, right.testcase_id)
    ),
    cells: [...result.cells]
      .map((cell) => ({
        ...cell,
        terminal_reason:
          cell.terminal_reason === undefined
            ? undefined
            : safeDisplayText(cell.terminal_reason),
        attempts: [...cell.attempts]
          .sort((left, right) => left.attempt_number - right.attempt_number)
          .map((attempt) => ({
            ...attempt,
            terminal_reason:
              attempt.terminal_reason === undefined
                ? undefined
                : safeDisplayText(attempt.terminal_reason),
          })),
      }))
      .sort(
        (left, right) =>
          compareText(left.testcase_id, right.testcase_id) ||
          compareText(left.variant_name, right.variant_name) ||
          left.repetition - right.repetition ||
          compareText(left.cell_id, right.cell_id)
      ),
    aggregates: [...result.aggregates].sort(
      (left, right) =>
        compareText(left.scope, right.scope) ||
        compareText(left.testcase_id, right.testcase_id) ||
        compareText(left.variant_name, right.variant_name)
    ),
    comparisons: [...result.comparisons]
      .map((finding) => ({
        ...finding,
        message: safeDisplayText(finding.message),
      }))
      .sort(
        (left, right) =>
          compareText(left.scope, right.scope) ||
          compareText(left.metric, right.metric) ||
          compareText(left.message, right.message)
      ),
    warnings: result.warnings.map(safeDisplayText).sort(compareText),
  };
}

export function safeDisplayText(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? ''
        : JSON.stringify(value);
  const validText = [...text]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint === 0x9 ||
          codePoint === 0xa ||
          codePoint === 0xd ||
          (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
          (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
          (codePoint >= 0x10000 && codePoint <= 0x10ffff))
      );
    })
    .join('');
  return validText
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+\S/.test(line))
    .join('\n');
}

export function escapeMarkdownCell(value: unknown): string {
  return safeDisplayText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(
      /./g,
      (character) => ('[]_*`<>'.includes(character) ? '\\' : '') + character
    )
    .replace(/\r?\n/g, '<br>')
    .split(String.fromCharCode(0x7f))
    .join('');
}

export function portableMarkdownLink(
  target: string,
  reportDirectory?: string
): string {
  let portable = target;
  if (path.isAbsolute(target)) {
    portable = reportDirectory
      ? path.relative(path.resolve(reportDirectory), target)
      : path.basename(target);
  }
  portable = portable.replace(/\\/g, '/');
  const encoded = portable
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/');
  return encoded.replace(/^\//, '');
}

export function xmlSafeText(value: unknown): string {
  return safeDisplayText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
