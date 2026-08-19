import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

describe('Integration: Run Command', () => {
  const projectDir = path.join(__dirname, '..', '..');
  const remoteRepoUrl = 'https://example.com/youbencha-offline-fixture.git';
  let testWorkspaceDir: string;
  let testSuiteConfig: string;
  let testRepoDir: string;
  let fakeBinDir: string;
  let commandEnvironment: NodeJS.ProcessEnv;

  beforeAll(async () => {
    testWorkspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-run-command-')
    );
    testSuiteConfig = path.join(testWorkspaceDir, 'test-suite.yaml');
    testRepoDir = path.join(testWorkspaceDir, 'test-repo');
    fakeBinDir = path.join(testWorkspaceDir, 'bin');

    await fs.mkdir(testRepoDir);
    await fs.mkdir(fakeBinDir);
    execFileSync('git', ['init', '-b', 'master'], { cwd: testRepoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: testRepoDir,
    });
    execFileSync('git', ['config', 'user.name', 'Test User'], {
      cwd: testRepoDir,
    });
    await fs.writeFile(
      path.join(testRepoDir, 'README.md'),
      '# Offline fixture\n'
    );
    execFileSync('git', ['add', 'README.md'], { cwd: testRepoDir });
    execFileSync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testRepoDir,
    });

    const fakeAgentPath = path.join(
      fakeBinDir,
      process.platform === 'win32' ? 'copilot.ps1' : 'copilot'
    );
    if (process.platform === 'win32') {
      await fs.writeFile(
        fakeAgentPath,
        [
          `Write-Output '{"type":"assistant.message","data":{"messageId":"m1","content":"Offline test agent completed"}}'`,
          `Write-Output '{"type":"result","data":{"exitCode":0,"usage":{"inputTokens":1,"outputTokens":1}}}'`,
          '',
        ].join('\r\n')
      );
      await fs.writeFile(
        path.join(fakeBinDir, 'where.cmd'),
        `@echo off\r\necho ${fakeAgentPath}\r\n`
      );
    } else {
      await fs.writeFile(
        fakeAgentPath,
        [
          '#!/usr/bin/env sh',
          `printf '%s\\n' '{"type":"assistant.message","data":{"messageId":"m1","content":"Offline test agent completed"}}'`,
          `printf '%s\\n' '{"type":"result","data":{"exitCode":0,"usage":{"inputTokens":1,"outputTokens":1}}}'`,
          '',
        ].join('\n')
      );
      await fs.chmod(fakeAgentPath, 0o755);
    }

    const suiteYaml = `
name: run-command-integration-test
description: Integration test for run command
repo: "${remoteRepoUrl}"
branch: master
agent:
  type: copilot-cli
  config:
    prompt: "Inspect the local fixture"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${path.join(testWorkspaceDir, '.youbencha-workspace').replace(/\\/g, '/')}"
timeout: 5000
`.trim();
    await fs.writeFile(testSuiteConfig, suiteYaml);

    const localRepoUrl = pathToFileURL(testRepoDir).href;
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ??
      'PATH';
    commandEnvironment = {
      ...process.env,
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${localRepoUrl}.insteadOf`,
      GIT_CONFIG_VALUE_0: remoteRepoUrl,
    };
    commandEnvironment[pathKey] =
      `${fakeBinDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
  });

  afterAll(async () => {
    await fs.rm(testWorkspaceDir, { recursive: true, force: true });
  });

  it('runs a complete evaluation without network or a real agent CLI', () => {
    const cliPath = path.join(projectDir, 'dist', 'cli', 'index.js');
    const output = execFileSync(
      process.execPath,
      [cliPath, 'run', '-c', testSuiteConfig],
      {
        cwd: projectDir,
        encoding: 'utf-8',
        env: commandEnvironment,
      }
    );

    expect(output).toContain('Evaluation completed successfully');
  }, 60000);

  it('generates a valid results.json structure', async () => {
    const workspaceDir = path.join(testWorkspaceDir, '.youbencha-workspace');
    const entries = await fs.readdir(workspaceDir);
    const runDirs = entries.filter((entry) => entry.startsWith('run-'));
    expect(runDirs).toHaveLength(1);

    const resultsPath = path.join(
      workspaceDir,
      runDirs[0],
      'artifacts',
      'results.json'
    );
    const results = JSON.parse(await fs.readFile(resultsPath, 'utf-8')) as {
      version: string;
      test_case: object;
      execution: object;
      evaluators: Array<{ evaluator: string }>;
      summary: object;
    };

    expect(results.version).toBe('1.0.0');
    expect(results.test_case).toBeDefined();
    expect(results.execution).toBeDefined();
    expect(results.summary).toBeDefined();
    expect(
      results.evaluators.some(
        (evaluation) => evaluation.evaluator === 'git-diff'
      )
    ).toBe(true);
  });

  it('rejects an invalid suite configuration before execution', async () => {
    const invalidSuiteConfig = path.join(
      testWorkspaceDir,
      'invalid-suite.yaml'
    );
    await fs.writeFile(invalidSuiteConfig, 'version: "1.0"\n');

    const cliPath = path.join(projectDir, 'dist', 'cli', 'index.js');
    let exitStatus: number | undefined;
    try {
      execFileSync(
        process.execPath,
        [cliPath, 'run', '-c', invalidSuiteConfig],
        {
          cwd: projectDir,
          encoding: 'utf-8',
          env: commandEnvironment,
        }
      );
    } catch (error) {
      exitStatus = (error as { status?: number }).status;
    }

    expect(exitStatus).toBe(1);
  });
});
