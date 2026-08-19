import type { RetryReason } from '../schemas/experiment.schema.js';

export class ExperimentExecutionError extends Error {
  public constructor(
    message: string,
    public readonly retryReason: RetryReason
  ) {
    super(message);
    this.name = 'ExperimentExecutionError';
  }
}

export function classifyExecutionError(error: unknown): RetryReason {
  return error instanceof ExperimentExecutionError
    ? error.retryReason
    : 'infrastructure_failure';
}

export function shouldRetry(
  reason: RetryReason,
  configuredReasons: readonly RetryReason[],
  completedAttempts: number,
  maxAttempts: number
): boolean {
  return completedAttempts < maxAttempts && configuredReasons.includes(reason);
}

export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Operation cancelled'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error('Operation cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
