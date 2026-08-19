import * as path from 'path';
import {
  E2BSdkClient,
  E2BSingleRunExecutor,
  resolveEffectiveNetworkPolicy,
  type E2BClient,
  type E2BExecutorCellPolicy,
  type E2BNetworkPolicy,
  type E2BProviderConfig,
  type E2BRequiredHarnessCapability,
  type E2BSecretReference,
} from '../e2b/index.js';
import {
  TokenBucket,
  type InterruptedExecutionContext,
  type PlannedExperimentCell,
  type SingleRunExecutionContext,
  type SingleRunExecutionResult,
  type SingleRunExecutor,
} from '../experiments/index.js';
import { resolveEvaluatorConfigs } from '../lib/evaluator-loader.js';
import type { RegressionTarget } from '../schemas/suite-v2.schema.js';
import type { LoadedRegressionSuite } from './suite-loader.js';
import type { RegressionPlan } from './suite-planner.js';

export interface CreateRegressionE2BExecutorOptions {
  cwd: string;
  client?: E2BClient;
  owner?: string;
  project?: string;
  environment?: NodeJS.ProcessEnv;
  onWarning?: (message: string) => void;
}

export interface RegressionE2BCellPlan {
  cellId: string;
  caseId: string;
  targetId: string;
  templateRef: string;
  expectedBuildId?: string;
  expectedResources: { cpu_count: number; memory_mb: number };
  network: E2BNetworkPolicy;
  requiredCapabilities: E2BRequiredHarnessCapability[];
}

class TargetRoutingExecutor implements SingleRunExecutor {
  public constructor(
    private readonly executors: ReadonlyMap<string, SingleRunExecutor>
  ) {}

  public execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult> {
    const executor = this.executors.get(cell.variantName);
    if (executor === undefined) {
      throw new Error(`No E2B executor is configured for ${cell.variantName}`);
    }
    return executor.execute(cell, context);
  }

  public reconcileInterrupted(
    context: InterruptedExecutionContext
  ): Promise<void> {
    const executor = this.executors.get(context.targetId);
    if (executor?.reconcileInterrupted === undefined) {
      throw new Error(
        `E2B executor for ${context.targetId} cannot reconcile an interrupted attempt`
      );
    }
    return executor.reconcileInterrupted(context);
  }
}

function metadataIdentifier(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 128);
  return normalized === '' ? fallback : normalized;
}

function targetNetwork(target: RegressionTarget): E2BNetworkPolicy {
  const network = target.runtime.network;
  if (network.outbound === 'allowlist') {
    return { inbound: 'none', outbound: 'allowlist', allow: network.allow };
  }
  if (network.outbound === 'unrestricted') {
    return {
      inbound: 'none',
      outbound: 'unrestricted',
      explicit_opt_in: true,
    };
  }
  return { inbound: 'none', outbound: 'none' };
}

function sourceNetwork(repo: string): E2BNetworkPolicy {
  const hostname = new URL(repo).hostname;
  return {
    inbound: 'none',
    outbound: 'allowlist',
    allow: [hostname],
  };
}

function providerDefaultNetwork(
  suite: LoadedRegressionSuite
): E2BNetworkPolicy {
  const provider = suite.definition.execution.provider as Extract<
    LoadedRegressionSuite['definition']['execution']['provider'],
    { type: 'e2b' }
  >;
  if (provider.network_defaults.outbound === 'none') {
    return { inbound: 'none', outbound: 'none' };
  }
  if (provider.network_defaults.outbound === 'unrestricted') {
    return {
      inbound: 'none',
      outbound: 'unrestricted',
      explicit_opt_in: true,
    };
  }
  // Allowlist entries are target/task specific; the default selects the mode
  // while those scopes contribute the actual hosts.
  return { inbound: 'none', outbound: 'none' };
}

function secretReferences(suite: LoadedRegressionSuite): E2BSecretReference[] {
  return suite.definition.execution.secrets.map((secret) => ({
    id: secret.id,
    source: { type: 'environment', name: secret.source.env },
    inject_as: secret.expose_as.env,
    targets: secret.targets,
    components: secret.components ?? [
      'source',
      'agent',
      'evaluator',
      'post_evaluation',
    ],
    phases: secret.phases.map((phase) =>
      phase === 'post_evaluate' ? 'post-evaluate' : phase
    ),
  }));
}

