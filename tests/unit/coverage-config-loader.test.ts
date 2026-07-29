import * as fs from 'node:fs/promises';
import * as os from 'os';
import * as path from 'node:path';
import {
  configExists,
  findActiveConfigFile,
  getDefaultConfigPath,
  loadConfig,
} from '../../src/lib/config-loader.js';

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: jest.fn(actual.homedir),
  };
});

describe('configuration loader filesystem coverage', () => {
  let root: string;
  let userDirectory: string;
  let projectDirectory: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-config-loader-'));
    userDirectory = path.join(root, 'user');
    projectDirectory = path.join(root, 'project');
    await Promise.all([fs.mkdir(userDirectory), fs.mkdir(projectDirectory)]);
    jest.mocked(os.homedir).mockReturnValue(userDirectory);
    process.chdir(projectDirectory);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    jest.mocked(os.homedir).mockReset();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns defaults and no active file when neither level exists', async () => {
    const config = await loadConfig();
    expect(config.workspace_dir).toBeDefined();
    await expect(findActiveConfigFile()).resolves.toBeNull();
    await expect(configExists('project')).resolves.toBe(false);
    await expect(configExists('user')).resolves.toBe(false);
    expect(getDefaultConfigPath('project')).toBe(
      path.join(projectDirectory, '.youbencharc')
    );
    expect(getDefaultConfigPath('user')).toBe(
      path.join(userDirectory, '.youbencharc')
    );
  });

  it('merges every supported user and project setting with project priority', async () => {
    const userFile = path.join(userDirectory, '.youbencharc.yaml');
    const projectFile = path.join(projectDirectory, '.youbencharc.json');
    await fs.writeFile(
      userFile,
      [
        'workspace_dir: user-workspace',
        'output_dir: user-output',
        'timeout_ms: 1000',
        'log_level: warn',
        'keep_workspace: false',
        'variables:',
        '  USER_VALUE: user',
        'agent:',
        '  timeout_ms: 2000',
        'evaluators:',
        '  max_concurrent: 2',
      ].join('\n')
    );
    await fs.writeFile(
      projectFile,
      JSON.stringify({
        workspace_dir: 'project-workspace',
        output_dir: 'project-output',
        timeout_ms: 3000,
        log_level: 'debug',
        keep_workspace: true,
        variables: { PROJECT_VALUE: 'project' },
        agent: { model: 'project-model' },
        evaluators: { max_concurrent: 4 },
      })
    );

    await expect(configExists('user')).resolves.toBe(true);
    await expect(configExists('project')).resolves.toBe(true);
    await expect(findActiveConfigFile()).resolves.toBe(projectFile);
    await expect(loadConfig()).resolves.toMatchObject({
      workspace_dir: 'project-workspace',
      output_dir: 'project-output',
      timeout_ms: 3000,
      log_level: 'debug',
      keep_workspace: true,
      variables: {
        USER_VALUE: 'user',
        PROJECT_VALUE: 'project',
      },
      agent: {
        timeout_ms: 2000,
        model: 'project-model',
      },
      evaluators: {
        max_concurrent: 4,
      },
    });

    await fs.rm(projectFile);
    await expect(findActiveConfigFile()).resolves.toBe(userFile);
  });

  it('wraps parsing and schema failures with the source path', async () => {
    const invalidFile = path.join(projectDirectory, '.youbencharc');
    await fs.writeFile(invalidFile, 'timeout_ms: not-a-number');
    await expect(loadConfig()).rejects.toThrow(
      `Failed to load config from ${invalidFile}`
    );
  });
});
