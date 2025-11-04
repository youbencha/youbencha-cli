/**
 * Progress Feedback Utility
 * 
 * Provides progress indicators using ora spinners.
 * Shows real-time feedback during long-running operations.
 */

import ora, { Ora } from 'ora';

/**
 * Progress spinner interface
 */
export interface ProgressSpinner {
  /** Start the spinner */
  start(text?: string): ProgressSpinner;
  
  /** Update spinner text */
  text(text: string): ProgressSpinner;
  
  /** Mark spinner as successful */
  succeed(text?: string): ProgressSpinner;
  
  /** Mark spinner as failed */
  fail(text?: string): ProgressSpinner;
  
  /** Mark spinner as warning */
  warn(text?: string): ProgressSpinner;
  
  /** Mark spinner as info */
  info(text?: string): ProgressSpinner;
  
  /** Stop spinner without marking success/failure */
  stop(): ProgressSpinner;
  
  /** Check if spinner is currently spinning */
  isSpinning(): boolean;
}

/**
 * Wrapper class for ora spinner
 */
class OraProgressSpinner implements ProgressSpinner {
  private spinner: Ora;

  constructor(text?: string) {
    this.spinner = ora({
      text: text || '',
      color: 'cyan',
    });
  }

  start(text?: string): ProgressSpinner {
    if (text) {
      this.spinner.text = text;
    }
    this.spinner.start();
    return this;
  }

  text(text: string): ProgressSpinner {
    this.spinner.text = text;
    return this;
  }

  succeed(text?: string): ProgressSpinner {
    this.spinner.succeed(text);
    return this;
  }

  fail(text?: string): ProgressSpinner {
    this.spinner.fail(text);
    return this;
  }

  warn(text?: string): ProgressSpinner {
    this.spinner.warn(text);
    return this;
  }

  info(text?: string): ProgressSpinner {
    this.spinner.info(text);
    return this;
  }

  stop(): ProgressSpinner {
    this.spinner.stop();
    return this;
  }

  isSpinning(): boolean {
    return this.spinner.isSpinning;
  }
}

/**
 * Create a new progress spinner
 */
export function createSpinner(text?: string): ProgressSpinner {
  return new OraProgressSpinner(text);
}

/**
 * Show a step in a multi-step process
 */
export function showStep(step: number, total: number, text: string): ProgressSpinner {
  const spinner = createSpinner(`[${step}/${total}] ${text}`);
  spinner.start();
  return spinner;
}

/**
 * Track progress of an async operation
 */
export async function withProgress<T>(
  text: string,
  operation: () => Promise<T>,
  options?: {
    successText?: string;
    failText?: string;
  }
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();

  try {
    const result = await operation();
    spinner.succeed(options?.successText || text);
    return result;
  } catch (error) {
    spinner.fail(options?.failText || `${text} - Failed`);
    throw error;
  }
}

/**
 * Run multiple operations with individual progress tracking
 */
export async function withMultiProgress<T>(
  operations: Array<{
    text: string;
    operation: () => Promise<T>;
    successText?: string;
    failText?: string;
  }>
): Promise<T[]> {
  const results: T[] = [];

  for (const op of operations) {
    const result = await withProgress(
      op.text,
      op.operation,
      {
        successText: op.successText,
        failText: op.failText,
      }
    );
    results.push(result);
  }

  return results;
}

/**
 * Show a simple success message
 */
export function success(text: string): void {
  const spinner = createSpinner();
  spinner.succeed(text);
}

/**
 * Show a simple error message
 */
export function failure(text: string): void {
  const spinner = createSpinner();
  spinner.fail(text);
}

/**
 * Show a simple warning message
 */
export function warning(text: string): void {
  const spinner = createSpinner();
  spinner.warn(text);
}

/**
 * Show a simple info message
 */
export function information(text: string): void {
  const spinner = createSpinner();
  spinner.info(text);
}

/**
 * Default export with all progress functions
 */
export default {
  createSpinner,
  showStep,
  withProgress,
  withMultiProgress,
  success,
  failure,
  warning,
  information,
};
