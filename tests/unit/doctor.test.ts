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
});
