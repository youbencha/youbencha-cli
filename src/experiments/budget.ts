import type { ExperimentPlan } from './planner.js';
import type { ExperimentState } from '../schemas/experiment-result.schema.js';

export type BudgetStopReason = 'duration' | 'cost';

export class ExperimentBudget {
  public constructor(
    private readonly configured: ExperimentPlan['budget'],
    private readonly startedAtMs: number,
    private readonly previouslyUsedMs = 0,
    private readonly previouslyUsedCostUsd = 0
  ) {}

  public updateDuration(state: ExperimentState, nowMs: number): void {
    state.budget.duration_ms_used =
      this.previouslyUsedMs + Math.max(0, nowMs - this.startedAtMs);
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
    return undefined;
  }
}
