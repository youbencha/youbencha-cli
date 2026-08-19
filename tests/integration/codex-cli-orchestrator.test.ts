import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { MarkdownReporter } from '../../src/reporters/markdown.js';
import type { TestCaseConfig } from '../../src/schemas/testcase.schema.js';
import { youBenchaLogSchema } from '../../src/schemas/youbenchalog.schema.js';

const execFileAsync = promisify(execFile);

describe('Codex CLI orchestrator integration', () => {
  let testDirectory: string;
  let fixtureRepository: string;
  let fakeBinDirectory: string;
  let workspaceDirectory: string;
  let configPath: string;
  let originalPath: string | undefined;
  let originalPrompt: string | undefined;

  beforeEach(async () => {
    testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-codex-orchestrator-')
    );
    fixtureRepository = path.join(testDirectory, 'fixture-repository');
    fakeBinDirectory = path.join(testDirectory, 'bin');
    workspaceDirectory = path.join(testDirectory, 'workspaces');
    configPath = path.join(testDirectory, 'testcase.yaml');
    await Promise.all([
      fs.mkdir(fixtureRepository, { recursive: true }),
      fs.mkdir(fakeBinDirectory, { recursive: true }),
      fs.writeFile(configPath, '# Direct orchestrator integration fixture\n'),
    ]);

    await execFileAsync('git', ['init', '--quiet', '-b', 'main'], {
      cwd: fixtureRepository,
    });
    await execFileAsync(
      'git',
      ['config', 'user.email', 'codex-integration@example.invalid'],
      { cwd: fixtureRepository }
    );
    await execFileAsync('git', ['config', 'user.name', 'Codex Integration'], {
      cwd: fixtureRepository,
    });
    await fs.writeFile(
      path.join(fixtureRepository, 'README.md'),
      '# Hermetic Codex fixture\n'
    );
    await execFileAsync('git', ['add', 'README.md'], {
      cwd: fixtureRepository,
    });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'Initial fixture'], {
      cwd: fixtureRepository,
    });
    await installFakeCodex(fakeBinDirectory);

    originalPath = process.env.PATH;
    originalPrompt = process.env.YOUBENCHA_FAKE_CODEX_PROMPT;
    process.env.PATH = `${fakeBinDirectory}${path.delimiter}${originalPath ?? ''}`;
    process.env.YOUBENCHA_FAKE_CODEX_PROMPT =
      'Create codex-orchestrated-change.txt with the fixture content.';
  });

  afterEach(async () => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalPrompt === undefined) {
      delete process.env.YOUBENCHA_FAKE_CODEX_PROMPT;
    } else {
      process.env.YOUBENCHA_FAKE_CODEX_PROMPT = originalPrompt;
    }
    await fs.rm(testDirectory, { recursive: true, force: true });
  });

  it('runs Codex through the registry, workspace, normalization, manifest, and reporter', async () => {
    const config: TestCaseConfig = {
      name: 'codex-orchestrator-offline',
      description: 'Exercises the complete Codex orchestration path offline.',
      repo: pathToFileURL(fixtureRepository).href,
      branch: 'main',
      workspace_dir: workspaceDirectory,
      timeout: 15_000,
      agent: {
        type: 'codex-cli',
        model: 'fake-codex-model',
        config: {
          prompt: process.env.YOUBENCHA_FAKE_CODEX_PROMPT,
          sandbox: 'workspace-write',
          approval_policy: 'never',
          ephemeral: true,
          ignore_user_config: true,
          ignore_rules: false,
          reasoning_effort: 'high',
          search: false,
        },
      },
      evaluators: [
        {
          name: 'git-diff',
          config: {
            assertions: {
              max_files_changed: 1,
              max_lines_added: 1,
              max_lines_removed: 0,
            },
          },
        },
      ],
    };

    const results = await new Orchestrator({
      keepWorkspace: true,
      defaultTimeout: 15_000,
      agentTimeout: 15_000,
    }).runEvaluation(config, configPath, {
      workspaceRunId: 'codex-offline-run',
    });

    const artifactsDirectory = path.join(
      workspaceDirectory,
      'codex-offline-run',
      'artifacts'
    );
    const modifiedDirectory = path.join(
      workspaceDirectory,
      'codex-offline-run',
      'src-modified'
    );
    await expect(
      fs.readFile(
        path.join(modifiedDirectory, 'codex-orchestrated-change.txt'),
        'utf8'
      )
    ).resolves.toBe('created through the orchestrator\n');

    const normalizedLog = youBenchaLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(artifactsDirectory, 'youbencha.log.json'),
          'utf8'
        )
      )
    );
    expect({
      agent: results.agent,
      errors: normalizedLog.errors,
    }).toMatchObject({
      agent: {
        type: 'codex-cli',
        status: 'success',
        exit_code: 0,
      },
      errors: [],
    });
    expect(results.evaluators).toEqual([
      expect.objectContaining({
        evaluator: 'git-diff',
        status: 'passed',
        metrics: expect.objectContaining({
          files_changed: 1,
          lines_added: 1,
        }),
      }),
    ]);
    expect(normalizedLog.agent.name).toBe('codex-cli');
    expect(normalizedLog.usage).toMatchObject({
      prompt_tokens: 13,
      cached_prompt_tokens: 5,
      completion_tokens: 8,
      reasoning_tokens: 2,
      total_tokens: 21,
      measurement_source: 'measured',
    });
    expect(normalizedLog.provenance).toMatchObject({
      session_id: 'orchestrator-thread',
      structured_output_format: 'jsonl',
      usage_source: 'measured',
    });
    expect(normalizedLog.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'The hermetic Codex task is complete.',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('codex-orchestrated-change.txt'),
          tool_calls: [
            expect.objectContaining({
              function: expect.objectContaining({ name: 'file_change' }),
            }),
          ],
        }),
      ])
    );

    expect(results.artifacts.agent_artifacts).toHaveLength(4);
    expect(results.artifacts.agent_artifacts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^codex-cli-logs[\\/]+events-/),
        expect.stringMatching(/^codex-cli-logs[\\/]+stderr-/),
        expect.stringMatching(/^codex-cli-logs[\\/]+final-message-/),
        expect.stringMatching(/^codex-cli-logs[\\/]+execution-metadata-/),
      ])
    );
    const persistedResults = JSON.parse(
      await fs.readFile(path.join(artifactsDirectory, 'results.json'), 'utf8')
    ) as { artifacts: { agent_artifacts?: string[] } };
    expect(persistedResults.artifacts.agent_artifacts).toEqual(
      results.artifacts.agent_artifacts
    );

    const report = await new MarkdownReporter().generate(results);
    expect(report).toContain('**Agent Artifacts:**');
    expect(report).toContain('codex-cli-logs');
    expect(report).toContain('events-');
  }, 30_000);
});

