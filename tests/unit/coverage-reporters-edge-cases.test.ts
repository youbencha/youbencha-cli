import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as experimentReporters from '../../src/reporters/experiment.js';
import {
  generateExperimentMarkdown,
  writeExperimentMarkdown,
} from '../../src/reporters/experiment-markdown.js';
import { generateExperimentJunit } from '../../src/reporters/experiment-junit.js';
import {
  escapeMarkdownCell,
  normalizeExperimentResult,
  portableMarkdownLink,
  safeDisplayText,
  writeReportFile,
  xmlSafeText,
} from '../../src/reporters/experiment-utils.js';
import { MarkdownReporter } from '../../src/reporters/markdown.js';
import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

const timestamp = '2026-07-29T00:00:00.000Z';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);

function experimentFixture(): ExperimentResult {
  return {
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: 'experiment',
    definition_hash: hashA,
    started_at: timestamp,
    completed_at: timestamp,
    final_status: 'partial',
    exit_code: 3,
    effective_configuration: {
      nested: [{ stack: 'hidden', value: 1 }],
      scalar: 'value',
    },
    sources: [
      { testcase_id: 'z', config_hash: hashA },
      { testcase_id: 'a', config_hash: hashB },
    ],
    provenance: {
      youbencha_version: '1.0.0',
      agent_cli_versions: {},
      requested_models: {},
      resolved_models: {},
    },
    cells: [
      {
        cell_id: hashC,
        testcase_id: 'task',
        variant_name: 'z',
        repetition: 0,
        status: 'failed',
        attempts: [
          {
            attempt_id: 'second',
            attempt_number: 2,
            status: 'failed',
            started_at: timestamp,
            completed_at: timestamp,
            duration_ms: 2,
            terminal_reason: 'failure\n at hidden',
            execution_provider: 'e2b',
            remote: {
              lifecycle_state: 'killed',
              updated_at: timestamp,
              sandbox_id: 'sandbox',
            },
          },
          {
            attempt_id: 'first',
            attempt_number: 1,
            status: 'failed',
            started_at: timestamp,
            completed_at: timestamp,
            duration_ms: 1,
          },
        ],
        terminal_reason: 'terminal\n at hidden',
        usage_quality: 'unavailable',
        sandbox_cost_usd: 0,
      },
      {
        cell_id: hashB,
        testcase_id: 'task',
        variant_name: 'a',
        repetition: 1,
        status: 'passed',
        attempts: [],
        result_path: '/tmp/details with spaces.json',
        duration_ms: 10,
        cost_usd: 0,
        usage_quality: 'measured',
      },
      {
        cell_id: hashA,
        testcase_id: 'another',
        variant_name: 'a',
        repetition: 0,
        status: 'passed',
        attempts: [],
        usage_quality: 'unavailable',
      },
      {
        cell_id: 'd'.repeat(64),
        testcase_id: 'task',
        variant_name: 'a',
        repetition: 0,
        status: 'passed',
        attempts: [],
        usage_quality: 'unavailable',
      },
      {
        cell_id: 'e'.repeat(64),
        testcase_id: 'task',
        variant_name: 'a',
        repetition: 0,
        status: 'passed',
        attempts: [],
        usage_quality: 'unavailable',
      },
    ],
    aggregates: [
      {
        scope: 'variant',
        variant_name: 'z',
        metrics: {
          z_metric: { sample_size: 1, quality: 'unavailable' },
          a_metric: { sample_size: 1, quality: 'measured', value: 0 },
        },
      },
      {
        scope: 'testcase_variant',
        testcase_id: 'task',
        variant_name: 'a',
        metrics: {},
      },
      { scope: 'experiment', metrics: {} },
      { scope: 'testcase', testcase_id: 'a', metrics: {} },
      { scope: 'testcase', testcase_id: 'b', metrics: {} },
      {
        scope: 'testcase_variant',
        testcase_id: 'same',
        variant_name: 'a',
        metrics: {},
      },
      {
        scope: 'testcase_variant',
        testcase_id: 'same',
        variant_name: 'b',
        metrics: {},
      },
    ],
    comparisons: [
      {
        status: 'failed',
        metric: 'z',
        scope: 'target',
        message: 'z message',
      },
      {
        status: 'passed',
        metric: 'a',
        scope: 'target',
        candidate: 0,
        baseline: 0,
        message: 'a message',
      },
      {
        status: 'partial',
        metric: 'a',
        scope: 'other',
        message: 'other message',
      },
      {
        status: 'passed',
        metric: 'same',
        scope: 'same',
        message: 'a message',
      },
      {
        status: 'passed',
        metric: 'same',
        scope: 'same',
        message: 'b message',
      },
    ],
    artifacts: {
      json: '',
      markdown: '/tmp/report with spaces.md',
    },
    warnings: ['z warning', 'a warning'],
  };
}

