import * as schemas from '../../src/schemas/index.js';
import * as agentSchemas from '../../src/schemas/agent-config/index.js';
import { baselineChannelAuditSchema } from '../../src/schemas/baseline-channel.schema.js';
import {
  agenticJudgeEvaluatorConfigSchema,
  parseEvaluatorConfig,
  resolveAgenticJudgeAdapterType,
} from '../../src/schemas/evaluator-config.schema.js';
import { evaluatorDefinitionSchema } from '../../src/schemas/evaluator-definition.schema.js';
import {
  experimentAggregateSchema,
  experimentAttemptSchema,
} from '../../src/schemas/experiment-result.schema.js';
import { experimentDefinitionSchema } from '../../src/schemas/experiment.schema.js';
import {
  regressionRuleSchema,
  regressionSuiteDefinitionSchema,
  regressionTargetSchema,
  regressionTaskDefinitionSchema,
  suiteV2EvaluatorSchema,
  suiteV2SecretSchema,
} from '../../src/schemas/suite-v2.schema.js';
import { suiteConfigSchema } from '../../src/schemas/suite.schema.js';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema.js';

const digest = 'a'.repeat(64);
const timestamp = '2026-07-29T00:00:00.000Z';

const validTask = {
  version: 2,
  kind: 'task',
  name: 'task',
  description: 'description',
  repo: 'https://github.com/example/project.git',
  task: { prompt: 'change it' },
  evaluators: [{ name: 'git-diff' }],
};

const validTarget = {
  id: 'candidate',
  agent: {
    type: 'codex-cli',
    model: 'gpt-5',
    config: { reasoning_effort: 'high' },
  },
  harness: { exact_version: '1.2.3' },
};

const validSuite = {
  version: 2,
  name: 'suite',
  suite: { tasks: [{ id: 'task', file: './task.yaml' }] },
  targets: [validTarget],
};

const validLegacySuite = {
  repo: 'https://github.com/example/project.git',
  agent: { type: 'copilot-cli' },
  evaluators: [{ name: 'git-diff' }],
};

const validTestCase = {
  name: 'case',
  description: 'description',
  repo: 'https://github.com/example/project.git',
  agent: { type: 'copilot-cli' },
  evaluators: [{ name: 'git-diff' }],
};