async function installFakeCodex(directory: string): Promise<void> {
  const scriptPath = path.join(directory, 'fake-codex.mjs');
  const script = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const args = process.argv.slice(2);',
    "if (args.length === 1 && args[0] === '--version') {",
    "  process.stdout.write('codex-cli 9.9.9\\n');",
    '  process.exit(0);',
    '}',
    "if (args.length === 1 && args[0] === '--help') {",
    "  process.stdout.write('--ask-for-approval --search\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'exec' && args[1] === '--help') {",
    "  process.stdout.write('--json --ephemeral --color --sandbox --ignore-user-config --output-last-message -C\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'login' && args[1] === 'status') {",
    "  process.stdout.write('Logged in using the hermetic fixture\\n');",
    '  process.exit(0);',
    '}',
    "const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(42); };",
    "const execIndex = args.indexOf('exec');",
    "if (execIndex !== 2 || args[0] !== '--ask-for-approval' || args[1] !== 'never') fail('invalid global flags');",
    "for (const flag of ['--json', '--ephemeral', '--ignore-user-config']) if (!args.includes(flag)) fail('missing ' + flag);",
    "if (args.includes('--skip-git-repo-check')) fail('unsafe git bypass');",
    "if (args.includes('--dangerously-bypass-approvals-and-sandbox')) fail('unsafe sandbox bypass');",
    "if (args.at(-1) !== '-') fail('missing stdin sentinel');",
    "const cwdIndex = args.indexOf('-C');",
    'const repo = args[cwdIndex + 1];',
    "if (!repo || path.resolve(repo) !== path.resolve(process.cwd())) fail('cwd mismatch');",
    "let prompt = '';",
    "process.stdin.setEncoding('utf8');",
    'for await (const chunk of process.stdin) prompt += chunk;',
    "if (prompt !== process.env.YOUBENCHA_FAKE_CODEX_PROMPT) fail('prompt was not delivered through stdin');",
    "fs.writeFileSync(path.join(repo, 'codex-orchestrated-change.txt'), 'created through the orchestrator\\n');",
    "const finalMessage = 'The hermetic Codex task is complete.';",
    "if (args.includes('--output-last-message')) fail('unsafe direct final-message artifact');",
    'const events = [',
    "  { type: 'thread.started', thread_id: 'orchestrator-thread' },",
    "  { type: 'turn.started' },",
    "  { type: 'item.completed', item: { id: 'file-1', type: 'file_change', changes: [{ path: 'codex-orchestrated-change.txt', kind: 'add' }], status: 'completed' } },",
    "  { type: 'item.completed', item: { id: 'message-1', type: 'agent_message', text: finalMessage } },",
    "  { type: 'turn.completed', model: 'fake-codex-model', usage: { input_tokens: 13, cached_input_tokens: 5, output_tokens: 8, reasoning_output_tokens: 2 } },",
    '];',
    "process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
    "process.stderr.write('hermetic Codex progress\\n');",
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');

  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(directory, 'codex.cmd'),
      '@echo off\r\nnode "%~dp0fake-codex.mjs" %*\r\n',
      'utf8'
    );
  } else {
    const executablePath = path.join(directory, 'codex');
    await fs.writeFile(
      executablePath,
      `#!/usr/bin/env node\n${script}`,
      'utf8'
    );
    await fs.chmod(executablePath, 0o755);
  }
}
