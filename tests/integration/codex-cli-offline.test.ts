import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { CodexCLIAdapter } from '../../src/adapters/codex-cli.js';

const execFileAsync = promisify(execFile);

describe('Codex CLI offline process integration', () => {
  let testDirectory: string;
  let binDirectory: string;
  let repoDirectory: string;
  let artifactsDirectory: string;

  beforeEach(async () => {
    testDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-codex-offline-')
    );
    binDirectory = path.join(testDirectory, 'bin');
    repoDirectory = path.join(testDirectory, 'repo');
    artifactsDirectory = path.join(testDirectory, 'artifacts');
    await Promise.all([
      fs.mkdir(binDirectory, { recursive: true }),
      fs.mkdir(repoDirectory, { recursive: true }),
      fs.mkdir(artifactsDirectory, { recursive: true }),
    ]);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repoDirectory });
    await installFakeCodex(binDirectory);
  });

  afterEach(async () => {
    await fs.rm(testDirectory, { recursive: true, force: true });
  });

  it('probes auth and executes stdin JSONL through a deterministic fake CLI', async () => {
    const prompt = 'Create the deterministic fixture.\nUnicode: café ✓';
    const fakePath = prependPath(binDirectory);
    const adapter = new CodexCLIAdapter();

    const availability = await adapter.diagnoseAvailability({
      PATH: fakePath,
    });
    expect(availability).toMatchObject({
      installed: true,
      authenticated: true,
      version: '9.9.9',
    });

    const result = await adapter.execute({
      workspaceDir: repoDirectory,
      repoDir: repoDirectory,
      artifactsDir: artifactsDirectory,
      config: {
        prompt,
        sandbox: 'workspace-write',
        approval_policy: 'never',
        ephemeral: true,
        ignore_user_config: true,
        ignore_rules: false,
        reasoning_effort: 'high',
        search: true,
      },
      timeout: 15_000,
      env: {
        PATH: fakePath,
        YOUBENCHA_FAKE_CODEX_PROMPT: prompt,
      },
    });

    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
      output: 'Fake Codex completed the task.',
      errors: [],
    });
    expect(result.telemetry).toMatchObject({
      sessionId: 'fake-thread-1',
      finalResponse: 'Fake Codex completed the task.',
      structuredOutputFormat: 'jsonl',
      usage: {
        promptTokens: 21,
        cachedPromptTokens: 8,
        completionTokens: 7,
        reasoningTokens: 3,
        totalTokens: 28,
        source: 'measured',
      },
      effectiveConfig: {
        approval_policy: 'never',
        sandbox: 'workspace-write',
        ephemeral: true,
        ignore_user_config: true,
        search: true,
        search_grants_shell_network: false,
      },
    });
    await expect(
      fs.readFile(path.join(repoDirectory, 'codex-fake-change.txt'), 'utf8')
    ).resolves.toBe('created by fake Codex\n');

    const artifactDirectory = path.join(artifactsDirectory, 'codex-cli-logs');
    const artifacts = await fs.readdir(artifactDirectory);
    const eventArtifact = artifacts.find((name) => name.startsWith('events-'));
    const stderrArtifact = artifacts.find((name) => name.startsWith('stderr-'));
    const finalArtifact = artifacts.find((name) =>
      name.startsWith('final-message-')
    );
    const metadataArtifact = artifacts.find((name) =>
      name.startsWith('execution-metadata-')
    );

    expect(eventArtifact).toBeDefined();
    expect(stderrArtifact).toBeDefined();
    expect(finalArtifact).toBeDefined();
    expect(metadataArtifact).toBeDefined();
    await expect(
      fs.readFile(path.join(artifactDirectory, eventArtifact!), 'utf8')
    ).resolves.toContain('"type":"turn.completed"');
    await expect(
      fs.readFile(path.join(artifactDirectory, stderrArtifact!), 'utf8')
    ).resolves.toContain('fake Codex progress');
    await expect(
      fs.readFile(path.join(artifactDirectory, finalArtifact!), 'utf8')
    ).resolves.toBe('Fake Codex completed the task.');
    const metadata = JSON.parse(
      await fs.readFile(path.join(artifactDirectory, metadataArtifact!), 'utf8')
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      adapter_version: '1.0.0',
      approval_policy: 'never',
      ephemeral: true,
      ignore_user_config: true,
      thread_id: 'fake-thread-1',
      exit_code: 0,
      usage_source: 'measured',
    });
    expect(JSON.stringify(metadata)).not.toContain(prompt);
  }, 30_000);
});

