import * as path from 'path';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import {
  createRegressionE2BExecutor,
  loadRegressionSuite,
  planRegressionSuite,
  validateRegressionE2BPlan,
  type LoadedRegressionSuite,
  type RegressionPlan,
} from '../../src/regression/index.js';
import type {
  InterruptedExecutionContext,
  SingleRunExecutor,
} from '../../src/experiments/index.js';
import type { E2BClient } from '../../src/e2b/index.js';

const exampleSuite = path.resolve('examples/regression/suite-e2b.yaml');

async function fixture(): Promise<{
  suite: LoadedRegressionSuite;
  plan: RegressionPlan;
}> {
  const suite = await loadRegressionSuite(exampleSuite, { ...defaultConfig });
  const plan = planRegressionSuite(suite, { profile: 'smoke' });
  return { suite, plan };
}

function cloned<T>(value: T): T {
  return structuredClone(value);
}

const fakeClient = {} as E2BClient;

describe('regression E2B factory residual coverage', () => {
  it('returns no validation mapping for host execution and rejects host creation', async () => {
    const { suite, plan } = await fixture();
    const hostPlan = cloned(plan);
    hostPlan.selection.provider = 'host-trusted';
    expect(validateRegressionE2BPlan(suite, hostPlan)).toEqual([]);
    expect(() =>
      createRegressionE2BExecutor(suite, hostPlan, {
        cwd: process.cwd(),
        client: fakeClient,
      })
    ).toThrow('not configured for E2B');

    const hostSuite = cloned(suite);
    hostSuite.definition.execution.provider = {
      type: 'host-trusted',
    };
    expect(validateRegressionE2BPlan(hostSuite, plan)).toEqual([]);
  });

  it('validates immutable template, resources, capability, and cache requirements', async () => {
    const { suite, plan } = await fixture();
    expect(validateRegressionE2BPlan(suite, plan)).toEqual([
      expect.objectContaining({
        targetId: 'candidate',
        templateRef: 'replace-with-template',
        expectedBuildId: 'replace-with-immutable-build',
        expectedResources: { cpu_count: 2, memory_mb: 4096 },
        network: expect.objectContaining({ outbound: 'allowlist' }),
      }),
    ]);

    const snapshot = cloned(suite);
    snapshot.definition.execution.provider.fixture_cache.mode = 'snapshot';
    expect(() => validateRegressionE2BPlan(snapshot, plan)).toThrow(
      'fixture_cache.mode=snapshot'
    );

    const missingTargetPlan = cloned(plan);
    missingTargetPlan.cells[0].variantName = 'missing';
    expect(() => validateRegressionE2BPlan(suite, missingTargetPlan)).toThrow(
      'Selected target missing is missing'
    );

    const missingTemplate = cloned(suite);
    missingTemplate.definition.targets[0].harness.e2b_template = undefined;
    expect(() => validateRegressionE2BPlan(missingTemplate, plan)).toThrow(
      'must declare harness.e2b_template'
    );

    const missingResources = cloned(suite);
    const template =
      missingResources.definition.targets[0].harness.e2b_template;
    if (template !== undefined) template.expected_resources = undefined;
    expect(() => validateRegressionE2BPlan(missingResources, plan)).toThrow(
      'expected E2B CPU'
    );

    const missingBuild = cloned(suite);
    const buildTemplate =
      missingBuild.definition.targets[0].harness.e2b_template;
    if (buildTemplate !== undefined)
      buildTemplate.expected_build_id = undefined;
    expect(() => validateRegressionE2BPlan(missingBuild, plan)).toThrow(
      'pin expected_build_id'
    );

    const missingTask = cloned(suite);
    missingTask.tasks = [];
    expect(() => validateRegressionE2BPlan(missingTask, plan)).toThrow(
      'Loaded task fix-auth is missing'
    );
  });

  it('maps all network policies, optional builds, retention, and secret phases', async () => {
    const { suite, plan } = await fixture();
    const permissive = cloned(suite);
    permissive.definition.execution.provider.strict_reproducibility = false;
    permissive.definition.execution.provider.network_defaults.outbound =
      'unrestricted';
    permissive.definition.execution.provider.lifecycle = {
      on_timeout: 'kill',
      retain_on: 'failure',
      retention_reason: 'debug',
      retention_max_minutes: 5,
    };
    const target = permissive.definition.targets[0];
    target.runtime.network = {
      inbound: 'none',
      outbound: 'unrestricted',
      explicit_opt_in: true,
    };
    const template = target.harness.e2b_template;
    if (template !== undefined) template.expected_build_id = undefined;
    permissive.definition.execution.secrets.push({
      id: 'all-components',
      source: { env: 'ALL_SECRET' },
      expose_as: { env: 'ALL_SECRET' },
      targets: ['candidate'],
      phases: ['prepare', 'evaluate', 'post_evaluate', 'package'],
    });
    expect(validateRegressionE2BPlan(permissive, plan)[0]).not.toHaveProperty(
      'expectedBuildId'
    );
    expect(() =>
      createRegressionE2BExecutor(permissive, plan, {
        cwd: process.cwd(),
        client: fakeClient,
        owner: '***',
        project: '***',
      })
    ).not.toThrow();

    const closed = cloned(suite);
    closed.definition.targets[0].runtime.network = {
      inbound: 'none',
      outbound: 'none',
    };
    expect(validateRegressionE2BPlan(closed, plan)[0].network.outbound).toBe(
      'allowlist'
    );

    const allowlistDefault = cloned(suite);
    allowlistDefault.definition.execution.provider.network_defaults.outbound =
      'allowlist';
    expect(
      validateRegressionE2BPlan(allowlistDefault, plan)[0].network.outbound
    ).toBe('allowlist');
  });

  it('derives judge capabilities from declared and configured harness types', async () => {
    const names = [
      'agentic-judge',
      'agentic-judge-specialized',
      'agentic-judge:custom',
    ];
    for (const [index, name] of names.entries()) {
      const { suite, plan } = await fixture();
      suite.tasks[0].definition.evaluators = [
        {
          name,
          config: index === 1 ? { type: 'claude-code' } : {},
          harness: {
            exact_version: '9.9.9',
            ...(index === 0 ? { type: 'copilot-cli' as const } : {}),
          },
        },
      ];
      plan.cells[0].config.evaluators = [
        {
          name,
          config: index === 1 ? { type: 'claude-code' } : {},
        },
      ];
      expect(
        validateRegressionE2BPlan(suite, plan)[0].requiredCapabilities
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            component: 'evaluator-1',
            type:
              index === 0
                ? 'copilot-cli'
                : index === 1
                  ? 'claude-code'
                  : 'codex-cli',
            version: '9.9.9',
          }),
        ])
      );
    }

    const { suite, plan } = await fixture();
    suite.tasks[0].definition.evaluators = [
      { name: 'agentic-judge', config: {} },
    ];
    plan.cells[0].config.evaluators = [{ name: 'agentic-judge', config: {} }];
    expect(() => validateRegressionE2BPlan(suite, plan)).toThrow(
      'must declare an exact judge harness version'
    );
  });

  it('requires a control-plane key only when a client is not injected', async () => {
    const { suite, plan } = await fixture();
    expect(() =>
      createRegressionE2BExecutor(suite, plan, {
        cwd: process.cwd(),
        environment: {},
      })
    ).toThrow('E2B_API_KEY is required');
    expect(() =>
      createRegressionE2BExecutor(suite, plan, {
        cwd: process.cwd(),
        environment: { E2B_API_KEY: '' },
      })
    ).toThrow('E2B_API_KEY is required');
    expect(() =>
      createRegressionE2BExecutor(suite, plan, {
        cwd: process.cwd(),
        environment: { E2B_API_KEY: 'test-key' },
      })
    ).not.toThrow();
    expect(() =>
      createRegressionE2BExecutor(suite, plan, {
        cwd: process.cwd(),
        client: fakeClient,
        environment: {
          YOUBENCHA_E2B_OWNER: 'owner',
          YOUBENCHA_E2B_PROJECT: 'project',
        },
      })
    ).not.toThrow();
  });

  it('routes execution and interrupted reconciliation by target', async () => {
    const { suite, plan } = await fixture();
    const router = createRegressionE2BExecutor(suite, plan, {
      cwd: process.cwd(),
      client: fakeClient,
    });
    const internals = router as unknown as {
      executors: Map<string, SingleRunExecutor>;
    };
    const original = internals.executors.get('candidate') as unknown as {
      options: {
        resolveCellPolicy: (cell: (typeof plan.cells)[number]) => unknown;
      };
    };
    expect(original.options.resolveCellPolicy(plan.cells[0])).toMatchObject({
      requiredCapabilities: expect.any(Array),
      networkRequirements: expect.any(Array),
      secretReferences: expect.any(Array),
    });
    const result = { result: {}, resultPath: 'result.json' } as never;
    const execute = jest.fn().mockResolvedValue(result);
    const reconcile = jest.fn().mockResolvedValue(undefined);
    internals.executors.set('candidate', {
      execute,
      reconcileInterrupted: reconcile,
    });
    await expect(
      router.execute(plan.cells[0], {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
      })
    ).resolves.toBe(result);
    const interrupted: InterruptedExecutionContext = {
      experimentId: 'experiment',
      cellId: plan.cells[0].cellId,
      targetId: 'candidate',
      attemptId: 'attempt',
    };
    await expect(
      router.reconcileInterrupted?.(interrupted)
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);

    internals.executors.delete('candidate');
    expect(() =>
      router.execute(plan.cells[0], {
        experimentId: 'experiment',
        attemptId: 'attempt',
        attemptNumber: 1,
      })
    ).toThrow('No E2B executor');
    expect(() => router.reconcileInterrupted?.(interrupted)).toThrow(
      'cannot reconcile'
    );

    internals.executors.set('candidate', { execute });
    expect(() => router.reconcileInterrupted?.(interrupted)).toThrow(
      'cannot reconcile'
    );
  });
});
