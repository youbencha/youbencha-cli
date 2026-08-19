import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { CodexCLIAdapter } from '../../src/adapters/codex-cli.js';

const execFileAsync = promisify(execFile);
const liveIt = process.env.CODEX_CLI_INTEGRATION_TESTS === '1' ? it : it.skip;

describe('Codex CLI live smoke integration', () => {
  liveIt(
    'makes one deterministic change in a temporary local Git repository',
    async () => {
      const adapter = new CodexCLIAdapter();
      const availability = await adapter.diagnoseAvailability(process.env);
      if (!availability.installed || availability.authenticated !== true) {
        throw new Error(
          `CODEX_CLI_INTEGRATION_TESTS=1 requires an installed and authenticated Codex CLI: ${availability.messages.join(' ')}`
        );
      }

      const testDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'youbencha-codex-live-')
      );
      const repoDirectory = path.join(testDirectory, 'repo');
      const artifactsDirectory = path.join(testDirectory, 'artifacts');
      await Promise.all([
        fs.mkdir(repoDirectory, { recursive: true }),
        fs.mkdir(artifactsDirectory, { recursive: true }),
      ]);
      await execFileAsync('git', ['init', '--quiet'], { cwd: repoDirectory });

      // Intentionally retain this opt-in run for troubleshooting and artifact
      // inspection. The default suite never creates it.
      console.log(`Codex live integration artifacts: ${testDirectory}`);

      const model = process.env.CODEX_CLI_INTEGRATION_MODEL;
      const result = await adapter.execute({
        workspaceDir: repoDirectory,
        repoDir: repoDirectory,
        artifactsDir: artifactsDirectory,
        config: {
          prompt:
            'Create codex-live-smoke.txt containing exactly: codex live smoke passed',
          sandbox: 'workspace-write',
          approval_policy: 'never',
          ephemeral: true,
          ignore_user_config: true,
          ...(model ? { model } : {}),
        },
        timeout: 60_000,
        env: {},
      });

      expect(result.status).toBe('success');
      await expect(
        fs
          .readFile(path.join(repoDirectory, 'codex-live-smoke.txt'), 'utf8')
          .then((content) => content.trim())
      ).resolves.toBe('codex live smoke passed');
      await expect(
        fs.readdir(path.join(artifactsDirectory, 'codex-cli-logs'))
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^events-.*\.jsonl$/),
          expect.stringMatching(/^stderr-.*\.log$/),
          expect.stringMatching(/^final-message-.*\.txt$/),
          expect.stringMatching(/^execution-metadata-.*\.json$/),
        ])
      );
    },
    75_000
  );
});
