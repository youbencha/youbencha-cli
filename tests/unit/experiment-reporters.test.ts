import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import { experimentResultSchema } from '../../src/schemas/experiment-result.schema.js';
import {
  generateExperimentJson,
  generateExperimentJunit,
  generateExperimentMarkdown,
  writeExperimentReports,
} from '../../src/reporters/experiment.js';

const hash = 'a'.repeat(64);
const now = '2026-07-24T12:00:00.000Z';

function fixture(): ExperimentResult {
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: 'experiment<&"',
    definition_hash: hash,
    started_at: now,
    completed_at: now,
    final_status: 'failed',
    exit_code: 2,
    effective_configuration: {
      api_token: 'do-not-print',
      nested: { stack_trace: 'private stack' },
    },
    sources: [
      { testcase_id: 'z-task', config_hash: hash },
      { testcase_id: 'a-task', config_hash: hash },
    ],
    provenance: {
      youbencha_version: '0.1.5-beta',
      agent_cli_versions: {},
      requested_models: {},
      resolved_models: {},
    },
    cells: [
      {
        cell_id: 'b'.repeat(64),
        testcase_id: 'z|task',
        variant_name: 'slow\nvariant',
        repetition: 1,
        status: 'partial',
        attempts: [],
        terminal_reason: 'incomplete\u0000\n    at hidden-stack',
        usage_quality: 'unavailable',
      },
      {
        cell_id: 'c'.repeat(64),
        testcase_id: 'a-task',
        variant_name: 'candidate<&"',
        repetition: 0,
        status: 'failed',
        attempts: [],
        result_path: 'cells\\candidate result\\report.md',
        terminal_reason: 'bad & <value> "quoted" ]]> \u0001',
        duration_ms: 1250,
        usage_quality: 'measured',
      },
    ],
    aggregates: [
      {
        scope: 'variant',
        variant_name: 'candidate',
        metrics: {
          pass_rate: {
            sample_size: 2,
            value: 0.5,
            quality: 'measured',
          },
        },
      },
    ],
    comparisons: [
      {
        status: 'partial',
        metric: 'duration',
        scope: 'variant/z',
        message: 'baseline unavailable',
      },
      {
        status: 'failed',
        metric: 'pass|rate',
        scope: 'variant/a',
        threshold: 0.8,
        candidate: 0.5,
        baseline: 1,
        message: 'regression & <bad> "quote" ]]>',
      },
    ],
    artifacts: {},
    warnings: ['warning|one', 'another\nwarning'],
  };
}

describe('experiment reporters', () => {
  it('generates schema-valid, redacted, deterministic JSON', () => {
    const original = fixture();
    const shuffled: ExperimentResult = {
      ...original,
      cells: [...original.cells].reverse(),
      sources: [...original.sources].reverse(),
      comparisons: [...original.comparisons].reverse(),
      warnings: [...original.warnings].reverse(),
    };
    const first = generateExperimentJson(original);
    const second = generateExperimentJson(shuffled);
    const parsed: unknown = JSON.parse(first);

    expect(first).toBe(second);
    expect(experimentResultSchema.safeParse(parsed).success).toBe(true);
    expect(first).not.toContain('do-not-print');
    expect(first).not.toContain('private stack');
    expect(first).not.toContain('hidden-stack');
    expect(first).toContain('[REDACTED]');
  });

  it('escapes Markdown tables and creates portable encoded drill-down links', () => {
    const markdown = generateExperimentMarkdown(fixture());

    expect(markdown).toContain('z\\|task');
    expect(markdown).toContain('slow<br>variant');
    expect(markdown).toContain('(cells/candidate%20result/report.md)');
    expect(markdown).not.toContain('\u0000');
    expect(markdown).not.toContain('hidden-stack');
  });

  it('maps cells and policies to unique escaped JUnit cases', () => {
    const junit = generateExperimentJunit(fixture());

    expect(junit).toContain('tests="4" failures="2" errors="0" skipped="2"');
    expect(junit).toContain('&amp;');
    expect(junit).toContain('&lt;');
    expect(junit).toContain('&quot;');
    expect(junit).toContain(']]&gt;');
    expect(junit).not.toContain('\u0000');
    expect(junit).not.toContain('\u0001');
    expect(junit).not.toContain('hidden-stack');
    const testcaseIdentities = [
      ...junit.matchAll(/<testcase classname="([^"]+)" name="([^"]+)"/g),
    ].map((match) => `${match[1]}:${match[2]}`);
    expect(new Set(testcaseIdentities).size).toBe(4);
  });

  it('writes the three conventional artifact paths with linked JSON metadata', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-reporters-')
    );
    try {
      await Promise.all([
        fs.writeFile(path.join(temporaryDirectory, 'results.json'), 'old'),
        fs.writeFile(path.join(temporaryDirectory, 'report.md'), 'old'),
        fs.writeFile(path.join(temporaryDirectory, 'junit.xml'), 'old'),
      ]);
      const paths = await writeExperimentReports(fixture(), temporaryDirectory);
      expect(paths).toEqual({
        json: path.join(temporaryDirectory, 'results.json'),
        markdown: path.join(temporaryDirectory, 'report.md'),
        junit: path.join(temporaryDirectory, 'junit.xml'),
      });
      await expect(fs.access(paths.json)).resolves.toBeUndefined();
      await expect(fs.access(paths.markdown)).resolves.toBeUndefined();
      await expect(fs.access(paths.junit)).resolves.toBeUndefined();
      const json = JSON.parse(await fs.readFile(paths.json, 'utf8')) as {
        artifacts: Record<string, string>;
      };
      expect(json.artifacts).toEqual({
        json: 'results.json',
        junit: 'junit.xml',
        markdown: 'report.md',
      });
      expect(
        (await fs.readdir(temporaryDirectory)).filter((file) =>
          file.endsWith('.tmp')
        )
      ).toEqual([]);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a linked report output directory', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-linked-report-')
    );
    const actual = path.join(temporaryDirectory, 'actual');
    const linked = path.join(temporaryDirectory, 'linked');
    try {
      await fs.mkdir(actual);
      await fs.symlink(actual, linked, 'junction');
      await expect(writeExperimentReports(fixture(), linked)).rejects.toThrow(
        'Linked path component is not allowed'
      );
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a linked ancestor of a nested report directory', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-linked-ancestor-')
    );
    const actual = path.join(temporaryDirectory, 'actual');
    const linked = path.join(temporaryDirectory, 'linked');
    try {
      await fs.mkdir(actual);
      await fs.symlink(actual, linked, 'junction');
      await expect(
        writeExperimentReports(fixture(), path.join(linked, 'reports'))
      ).rejects.toThrow('Linked path component is not allowed');
      await expect(fs.readdir(actual)).resolves.toEqual([]);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
