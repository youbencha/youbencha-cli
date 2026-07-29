import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAgentFiles, installAgentFiles } from '../../src/lib/agent-files.js';

describe('agent file installation coverage', () => {
  let temporaryDirectory: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-agent-files-')
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('exposes immutable installation definitions', () => {
    const definitions = getAgentFiles();
    expect(definitions).toHaveLength(2);
    expect(definitions.map((definition) => definition.relativePath)).toEqual([
      '.github/agents/agentic-judge.md',
      '.claude/agents/agentic-judge.md',
    ]);
    expect(
      definitions.every((definition) => definition.content.length > 0)
    ).toBe(true);
  });

  it('creates, skips, and overwrites all agent files', async () => {
    const created = await installAgentFiles({
      targetDir: temporaryDirectory,
    });
    expect(created.summary).toEqual({
      created: 2,
      skipped: 0,
      overwritten: 0,
      errors: 0,
    });
    expect(created.success).toBe(true);

    const skipped = await installAgentFiles({
      targetDir: temporaryDirectory,
    });
    expect(skipped.summary.skipped).toBe(2);

    const firstPath = path.join(
      temporaryDirectory,
      getAgentFiles()[0].relativePath
    );
    await fs.writeFile(firstPath, 'old content');
    const overwritten = await installAgentFiles({
      targetDir: temporaryDirectory,
      force: true,
    });
    expect(overwritten.summary.overwritten).toBe(2);
    await expect(fs.readFile(firstPath, 'utf8')).resolves.not.toBe(
      'old content'
    );
  });

  it('defaults to cwd and default force behavior', async () => {
    process.chdir(temporaryDirectory);
    const result = await installAgentFiles();
    expect(result.files.every((file) => file.status === 'created')).toBe(true);
    for (const definition of getAgentFiles()) {
      await expect(
        fs.readFile(path.join(temporaryDirectory, definition.relativePath))
      ).resolves.toBeDefined();
    }
  });
});
