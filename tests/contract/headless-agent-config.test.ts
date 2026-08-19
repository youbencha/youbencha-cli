import {
  agentConfigSchema,
  claudeCodeConfigSchema,
  codexCliConfigSchema,
  copilotCliConfigSchema,
} from '../../src/schemas/index.js';
import { suiteConfigSchema } from '../../src/schemas/suite.schema.js';
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

  it('accepts Codex CLI with reproducible headless defaults', () => {
    const parsed = agentConfigSchema.parse({
      type: 'codex-cli',
      model: 'gpt-5.4',
      config: { prompt: 'Review the repository.', reasoning_effort: 'ultra' },
    });

    expect(parsed.type).toBe('codex-cli');
    expect(parsed.config).toEqual(
      expect.objectContaining({
        sandbox: 'workspace-write',
        approval_policy: 'never',
        ephemeral: true,
        ignore_user_config: true,
        ignore_rules: false,
        search: false,
      })
    );
  });

  it('rejects Codex agent_name with actionable guidance', () => {
    const result = agentConfigSchema.safeParse({
      type: 'codex-cli',
      agent_name: 'reviewer',
      config: { prompt: 'Review the repository.' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['agent_name']);
    expect(result.error?.issues[0].message).toMatch(/profile|prompt/i);
  });

  it('bounds Codex output and prompt file paths', () => {
    expect(
      codexCliConfigSchema.safeParse({
        prompt_file: '../outside.md',
      }).success
    ).toBe(false);
    expect(
      codexCliConfigSchema.safeParse({
        prompt: 'Review.',
        output_limit_bytes: 16 * 1024 * 1024 + 1,
      }).success
    ).toBe(false);
  });

  it('accepts Codex as an agentic judge and rejects incompatible identity', () => {
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'codex-cli',
        profile: 'benchmark',
        reasoning_effort: 'high',
        assertions: { quality: 'The implementation is maintainable.' },
      }).success
    ).toBe(true);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'codex-cli',
        agent_name: 'agentic-judge',
        assertions: { quality: 'The implementation is maintainable.' },
      }).success
    ).toBe(false);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'codex-cli',
        prompt_file: '../outside.md',
        assertions: { quality: 'The implementation is maintainable.' },
      }).success
    ).toBe(false);
  });

  it('keeps agentic-judge reasoning and output limits adapter-specific', () => {
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'claude-code',
        max_output_bytes: 1048576,
        effort: 'high',
        assertions: { quality: 'Code quality is acceptable' },
      }).success
    ).toBe(true);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'claude-code',
        reasoning_effort: 'high',
        assertions: { quality: 'Code quality is acceptable' },
      }).success
    ).toBe(false);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'copilot-cli',
        reasoning_effort: 'ultra',
        assertions: { quality: 'Code quality is acceptable' },
      }).success
    ).toBe(false);
    expect(
      agenticJudgeEvaluatorConfigSchema.safeParse({
        type: 'codex-cli',
        max_output_bytes: 1048576,
        assertions: { quality: 'Code quality is acceptable' },
      }).success
    ).toBe(false);
  });

  it('keeps the deprecated suite entry point on the active agent schema', () => {
    expect(
      suiteConfigSchema.safeParse({
        name: 'Codex compatibility',
        description:
          'Proves the deprecated suite export uses the active schema.',
        repo: 'https://github.com/example/project',
        agent: {
          type: 'codex-cli',
          config: { prompt: 'Review.' },
        },
        evaluators: [{ name: 'git-diff' }],
      }).success
    ).toBe(true);
    expect(
      suiteConfigSchema.safeParse({
        repo: 'https://github.com/example/project',
        agent: {
          type: 'codex-cli',
          agent_name: 'must-not-be-remapped',
          config: { prompt: 'Review.' },
        },
        evaluators: [{ name: 'git-diff' }],
      }).success
    ).toBe(false);
  });
});
