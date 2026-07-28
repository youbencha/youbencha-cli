import type { ExperimentPlan } from './planner.js';
import type { ExperimentState } from '../schemas/experiment-result.schema.js';

export type BudgetStopReason = 'duration' | 'cost' | 'sandbox_runtime';

export class ExperimentBudget {
  public constructor(
    private readonly configured: ExperimentPlan['budget'],
    private readonly startedAtMs: number,
    private readonly previouslyUsedMs = 0,
    private readonly previouslyUsedCostUsd = 0,
    private readonly previouslyUsedSandboxRuntimeMs = 0
  ) {}

  public updateDuration(state: ExperimentState, nowMs: number): void {
    state.budget.duration_ms_used =
      this.previouslyUsedMs + Math.max(0, nowMs - this.startedAtMs);
    state.budget.sandbox_runtime_ms_used = state.cells.reduce(
      (total, cell) =>
        total +
        cell.attempts.reduce((attemptTotal, attempt) => {
          const remote = attempt.remote;
          if (remote?.sandbox_started_at === undefined) return attemptTotal;
          const started = Date.parse(remote.sandbox_started_at);
          const completed =
            remote.sandbox_completed_at === undefined
              ? nowMs
              : Date.parse(remote.sandbox_completed_at);
          if (!Number.isFinite(started) || !Number.isFinite(completed)) {
            return attemptTotal;
          }
          return attemptTotal + Math.max(0, completed - started);
        }, 0),
      0
    );
  }

  public addCost(state: ExperimentState, costUsd: number | undefined): void {
    if (costUsd !== undefined) {
      state.budget.cost_usd_used += costUsd;
    }
  }

  public stopReason(
    state: ExperimentState,
    nowMs: number
  ): BudgetStopReason | undefined {
    this.updateDuration(state, nowMs);
    if (
      this.configured?.max_duration_minutes !== undefined &&
      state.budget.duration_ms_used - this.previouslyUsedMs >=
        this.configured.max_duration_minutes * 60_000
    ) {
      return 'duration';
    }
    if (
      this.configured?.max_cost_usd !== undefined &&
      state.budget.cost_usd_used - this.previouslyUsedCostUsd >=
        this.configured.max_cost_usd
    ) {
      return 'cost';
    }
    if (
      this.configured?.max_sandbox_runtime_minutes !== undefined &&
      state.budget.sandbox_runtime_ms_used -
        this.previouslyUsedSandboxRuntimeMs >=
        this.configured.max_sandbox_runtime_minutes * 60_000
    ) {
      return 'sandbox_runtime';
    }
    return undefined;
  }
}
