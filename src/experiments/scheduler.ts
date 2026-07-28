import { randomUUID } from 'crypto';
import type {
  ExperimentDefinition,
  RetryReason,
} from '../schemas/experiment.schema.js';
import type {
  ExperimentAttempt,
  ExperimentCellResult,
  ExperimentCellStatus,
  ExperimentState,
} from '../schemas/experiment-result.schema.js';
import type { ExperimentPlan } from './planner.js';
import type {
  PlannedExperimentCell,
  SingleRunExecutionResult,
  SingleRunExecutor,
} from './single-run-executor.js';
import { ExperimentBudget } from './budget.js';
import {
  abortableDelay,
  classifyExecutionError,
  shouldRetry,
} from './retry.js';
import { ExperimentStateStore } from './state-store.js';
import { sanitizeExperimentResultsBundle } from './artifact-security.js';
import { TargetUnavailableError } from './target-circuit-breaker.js';

export interface ExperimentSchedulerOptions {
  plan: ExperimentPlan;
  state: ExperimentState;
  store: ExperimentStateStore;
  executor: SingleRunExecutor;
  retry: ExperimentRetryPolicy;
  signal?: AbortSignal;
  now?: () => Date;
  random?: () => number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export type ExperimentRetryPolicy =
  ExperimentDefinition['execution']['retry'] & {
    jitter?: 'none' | 'full';
  };

export interface ExperimentScheduleResult {
  state: ExperimentState;
  finalStatus: 'passed' | 'failed' | 'partial' | 'infrastructure_failed';
  exitCode: 0 | 1 | 2 | 3;
}

interface SettledAttempt {
  cell: PlannedExperimentCell;
  cellState: ExperimentCellResult;
  attempt: ExperimentAttempt;
  execution?: SingleRunExecutionResult;
  error?: unknown;
}

function terminalStatus(
  execution: SingleRunExecutionResult
): Extract<
  ExperimentCellStatus,
  'passed' | 'failed' | 'partial' | 'infrastructure_failed'
> {
  if (
    execution.result.agent.status !== 'success' ||
    execution.result.agent.exit_code !== 0
  ) {
    return 'infrastructure_failed';
  }
  return execution.result.summary.overall_status;
}

function finalOutcome(
  state: ExperimentState
): Pick<ExperimentScheduleResult, 'finalStatus' | 'exitCode'> {
  if (state.budget.stop_reason !== undefined) {
    return { finalStatus: 'partial', exitCode: 3 };
  }
  if (
    state.cells.some((cell) =>
      cell.terminal_reason?.startsWith('retry_exhausted:')
    )
  ) {
    return { finalStatus: 'partial', exitCode: 3 };
  }
  if (state.cells.some((cell) => cell.status === 'infrastructure_failed')) {
    return { finalStatus: 'infrastructure_failed', exitCode: 1 };
  }
  if (state.cells.some((cell) => cell.status === 'failed')) {
    return { finalStatus: 'failed', exitCode: 2 };
  }
  if (
    state.cells.some(
      (cell) =>
        cell.status === 'partial' ||
        cell.status === 'cancelled' ||
        cell.status === 'pending' ||
        cell.status === 'running'
    )
  ) {
    return { finalStatus: 'partial', exitCode: 3 };
  }
  return { finalStatus: 'passed', exitCode: 0 };
}

function mergeUsageQuality(
  current: ExperimentCellResult['usage_quality'],
  next: SingleRunExecutionResult['usageQuality']
): ExperimentCellResult['usage_quality'] {
  if (current === 'estimated' || next === 'estimated') {
    return 'estimated';
  }
  if (current === 'measured' || next === 'measured') {
    return 'measured';
  }
  return 'unavailable';
}

export class ExperimentScheduler {
  private readonly now: () => Date;
  private readonly delay: (
    milliseconds: number,
    signal?: AbortSignal
  ) => Promise<void>;
  private readonly active = new Map<string, Promise<SettledAttempt>>();
  private readonly retryNotBefore = new Map<string, number>();
  private readonly runtimeAbort = new AbortController();
  private readonly random: () => number;
  private readonly onExternalAbort = (): void =>
    this.runtimeAbort.abort(this.options.signal?.reason);

  public constructor(private readonly options: ExperimentSchedulerOptions) {
    this.now = options.now ?? ((): Date => new Date());
    this.random = options.random ?? Math.random;
    this.delay = options.delay ?? abortableDelay;
    if (options.signal?.aborted) {
      this.onExternalAbort();
    } else {
      options.signal?.addEventListener('abort', this.onExternalAbort, {
        once: true,
      });
    }
  }

