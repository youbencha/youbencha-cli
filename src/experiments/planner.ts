import type { LoadedExperiment } from './loader.js';
import { resolveVariantTestCaseConfig } from './loader.js';
import { identitySafeValue, stableHash } from './identity.js';
import type { PlannedExperimentCell } from './single-run-executor.js';

export interface ExperimentPlan {
  definitionHash: string;
  cellCount: number;
  maxConcurrent: number;
  budget:
    | (NonNullable<LoadedExperiment['definition']['budget']> & {
        max_sandbox_runtime_minutes?: number;
      })
    | undefined;
  redactedEffectiveConfiguration: unknown;
  cells: PlannedExperimentCell[];
}

export function planExperiment(experiment: LoadedExperiment): ExperimentPlan {
  const cells: PlannedExperimentCell[] = [];

  for (const testcase of experiment.testcases) {
    for (const variant of experiment.definition.variants) {
      const config = resolveVariantTestCaseConfig(testcase.config, variant);
      const variantIdentity = identitySafeValue(variant.agent);
      for (
        let repetition = 0;
        repetition < experiment.definition.repetitions;
        repetition += 1
      ) {
        const cellId = stableHash({
          experiment_version: experiment.definition.version,
          definition_hash: experiment.definitionHash,
          testcase_id: testcase.id,
          testcase_config_hash: testcase.configHash,
          variant_name: variant.name,
          variant_overrides: variantIdentity,
          repetition,
        });
        cells.push({
          cellId,
          testcaseId: testcase.id,
          variantName: variant.name,
          repetition,
          configHash: testcase.configHash,
          config,
        });
      }
    }
  }

  return {
    definitionHash: experiment.definitionHash,
    cellCount: cells.length,
    maxConcurrent: experiment.definition.execution.max_concurrent,
    budget: experiment.definition.budget,
    redactedEffectiveConfiguration: experiment.redactedEffectiveConfiguration,
    cells,
  };
}
