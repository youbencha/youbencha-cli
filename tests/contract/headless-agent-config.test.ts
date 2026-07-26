import {
  agentConfigSchema,
  claudeCodeConfigSchema,
  copilotCliConfigSchema,
} from '../../src/schemas/index.js';
import { agenticJudgeEvaluatorConfigSchema } from '../../src/schemas/evaluator-config.schema.js';

describe('headless agent configuration contracts', () => {
  it('accepts documented Claude Code headless limits', () => {
    expect(
      agentConfigSchema.parse({
        type: 'claude-code',
        agent_name: 'code-reviewer',
        model: 'sonnet',
        config: {
          prompt: 'Review the repository.',
          permission_mode: 'dontAsk',
          max_turns: 8,
          max_budget_usd: 2,
          effort: 'high',
          fallback_model: 'haiku',
          setting_sources: ['project'],
          tools: ['Read', 'Grep'],
          allowed_tools: ['Read', 'Grep'],
          disallowed_tools: ['WebFetch'],
          max_output_bytes: 1048576,
        },
      })
    ).toBeDefined();
  });

  it.each([
    ['auto', 'xhigh'],
    ['manual', 'ultracode'],
  ])(
    'accepts current Claude permission mode %s and effort %s',
    (permissionMode, effort) => {
      expect(
        claudeCodeConfigSchema.safeParse({
          prompt: 'Review the repository.',
          permission_mode: permissionMode,
          effort,
        }).success
      ).toBe(true);
    }
  );

  it('rejects the removed Claude default permission alias', () => {
    expect(
      claudeCodeConfigSchema.safeParse({
        prompt: 'Review the repository.',
        permission_mode: 'default',
      }).success
    ).toBe(false);
  });

  it('accepts documented Copilot CLI headless limits', () => {
    expect(
      agentConfigSchema.parse({
        type: 'copilot-cli',
        agent_name: 'code-reviewer',
        model: 'account-selected-model',
        config: {
          prompt_file: './prompt.md',
          reasoning_effort: 'high',
          max_ai_credits: 10,
          log_level: 'warning',
          allow_all_tools: true,
          allow_all_paths: true,
          max_output_bytes: 1048576,
        },
      })
    ).toBeDefined();
  });

  it('rejects unknown adapter fields with a useful path', () => {
    const result = copilotCliConfigSchema.safeParse({
      prompt: 'Fix the tests.',
      unsupported_flag: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].code).toBe('unrecognized_keys');
    expect(result.error?.issues[0].message).toContain('unsupported_flag');
  });

  it('rejects unsupported legacy Claude sampling flags explicitly', () => {
    const maxTokens = claudeCodeConfigSchema.safeParse({
      prompt: 'Fix the tests.',
      max_tokens: 4096,
    });
    const temperature = claudeCodeConfigSchema.safeParse({
      prompt: 'Fix the tests.',
      temperature: 0,
    });

    expect(maxTokens.success).toBe(false);
    expect(maxTokens.error?.issues[0].path).toEqual(['max_tokens']);
    expect(temperature.success).toBe(false);
    expect(temperature.error?.issues[0].path).toEqual(['temperature']);
  });

  it('rejects contradictory Claude permission and tool policies', () => {
    expect(
      claudeCodeConfigSchema.safeParse({
        prompt: 'Fix the tests.',
        allowed_tools: ['Bash'],
        disallowed_tools: ['Bash'],
      }).success
    ).toBe(false);
  });

  it('applies the same adapter options to an agentic judge', () => {
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'claude-code',
        assertions: { quality: 'The implementation is maintainable.' },
        max_turns: 4,
        setting_sources: ['project'],
      }).success
    ).toBe(true);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'copilot-cli',
        assertions: { quality: 'The implementation is maintainable.' },
        max_turns: 4,
      }).success
    ).toBe(false);
  });
});
