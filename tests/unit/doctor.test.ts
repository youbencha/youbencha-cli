import { describe, expect, it } from '@jest/globals';
import { DoctorDependencies, runDoctor } from '../../src/cli/commands/doctor';
import { defaultConfig } from '../../src/schemas/config.schema';

function createDependencies(
  overrides: Partial<DoctorDependencies> = {}
): DoctorDependencies {
  return {
    nodeVersion: '20.19.0',
    cwd: '/project',
    commandVersion: async (command) =>
      command === 'git' ? 'git version 2.47.0' : null,
    isWritable: async () => true,
    pathExists: async () => false,
    findActiveConfigFile: async () => null,
    readTextFile: async () => '',
    loadConfig: async () => defaultConfig,
    ...overrides,
  };
}

describe('doctor checks', () => {
  it('passes required checks and reports optional setup as warnings', async () => {
    const result = await runDoctor(createDependencies());

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Node.js', status: 'pass' }),
        expect.objectContaining({ name: 'Git', status: 'pass' }),
        expect.objectContaining({ name: 'Agent CLI', status: 'warn' }),
        expect.objectContaining({ name: 'Workspace', status: 'pass' }),
        expect.objectContaining({
          name: 'Judge agent files',
          status: 'warn',
        }),
      ])
    );
  });

  it('reports supported agent CLIs and installed judge files', async () => {
    const result = await runDoctor(
      createDependencies({
        commandVersion: async (command) => {
          if (command === 'git') return 'git version 2.47.0';
          if (command === 'claude') return '2.1.0';
          return null;
        },
        pathExists: async () => true,
      })
    );

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Agent CLI',
          status: 'pass',
          message: expect.stringContaining('Claude Code CLI'),
        }),
        expect.objectContaining({
          name: 'Judge agent files',
          status: 'pass',
        }),
      ])
    );
  });

  it('fails for blocking runtime, Git, workspace, and config issues', async () => {
    const result = await runDoctor(
      createDependencies({
        nodeVersion: '18.20.0',
        commandVersion: async () => null,
        isWritable: async () => false,
        findActiveConfigFile: async () => '/project/.youbencharc',
        readTextFile: async () => 'unknown_setting: true',
      })
    );

    expect(result.ok).toBe(false);
    expect(
      result.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.name)
    ).toEqual(
      expect.arrayContaining(['Node.js', 'Git', 'Configuration', 'Workspace'])
    );
  });

  it('does not expose configured variable values in the effective summary', async () => {
    const result = await runDoctor(
      createDependencies({
        loadConfig: async () => ({
          ...defaultConfig,
          variables: { API_TOKEN: 'super-secret-value' },
        }),
      })
    );
    const configuration = result.checks.find(
      (check) => check.name === 'Configuration'
    );

    expect(configuration?.message).not.toContain('super-secret-value');
    expect(configuration?.message).not.toContain('API_TOKEN');
  });

  it('reports structured Codex version and persisted login diagnostics without executing a model request', async () => {
    const probes: Array<{ command: string; args: readonly string[] }> = [];
    const result = await runDoctor(
      createDependencies({
        commandVersion: async (command) => {
          if (command === 'git') return 'git version 2.47.0';
          if (command === 'codex') return 'codex-cli 0.95.0';
          return null;
        },
        commandOutput: async (command, args) => {
          probes.push({ command, args });
          if (args[0] === '--help') {
            return {
              exitCode: 0,
              stdout: '--ask-for-approval --sandbox',
              stderr: '',
            };
          }
          if (args[0] === 'exec') {
            return {
              exitCode: 0,
              stdout:
                '--json --ephemeral --color --sandbox --ignore-user-config -C',
              stderr: '',
            };
          }
          return {
            exitCode: 0,
            stdout: 'Signed in with ChatGPT',
            stderr: '',
          };
        },
      })
    );

    expect(probes).toEqual([
      { command: 'codex', args: ['login', 'status'] },
      { command: 'codex', args: ['--help'] },
      { command: 'codex', args: ['exec', '--help'] },
    ]);
    expect(
      probes.some(({ args }) => args[0] === 'exec' && args[1] !== '--help')
    ).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Codex CLI',
          status: 'pass',
          message: expect.stringMatching(
            /Installed: yes.*Authentication: signed in.*JSONL output: supported/
          ),
        }),
      ])
    );
  });

  it('recognizes process-scoped Codex API key availability without exposing it', async () => {
    const result = await runDoctor(
      createDependencies({
        commandVersion: async (command) =>
          command === 'git'
            ? 'git version 2.47.0'
            : command === 'codex'
              ? 'codex-cli 0.95.0'
              : null,
        commandOutput: async () => ({
          exitCode: 0,
          stdout:
            '--ask-for-approval --sandbox --json --ephemeral --color --ignore-user-config -C',
          stderr: '',
        }),
        hasCodexApiKey: true,
      })
    );
    const codex = result.checks.find((check) => check.name === 'Codex CLI');

    expect(codex?.status).toBe('pass');
    expect(codex?.message).toContain('CODEX_API_KEY available');
  });

  it('reports unsupported Codex capabilities from side-effect-free help probes', async () => {
    const result = await runDoctor(
      createDependencies({
        commandVersion: async (command) =>
          command === 'git'
            ? 'git version 2.47.0'
            : command === 'codex'
              ? 'codex-cli 0.1.0'
              : null,
        commandOutput: async (_command, args) =>
          args[0] === 'login'
            ? {
                exitCode: 1,
                stdout: '',
                stderr: 'Not logged in',
              }
            : { exitCode: 0, stdout: 'usage: codex', stderr: '' },
      })
    );
    const codex = result.checks.find((check) => check.name === 'Codex CLI');

    expect(codex?.status).toBe('warn');
    expect(codex?.message).toContain('Authentication: unavailable');
    expect(codex?.message).toContain('JSONL output: unsupported');
    expect(codex?.message).toContain('Workspace sandbox: unsupported');
  });

  it('keeps unrecognized Codex login failures at unknown', async () => {
    const result = await runDoctor(
      createDependencies({
        commandVersion: async (command) =>
          command === 'git'
            ? 'git version 2.47.0'
            : command === 'codex'
              ? 'codex-cli 0.95.0'
              : null,
        commandOutput: async (_command, args) =>
          args[0] === 'login'
            ? {
                exitCode: 2,
                stdout: '',
                stderr: 'Configuration could not be loaded',
              }
            : {
                exitCode: 0,
                stdout:
                  '--ask-for-approval --sandbox --json --ephemeral --color --ignore-user-config -C',
                stderr: '',
              },
      })
    );
    const codex = result.checks.find((check) => check.name === 'Codex CLI');

    expect(codex?.message).toContain('Authentication: unknown');
  });
});