function isAgenticJudge(name: string): boolean {
  return (
    name === 'agentic-judge' ||
    name.startsWith('agentic-judge-') ||
    name.startsWith('agentic-judge:')
  );
}

function capabilitiesForCell(
  suite: LoadedRegressionSuite,
  target: RegressionTarget,
  cell: PlannedExperimentCell
): E2BRequiredHarnessCapability[] {
  const capabilities: E2BRequiredHarnessCapability[] = [
    {
      component: 'agent',
      type: target.agent.type,
      version: target.harness.exact_version,
      adapter_schema_version: '1.0.0',
    },
  ];
  const task = suite.tasks.find(
    (candidate) => candidate.id === cell.testcaseId
  );
  if (task === undefined) {
    throw new Error(`Loaded task ${cell.testcaseId} is missing`);
  }
  const resolved = resolveEvaluatorConfigs(
    cell.config.evaluators,
    path.dirname(task.resolvedFile)
  );
  for (const [index, evaluator] of resolved.entries()) {
    if (!isAgenticJudge(evaluator.name)) continue;
    const declared = task.definition.evaluators[index];
    const harness = declared?.harness;
    if (harness === undefined) {
      throw new Error(
        `Task ${task.id} evaluator ${evaluator.name} must declare an exact judge harness version for E2B`
      );
    }
    const configuredType = evaluator.config?.type;
    const type =
      harness.type ??
      (typeof configuredType === 'string' ? configuredType : target.agent.type);
    capabilities.push({
      component: `evaluator-${index + 1}`,
      type,
      version: harness.exact_version,
      adapter_schema_version: '1.0.0',
    });
  }
  return capabilities;
}

function providerForTarget(
  suite: LoadedRegressionSuite,
  target: RegressionTarget
): E2BProviderConfig {
  const execution = suite.definition.execution.provider as Extract<
    LoadedRegressionSuite['definition']['execution']['provider'],
    { type: 'e2b' }
  >;
  const template = target.harness.e2b_template;
  if (template === undefined) {
    throw new Error(
      `Target ${target.id} must declare harness.e2b_template for E2B execution`
    );
  }
  const resources = template.expected_resources;
  if (resources === undefined) {
    throw new Error(
      `Target ${target.id} must declare expected E2B CPU and memory resources`
    );
  }
  if (
    execution.strict_reproducibility &&
    template.expected_build_id === undefined
  ) {
    throw new Error(
      `Target ${target.id} must pin expected_build_id in strict reproducibility mode`
    );
  }
  const phases = {
    prepare: 10 * 60_000,
    agent: execution.timeout_ms,
    evaluate: 10 * 60_000,
    post_evaluate: 5 * 60_000,
    package: 2 * 60_000,
  };
  const phaseTotal = Object.values(phases).reduce(
    (total, value) => total + value,
    0
  );
  const sandboxTtl = phaseTotal + execution.collection_grace_ms;
  return {
    provider: 'e2b',
    template: {
      template_id: template.ref,
      ...(template.expected_build_id === undefined
        ? {}
        : { build_id: template.expected_build_id }),
    },
    strict_reproducibility: execution.strict_reproducibility,
    secure_access: true,
    network: targetNetwork(target),
    expected_resources: {
      cpu_count: resources.cpu,
      memory_mb: resources.memory_mb,
    },
    deadlines: {
      phases_ms: phases,
      collection_grace_ms: execution.collection_grace_ms,
      cleanup_grace_ms: 60_000,
      sandbox_ttl_ms: sandboxTtl,
      watchdog_ms: sandboxTtl + 60_000,
    },
    artifact_limits: {
      max_files: 1_000,
      max_file_bytes: 10 * 1024 * 1024,
      max_compressed_bytes: 100 * 1024 * 1024,
      max_uncompressed_bytes: 250 * 1024 * 1024,
    },
    runtime_package_installation: false,
    retention:
      execution.lifecycle.retain_on === 'failure'
        ? {
            mode: 'pause-on-failure',
            reason: execution.lifecycle.retention_reason as string,
            max_retention_ms:
              (execution.lifecycle.retention_max_minutes as number) * 60_000,
          }
        : { mode: 'kill' },
  };
}

