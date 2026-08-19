import { afterEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseConfig } from '../../src/lib/config-parser';
import { evalConfigSchema } from '../../src/schemas/eval.schema';

describe('onboarding CLI', () => {
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('documents doctor and minimal init in CLI help', () => {
    const rootHelp = execFileSync(process.execPath, [cliPath, '--help'], {
      encoding: 'utf8',
    });
    const initHelp = execFileSync(
      process.execPath,
      [cliPath, 'init', '--help'],
      {
        encoding: 'utf8',
      }
    );
    const doctorHelp = execFileSync(
      process.execPath,
      [cliPath, 'doctor', '--help'],
      { encoding: 'utf8' }
    );

    expect(rootHelp).toContain('doctor');
    expect(initHelp).toContain('--minimal');
    expect(doctorHelp).toContain('Writable workspace path');
  });

  it('creates a local eval workflow without installing judge agent files', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'youbencha-minimal-init-')
    );
    temporaryDirectories.push(directory);

    execFileSync(process.execPath, [cliPath, 'init', '--minimal'], {
      cwd: directory,
      encoding: 'utf8',
    });

    const evalPath = path.join(directory, 'eval.yaml');
    const parsed = evalConfigSchema.parse(
      parseConfig(fs.readFileSync(evalPath, 'utf8'), evalPath)
    );
    expect(parsed.directory).toBe('.');
    expect(parsed.evaluators).toEqual([
      expect.objectContaining({ name: 'git-diff' }),
    ]);
    expect(fs.existsSync(path.join(directory, 'testcase.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(directory, '.github'))).toBe(false);
    expect(fs.existsSync(path.join(directory, '.claude'))).toBe(false);

    const secondRun = spawnSync(
      process.execPath,
      [cliPath, 'init', '--minimal'],
      { cwd: directory, encoding: 'utf8' }
    );
    expect(secondRun.status).toBe(1);
    expect(`${secondRun.stdout}${secondRun.stderr}`).toContain(
      'eval.yaml already exists'
    );
    expect(`${secondRun.stdout}${secondRun.stderr}`).toContain(
      '--force to overwrite (destructive!)'
    );
  });
});
