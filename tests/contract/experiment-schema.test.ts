import {
  experimentDefinitionSchema,
  experimentResultSchema,
  experimentStateSchema,
} from '../../src/schemas/index.js';

const validDefinition = {
  version: 1,
  name: 'comparison',
  testcases: [{ id: 'task', file: './task.yaml' }],
  variants: [{ name: 'default', agent: { type: 'copilot-cli' } }],
};

describe('experiment schemas', () => {
  it('applies deterministic execution defaults', () => {
    const parsed = experimentDefinitionSchema.parse(validDefinition);

    expect(parsed.repetitions).toBe(1);
    expect(parsed.execution).toEqual({
      max_concurrent: 1,
      retry: { max_attempts: 1, on: [], backoff_ms: 0 },
    });
  });

  it.each([
    [
      'duplicate test case IDs',
      {
        ...validDefinition,
        testcases: [
          { id: 'task', file: './one.yaml' },
          { id: 'task', file: './two.yaml' },
        ],
      },
    ],
    [
      'duplicate variant names',
      {
        ...validDefinition,
        variants: [
          { name: 'default', agent: { type: 'copilot-cli' } },
          { name: 'default', agent: { type: 'claude-code' } },
        ],
      },
    ],
    [
      'invalid typed agent overrides',
      {
        ...validDefinition,
        variants: [{ name: 'bad', agent: { type: 'unknown-agent' } }],
      },
    ],
    ['an empty matrix', { ...validDefinition, testcases: [] }],
  ])('rejects %s', (_description, value) => {
    expect(() => experimentDefinitionSchema.parse(value)).toThrow();
  });

  it('requires explicit zero-baseline behavior through a stable default', () => {
    const parsed = experimentDefinitionSchema.parse({
      ...validDefinition,
      regression: { max_pass_rate_drop: 0.1 },
    });

    expect(parsed.regression?.zero_baseline_behavior).toBe('partial');
  });

  it('validates versioned durable state and result contracts', () => {
    const now = '2026-07-24T12:00:00.000Z';
    const hash = 'a'.repeat(64);
    const cell = {
      cell_id: hash,
      testcase_id: 'task',
      variant_name: 'default',
      repetition: 0,
      status: 'pending',
      attempts: [],
      usage_quality: 'unavailable',
    };

    expect(
      experimentStateSchema.safeParse({
        schema_version: '1.0.0',
        experiment_id: 'exp-1',
        definition_hash: hash,
        status: 'pending',
        updated_at: now,
        cells: [cell],
        budget: { duration_ms_used: 0, cost_usd_used: 0 },
      }).success
    ).toBe(true);

    expect(
      experimentStateSchema.safeParse({
        schema_version: '1.0.0',
        experiment_id: 'exp-1',
        definition_hash: hash,
        status: 'running',
        started_at: now,
        updated_at: now,
        cells: [
          {
            ...cell,
            status: 'running',
            attempts: [
              {
                attempt_id: `${hash}-1`,
                attempt_number: 1,
                status: 'running',
                started_at: now,
              },
            ],
          },
        ],
        budget: { duration_ms_used: 0, cost_usd_used: 0 },
      }).success
    ).toBe(true);

    expect(
      experimentResultSchema.safeParse({
        schema_version: '1.0.0',
        experiment_version: 1,
        experiment_id: 'exp-1',
        definition_hash: hash,
        started_at: now,
        completed_at: now,
        final_status: 'partial',
        exit_code: 3,
        effective_configuration: {},
        sources: [{ testcase_id: 'task', config_hash: hash }],
        provenance: {
          youbencha_version: '0.1.5-beta',
          agent_cli_versions: {},
          requested_models: {},
          resolved_models: {},
        },
        cells: [cell],
        aggregates: [
          {
            scope: 'experiment',
            metrics: {
              token_total: {
                sample_size: 1,
                value: 10,
                quality: 'measured',
                source_cell_ids: [hash],
                quality_counts: {
                  measured: 1,
                  estimated: 0,
                  unavailable: 0,
                },
              },
            },
          },
        ],
        comparisons: [],
        artifacts: {},
        warnings: [],
      }).success
    ).toBe(true);
  });

  it.each([
    [{ scope: 'experiment', testcase_id: 'task', metrics: {} }],
    [{ scope: 'testcase', metrics: {} }],
    [
      {
        scope: 'testcase',
        testcase_id: 'task',
        variant_name: 'v',
        metrics: {},
      },
    ],
    [{ scope: 'variant', metrics: {} }],
    [{ scope: 'testcase_variant', testcase_id: 'task', metrics: {} }],
  ])('rejects invalid aggregate dimensions %#', (aggregate) => {
    const hash = 'a'.repeat(64);
    const now = '2026-07-24T12:00:00.000Z';
    const result = {
      schema_version: '1.0.0',
      experiment_version: 1,
      experiment_id: 'exp-1',
      definition_hash: hash,
      started_at: now,
      completed_at: now,
      final_status: 'passed',
      exit_code: 0,
      effective_configuration: {},
      sources: [],
      provenance: {
        youbencha_version: '1.0.0',
        agent_cli_versions: {},
        requested_models: {},
        resolved_models: {},
      },
      cells: [],
      aggregates: [aggregate],
      comparisons: [],
      artifacts: {},
      warnings: [],
    };

    expect(experimentResultSchema.safeParse(result).success).toBe(false);
  });

  it('rejects duplicate aggregate scope tuples', () => {
    const hash = 'a'.repeat(64);
    const now = '2026-07-24T12:00:00.000Z';
    const aggregate = {
      scope: 'testcase',
      testcase_id: 'task',
      metrics: {},
    };
    const parsed = experimentResultSchema.safeParse({
      schema_version: '1.0.0',
      experiment_version: 1,
      experiment_id: 'exp-1',
      definition_hash: hash,
      started_at: now,
      completed_at: now,
      final_status: 'passed',
      exit_code: 0,
      effective_configuration: {},
      sources: [],
      provenance: {
        youbencha_version: '1.0.0',
        agent_cli_versions: {},
        requested_models: {},
        resolved_models: {},
      },
      cells: [],
      aggregates: [aggregate, aggregate],
      comparisons: [],
      artifacts: {},
      warnings: [],
    });

    expect(parsed.success).toBe(false);
  });
});