/**
 * Performs every E2B check available without creating a sandbox and returns
 * the cell-to-template/security mapping shown by `yb regress --plan`.
 */
export function validateRegressionE2BPlan(
  suite: LoadedRegressionSuite,
  plan: RegressionPlan
): RegressionE2BCellPlan[] {
  if (
    plan.selection.provider !== 'e2b' ||
    suite.definition.execution.provider.type !== 'e2b'
  ) {
    return [];
  }
  if (suite.definition.execution.provider.fixture_cache.mode === 'snapshot') {
    throw new Error(
      'fixture_cache.mode=snapshot is not available in this release; use mode=none so every attempt starts from the declared immutable template'
    );
  }
  return plan.cells.map((cell) => {
    const target = suite.definition.targets.find(
      (candidate) => candidate.id === cell.variantName
    );
    if (target === undefined) {
      throw new Error(`Selected target ${cell.variantName} is missing`);
    }
    const provider = providerForTarget(suite, target);
    const requiredCapabilities = capabilitiesForCell(suite, target, cell);
    return {
      cellId: cell.cellId,
      caseId: cell.testcaseId,
      targetId: target.id,
      templateRef: provider.template.template_id,
      ...(provider.template.build_id === undefined
        ? {}
        : { expectedBuildId: provider.template.build_id }),
      expectedResources: provider.expected_resources,
      network: resolveEffectiveNetworkPolicy(
        [
          provider.network,
          providerDefaultNetwork(suite),
          sourceNetwork(cell.config.repo),
        ],
        provider.strict_reproducibility
      ),
      requiredCapabilities,
    };
  });
}

export function createRegressionE2BExecutor(
  suite: LoadedRegressionSuite,
  plan: RegressionPlan,
  options: CreateRegressionE2BExecutorOptions
): SingleRunExecutor {
  if (
    plan.selection.provider !== 'e2b' ||
    suite.definition.execution.provider.type !== 'e2b'
  ) {
    throw new Error('The effective regression plan is not configured for E2B');
  }
  validateRegressionE2BPlan(suite, plan);
  const apiKey = options.environment?.E2B_API_KEY ?? process.env.E2B_API_KEY;
  if (options.client === undefined && (apiKey === undefined || apiKey === '')) {
    throw new Error(
      'E2B_API_KEY is required in the local control-plane environment'
    );
  }
  const client =
    options.client ??
    new E2BSdkClient({
      apiKey,
    });
  const creationLimiter = new TokenBucket({
    tokensPerSecond: suite.definition.execution.max_creations_per_second,
  });
  const secrets = secretReferences(suite);
  const selectedTargets = suite.definition.targets.filter((target) =>
    plan.selection.targetIds.includes(target.id)
  );
  const executors = new Map<string, SingleRunExecutor>();
  for (const target of selectedTargets) {
    const provider = providerForTarget(suite, target);
    executors.set(
      target.id,
      new E2BSingleRunExecutor({
        client,
        provider,
        owner: metadataIdentifier(
          options.owner ??
            options.environment?.YOUBENCHA_E2B_OWNER ??
            'youbencha',
          'youbencha'
        ),
        project: metadataIdentifier(
          options.project ??
            options.environment?.YOUBENCHA_E2B_PROJECT ??
            path.basename(path.resolve(options.cwd)),
          'project'
        ),
        artifactsDirectory: path.join(
          path.resolve(options.cwd),
          'results',
          'e2b-artifacts'
        ),
        creationLimiter,
        environment: options.environment,
        resolveCellPolicy: (cell): E2BExecutorCellPolicy => ({
          requiredCapabilities: capabilitiesForCell(suite, target, cell),
          networkRequirements: [
            provider.network,
            providerDefaultNetwork(suite),
            sourceNetwork(cell.config.repo),
          ],
          secretReferences: secrets,
        }),
        onWarning: options.onWarning,
      })
    );
  }
  return new TargetRoutingExecutor(executors);
}