  public async run(): Promise<ExperimentScheduleResult> {
    const { state, store } = this.options;
    const startedAt = state.started_at ?? this.now().toISOString();
    const runtimeStartedAt = this.now().getTime();
    const previouslyUsedMs = state.budget.duration_ms_used;
    const previouslyUsedCostUsd = state.budget.cost_usd_used;
    const previouslyUsedSandboxRuntimeMs = state.budget.sandbox_runtime_ms_used;
    state.started_at = startedAt;
    state.status = 'running';
    state.updated_at = this.now().toISOString();
    const budget = new ExperimentBudget(
      this.options.plan.budget,
      runtimeStartedAt,
      previouslyUsedMs,
      previouslyUsedCostUsd,
      previouslyUsedSandboxRuntimeMs
    );
    try {
      await store.save(state);

      while (this.hasRunnableWork()) {
        if (this.runtimeAbort.signal.aborted) {
          await this.cancelPending(state, budget);
          break;
        }

        const stopReason = budget.stopReason(state, this.now().getTime());
        if (stopReason !== undefined) {
          state.budget.stop_reason = stopReason;
          await this.cancelPending(state, budget);
          break;
        }

        await this.startReadyCells();
        if (this.active.size === 0) {
          const wait = this.nextRetryDelay();
          if (wait === undefined) {
            break;
          }
          try {
            await this.delay(wait, this.runtimeAbort.signal);
          } catch {
            await this.cancelPending(state, budget);
            break;
          }
          continue;
        }

        const settled = await Promise.race(this.active.values());
        this.active.delete(settled.cell.cellId);
        await this.applySettled(settled, budget);
      }

      await this.drainActive(budget, true);

      budget.updateDuration(state, this.now().getTime());
      if (this.options.signal?.aborted) {
        state.budget.stop_reason = 'cancelled';
        state.status = 'cancelled';
      } else {
        state.status = 'completed';
      }
      state.updated_at = this.now().toISOString();
      await store.save(state);
      return { state, ...finalOutcome(state) };
    } catch (error) {
      this.runtimeAbort.abort(error);
      await this.drainActive(budget, false);
      throw error;
    } finally {
      this.options.signal?.removeEventListener('abort', this.onExternalAbort);
    }
  }

  private hasRunnableWork(): boolean {
    return (
      this.active.size > 0 ||
      this.options.state.cells.some((cell) => cell.status === 'pending')
    );
  }

  private async startReadyCells(): Promise<void> {
    const capacity = this.options.plan.maxConcurrent - this.active.size;
    if (capacity <= 0) {
      return;
    }
    const nowMs = this.now().getTime();
    const ready = this.options.state.cells
      .filter(
        (cell) =>
          cell.status === 'pending' &&
          (this.retryNotBefore.get(cell.cell_id) ?? 0) <= nowMs
      )
      .slice(0, capacity);

    const prepared: Array<{
      cell: PlannedExperimentCell;
      cellState: ExperimentCellResult;
      attempt: ExperimentAttempt;
      startedAtMs: number;
    }> = [];
    for (const cellState of ready) {
      const cell = this.options.plan.cells.find(
        (candidate) => candidate.cellId === cellState.cell_id
      );
      if (cell === undefined) {
        throw new Error(
          `Persisted cell ${cellState.cell_id} is not in the plan`
        );
      }
      const attemptNumber = cellState.attempts.length + 1;
      const started = this.now();
      const attempt: ExperimentAttempt = {
        attempt_id: randomUUID(),
        attempt_number: attemptNumber,
        status: 'running',
        started_at: started.toISOString(),
      };
      cellState.status = 'running';
      cellState.attempts.push(attempt);
      cellState.terminal_reason = undefined;
      this.options.state.updated_at = started.toISOString();
      prepared.push({
        cell,
        cellState,
        attempt,
        startedAtMs: started.getTime(),
      });
    }
    if (prepared.length > 0) {
      await this.options.store.save(this.options.state);
    }
    for (const { cell, cellState, attempt, startedAtMs } of prepared) {
      const task = this.execute(cell, cellState, attempt, startedAtMs);
      this.active.set(cell.cellId, task);
    }
  }

