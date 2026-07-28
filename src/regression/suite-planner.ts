import type { ExperimentPlan } from '../experiments/planner.js';
import { identitySafeValue, stableHash } from '../experiments/identity.js';
import type { PlannedExperimentCell } from '../experiments/single-run-executor.js';
import { compileRegressionTask } from './task-compiler.js';
import {
  resolveRegressionSelection,
  type EffectiveRegressionSelection,
  type RegressionSelectionOptions,
} from './selection.js';
import type { LoadedRegressionSuite } from './suite-loader.js';

export interface RegressionPlan extends ExperimentPlan {
  suiteDefinitionHash: string;
  selection: EffectiveRegressionSelection;
}

function roundRobin<T>(queues: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  for (let index = 0; index < longest; index += 1) {
    for (const queue of queues) {
      const item = queue[index];
      if (item !== undefined) result.push(item);
    }
  }
  return result;
}

export function planRegressionSuite(
  suite: LoadedRegressionSuite,
  options: RegressionSelectionOptions = {}
): RegressionPlan {
  const selection = resolveRegressionSelection(suite, options);
  const tasks = selection.taskIds.map((id) => {
    const task = suite.tasks.find((candidate) => candidate.id === id);
    if (task === undefined) throw new Error(`Loaded task "${id}" is missing`);
    return task;
  });
  const targets = selection.targetIds.map((id) => {
    const target = suite.definition.targets.find(
      (candidate) => candidate.id === id
    );
    if (target === undefined) throw new Error(`Target "${id}" is missing`);
    return target;
  });

  const targetQueues = targets.map((target) => {
    const cells: PlannedExperimentCell[] = [];
    for (const task of tasks) {
      const compiled = compileRegressionTask(task, target, suite.globalConfig);
      for (
        let repetition = 0;
        repetition < selection.repetitions;
        repetition += 1
      ) {
        const cellId = stableHash({
          experiment_version: 2,
          definition_hash: selection.effectiveDefinitionHash,
          task_id: task.id,
          task_definition_hash: task.definitionHash,
          target_id: target.id,
          target: identitySafeValue(target),
          compiled_config_hash: compiled.configHash,
          repetition,
        });
        cells.push({
          cellId,
          testcaseId: task.id,
          variantName: target.id,
          repetition,
          configHash: compiled.configHash,
          config: compiled.config,
        });
      }
    }
    return cells;
  });
  const cells = roundRobin(targetQueues);
  const budget =
    suite.definition.budget === undefined
      ? undefined
      : {
          max_duration_minutes: suite.definition.budget.max_duration_minutes,
          max_cost_usd: suite.definition.budget.max_model_cost_usd,
          max_sandbox_runtime_minutes:
            suite.definition.budget.max_sandbox_runtime_minutes,
        };

  return {
    definitionHash: selection.effectiveDefinitionHash,
    suiteDefinitionHash: suite.definitionHash,
    cellCount: cells.length,
    maxConcurrent: suite.definition.execution.max_concurrent,
    budget:
      budget?.max_duration_minutes === undefined &&
      budget?.max_cost_usd === undefined &&
      budget?.max_sandbox_runtime_minutes === undefined
        ? undefined
        : budget,
    redactedEffectiveConfiguration: {
      suite: suite.redactedEffectiveConfiguration,
      selection: identitySafeValue(selection),
    },
    cells,
    selection,
  };
}