describe('schema coverage edge cases', () => {
  test('touches every runtime barrel export', () => {
    for (const key of Object.keys(schemas)) {
      expect(schemas[key as keyof typeof schemas]).toBeDefined();
    }
    for (const key of Object.keys(agentSchemas)) {
      expect(agentSchemas[key as keyof typeof agentSchemas]).toBeDefined();
    }
  });

  test('validates both generations of baseline channel audit records', () => {
    const base = {
      schema_version: '1.0.0',
      channel: 'production',
      new_digest: digest,
      new_target: 'candidate',
      timestamp,
      source_experiment: 'experiment',
      target_mapping: { candidate_target: 'candidate' },
      audit_hash: digest,
    };

    expect(
      baselineChannelAuditSchema.safeParse({ ...base, generation: 1 }).success
    ).toBe(true);
    expect(
      baselineChannelAuditSchema.safeParse({
        ...base,
        generation: 1,
        old_digest: digest,
        old_target: 'old',
        previous_audit_hash: digest,
      }).success
    ).toBe(false);
    expect(
      baselineChannelAuditSchema.safeParse({ ...base, generation: 2 }).success
    ).toBe(false);
    expect(
      baselineChannelAuditSchema.safeParse({
        ...base,
        generation: 2,
        old_digest: digest,
        old_target: 'old',
        previous_audit_hash: digest,
      }).success
    ).toBe(true);
  });

  test('covers evaluator-specific dispatch and adapter validation', () => {
    expect(
      resolveAgenticJudgeAdapterType({ type: 'codex-cli' }, 'fallback')
    ).toBe('codex-cli');
    expect(resolveAgenticJudgeAdapterType(undefined, 'fallback')).toBe(
      'fallback'
    );
    expect(parseEvaluatorConfig('git-diff', undefined)).toEqual({});
    expect(parseEvaluatorConfig('expected-diff', { threshold: 0.5 })).toEqual({
      threshold: 0.5,
    });
    expect(parseEvaluatorConfig('custom', undefined)).toEqual({});

    for (const config of [
      {
        type: 'codex-cli',
        reasoning_effort: 'none',
        assertions: { quality: 'good' },
      },
      {
        type: 'codex-cli',
        reasoning_effort: 'minimal',
        assertions: { quality: 'good' },
      },
      {
        type: 'codex-cli',
        prompt_file: '../prompt.md',
        assertions: { quality: 'good' },
      },
      {
        type: 'codex-cli',
        max_output_bytes: 10,
        assertions: { quality: 'good' },
      },
      {
        type: 'copilot-cli',
        reasoning_effort: 'ultra',
        assertions: { quality: 'good' },
      },
      {
        type: 'claude-code',
        max_ai_credits: 2,
        assertions: { quality: 'good' },
      },
      {
        type: 'codex-cli',
        allowed_tools: ['Read'],
        assertions: { quality: 'good' },
      },
    ]) {
      expect(agenticJudgeEvaluatorConfigSchema.safeParse(config).success).toBe(
        false
      );
    }

    expect(
      parseEvaluatorConfig(
        'agentic-judge-custom',
        { criteria: ['correct'] },
        { inheritedAgentType: 'copilot-cli' }
      )
    ).toMatchObject({ type: 'copilot-cli' });
    expect(
      parseEvaluatorConfig(
        'agentic-judge:custom',
        {
          type: 'codex-cli',
          reasoning_effort: 'high',
          criteria: { correct: 'yes' },
        },
        { requireAgentType: true }
      )
    ).toMatchObject({ type: 'codex-cli' });
  });

  test('converts evaluator parser failures into definition issues', () => {
    const parsed = evaluatorDefinitionSchema.safeParse({
      name: 'agentic-judge',
      config: { type: 'copilot-cli' },
    });
    expect(parsed.success).toBe(false);
  });

  test('covers terminal and aggregate dimension refinements', () => {
    const running = {
      attempt_id: 'attempt',
      attempt_number: 1,
      status: 'running',
      started_at: timestamp,
    };
    expect(experimentAttemptSchema.safeParse(running).success).toBe(true);
    expect(
      experimentAttemptSchema.safeParse({ ...running, status: 'passed' })
        .success
    ).toBe(false);
    expect(
      experimentAttemptSchema.safeParse({
        ...running,
        status: 'passed',
        completed_at: timestamp,
        duration_ms: 0,
      }).success
    ).toBe(true);

    for (const aggregate of [
      { scope: 'experiment', metrics: {} },
      { scope: 'testcase', testcase_id: 'task', metrics: {} },
      { scope: 'variant', variant_name: 'candidate', metrics: {} },
      {
        scope: 'testcase_variant',
        testcase_id: 'task',
        variant_name: 'candidate',
        metrics: {},
      },
    ]) {
      expect(experimentAggregateSchema.safeParse(aggregate).success).toBe(true);
    }
  });

  test('covers experiment optional budget and regression predicates', () => {
    const base = {
      version: 1,
      name: 'experiment',
      testcases: [{ id: 'task', file: './task.yaml' }],
      variants: [{ name: 'candidate', agent: { type: 'copilot-cli' } }],
    };
    expect(
      experimentDefinitionSchema.safeParse({
        ...base,
        budget: { max_duration_minutes: 1 },
        regression: { min_pass_rate: 0.5 },
      }).success
    ).toBe(true);
    expect(
      experimentDefinitionSchema.safeParse({
        ...base,
        budget: { max_cost_usd: 1 },
        regression: { max_pass_rate_drop: 0.1 },
      }).success
    ).toBe(true);
    expect(
      experimentDefinitionSchema.safeParse({
        ...base,
        budget: {},
        regression: {},
      }).success
    ).toBe(false);
    expect(
      experimentDefinitionSchema.safeParse({
        ...base,
        regression: { max_duration_increase_percent: 10 },
      }).success
    ).toBe(true);
  });

  test.each([
    'https://example.com/repo.git',
    'https://8.8.8.8/repo.git',
    'https://100.128.0.1/repo.git',
    'https://172.32.0.1/repo.git',
    'https://[2001:4860:4860::8888]/repo.git',
  ])('accepts public repository form %s', (repo) => {
    expect(
      regressionTaskDefinitionSchema.safeParse({ ...validTask, repo }).success
    ).toBe(true);
  });

  test.each([
    'ftp://example.com/repo.git',
    'https://user@example.com/repo.git',
    'https://user:password@example.com/repo.git',
    'https://example.com:8443/repo.git',
    'https://localhost/repo.git',
    'https://host.localhost/repo.git',
    'https://host.local/repo.git',
    'https://host.internal/repo.git',
    'https://0.0.0.0/repo.git',
    'https://10.1.2.3/repo.git',
    'https://100.64.0.1/repo.git',
    'https://127.0.0.1/repo.git',
    'https://169.254.1.1/repo.git',
    'https://172.16.0.1/repo.git',
    'https://192.0.0.1/repo.git',
    'https://192.168.1.1/repo.git',
    'https://198.18.0.1/repo.git',
    'https://198.19.0.1/repo.git',
    'https://224.0.0.1/repo.git',
    'not a url',
  ])('rejects private or malformed repository form %s', (repo) => {
    expect(
      regressionTaskDefinitionSchema.safeParse({ ...validTask, repo }).success
    ).toBe(false);
  });

  test.each([
    'https://[::]/repo.git',
    'https://[::1]/repo.git',
    'https://[fc00::1]/repo.git',
    'https://[fd00::1]/repo.git',
    'https://[fe80::1]/repo.git',
    'https://[fe90::1]/repo.git',
    'https://[fea0::1]/repo.git',
    'https://[feb0::1]/repo.git',
  ])('rejects private IPv6 repository form %s', (repo) => {
    expect(
      regressionTaskDefinitionSchema.safeParse({ ...validTask, repo }).success
    ).toBe(false);
  });

  test('covers version 2 component refinements', () => {
    expect(
      suiteV2EvaluatorSchema.safeParse({
        name: 'agentic-judge:quality',
        harness: { type: 'codex-cli', exact_version: '1.2.3' },
      }).success
    ).toBe(true);
    expect(
      suiteV2EvaluatorSchema.safeParse({ name: 'agentic-judge-quality' })
        .success
    ).toBe(false);
    expect(
      suiteV2EvaluatorSchema.safeParse({ name: 'agentic-judge' }).success
    ).toBe(false);
    expect(
      regressionTaskDefinitionSchema.safeParse({
        ...validTask,
        expected_source: 'branch',
      }).success
    ).toBe(false);
    expect(
      regressionTaskDefinitionSchema.safeParse({
        ...validTask,
        expected_source: 'branch',
        expected: 'expected',
      }).success
    ).toBe(true);

    for (const runtime of [
      { network: { outbound: 'none', allow: ['example.com'] } },
      { network: { outbound: 'allowlist', allow: [] } },
      { network: { outbound: 'allowlist', allow: ['example.com'] } },
    ]) {
      const success = regressionTargetSchema.safeParse({
        ...validTarget,
        runtime,
      }).success;
      expect(success).toBe(
        runtime.network.allow.length > 0 &&
          runtime.network.outbound === 'allowlist'
      );
    }

    expect(
      regressionTargetSchema.safeParse({
        ...validTarget,
        agent: { type: 'codex-cli', config: {} },
      }).success
    ).toBe(false);
    expect(
      regressionTargetSchema.safeParse({
        ...validTarget,
        agent: {
          ...validTarget.agent,
          config: { prompt_file: './prompt.md' },
        },
      }).success
    ).toBe(false);
    expect(
      regressionRuleSchema.safeParse({
        id: 'rule',
        metric: 'pass_rate',
        scopes: ['target'],
        minimum_samples: 1,
      }).success
    ).toBe(false);
    expect(
      regressionRuleSchema.safeParse({
        id: 'rule',
        metric: 'pass_rate',
        scopes: ['target'],
        minimum: 0.9,
        minimum_samples: 1,
      }).success
    ).toBe(true);
    expect(
      suiteV2SecretSchema.safeParse({
        id: 'secret',
        source: { env: 'SAFE' },
        expose_as: { env: 'e2b_api_key' },
        targets: ['candidate'],
        phases: ['agent'],
      }).success
    ).toBe(false);
  });

  test('covers suite references, duplicates, profiles, and strict E2B checks', () => {
    const comparison = {
      id: 'comparison',
      candidate_target: 'candidate',
      baseline: { source: 'current_run', target: 'baseline' },
    };
    const rule = {
      id: 'rule',
      metric: 'pass_rate',
      scopes: ['target'],
      minimum: 0.9,
      comparisons: ['comparison'],
      minimum_samples: 1,
    };
    const suite = {
      ...validSuite,
      suite: {
        tasks: [
          { id: 'task', file: './task.yaml' },
          { id: 'task', file: './task-2.yaml' },
        ],
      },
      targets: [
        validTarget,
        { ...validTarget, id: 'candidate' },
        {
          ...validTarget,
          id: 'baseline',
          runtime: { network: { outbound: 'unrestricted' } },
        },
      ],
      profiles: {
        smoke: {
          tasks: ['missing-task'],
          targets: ['missing-target'],
          repetitions: 1,
          comparisons: ['missing-comparison'],
          rules: ['missing-rule'],
        },
      },
      execution: {
        provider: {
          type: 'e2b',
          timeout_ms: 1000,
          collection_grace_ms: 100,
          strict_reproducibility: true,
          lifecycle: { retain_on: 'failure' },
        },
        secrets: [
          {
            id: 'secret',
            source: { env: 'SAFE' },
            expose_as: { env: 'SAFE' },
            targets: ['missing-target'],
            phases: ['agent'],
          },
        ],
      },
      regression: {
        default_candidate_target: 'missing-target',
        comparisons: [comparison, comparison],
        rules: [rule, rule],
      },
    };
    expect(regressionSuiteDefinitionSchema.safeParse(suite).success).toBe(
      false
    );

    expect(
      regressionSuiteDefinitionSchema.safeParse({
        ...validSuite,
        execution: {
          provider: {
            type: 'e2b',
            timeout_ms: 1000,
            collection_grace_ms: 100,
            lifecycle: {
              retain_on: 'failure',
              retention_reason: 'debugging',
            },
          },
        },
      }).success
    ).toBe(false);

    expect(
      regressionSuiteDefinitionSchema.safeParse({
        ...validSuite,
        targets: [
          {
            ...validTarget,
            harness: {
              exact_version: '1.2.3',
              e2b_template: {
                ref: 'runner:v1',
                expected_build_id: 'build-1',
              },
            },
          },
        ],
        execution: {
          provider: {
            type: 'e2b',
            timeout_ms: 1000,
            collection_grace_ms: 100,
            strict_reproducibility: true,
          },
        },
      }).success
    ).toBe(true);
  });

  test('covers legacy and test-case URL/refinement branches', () => {
    for (const schema of [suiteConfigSchema, testCaseConfigSchema]) {
      expect(schema.safeParse(validLegacySuite).success).toBe(
        schema === suiteConfigSchema
      );
      const base =
        schema === suiteConfigSchema ? validLegacySuite : validTestCase;
      for (const repo of [
        'git@example.com:repo.git',
        'https://localhost/repo.git',
        'https://127.0.0.1/repo.git',
        'https://0.0.0.0/repo.git',
        'https://192.168.1.1/repo.git',
        'https://10.0.0.1/repo.git',
        'https://172.16.0.1/repo.git',
        'https://[::1]/repo.git',
        'https://[invalid',
      ]) {
        expect(schema.safeParse({ ...base, repo }).success).toBe(false);
      }
      expect(
        schema.safeParse({
          ...base,
          expected_source: 'branch',
          expected: undefined,
        }).success
      ).toBe(false);
      expect(
        schema.safeParse({
          ...base,
          expected_source: 'branch',
          expected: 'expected',
        }).success
      ).toBe(true);
    }
  });
});
