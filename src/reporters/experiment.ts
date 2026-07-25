import type { ExperimentResult } from '../schemas/experiment-result.schema.js';
import {
  getExperimentReportPaths,
  type ExperimentReportPaths,
} from './experiment-utils.js';
import { writeExperimentJson } from './experiment-json.js';
import { writeExperimentMarkdown } from './experiment-markdown.js';
import { writeExperimentJunit } from './experiment-junit.js';

export {
  generateExperimentJson,
  writeExperimentJson,
} from './experiment-json.js';
export {
  generateExperimentMarkdown,
  writeExperimentMarkdown,
  type ExperimentMarkdownOptions,
} from './experiment-markdown.js';
export {
  generateExperimentJunit,
  writeExperimentJunit,
} from './experiment-junit.js';
export {
  getExperimentReportPaths,
  type ExperimentReportPaths,
} from './experiment-utils.js';

export async function writeExperimentReports(
  result: ExperimentResult,
  outputDirectory: string
): Promise<ExperimentReportPaths> {
  const paths = getExperimentReportPaths(outputDirectory);
  const reportResult: ExperimentResult = {
    ...result,
    artifacts: {
      ...result.artifacts,
      json: 'results.json',
      markdown: 'report.md',
      junit: 'junit.xml',
    },
  };
  await Promise.all([
    writeExperimentJson(reportResult, paths.json),
    writeExperimentMarkdown(reportResult, paths.markdown, {
      reportDirectory: outputDirectory,
    }),
    writeExperimentJunit(reportResult, paths.junit),
  ]);
  return paths;
}
