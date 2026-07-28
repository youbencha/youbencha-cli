import { abortableDelay } from './retry.js';

export interface TokenBucketOptions {
  tokensPerSecond: number;
  capacity?: number;
  now?: () => number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * A process-local token bucket used to meter remote sandbox creation
 * independently from the experiment concurrency limit.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly delay: (
    milliseconds: number,
    signal?: AbortSignal
  ) => Promise<void>;
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: TokenBucketOptions) {
    if (
      !Number.isFinite(options.tokensPerSecond) ||
      options.tokensPerSecond <= 0
    ) {
      throw new Error('tokensPerSecond must be a positive finite number');
    }
    this.capacity = options.capacity ?? 1;
    if (!Number.isFinite(this.capacity) || this.capacity < 1) {
      throw new Error('capacity must be at least one');
    }
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? abortableDelay;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  public acquire(signal?: AbortSignal): Promise<void> {
    const operation = this.queue.then(() => this.acquireToken(signal));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async acquireToken(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Operation cancelled');
      }
      const current = this.now();
      const elapsed = Math.max(0, current - this.lastRefill);
      this.tokens = Math.min(
        this.capacity,
        this.tokens + (elapsed * this.options.tokensPerSecond) / 1000
      );
      this.lastRefill = current;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMilliseconds = Math.ceil(
        ((1 - this.tokens) * 1000) / this.options.tokensPerSecond
      );
      await this.delay(waitMilliseconds, signal);
    }
  }
}
