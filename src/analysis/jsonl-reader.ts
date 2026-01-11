/**
 * JSONL Reader
 *
 * Reads and parses JSONL history files for analysis.
 * Provides methods to read all records or filter them based on criteria.
 */

import * as fs from 'fs/promises';
import * as readline from 'readline';
import { createReadStream } from 'fs';
import {
  ExportedResultsBundle,
  exportedResultsBundleSchema,
  AnalysisFilter,
} from './schemas/analysis.schema.js';
import * as logger from '../lib/logger.js';

/**
 * Error thrown when JSONL reading fails
 */
export class JSONLReaderError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'JSONLReaderError';
  }
}

/**
 * JSONL Reader for parsing history files
 */
export class JSONLReader {
  /**
   * Read all records from JSONL file
   *
   * @param filePath - Path to JSONL file
   * @returns Array of ExportedResultsBundle records
   * @throws JSONLReaderError if file cannot be read or parsed
   */
  async readAll(filePath: string): Promise<ExportedResultsBundle[]> {
    const records: ExportedResultsBundle[] = [];

    for await (const record of this.stream(filePath)) {
      records.push(record);
    }

    return records;
  }

  /**
   * Stream records from JSONL file (memory-efficient for large files)
   *
   * @param filePath - Path to JSONL file
   * @yields ExportedResultsBundle records one at a time
   */
  async *stream(filePath: string): AsyncGenerator<ExportedResultsBundle> {
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      throw new JSONLReaderError(
        `No history file found at ${filePath}. Run evaluations with \`database\` post-evaluator first.`
      );
    }

    const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;

      // Skip empty lines
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const parsed: unknown = JSON.parse(trimmedLine);
        const result = exportedResultsBundleSchema.safeParse(parsed);

        if (result.success) {
          yield result.data;
        } else {
          logger.warn(`Invalid ResultsBundle at line ${lineNumber}, skipping`);
        }
      } catch (error) {
        logger.warn(
          `Malformed JSON at line ${lineNumber}, skipping: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Read with filtering
   *
   * @param filePath - Path to JSONL file
   * @param filter - Filter criteria
   * @returns Filtered records
   */
  async readFiltered(
    filePath: string,
    filter: AnalysisFilter
  ): Promise<ExportedResultsBundle[]> {
    const records: ExportedResultsBundle[] = [];
    let count = 0;

    for await (const record of this.stream(filePath)) {
      if (this.matchesFilter(record, filter)) {
        records.push(record);
        count++;

        // Early exit if limit reached
        if (filter.limit && count >= filter.limit) {
          break;
        }
      }
    }

    // If limit is specified but we want "last N" behavior, we need all records first
    // then slice. For streaming efficiency, we only support "first N" with limit.
    // For "last N" behavior, use readAll and then slice externally.
    return records;
  }

  /**
   * Read last N records (reads all and returns last N)
   *
   * @param filePath - Path to JSONL file
   * @param n - Number of records to return
   * @param filter - Optional additional filters
   * @returns Last N matching records
   */
  async readLast(
    filePath: string,
    n: number,
    filter?: Omit<AnalysisFilter, 'limit'>
  ): Promise<ExportedResultsBundle[]> {
    const allRecords: ExportedResultsBundle[] = [];

    for await (const record of this.stream(filePath)) {
      if (!filter || this.matchesFilter(record, filter)) {
        allRecords.push(record);
      }
    }

    // Return last N records
    return allRecords.slice(-n);
  }

  /**
   * Check if a record matches the filter criteria
   */
  private matchesFilter(record: ExportedResultsBundle, filter: AnalysisFilter): boolean {
    // Filter by test case name
    if (filter.testCase) {
      if (filter.testCase instanceof RegExp) {
        if (!filter.testCase.test(record.test_case.name)) {
          return false;
        }
      } else {
        // Support glob-like patterns with *
        const pattern = filter.testCase.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`, 'i');
        if (!regex.test(record.test_case.name)) {
          return false;
        }
      }
    }

    // Filter by agent type
    if (filter.agent && record.agent.type !== filter.agent) {
      return false;
    }

    // Filter by evaluator
    if (filter.evaluator) {
      const hasEvaluator = record.evaluators.some((e) => e.evaluator === filter.evaluator);
      if (!hasEvaluator) {
        return false;
      }
    }

    // Filter by date range
    const recordDate = new Date(record.exported_at);
    if (filter.since && recordDate < filter.since) {
      return false;
    }
    if (filter.until && recordDate > filter.until) {
      return false;
    }

    // Filter by status
    if (filter.status && filter.status.length > 0) {
      if (!filter.status.includes(record.summary.overall_status)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get record count without loading all records into memory
   *
   * @param filePath - Path to JSONL file
   * @returns Number of valid records in file
   */
  async count(filePath: string): Promise<number> {
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _record of this.stream(filePath)) {
      count++;
    }
    return count;
  }
}
