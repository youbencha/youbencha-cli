/**
 * JSON Reporter
 * 
 * Generates JSON reports from evaluation results.
 * Produces pretty-printed JSON files for easy reading and parsing.
 */

import { Reporter } from './base.js';
import { ResultsBundle } from '../schemas/result.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * JSON Reporter implementation
 * 
 * Serializes ResultsBundle to pretty-printed JSON format.
 */
export class JsonReporter implements Reporter {
  readonly name = 'json';
  readonly extension = '.json';

  /**
   * Generate JSON report from results bundle
   * 
   * @param bundle - Complete evaluation results
   * @param options - Reporter-specific options (unused for JSON)
   * @returns Promise resolving to pretty-printed JSON string
   */
  async generate(
    bundle: ResultsBundle,
    _options?: Record<string, unknown>
  ): Promise<string> {
    // Pretty-print with 2-space indentation
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Write JSON report to file
   * 
   * @param bundle - Complete evaluation results
   * @param outputPath - Path where report should be written
   * @param options - Reporter-specific options (unused for JSON)
   */
  async writeToFile(
    bundle: ResultsBundle,
    outputPath: string,
    _options?: Record<string, unknown>
  ): Promise<void> {
    // Generate JSON content
    const content = await this.generate(bundle);

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    // Write to file
    await fs.writeFile(outputPath, content, 'utf-8');
  }
}
