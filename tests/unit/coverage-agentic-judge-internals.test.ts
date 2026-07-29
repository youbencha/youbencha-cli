import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentAdapter } from '../../src/adapters/base.js';
import type { EvaluationContext } from '../../src/evaluators/base.js';
import { AgenticJudgeEvaluator } from '../../src/evaluators/agentic-judge.js';

interface AgenticJudgeInternals {
  checkPreconditions(context: EvaluationContext): Promise<boolean>;
  evaluate(context: EvaluationContext): Promise<{
    status: string;
    error?: { message: string; stack_trace?: string };
    metrics: Record<string, unknown>;
  }>;
  getAdapterOptions(config: Record<string, unknown>): Record<string, unknown>;
  buildEvaluationPrompt(context: EvaluationContext): string;
  formatAssertions(assertions: unknown): string;
  parseAgentOutput(output: string): {
    status: 'passed' | 'failed';
    metrics: Record<string, unknown>;
    message: string;
  } | null;
  validateAndParse(json: string): {
    status: 'passed' | 'failed';
    metrics: Record<string, unknown>;
    message: string;
  } | null;
  getAdapter(type: string): Promise<AgentAdapter | null>;
  createSkippedResult(
    startedAt: string,
    message: string,
    duration?: number
  ): { metrics: Record<string, unknown> };
}

function internals(
  evaluator = new AgenticJudgeEvaluator()
): AgenticJudgeInternals {
  return evaluator as unknown as AgenticJudgeInternals;
}

function context(config: Record<string, unknown>): EvaluationContext {
  return {
    modifiedDir: process.cwd(),
    artifactsDir: process.cwd(),
    config,
  };
}