  private async execute(
    cell: PlannedExperimentCell,
    cellState: ExperimentCellResult,
    attempt: ExperimentAttempt,
    startedAtMs: number
  ): Promise<SettledAttempt> {
    try {
      const execution = await this.options.executor.execute(cell, {
        experimentId: this.options.store.experimentId,
        attemptId: attempt.attempt_id,
        attemptNumber: attempt.attempt_number,
        signal: this.runtimeAbort.signal,
        reportLifecycle: async (event) => {
          if (
            cellState.attempts[cellState.attempts.length - 1]?.attempt_id !==
            attempt.attempt_id
          ) {
            throw new Error(
              `Lifecycle update does not own the active attempt for ${cell.cellId}`
            );
          }
          attempt.execution_provider = event.executionProvider;
          attempt.remote = {
            ...attempt.remote,
            lifecycle_state: event.lifecycleState,
            updated_at: this.now().toISOString(),
            ...(event.sandboxId === undefined
              ? {}
              : { sandbox_id: event.sandboxId }),
            ...(event.templateId === undefined
              ? {}
              : { template_id: event.templateId }),
            ...(event.templateBuildId === undefined
              ? {}
              : { template_build_id: event.templateBuildId }),
            ...(event.sdkVersion === undefined
              ? {}
              : { sdk_version: event.sdkVersion }),
            ...(event.secureAccess === undefined
              ? {}
              : { secure_access: event.secureAccess }),
            ...(event.resources === undefined
              ? {}
              : { resources: event.resources }),
            ...(event.networkPolicy === undefined
              ? {}
              : { network_policy: event.networkPolicy }),
            ...(event.runnerProtocol === undefined
              ? {}
              : { runner_protocol: event.runnerProtocol }),
            ...(event.artifactProtocol === undefined
              ? {}
              : { artifact_protocol: event.artifactProtocol }),
            ...(event.fixtureSnapshotId === undefined
              ? {}
              : { fixture_snapshot_id: event.fixtureSnapshotId }),
            ...(event.retainedUntil === undefined
              ? {}
              : { retained_until: event.retainedUntil }),
            ...(event.retentionReason === undefined
              ? {}
              : { retention_reason: event.retentionReason }),
            ...(event.sandboxStartedAt === undefined
              ? {}
              : { sandbox_started_at: event.sandboxStartedAt }),
            ...(event.sandboxCompletedAt === undefined
              ? {}
              : { sandbox_completed_at: event.sandboxCompletedAt }),
            ...(event.sandboxRuntimeMs === undefined
              ? {}
              : { sandbox_runtime_ms: event.sandboxRuntimeMs }),
          };
          cellState.sandbox_runtime_ms = cellState.attempts.reduce(
            (total, current) =>
              total + (current.remote?.sandbox_runtime_ms ?? 0),
            0
          );
          this.options.state.updated_at = attempt.remote.updated_at;
          await this.options.store.save(this.options.state);
        },
      });
      return { cell, cellState, attempt, execution };
    } catch (error) {
      return { cell, cellState, attempt, error };
    } finally {
      const completed = this.now();
      attempt.completed_at = completed.toISOString();
      attempt.duration_ms = Math.max(0, completed.getTime() - startedAtMs);
    }
  }

