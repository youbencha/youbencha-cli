import * as path from 'path';
import type { ExperimentResult } from '../schemas/experiment-result.schema.js';
import {
  escapeMarkdownCell,
  normalizeExperimentResult,
  portableMarkdownLink,
  safeDisplayText,
  writeReportFile,
} from './experiment-utils.js';

export interface ExperimentMarkdownOptions {
  reportDirectory?: string;
}

function artifactLink(
  label: string,
  artifactPath: string,
  options: ExperimentMarkdownOptions
): string {
  const target = portableMarkdownLink(artifactPath, options.reportDirectory);
  return `[${escapeMarkdownCell(label)}](${target})`;
}

export function generateExperimentMarkdown(
  input: ExperimentResult,
  options: ExperimentMarkdownOptions = {}
): string {
  const result = normalizeExperimentResult(input);
  const lines = [
    `# youBencha Experiment: ${escapeMarkdownCell(result.experiment_id)}`,
    '',
    `**Status:** ${escapeMarkdownCell(result.final_status)}`,
    `**Exit code:** ${result.exit_code}`,
    `**Started:** ${escapeMarkdownCell(result.started_at)}`,
    `**Completed:** ${escapeMarkdownCell(result.completed_at)}`,
    '',
    '## Cells',
    '',
    '| Test case | Target/variant | Repetition | Status | Provider | Sandbox | Duration | Sandbox runtime | Model cost | Sandbox cost | Result |',
    '| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const cell of result.cells) {
    const resultLink = cell.result_path
      ? artifactLink('details', cell.result_path, options)
      : '';
    const latestAttempt = cell.attempts.at(-1);
    lines.push(
      `| ${escapeMarkdownCell(cell.testcase_id)} | ${escapeMarkdownCell(cell.variant_name)} | ${cell.repetition + 1} | ${escapeMarkdownCell(cell.status)} | ${escapeMarkdownCell(latestAttempt?.execution_provider ?? 'host-trusted')} | ${escapeMarkdownCell(latestAttempt?.remote?.sandbox_id ?? '')} | ${cell.duration_ms ?? ''} | ${cell.sandbox_runtime_ms ?? ''} | ${cell.cost_usd ?? ''} | ${cell.sandbox_cost_usd ?? 'unavailable'} | ${resultLink} |`
    );
  }

  lines.push('', '## Regression findings', '');
  if (result.comparisons.length === 0) {
    lines.push('No regression findings.');
  } else {
    lines.push('| Status | Scope | Metric | Candidate | Baseline | Message |');
    lines.push('| --- | --- | --- | ---: | ---: | --- |');
    for (const finding of result.comparisons) {
      lines.push(
        `| ${escapeMarkdownCell(finding.status)} | ${escapeMarkdownCell(finding.scope)} | ${escapeMarkdownCell(finding.metric)} | ${finding.candidate ?? ''} | ${finding.baseline ?? ''} | ${escapeMarkdownCell(finding.message)} |`
      );
    }
  }

  lines.push('', '## Aggregates', '');
  for (const aggregate of result.aggregates) {
    const identity = [
      aggregate.scope,
      aggregate.testcase_id,
      aggregate.variant_name,
    ]
      .filter((value) => value !== undefined)
      .join(' / ');
    lines.push(`### ${escapeMarkdownCell(identity)}`, '');
    lines.push('| Metric | Sample size | Value | Quality |');
    lines.push('| --- | ---: | ---: | --- |');
    for (const [metric, value] of Object.entries(aggregate.metrics).sort(
      ([left], [right]) => left.localeCompare(right, 'en')
    )) {
      lines.push(
        `| ${escapeMarkdownCell(metric)} | ${value.sample_size} | ${value.value ?? ''} | ${escapeMarkdownCell(value.quality)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Artifacts', '');
  for (const [kind, artifactPath] of Object.entries(result.artifacts).sort(
    ([left], [right]) => left.localeCompare(right, 'en')
  )) {
    if (artifactPath) {
      lines.push(`- ${artifactLink(kind, artifactPath, options)}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of result.warnings) {
      lines.push(`- ${escapeMarkdownCell(safeDisplayText(warning))}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function writeExperimentMarkdown(
  result: ExperimentResult,
  outputPath: string,
  options: ExperimentMarkdownOptions = {}
): Promise<void> {
  await writeReportFile(
    outputPath,
    generateExperimentMarkdown(result, {
      reportDirectory:
        options.reportDirectory ?? path.dirname(path.resolve(outputPath)),
    })
  );
}
