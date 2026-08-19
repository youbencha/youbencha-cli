import {
  regressionSuiteDefinitionSchema,
  regressionTaskDefinitionSchema,
} from '../../src/schemas/suite-v2.schema.js';

const task = {
  version: 2,
  kind: 'task',
  name: 'Task',
  description: 'A target-neutral coding task',
  repo: 'https://github.com/example/project.git',
  task: { prompt: 'Make the focused change' },
  evaluators: [{ name: 'git-diff' }],
};

const target = {
  id: 'candidate',
  agent: {
    type: 'codex-cli',
    model: 'gpt-candidate',
    config: { reasoning_effort: 'high' },
  },
  harness: { exact_version: '1.2.3' },
};

const suite = {
  version: 2,
  name: 'regression',
  suite: {
    tasks: [{ id: 'task', file: './task.yaml' }],
  },
  targets: [target],
  regression: {
    default_candidate_target: 'candidate',
  },
};

describe('version 2 regression schemas', () => {
  it('keeps tasks target-neutral and applies safe suite defaults', () => {
    const parsedTask = regressionTaskDefinitionSchema.parse(task);
    const parsedSuite = regressionSuiteDefinitionSchema.parse(suite);

    expect(parsedTask).not.toHaveProperty('agent');
    expect(parsedTask.setup).toEqual({ cacheable: [], per_attempt: [] });
    expect(parsedSuite.suite.repetitions).toBe(1);
    expect(parsedSuite.execution.provider).toEqual({
      type: 'host-trusted',
    });
    expect(parsedSuite.execution.schedule.order).toBe('round_robin');
  });

  it.each([
    [
      'an agent embedded in a task',
      { ...task, agent: { type: 'codex-cli', model: 'gpt' } },
    ],
    [
      'both prompt sources',
      { ...task, task: { prompt: 'x', prompt_file: 'x.md' } },
    ],
    ['no prompt source', { ...task, task: {} }],
  ])('rejects %s', (_description, value) => {
    expect(regressionTaskDefinitionSchema.safeParse(value).success).toBe(false);
  });

  it('rejects credential-bearing and non-public repository URLs', () => {
    for (const repo of [
      'http://github.com/example/repo.git',
      'https://token@github.com/example/repo.git',
      'https://127.0.0.1/repo.git',
      'https://172.31.0.1/repo.git',
      'https://169.254.169.254/latest/meta-data',
      'https://service.internal/repo.git',
    ]) {
      expect(
        regressionTaskDefinitionSchema.safeParse({ ...task, repo }).success
      ).toBe(false);
    }
  });

  it.each([
    [
      'target-owned prompts',
      {
        ...suite,
        targets: [
          {
            ...target,
            agent: {
              ...target.agent,
              config: { reasoning_effort: 'high', prompt: 'wrong owner' },
            },
          },
        ],
      },
    ],
    [
      'moving harness versions',
      {
        ...suite,
        targets: [{ ...target, harness: { exact_version: '^1.2.3' } }],
      },
    ],
    [
      'unknown profile targets',
      {
        ...suite,
        profiles: {
          smoke: {
            tasks: '*',
            targets: ['missing'],
            repetitions: 1,
          },
        },
      },
    ],
    [
      'task file traversal',
      {
        ...suite,
        suite: {
          tasks: [{ id: 'task', file: '../outside.yaml' }],
        },
      },
    ],
    [
      'E2B control credentials as sandbox secrets',
      {
        ...suite,
        execution: {
          secrets: [
            {
              id: 'bad',
              source: { env: 'E2B_API_KEY' },
              expose_as: { env: 'OTHER_KEY' },
              targets: ['candidate'],
              phases: ['agent'],
            },
          ],
        },
      },
    ],
  ])('rejects %s', (_description, value) => {
    expect(regressionSuiteDefinitionSchema.safeParse(value).success).toBe(
      false
    );
  });

  it('requires immutable builds and bounded egress in strict mode', () => {
    expect(
      regressionSuiteDefinitionSchema.safeParse({
        ...suite,
        execution: {
          provider: {
            type: 'e2b',
            timeout_ms: 60000,
            collection_grace_ms: 10000,
            strict_reproducibility: true,
          },
        },
      }).success
    ).toBe(false);

    expect(
      regressionSuiteDefinitionSchema.safeParse({
        ...suite,
        targets: [
          {
            ...target,
            harness: {
              exact_version: '1.2.3',
              e2b_template: {
                ref: 'runner:v1',
                expected_build_id: 'build-immutable',
              },
            },
          },
        ],
        execution: {
          provider: {
            type: 'e2b',
            timeout_ms: 60000,
            collection_grace_ms: 10000,
            strict_reproducibility: true,
          },
        },
      }).success
    ).toBe(true);
  });
});