describe('agentic judge internals coverage', () => {
  it('rejects missing and empty assertion configurations', async () => {
    for (const assertions of [undefined, [], {}]) {
      const evaluator = internals();
      await expect(
        evaluator.checkPreconditions(
          context({ type: 'copilot-cli', assertions })
        )
      ).resolves.toBe(false);
    }
  });

  it('handles missing, unavailable, and throwing adapters', async () => {
    const missing = internals();
    missing.getAdapter = jest.fn().mockResolvedValue(null);
    await expect(
      missing.checkPreconditions(
        context({ type: 'copilot-cli', assertions: ['check'] })
      )
    ).resolves.toBe(false);

    const unavailable = internals();
    unavailable.getAdapter = jest.fn().mockResolvedValue({
      checkAvailability: jest.fn().mockResolvedValue(false),
    });
    await expect(
      unavailable.checkPreconditions(
        context({ type: 'copilot-cli', assertions: ['check'] })
      )
    ).resolves.toBe(false);

    const throwing = internals();
    throwing.getAdapter = jest.fn().mockRejectedValue(new Error('failure'));
    await expect(
      throwing.checkPreconditions(
        context({ type: 'copilot-cli', assertions: ['check'] })
      )
    ).resolves.toBe(false);
  });

  it('filters evaluator-only options while preserving adapter options', () => {
    const evaluator = internals();
    expect(
      evaluator.getAdapterOptions({
        type: 'copilot-cli',
        prompt: 'ignored',
        assertions: ['ignored'],
        allow_all_tools: true,
      })
    ).toEqual({ allow_all_tools: true });
  });

  it('formats legacy, object, and absent assertions', () => {
    const evaluator = internals();
    expect(evaluator.formatAssertions(['first', 'second'])).toContain(
      '2. second'
    );
    expect(evaluator.formatAssertions({ quality: 'Good code' })).toBe(
      '- **quality**: Good code'
    );
    expect(evaluator.formatAssertions(undefined)).toBe('');
  });

  it('builds every prompt mode with and without a preamble', async () => {
    const evaluator = internals();
    const root = await makeDirectory();
    const template = path.join(root, 'template.md');
    await writeFile(template, 'A={{ASSERTIONS}}\nC={{CRITERIA}}');

    expect(
      evaluator.buildEvaluationPrompt(
        context({
          'instructions-file': template,
          assertions: ['check'],
          prompt: 'Preamble',
        })
      )
    ).toContain('Preamble');
    expect(
      evaluator.buildEvaluationPrompt(
        context({
          'instructions-file': template,
          assertions: ['check'],
        })
      )
    ).not.toContain('Preamble');
    expect(
      evaluator.buildEvaluationPrompt(
        context({
          'instructions-file':
            'dist/evaluators/prompts/agentic-judge.template.md',
          assertions: ['check'],
        })
      )
    ).toContain('1. check');
    expect(
      evaluator.buildEvaluationPrompt(
        context({
          agent_name: 'reviewer',
          assertions: ['check'],
          prompt: 'Preamble',
        })
      )
    ).toContain('Preamble');
    expect(
      evaluator.buildEvaluationPrompt(
        context({ agent_name: 'reviewer', assertions: ['check'] })
      )
    ).toMatch(/^# Evaluation Assertions/);
    expect(
      evaluator.buildEvaluationPrompt(
        context({ assertions: ['check'], prompt: 'Preamble' })
      )
    ).toContain('Preamble');
    expect(
      evaluator.buildEvaluationPrompt(context({ assertions: ['check'] }))
    ).toContain('1. check');
  });

  it('parses every supported output strategy', () => {
    const evaluator = internals();
    const valid = JSON.stringify({
      status: 'passed',
      metrics: { quality: 1 },
      message: 'ok',
    });
    expect(
      evaluator.parseAgentOutput(`\`\`\`json\n${valid}\n\`\`\``)
    ).not.toBeNull();
    expect(evaluator.parseAgentOutput(`prefix ${valid} suffix`)).not.toBeNull();
    expect(evaluator.parseAgentOutput(valid)).not.toBeNull();
    expect(
      evaluator.parseAgentOutput(
        JSON.stringify({
          metrics: { quality: 1 },
          message: 'different field order',
          status: 'passed',
        })
      )
    ).not.toBeNull();
    expect(evaluator.parseAgentOutput('not json')).toBeNull();
  });

  it('rejects every invalid parsed output shape', () => {
    const evaluator = internals();
    for (const value of [
      {},
      { status: 1, metrics: {}, message: 'x' },
      { status: 'passed', metrics: null, message: 'x' },
      { status: 'passed', metrics: [], message: 'x' },
      { status: 'passed', metrics: {}, message: 1 },
      { status: 'unknown', metrics: {}, message: 'x' },
    ]) {
      expect(evaluator.validateAndParse(JSON.stringify(value))).toBeNull();
    }
    expect(evaluator.validateAndParse('{')).toBeNull();
  });

  it('constructs all supported adapters and rejects unknown adapters', async () => {
    const evaluator = internals();
    await expect(evaluator.getAdapter('copilot-cli')).resolves.not.toBeNull();
    await expect(evaluator.getAdapter('claude-code')).resolves.not.toBeNull();
    await expect(evaluator.getAdapter('codex-cli')).resolves.not.toBeNull();
    await expect(evaluator.getAdapter('unknown')).resolves.toBeNull();
  });

  it('includes an optional agent duration in skipped metrics', () => {
    const evaluator = internals();
    expect(
      evaluator.createSkippedResult(new Date().toISOString(), 'x').metrics
    ).toEqual({});
    expect(
      evaluator.createSkippedResult(new Date().toISOString(), 'x', 10).metrics
    ).toEqual({ agent_duration_ms: 10 });
  });

  it('covers post-precondition missing and unknown adapter paths', async () => {
    const missingType = internals();
    missingType.checkPreconditions = jest.fn().mockResolvedValue(true);
    await expect(
      missingType.evaluate(context({ assertions: ['check'] }))
    ).resolves.toMatchObject({
      status: 'skipped',
    });

    const missingAdapter = internals();
    missingAdapter.checkPreconditions = jest.fn().mockResolvedValue(true);
    missingAdapter.getAdapter = jest.fn().mockResolvedValue(null);
    await expect(
      missingAdapter.evaluate(
        context({ type: 'copilot-cli', assertions: ['check'] })
      )
    ).resolves.toMatchObject({ status: 'skipped' });
  });

  it('copies named-agent files and forwards explicit execution options', async () => {
    const root = await makeDirectory();
    const evaluator = internals();
    const execute = jest.fn().mockResolvedValue({
      exitCode: 0,
      status: 'success',
      output: JSON.stringify({
        status: 'passed',
        metrics: { quality: 1 },
        message: 'ok',
      }),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 10,
      errors: [],
    });
    evaluator.getAdapter = jest.fn().mockResolvedValue({
      name: 'mock',
      version: '1',
      checkAvailability: jest.fn().mockResolvedValue(true),
      execute,
      normalizeLog: jest.fn(),
    });

    const result = await evaluator.evaluate({
      modifiedDir: root,
      artifactsDir: root,
      config: {
        type: 'copilot-cli',
        assertions: ['check'],
        agent_name: 'reviewer',
        model: 'judge-model',
        timeout: 25,
        allow_all_tools: true,
      },
    });
    expect(result.status).toBe('passed');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 25,
        config: expect.objectContaining({
          allow_all_tools: true,
          agent_name: 'reviewer',
          model: 'judge-model',
        }),
      })
    );
  });

  it('normalizes Error and non-Error evaluation failures', async () => {
    for (const failure of [new Error('standard failure'), 'string failure']) {
      const evaluator = internals();
      evaluator.checkPreconditions = jest.fn().mockResolvedValue(true);
      evaluator.getAdapter = jest.fn().mockRejectedValue(failure);
      const result = await evaluator.evaluate(
        context({ type: 'copilot-cli', assertions: ['check'] })
      );
      expect(result.status).toBe('skipped');
      expect(result.error?.message).toContain('failure');
      if (failure instanceof Error) {
        expect(result.error?.stack_trace).toBeDefined();
      } else {
        expect(result.error?.stack_trace).toBeUndefined();
      }
    }
  });
});

async function makeDirectory(): Promise<string> {
  const root = path.join(
    os.tmpdir(),
    `youbencha-agentic-judge-${Date.now()}-${Math.random()}`
  );
  await mkdir(root, { recursive: true });
  return root;
}
