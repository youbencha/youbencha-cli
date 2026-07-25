import {
  agenticJudgeEvaluatorConfigSchema,
  expectedDiffEvaluatorConfigSchema,
  gitDiffEvaluatorConfigSchema,
  parseEvaluatorConfig,
} from '../../src/schemas/evaluator-config.schema.js';

describe('evaluator-specific configuration schemas', () => {
  test('validates git-diff assertion values', () => {
    expect(() =>
      gitDiffEvaluatorConfigSchema.parse({
        assertions: { max_files_changed: -1 },
      })
    ).toThrow();
  });

  test('constrains expected-diff threshold to a probability', () => {
    expect(() =>
      expectedDiffEvaluatorConfigSchema.parse({ threshold: 1.1 })
    ).toThrow();
  });

  test('requires agentic-judge assertions or criteria', () => {
    expect(() =>
      agenticJudgeEvaluatorConfigSchema.parse({ type: 'copilot-cli' })
    ).toThrow(/assertions or criteria/);
  });

  test('rejects mutually exclusive agentic-judge prompt sources', () => {
    expect(() =>
      agenticJudgeEvaluatorConfigSchema.parse({
        type: 'copilot-cli',
        prompt: 'Inline',
        prompt_file: './prompt.md',
        assertions: { quality: 'The change is correct.' },
      })
    ).toThrow(/Cannot specify both/);
  });

  test('requires an adapter type for eval-only agentic judges', () => {
    expect(() =>
      parseEvaluatorConfig(
        'agentic-judge:quality',
        { assertions: { quality: 'The change is correct.' } },
        { requireAgentType: true }
      )
    ).toThrow(/requires config.type/);
  });

  test('allows a test-case agent to supply the agentic judge adapter type', () => {
    expect(
      parseEvaluatorConfig('agentic-judge', {
        assertions: { quality: 'The change is correct.' },
      })
    ).toMatchObject({
      assertions: { quality: 'The change is correct.' },
    });
  });
});