  private async applySettled(
    settled: SettledAttempt,
    budget: ExperimentBudget
  ): Promise<void> {
    const { cellState, attempt } = settled;
    if (settled.execution !== undefined) {
      const status = terminalStatus(settled.execution);
      attempt.status = status;
      cellState.status = status;
      cellState.duration_ms =
        (cellState.duration_ms ?? 0) + (attempt.duration_ms ?? 0);
      if (settled.execution.costUsd !== undefined) {
        cellState.cost_usd =
          (cellState.cost_usd ?? 0) + settled.execution.costUsd;
      }
      if (settled.execution.tokenCount !== undefined) {
        cellState.token_count =
          (cellState.token_count ?? 0) + settled.execution.tokenCount;
      }
      cellState.usage_quality = mergeUsageQuality(
        cellState.usage_quality,
        settled.execution.usageQuality
      );
      cellState.token_quality = mergeUsageQuality(
        cellState.token_quality ?? 'unavailable',
        settled.execution.tokenQuality ?? settled.execution.usageQuality
      );
      cellState.cost_quality = mergeUsageQuality(
        cellState.cost_quality ?? 'unavailable',
        settled.execution.costQuality ?? settled.execution.usageQuality
      );
      if (settled.execution.sandboxRuntimeMs !== undefined) {
        cellState.sandbox_runtime_ms = cellState.attempts.reduce(
          (total, current) => total + (current.remote?.sandbox_runtime_ms ?? 0),
          0
        );
      }
      if (settled.execution.sandboxCostUsd !== undefined) {
        cellState.sandbox_cost_usd =
          (cellState.sandbox_cost_usd ?? 0) + settled.execution.sandboxCostUsd;
      }
      cellState.sandbox_cost_quality =
        settled.execution.sandboxCostQuality ?? 'unavailable';
      budget.addCost(this.options.state, settled.execution.costUsd);
      try {
        const resultPath = await this.options.store.saveAttemptResult(
          settled.cell.cellId,
          attempt.attempt_number,
          sanitizeExperimentResultsBundle(settled.execution.result)
        );
        attempt.result_path = resultPath;
        cellState.result_path = resultPath;

        if (status === 'infrastructure_failed') {
          const reason =
            settled.execution.result.agent.status === 'timeout'
              ? 'timeout'
              : 'infrastructure_failure';
          attempt.terminal_reason = reason;
          cellState.terminal_reason = reason;
          this.queueRetry(cellState, reason);
        }
      } catch (error) {
        settled.error = error;
      }
    }

    if (settled.error !== undefined) {
      const cancelled = this.runtimeAbort.signal.aborted;
      const reason = classifyExecutionError(settled.error);
      attempt.status = cancelled ? 'cancelled' : 'infrastructure_failed';
      attempt.terminal_reason = cancelled ? 'cancelled' : reason;
      cellState.status = attempt.status;
      cellState.terminal_reason = attempt.terminal_reason;
      if (settled.execution === undefined) {
        cellState.duration_ms =
          (cellState.duration_ms ?? 0) + (attempt.duration_ms ?? 0);
      }
      if (!cancelled) {
        if (settled.error instanceof TargetUnavailableError) {
          const diagnostic = `target_unavailable:${settled.error.message}`;
          attempt.terminal_reason = diagnostic;
          cellState.terminal_reason = diagnostic;
          for (const pending of this.options.state.cells) {
            if (
              pending.status === 'pending' &&
              pending.variant_name === settled.cell.variantName
            ) {
              pending.status = 'cancelled';
              pending.terminal_reason = diagnostic;
            }
          }
        } else {
          this.queueRetry(cellState, reason);
        }
      }
    }

    budget.updateDuration(this.options.state, this.now().getTime());
    this.options.state.updated_at = this.now().toISOString();
    await this.options.store.save(this.options.state);
  }

  private queueRetry(
    cellState: ExperimentCellResult,
    reason: RetryReason
  ): void {
    const configured = this.options.retry.on.includes(reason);
    if (
      shouldRetry(
        reason,
        this.options.retry.on,
        cellState.attempts.length,
        this.options.retry.max_attempts
      )
    ) {
      cellState.status = 'pending';
      cellState.result_path = undefined;
      this.retryNotBefore.set(
        cellState.cell_id,
        this.now().getTime() +
          (this.options.retry.jitter === 'full'
            ? Math.floor(this.random() * (this.options.retry.backoff_ms + 1))
            : this.options.retry.backoff_ms)
      );
    } else if (
      configured &&
      cellState.attempts.length >= this.options.retry.max_attempts
    ) {
      cellState.terminal_reason = `retry_exhausted:${reason}`;
      const attempt = cellState.attempts[cellState.attempts.length - 1];
      if (attempt !== undefined) {
        attempt.terminal_reason = cellState.terminal_reason;
      }
    }
  }

  private async drainActive(
    budget: ExperimentBudget,
    persistSettled: boolean
  ): Promise<void> {
    const remaining = await Promise.all(this.active.values());
    this.active.clear();
    if (!persistSettled) {
      return;
    }
    for (const settled of remaining) {
      await this.applySettled(settled, budget);
    }
  }

  private nextRetryDelay(): number | undefined {
    const nowMs = this.now().getTime();
    const waits = this.options.state.cells
      .filter((cell) => cell.status === 'pending')
      .map((cell) =>
        Math.max(0, (this.retryNotBefore.get(cell.cell_id) ?? nowMs) - nowMs)
      );
    return waits.length === 0 ? undefined : Math.min(...waits);
  }

  private async cancelPending(
    state: ExperimentState,
    budget: ExperimentBudget
  ): Promise<void> {
    for (const cell of state.cells) {
      if (cell.status === 'pending') {
        cell.status = 'cancelled';
        cell.terminal_reason = state.budget.stop_reason ?? 'cancelled';
      }
    }
    budget.updateDuration(state, this.now().getTime());
    state.updated_at = this.now().toISOString();
    await this.options.store.save(state);
  }
}
