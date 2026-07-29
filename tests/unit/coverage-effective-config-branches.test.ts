import * as path from 'node:path';
import {
  resolveEffectiveEvalConfig,
  resolveEffectiveTestCaseConfig,
} from '../../src/lib/effective-config.js';
import type { Config } from '../../src/schemas/config.schema.js';

const configFile = path.resolve('coverage-effective-config.yaml');

function testcase(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: 'Coverage',
    description: 'Effective config branch coverage',
    repo: 'https://github.com/example/project.git',
    agent: { type: 'copilot-cli' },
    evaluators: [{ name: 'git-diff' }],
    ...overrides,
  };
}

describe('effective configuration branch coverage', () => {
  it('reports root and plural unresolved variables', () => {
    expect(() =>
      resolveEffectiveTestCaseConfig(
        '${ROOT_MISSING}',
        configFile,
        {} as Config
      )
    ).toThrow('<root>: ${ROOT_MISSING}');

    expect(() =>
      resolveEffectiveTestCaseConfig(
        testcase({
          repo: 'https://github.com/${OWNER}/${REPOSITORY}.git',
        }),
        configFile,
        {} as Config
      )
    ).toThrow('Unresolved configuration variables:');
  });

  it('resolves a minimal testcase without configured variables or agent config', () => {
    const resolved = resolveEffectiveTestCaseConfig(testcase(), configFile, {
      timeout_ms: 1234,
      output_dir: 'global-output',
    } as Config);
    expect(resolved.agent.config).toBeUndefined();
    expect(resolved.timeout).toBe(1234);
    expect(resolved.agent.model).toBeUndefined();
  });

  it('prefers explicit testcase and eval defaults', () => {
    const resolved = resolveEffectiveTestCaseConfig(
      testcase({
        workspace_dir: 'explicit-workspace',
        timeout: 99,
        agent: {
          type: 'copilot-cli',
          model: 'explicit-model',
          config: { prompt: 'Explicit prompt' },
        },
      }),
      configFile,
      {
        workspace_dir: 'global-workspace',
        timeout_ms: 1234,
        agent: { timeout_ms: 5678, model: 'global-model' },
      } as Config
    );
    expect(resolved.workspace_dir).toBe('explicit-workspace');
    expect(resolved.timeout).toBe(99);
    expect(resolved.agent.model).toBe('explicit-model');

    const evalConfig = resolveEffectiveEvalConfig(
      {
        name: 'Eval',
        description: 'Explicit output',
        directory: '.',
        output_dir: 'explicit-output',
        evaluators: [{ name: 'git-diff' }],
      },
      configFile,
      { output_dir: 'global-output' } as Config
    );
    expect(evalConfig.output_dir).toBe('explicit-output');
  });

  it('normalizes non-string evaluator prompt fields as absent', () => {
    const resolved = resolveEffectiveTestCaseConfig(
      testcase({
        evaluators: [
          {
            name: 'git-diff',
            config: { prompt: 123, prompt_file: 456 },
          },
        ],
      }),
      configFile,
      {} as Config
    );
    expect(resolved.evaluators[0].config).not.toHaveProperty('prompt_file');
  });

  it('preserves an inline evaluator prompt', () => {
    const resolved = resolveEffectiveTestCaseConfig(
      testcase({
        evaluators: [
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              prompt: 'Judge this result',
              assertions: { quality: 'The implementation is correct' },
            },
          },
        ],
      }),
      configFile,
      {} as Config
    );

    expect(resolved.evaluators[0].config).toMatchObject({
      prompt: 'Judge this result',
    });
  });
});
