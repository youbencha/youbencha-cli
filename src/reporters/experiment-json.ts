import type { ExperimentResult } from '../schemas/experiment-result.schema.js';
import { canonicalJson } from '../experiments/identity.js';
import {
  normalizeExperimentResult,
  writeReportFile,
} from './experiment-utils.js';

function prettyCanonicalJson(value: unknown): string {
  return JSON.stringify(JSON.parse(canonicalJson(value)), null, 2);
}

export function generateExperimentJson(result: ExperimentResult): string {
  return `${prettyCanonicalJson(normalizeExperimentResult(result))}\n`;
}

export async function writeExperimentJson(
  result: ExperimentResult,
  outputPath: string
): Promise<void> {
  await writeReportFile(outputPath, generateExperimentJson(result));
}
