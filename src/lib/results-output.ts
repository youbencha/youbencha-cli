import * as path from 'path';
import type { ResultsBundle } from '../schemas/result.schema.js';
import { MarkdownReporter } from '../reporters/markdown.js';

export interface ResultOutputPaths {
  results: string;
  report: string;
}

/**
 * Generate the default human-readable report next to results.json.
 */
export async function writeDefaultMarkdownReport(
  results: ResultsBundle
): Promise<ResultOutputPaths> {
  const artifactsDir = path.resolve(
    results.execution.environment.workspace_dir,
    'artifacts'
  );
  const outputPaths = {
    results: path.join(artifactsDir, 'results.json'),
    report: path.join(artifactsDir, 'report.md'),
  };
  await new MarkdownReporter().writeToFile(results, outputPaths.report);
  return outputPaths;
}
