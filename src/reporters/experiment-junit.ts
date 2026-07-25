import type { ExperimentResult } from '../schemas/experiment-result.schema.js';
import {
  normalizeExperimentResult,
  writeReportFile,
  xmlSafeText,
} from './experiment-utils.js';

interface JunitCase {
  classname: string;
  name: string;
  timeSeconds: string;
  outcome: 'passed' | 'failed' | 'skipped';
  message?: string;
}

function identifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function buildCases(result: ExperimentResult): JunitCase[] {
  const cases: JunitCase[] = result.cells.map((cell) => {
    const failed =
      cell.status === 'failed' || cell.status === 'infrastructure_failed';
    const skipped =
      cell.status === 'pending' ||
      cell.status === 'running' ||
      cell.status === 'partial' ||
      cell.status === 'cancelled';
    return {
      classname: `youbencha.experiment.${identifier(result.experiment_id)}.cell.${identifier(cell.testcase_id)}`,
      name: `${cell.variant_name} repetition ${cell.repetition + 1} [${cell.cell_id}]`,
      timeSeconds: ((cell.duration_ms ?? 0) / 1000).toFixed(3),
      outcome: failed ? 'failed' : skipped ? 'skipped' : 'passed',
      message: cell.terminal_reason,
    };
  });

  result.comparisons.forEach((finding, index) => {
    cases.push({
      classname: `youbencha.experiment.${identifier(result.experiment_id)}.policy.${identifier(finding.scope)}`,
      name: `${finding.metric} [${finding.scope}] #${index + 1}`,
      timeSeconds: '0.000',
      outcome:
        finding.status === 'failed'
          ? 'failed'
          : finding.status === 'partial'
            ? 'skipped'
            : 'passed',
      message: finding.message,
    });
  });
  return cases;
}

export function generateExperimentJunit(input: ExperimentResult): string {
  const result = normalizeExperimentResult(input);
  const cases = buildCases(result);
  const failures = cases.filter((item) => item.outcome === 'failed').length;
  const skipped = cases.filter((item) => item.outcome === 'skipped').length;
  const duration = cases
    .reduce((total, item) => total + Number(item.timeSeconds), 0)
    .toFixed(3);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${xmlSafeText(`youBencha experiment ${result.experiment_id}`)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${duration}">`,
  ];

  for (const item of cases) {
    lines.push(
      `  <testcase classname="${xmlSafeText(item.classname)}" name="${xmlSafeText(item.name)}" time="${item.timeSeconds}">`
    );
    if (item.outcome === 'failed') {
      lines.push(
        `    <failure message="${xmlSafeText(item.message ?? 'Experiment check failed')}">${xmlSafeText(item.message ?? 'Experiment check failed')}</failure>`
      );
    } else if (item.outcome === 'skipped') {
      lines.push(
        `    <skipped message="${xmlSafeText(item.message ?? 'Experiment check incomplete')}"/>`
      );
    }
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  return `${lines.join('\n')}\n`;
}

export async function writeExperimentJunit(
  result: ExperimentResult,
  outputPath: string
): Promise<void> {
  await writeReportFile(outputPath, generateExperimentJunit(result));
}