function resultsFixture(): ResultsBundle {
  return {
    version: '1.0.0',
    test_case: {
      name: 'case',
      description: 'description',
      config_file: 'case.yaml',
      config_hash: 'hash',
      repo: 'https://example.com/repo.git',
      branch: 'main',
      commit: 'commit',
      expected_branch: 'expected',
    },
    execution: {
      started_at: timestamp,
      completed_at: timestamp,
      duration_ms: 0,
      youbencha_version: '1.0.0',
      environment: {
        os: 'test',
        node_version: '20.0.0',
        workspace_dir: '/workspace',
      },
    },
    agent: {
      type: 'codex-cli',
      youbencha_log_path: 'logs/agent log.json',
      status: 'timeout',
      exit_code: null,
    },
    evaluators: [
      {
        evaluator: 'generic',
        status: 'skipped',
        metrics: {
          file_similarities: [],
          object: { a: 1 },
          integer: 1,
          decimal: 1.25,
        },
        message: 'skipped',
        duration_ms: 0,
        timestamp,
        error: { message: 'without stack' },
      },
      {
        evaluator: 'expected-diff',
        status: 'failed',
        metrics: {
          file_similarities: [
            { path: 'removed.ts', similarity: 0, status: 'removed' },
            { path: 'added.ts', similarity: 0.1, status: 'added' },
          ],
        },
        message: 'failed',
        duration_ms: 0,
        timestamp,
      },
    ],
    summary: {
      total_evaluators: 2,
      passed: 0,
      failed: 1,
      skipped: 1,
      overall_status: 'partial',
    },
    artifacts: {
      agent_log: 'logs/agent log.json',
      agent_artifacts: [],
      reports: [],
      evaluator_artifacts: ['evaluators/result file.json'],
    },
  };
}

