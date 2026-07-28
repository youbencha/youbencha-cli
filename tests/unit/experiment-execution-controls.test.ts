import {
  TargetCircuitBreakerExecutor,
  TargetUnavailableError,
  TokenBucket,
  type PlannedExperimentCell,
  type SingleRunExecutionResult,
  type SingleRunExecutor,
} from '../../src/experiments/index.js';

const cell = (target: string, index: number): PlannedExperimentCell => ({
  cellId: index.toString(16).padStart(64, '0'),
  testcaseId: `task-${index}`,
  variantName: target,
  repetition: 0,
  configHash: 'a'.repeat(64),
  config: {} as PlannedExperimentCell['config'],
});

describe('experiment execution controls', () => {
  test('meters concurrent token requests at the configured creation rate', async () => {
    let current = 0;
    const delays: number[] = [];
    const bucket = new TokenBucket({
      tokensPerSecond: 2,
      now: (): number => current,
      delay: async (milliseconds): Promise<void> => {
        delays.push(milliseconds);
        current += milliseconds;
      },
    });

    await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
    expect(delays).toEqual([500, 500]);
  });

  test('holds fan-out until the first target cell confirms capability', async () => {
    let releaseProbe = (): void => undefined;
    const probe = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const calls: string[] = [];
    const inner: SingleRunExecutor = {
      execute: async (plannedCell): Promise<SingleRunExecutionResult> => {
        calls.push(plannedCell.testcaseId);
        if (plannedCell.testcaseId === 'task-0') await probe;
        return {} as SingleRunExecutionResult;
      },
    };
    const executor = new TargetCircuitBreakerExecutor(inner);
    const first = executor.execute(cell('candidate', 0), {
      experimentId: 'experiment',
      attemptId: 'attempt-0',
      attemptNumber: 1,
    });
    const second = executor.execute(cell('candidate', 1), {
      experimentId: 'experiment',
      attemptId: 'attempt-1',
      attemptNumber: 1,
    });
    await Promise.resolve();
    expect(calls).toEqual(['task-0']);
    releaseProbe();
    await Promise.all([first, second]);
    expect(calls).toEqual(['task-0', 'task-1']);
  });

  test('opens the target circuit after deterministic unavailability', async () => {
    let calls = 0;
    const executor = new TargetCircuitBreakerExecutor({
      execute: async (plannedCell): Promise<never> => {
        calls += 1;
        throw new TargetUnavailableError(
          plannedCell.variantName,
          'requested model was retired'
        );
      },
    });
    const first = executor.execute(cell('candidate', 0), {
      experimentId: 'experiment',
      attemptId: 'attempt-0',
      attemptNumber: 1,
    });
    const second = executor.execute(cell('candidate', 1), {
      experimentId: 'experiment',
      attemptId: 'attempt-1',
      attemptNumber: 1,
    });
    await expect(first).rejects.toThrow('retired');
    await expect(second).rejects.toThrow('retired');
    expect(calls).toBe(1);
  });
});
