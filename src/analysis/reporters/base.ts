/**
 * Analysis Reporter Base
 *
 * Defines the interface for analysis reporters.
 */

import { AnalysisResult, ReporterOptions } from '../schemas/analysis.schema.js';

/**
 * Analysis Reporter interface for generating formatted output
 */
export interface AnalysisReporter {
  /**
   * Unique identifier for this reporter
   */
  readonly name: string;

  /**
   * File extension for generated report
   */
  readonly extension: string;

  /**
   * Generate formatted output
   *
   * @param analysis - Analysis result to format
   * @param options - Reporter-specific options
   * @returns Formatted output string
   */
  generate(analysis: AnalysisResult, options?: ReporterOptions): Promise<string>;

  /**
   * Write to file
   *
   * @param analysis - Analysis result to write
   * @param outputPath - Path where report should be written
   * @param options - Reporter-specific options
   */
  writeToFile(
    analysis: AnalysisResult,
    outputPath: string,
    options?: ReporterOptions
  ): Promise<void>;
}
