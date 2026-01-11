/**
 * JSON Analysis Reporter
 *
 * Outputs analysis results as JSON for programmatic consumption.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AnalysisReporter } from './base.js';
import { AnalysisResult, ReporterOptions } from '../schemas/analysis.schema.js';

/**
 * JSON Reporter implementation for analysis results
 */
export class AnalysisJsonReporter implements AnalysisReporter {
  readonly name = 'json';
  readonly extension = '.json';

  /**
   * Generate JSON output from analysis result
   *
   * @param analysis - Analysis result to format
   * @param options - Reporter options (unused for JSON)
   * @returns Pretty-printed JSON string
   */
  async generate(analysis: AnalysisResult, _options?: ReporterOptions): Promise<string> {
    return JSON.stringify(analysis, null, 2);
  }

  /**
   * Write JSON report to file
   *
   * @param analysis - Analysis result to write
   * @param outputPath - Path where report should be written
   * @param options - Reporter options
   */
  async writeToFile(
    analysis: AnalysisResult,
    outputPath: string,
    options?: ReporterOptions
  ): Promise<void> {
    const content = await this.generate(analysis, options);

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(outputPath, content, 'utf-8');
  }
}
