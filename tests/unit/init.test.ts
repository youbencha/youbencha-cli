import { describe, expect, it } from '@jest/globals';
import { parse } from 'yaml';
import { MINIMAL_EVAL, STARTER_TESTCASE } from '../../src/cli/init-templates';
import { evalConfigSchema } from '../../src/schemas/eval.schema';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema';

describe('init templates', () => {
  it('creates a valid full starter for a supported agent', () => {
    const parsed = testCaseConfigSchema.parse(parse(STARTER_TESTCASE));

    expect(parsed.agent.type).toBe('copilot-cli');
    expect(
      parsed.evaluators.map(
        (evaluator) => 'name' in evaluator && evaluator.name
      )
    ).toContain('agentic-judge');
  });

  it('creates a valid minimal starter without an AI judge', () => {
    const parsed = evalConfigSchema.parse(parse(MINIMAL_EVAL));

    expect(parsed.directory).toBe('.');
    expect(parsed.evaluators).toHaveLength(1);
    expect(parsed.evaluators[0]).toEqual(
      expect.objectContaining({ name: 'git-diff' })
    );
  });
});
