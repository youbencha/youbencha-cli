import type {
  PlannedExperimentCell,
  InterruptedExecutionContext,
  SingleRunExecutionContext,
  SingleRunExecutionResult,
  SingleRunExecutor,
} from './single-run-executor.js';

export class TargetUnavailableError extends Error {
  public constructor(
    public readonly targetId: string,
    message: string
  ) {
    super(message);
    this.name = 'TargetUnavailableError';
  }
}

interface TargetGate {
  state: 'probing' | 'available' | 'unavailable';
  probe: Promise<void>;
  release: () => void;
  failure?: TargetUnavailableError;
}

export interface TargetCircuitBreakerOptions {
  isUnavailable?: (error: unknown) => boolean;
}

/**
 * Allows one initial cell per target to confirm harness/model capability before
 * releasing the target's remaining fan-out.
 */
export class TargetCircuitBreakerExecutor implements SingleRunExecutor {
  private readonly gates = new Map<string, TargetGate>();
  private readonly isUnavailable: (error: unknown) => boolean;

  public constructor(
    private readonly executor: SingleRunExecutor,
    options: TargetCircuitBreakerOptions = {}
  ) {
    this.isUnavailable =
      options.isUnavailable ??
      ((error): boolean => error instanceof TargetUnavailableError);
  }

  public async execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult> {
    const existing = this.gates.get(cell.variantName);
    if (existing !== undefined) {
      await existing.probe;
      if (existing.state === 'unavailable') {
        throw (
          existing.failure ??
          new TargetUnavailableError(
            cell.variantName,
            `Target ${cell.variantName} is unavailable`
          )
        );
      }
      return this.executor.execute(cell, context);
    }

    let release = (): void => undefined;
    const probe = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate: TargetGate = { state: 'probing', probe, release };
    this.gates.set(cell.variantName, gate);
    try {
      const result = await this.executor.execute(cell, context);
      gate.state = 'available';
      return result;
    } catch (error) {
      if (this.isUnavailable(error)) {
        gate.state = 'unavailable';
        gate.failure =
          error instanceof TargetUnavailableError
            ? error
            : new TargetUnavailableError(
                cell.variantName,
                error instanceof Error ? error.message : String(error)
              );
      } else {
        this.gates.delete(cell.variantName);
      }
      throw error;
    } finally {
      gate.release();
    }
  }

  public reconcileInterrupted(
    context: InterruptedExecutionContext
  ): Promise<void> {
    return this.executor.reconcileInterrupted?.(context) ?? Promise.resolve();
  }
}