describe('reporter coverage edge cases', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-reporter-coverage-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('touches every experiment reporter barrel export', () => {
    for (const key of Object.keys(experimentReporters)) {
      expect(
        experimentReporters[key as keyof typeof experimentReporters]
      ).toBeDefined();
    }
  });

  test('normalizes every sorting fallback and sanitizes nested stacks', () => {
    const normalized = normalizeExperimentResult(experimentFixture());
    expect(normalized.sources.map((source) => source.testcase_id)).toEqual([
      'a',
      'z',
    ]);
    expect(normalized.cells.map((cell) => cell.cell_id)).toEqual([
      hashA,
      'd'.repeat(64),
      'e'.repeat(64),
      hashB,
      hashC,
    ]);
    expect(
      normalized.cells[4]?.attempts.map((attempt) => attempt.attempt_number)
    ).toEqual([1, 2]);
    expect(normalized.cells[4]?.terminal_reason).toBe('terminal');
    expect(normalized.effective_configuration).toMatchObject({
      nested: [{ stack: '[OMITTED]' }],
    });
    expect(normalized.warnings).toEqual(['a warning', 'z warning']);
  });

  test('sanitizes display text, Markdown cells, links, and XML', () => {
    expect(safeDisplayText(undefined)).toBe('');
    expect(safeDisplayText({ value: 1 })).toBe('{"value":1}');
    expect(safeDisplayText(`ok\u0000\u0001\t\n at hidden\nlast`)).toBe(
      'ok\t\nlast'
    );
    expect(safeDisplayText(`\uE000😀`)).toBe(`\uE000😀`);
    expect(escapeMarkdownCell(String.raw`\|[]_*` + '`<>\n')).toContain('\\\\');
    expect(
      portableMarkdownLink(
        path.join(temporaryDirectory, "a b!()'*.md"),
        temporaryDirectory
      )
    ).toBe('a%20b%21%28%29%27%2A.md');
    expect(portableMarkdownLink(path.join(temporaryDirectory, 'file.md'))).toBe(
      'file.md'
    );
    expect(portableMarkdownLink('/rooted/path')).not.toMatch(/^\//);
    expect(xmlSafeText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  test('cleans temporary report files after a rename failure', async () => {
    const targetDirectory = path.join(temporaryDirectory, 'existing-target');
    await fs.mkdir(targetDirectory);
    await expect(
      writeReportFile(targetDirectory, 'content', temporaryDirectory)
    ).rejects.toBeDefined();
    expect(
      (await fs.readdir(temporaryDirectory)).filter((entry) =>
        entry.endsWith('.tmp')
      )
    ).toEqual([]);
  });

  test('generates experiment Markdown with defaults and optional sections', async () => {
    const report = generateExperimentMarkdown(experimentFixture());
    expect(report).not.toContain('No regression findings.');
    expect(report).toContain('host-trusted');
    expect(report).toContain('unavailable');
    expect(report).toContain('## Warnings');
    expect(report).not.toContain('- [json]');
    expect(report).toContain('details%20with%20spaces.json');

    const empty = {
      ...experimentFixture(),
      cells: [],
      comparisons: [],
      aggregates: [],
      artifacts: {},
      warnings: [],
    };
    expect(generateExperimentMarkdown(empty)).toContain(
      'No regression findings.'
    );

    const output = path.join(temporaryDirectory, 'report.md');
    await writeExperimentMarkdown(empty, output);
    await expect(fs.access(output)).resolves.toBeUndefined();
  });

  test('generates JUnit passed cases and fallback failure messages', () => {
    const fixture = experimentFixture();
    fixture.cells = [
      {
        ...fixture.cells[0],
        status: 'failed',
        terminal_reason: undefined,
      },
      {
        ...fixture.cells[1],
        status: 'pending',
        terminal_reason: undefined,
      },
      {
        ...fixture.cells[2],
        status: 'passed',
      },
    ];
    fixture.comparisons = [
      {
        status: 'failed',
        metric: 'failed',
        scope: 'scope',
        message: 'failed',
      },
      {
        status: 'partial',
        metric: 'partial',
        scope: 'scope',
        message: 'partial',
      },
      {
        status: 'passed',
        metric: 'passed',
        scope: 'scope',
        message: 'passed',
      },
    ];
    const junit = generateExperimentJunit(fixture);
    expect(junit).toContain('Experiment check failed');
    expect(junit).toContain('Experiment check incomplete');
    expect(junit).toContain('name="passed [scope] #3"');
  });

  test('covers standard Markdown conditional branches and default metric values', async () => {
    const reporter = new MarkdownReporter();
    const report = await reporter.generate(resultsFixture());
    expect(report).toContain('⚠️ partial');
    expect(report).toContain('⏱️ timeout');
    expect(report).toContain('**Expected Branch:** expected');
    expect(report).toContain('| object | {"a":1} |');
    expect(report).not.toContain('| file_similarities |');
    expect(report).toContain('| Files Matched | 0 |');
    expect(report).toContain('➖ removed');
    expect(report).toContain('**Evaluator Artifacts:**');
    expect(report).not.toContain('Agent Artifacts:');
    expect(report).not.toContain('**Reports:**');
    expect(report).toContain('result%20file.json');

    const failed = {
      ...resultsFixture(),
      agent: { ...resultsFixture().agent, status: 'failed' as const },
      summary: {
        ...resultsFixture().summary,
        overall_status: 'failed' as const,
      },
    };
    expect(await reporter.generate(failed)).toContain('❌ failed');
  });
});