function prependPath(directory: string): string {
  return `${directory}${path.delimiter}${process.env.PATH ?? ''}`;
}

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
    "  process.stdout.write('Logged in using a deterministic fixture\\n');",
    '  process.exit(0);',
    '}',
    "const execIndex = args.indexOf('exec');",
    'const fail = (message) => { process.stderr.write(message + "\\n"); process.exit(42); };',
    "if (execIndex < 2) fail('exec must follow global flags');",
    "if (args[0] !== '--ask-for-approval' || args[1] !== 'never') fail('approval ordering');",
    "const searchIndex = args.indexOf('--search');",
    "if (searchIndex !== -1 && searchIndex > execIndex) fail('search ordering');",
    "for (const flag of ['--json', '--ephemeral', '--ignore-user-config']) {",
    "  if (!args.includes(flag)) fail('missing ' + flag);",
    '}',
    "const colorIndex = args.indexOf('--color');",
    "if (args[colorIndex + 1] !== 'never') fail('color');",
    "const sandboxIndex = args.indexOf('--sandbox');",
    "if (args[sandboxIndex + 1] !== 'workspace-write') fail('sandbox');",
    "const cwdIndex = args.indexOf('-C');",
    'const repo = args[cwdIndex + 1];',
    "if (!repo || path.resolve(repo) !== path.resolve(process.cwd())) fail('working directory');",
    "if (args.at(-1) !== '-') fail('stdin sentinel');",
    "if (args.includes('--skip-git-repo-check')) fail('unsafe git bypass');",
    "if (args.includes('--dangerously-bypass-approvals-and-sandbox')) fail('unsafe sandbox bypass');",
    "let prompt = '';",
    "process.stdin.setEncoding('utf8');",
    'for await (const chunk of process.stdin) prompt += chunk;',
    "if (prompt !== process.env.YOUBENCHA_FAKE_CODEX_PROMPT) fail('stdin prompt mismatch');",
    "fs.writeFileSync(path.join(repo, 'codex-fake-change.txt'), 'created by fake Codex\\n');",
    "const finalMessage = 'Fake Codex completed the task.';",
    "const outputIndex = args.indexOf('--output-last-message');",
    'if (outputIndex !== -1) fs.writeFileSync(args[outputIndex + 1], finalMessage);',
    'const events = [',
    "  { type: 'thread.started', thread_id: 'fake-thread-1' },",
    "  { type: 'turn.started' },",
    "  { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'write fixture', exit_code: 0, status: 'completed' } },",
    "  { type: 'item.completed', item: { id: 'file-1', type: 'file_change', changes: [{ path: 'codex-fake-change.txt', kind: 'add' }], status: 'completed' } },",
    "  { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: finalMessage } },",
    "  { type: 'turn.completed', model: 'fake-codex-model', usage: { input_tokens: 21, cached_input_tokens: 8, output_tokens: 7, reasoning_output_tokens: 3 } },",
    '];',
    "process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
    "process.stderr.write('fake Codex progress\\n');",
  ].join('\n');
  await fs.writeFile(scriptPath, script, 'utf8');

  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(directory, 'codex.cmd'),
      '@echo off\r\nnode "%~dp0fake-codex.mjs" %*\r\n',
      'utf8'
    );
    return;
  }

  const executablePath = path.join(directory, 'codex');
  await fs.writeFile(executablePath, `#!/usr/bin/env node\n${script}`, 'utf8');
  await fs.chmod(executablePath, 0o755);
}
