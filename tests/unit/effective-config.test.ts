import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  resolveEffectiveEvalConfig,
  resolveEffectiveTestCaseConfig,
} from '../../src/lib/effective-config.js';
import type { Config } from '../../src/schemas/config.schema.js';

const globalConfig: Config = {
  workspace_dir: '.custom-workspaces',
  output_dir: '.custom-output',
  timeout_ms: 300000,
  log_level: 'info',
  keep_workspace: true,
  variables: {
    REPOSITORY: 'https://github.com/example/project.git',
    TASK: 'Implement the requested behavior',
  },
  agent: {
    timeout_ms: 450000,
    model: 'configured-model',
  },
  evaluators: {
    max_concurrent: 2,
  },
};

describe('effective configuration', () => {
  let tempDir: string;
  let configFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effective-config-'));
    configFile = path.join(tempDir, 'testcase.yaml');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('applies variables, global defaults, evaluator files, and prompt files', async () => {
    await fs.writeFile(path.join(tempDir, 'prompt.md'), 'Prompt from a file');
    await fs.writeFile(
      path.join(tempDir, 'evaluator.yaml'),
      'name: git-diff\nconfig:\n  assertions:\n    max_files_changed: 3\n'
    );

    const resolved = resolveEffectiveTestCaseConfig(
      {
        name: 'Effective config',
        description: 'Exercises the complete resolution path',
        repo: '${REPOSITORY}',
        agent: {
          type: 'copilot-cli',
          config: { prompt_file: './prompt.md' },
        },
        evaluators: [{ file: './evaluator.yaml' }],
      },
      configFile,
      globalConfig
    );

    expect(resolved.repo).toBe('https://github.com/example/project.git');
    expect(resolved.workspace_dir).toBe('.custom-workspaces');
    expect(resolved.timeout).toBe(450000);
    expect(resolved.agent.model).toBe('configured-model');
    expect(resolved.agent.config?.prompt).toBe('Prompt from a file');
    expect(resolved.evaluators).toEqual([
      {
        name: 'git-diff',
        config: { assertions: { max_files_changed: 3 } },
      },
    ]);
  });

  it('rejects unresolved variables and unknown evaluators before execution', () => {
    const base = {
      name: 'Invalid config',
      description: 'Should fail before execution',
      repo: 'https://github.com/example/${MISSING}.git',
      agent: { type: 'copilot-cli', config: { prompt: '${TASK}' } },
      evaluators: [{ name: 'git-dif', config: {} }],
    };

    expect(() =>
      resolveEffectiveTestCaseConfig(base, configFile, globalConfig)
    ).toThrow('Unresolved configuration variable');

    expect(() =>
      resolveEffectiveTestCaseConfig(
        { ...base, repo: 'https://github.com/example/project.git' },
        configFile,
        globalConfig
      )
    ).toThrow('Unknown evaluator: git-dif');
  });

  it('accepts custom agentic-judge names and resolves eval prompt files', async () => {
    await fs.writeFile(path.join(tempDir, 'judge.md'), 'Judge these changes');

    const resolved = resolveEffectiveEvalConfig(
      {
        name: 'Eval',
        description: 'Evaluate an existing directory',
        directory: tempDir,
        evaluators: [
          {
            name: 'agentic-judge:security',
            config: {
              type: 'copilot-cli',
              prompt_file: './judge.md',
              assertions: {
                secure:
                  'The changes do not introduce a security vulnerability.',
              },
            },
          },
        ],
      },
      configFile,
      globalConfig
    );

    expect(resolved.output_dir).toBe('.custom-output');
    expect(resolved.evaluators[0].config?.prompt).toBe('Judge these changes');
  });

  it('preserves Codex defaults while resolving the effective prompt', () => {
    const resolved = resolveEffectiveTestCaseConfig(
      {
        name: 'Codex effective config',
        description: 'Resolves a Codex prompt without dropping safe defaults',
        repo: 'https://github.com/example/project.git',
        agent: {
          type: 'codex-cli',
          config: { prompt: '${TASK}', reasoning_effort: 'high' },
        },
        evaluators: [{ name: 'git-diff' }],
      },
      configFile,
      globalConfig
    );

    expect(resolved.agent.config).toEqual(
      expect.objectContaining({
        prompt: 'Implement the requested behavior',
        sandbox: 'workspace-write',
        approval_policy: 'never',
        ephemeral: true,
        ignore_user_config: true,
        ignore_rules: false,
        search: false,
      })
    );
  });

  it('materializes and validates the inherited agentic judge adapter type', () => {
    const base = {
      name: 'Inherited judge adapter',
      description: 'Uses the main adapter for an agentic judge',
      repo: 'https://github.com/example/project.git',
      agent: {
        type: 'codex-cli',
        config: { prompt: '${TASK}' },
      },
      evaluators: [
        {
          name: 'agentic-judge',
          config: {
            assertions: { quality: 'The change is correct.' },
          },
        },
      ],
    };

    const resolved = resolveEffectiveTestCaseConfig(
      base,
      configFile,
      globalConfig
    );
    expect(resolved.evaluators[0].config).toMatchObject({
      type: 'codex-cli',
      assertions: { quality: 'The change is correct.' },
    });

    expect(() =>
      resolveEffectiveTestCaseConfig(
        {
          ...base,
          evaluators: [
            {
              name: 'agentic-judge',
              config: {
                agent_name: 'reviewer',
                assertions: { quality: 'The change is correct.' },
              },
            },
          ],
        },
        configFile,
        globalConfig
      )
    ).toThrow(/codex-cli does not support agent_name/);

    expect(() =>
      resolveEffectiveTestCaseConfig(
        {
          ...base,
          evaluators: [
            {
              name: 'agentic-judge',
              config: {
                max_ai_credits: 1,
                assertions: { quality: 'The change is correct.' },
              },
            },
          ],
        },
        configFile,
        globalConfig
      )
    ).toThrow(/codex-cli does not support: max_ai_credits/);
  });
});
