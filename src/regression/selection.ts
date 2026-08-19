import type {
  RegressionProfile,
  RegressionSuiteDefinition,
} from '../schemas/suite-v2.schema.js';
import { stableHash } from '../experiments/identity.js';
import type { LoadedRegressionSuite } from './suite-loader.js';

export type ExecutionProviderName = 'host-trusted' | 'e2b';

export interface RegressionSelectionOptions {
  profile?: string;
  caseIds?: readonly string[];
  targetIds?: readonly string[];
  repetitions?: number;
  provider?: ExecutionProviderName;
}

export interface EffectiveRegressionSelection {
  profile?: string;
  taskIds: string[];
  targetIds: string[];
  repetitions: number;
  comparisonIds: string[];
  ruleIds: string[];
  provider: ExecutionProviderName;
  selectionHash: string;
  effectiveDefinitionHash: string;
}

function orderedSelection(
  declared: readonly string[],
  requested: readonly string[],
  label: string
): string[] {
  const unique = new Set(requested);
  const unknown = [...unique].filter((id) => !declared.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown ${label}${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`
    );
  }
  return declared.filter((id) => unique.has(id));
}

function profileTaskIds(
  profile: RegressionProfile,
  allTaskIds: readonly string[]
): string[] {
  return profile.tasks === '*' ? [...allTaskIds] : [...profile.tasks];
}

function assertNarrowing(
  requested: readonly string[] | undefined,
  profileIds: readonly string[],
  label: string
): void {
  if (requested === undefined) return;
  const profileSet = new Set(profileIds);
  const broadening = requested.filter((id) => !profileSet.has(id));
  if (broadening.length > 0) {
    throw new Error(
      `${label} filter would broaden profile selection: ${broadening.join(', ')}`
    );
  }
}

function assertComparisonTargetsSelected(
  definition: RegressionSuiteDefinition,
  selection: Pick<EffectiveRegressionSelection, 'comparisonIds' | 'targetIds'>
): void {
  const selectedTargets = new Set(selection.targetIds);
  for (const comparison of definition.regression.comparisons) {
    if (!selection.comparisonIds.includes(comparison.id)) continue;
    if (!selectedTargets.has(comparison.candidate_target)) {
      throw new Error(
        `Comparison "${comparison.id}" requires selected candidate target "${comparison.candidate_target}"`
      );
    }
    if (
      comparison.baseline.source === 'current_run' &&
      !selectedTargets.has(comparison.baseline.target)
    ) {
      throw new Error(
        `Current-run comparison "${comparison.id}" requires selected baseline target "${comparison.baseline.target}"`
      );
    }
  }
}

export function resolveRegressionSelection(
  suite: LoadedRegressionSuite,
  options: RegressionSelectionOptions = {}
): EffectiveRegressionSelection {
  const allTaskIds = suite.definition.suite.tasks.map((task) => task.id);
  const allTargetIds = suite.definition.targets.map((target) => target.id);
  const profile =
    options.profile === undefined
      ? undefined
      : suite.definition.profiles[options.profile];
  if (options.profile !== undefined && profile === undefined) {
    throw new Error(`Unknown regression profile "${options.profile}"`);
  }

  const profileTasks = profile
    ? profileTaskIds(profile, allTaskIds)
    : allTaskIds;
  const profileTargets = profile
    ? [...profile.targets]
    : suite.definition.regression.default_candidate_target
      ? [suite.definition.regression.default_candidate_target]
      : undefined;
  if (profileTargets === undefined && options.targetIds === undefined) {
    throw new Error(
      'At least one target must be selected or regression.default_candidate_target must be configured'
    );
  }

  assertNarrowing(options.caseIds, profileTasks, 'Case');
  if (profile) {
    assertNarrowing(options.targetIds, profileTargets!, 'Target');
  }
  const taskIds = orderedSelection(
    allTaskIds,
    options.caseIds ?? profileTasks,
    'case'
  );
  const targetIds = orderedSelection(
    allTargetIds,
    options.targetIds ?? profileTargets!,
    'target'
  );
  if (taskIds.length === 0) throw new Error('Case selection is empty');
  if (targetIds.length === 0) throw new Error('Target selection is empty');

  const repetitions =
    options.repetitions ??
    profile?.repetitions ??
    suite.definition.suite.repetitions;
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error('Repetitions must be a positive integer');
  }
  const selectedTargetSet = new Set(targetIds);
  const comparisonIds =
    profile?.comparisons ??
    suite.definition.regression.comparisons
      .filter(
        (comparison) =>
          selectedTargetSet.has(comparison.candidate_target) &&
          (comparison.baseline.source !== 'current_run' ||
            selectedTargetSet.has(comparison.baseline.target))
      )
      .map((comparison) => comparison.id);
  const selectedComparisonSet = new Set(comparisonIds);
  const ruleIds =
    profile?.rules ??
    suite.definition.regression.rules
      .filter(
        (rule) =>
          rule.comparisons === undefined ||
          rule.comparisons.some((comparison) =>
            selectedComparisonSet.has(comparison)
          )
      )
      .map((rule) => rule.id);
  const provider = options.provider ?? suite.definition.execution.provider.type;
  const normalized = {
    profile: options.profile,
    task_ids: taskIds,
    target_ids: targetIds,
    repetitions,
    comparison_ids: comparisonIds,
    rule_ids: ruleIds,
    provider,
  };
  const selectionHash = stableHash(normalized);
  const selection: EffectiveRegressionSelection = {
    profile: options.profile,
    taskIds,
    targetIds,
    repetitions,
    comparisonIds: [...comparisonIds],
    ruleIds: [...ruleIds],
    provider,
    selectionHash,
    effectiveDefinitionHash: stableHash({
      suite_definition_hash: suite.definitionHash,
      selection: normalized,
    }),
  };
  assertComparisonTargetsSelected(suite.definition, selection);
  return selection;
}
