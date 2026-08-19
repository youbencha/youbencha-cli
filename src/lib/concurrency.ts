/**
 * Map values while limiting the number of concurrently running workers.
 * Results retain the same order as the input.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maxConcurrent: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('maxConcurrent must be a positive integer');
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }

  const workerCount = Math.min(maxConcurrent, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
