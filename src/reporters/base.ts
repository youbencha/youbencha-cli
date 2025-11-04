/**
 * Base Reporter Interface
 * 
 * Defines the contract that all reporters must implement.
 * Enables pluggable report generation from evaluation results.
 */

import { ResultsBundle } from '../schemas/result.schema.js';

/**
 * Reporter interface for generating evaluation reports
 * 
 * Each reporter (JSON, Markdown, HTML, etc.) implements this interface
 * to transform ResultsBundle into desired format.
 */
export interface Reporter {
  /**
   * Unique identifier for this reporter
   * Example: 'json', 'markdown', 'html'
   */
  readonly name: string;

  /**
   * File extension for generated report
   * Example: '.json', '.md', '.html'
   */
  readonly extension: string;

  /**
   * Generate report from results bundle
   * 
   * @param bundle - Complete evaluation results
   * @param options - Reporter-specific options
   * @returns Promise resolving to report content as string
   */
  generate(
    bundle: ResultsBundle,
    options?: Record<string, unknown>
  ): Promise<string>;

  /**
   * Write report to file
   * 
   * @param bundle - Complete evaluation results
   * @param outputPath - Path where report should be written
   * @param options - Reporter-specific options
   */
  writeToFile(
    bundle: ResultsBundle,
    outputPath: string,
    options?: Record<string, unknown>
  ): Promise<void>;
}
