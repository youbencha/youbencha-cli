import { EventEmitter } from 'node:events';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  resolveCliExecutable,
  runCliProcess,
  type CliProcessRequest,
} from '../../src/lib/cli-process.js';

describe('CLI process boundary', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'youbencha-cli-process-')
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  describe('resolveCliExecutable', () => {
    it('finds a native executable in a PATH entry containing spaces', async () => {
      const binDirectory = join(temporaryDirectory, 'bin with spaces');
      await mkdir(binDirectory);
      const extension = process.platform === 'win32' ? '.EXE' : '';
      const executablePath = join(binDirectory, `local-agent${extension}`);
      await writeFile(executablePath, 'fake executable');
      if (process.platform !== 'win32') {
        await chmod(executablePath, 0o755);
      }

      const result = await resolveCliExecutable('local-agent', {
        env: {
          PATH: binDirectory,
          PATHEXT: '.EXE;.CMD',
        },
      });

      expect(result).toEqual({
        path: resolve(executablePath),
        kind: 'native',
      });
    });

    it.each([
      ['CMD', 'cmd'],
      ['BAT', 'bat'],
      ['PS1', 'powershell'],
    ] as const)(
      'classifies Windows .%s shims as %s',
      async (extension, kind) => {
        const executablePath = join(temporaryDirectory, `shim.${extension}`);
        await writeFile(executablePath, 'shim');

        const result = await resolveCliExecutable('shim', {
          env: {
            PATH: temporaryDirectory,
            PATHEXT: `.${extension}`,
          },
          platform: 'win32',
        });

        expect(result).toEqual({
          path: resolve(executablePath),
          kind,
        });
      }
    );

    it('honors PATHEXT order', async () => {
      await writeFile(join(temporaryDirectory, 'ordered.CMD'), 'cmd');
      await writeFile(join(temporaryDirectory, 'ordered.EXE'), 'exe');

      const result = await resolveCliExecutable('ordered', {
        env: {
          PATH: temporaryDirectory,
          PATHEXT: '.CMD;.EXE',
        },
        platform: 'win32',
      });

      expect(result?.kind).toBe('cmd');
    });

    it('rejects missing commands, directories, and non-executable Unix files', async () => {
      await mkdir(join(temporaryDirectory, 'directory-agent'));
      const nonExecutablePath = join(temporaryDirectory, 'non-executable');
      await writeFile(nonExecutablePath, 'not executable');
      await chmod(nonExecutablePath, 0o644);

      await expect(
        resolveCliExecutable('missing', {
          env: { PATH: temporaryDirectory },
          platform: process.platform,
        })
      ).resolves.toBeNull();
      await expect(
        resolveCliExecutable('directory-agent', {
          env: { PATH: temporaryDirectory },
          platform: process.platform,
        })
      ).resolves.toBeNull();

      if (process.platform !== 'win32') {
        await expect(
          resolveCliExecutable('non-executable', {
            env: { PATH: temporaryDirectory },
          })
        ).resolves.toBeNull();
      }
    });

    it('does not accept paths as command names', async () => {
      await expect(
        resolveCliExecutable('../untrusted', {
          env: { PATH: temporaryDirectory },
        })
      ).rejects.toThrow('bare command name');
    });
  });

  describe('runCliProcess', () => {
    it('keeps stdout and stderr separate in previews and complete artifacts', async () => {
      const request = makeRequest([
        '-e',
        "process.stdout.write('standard output'); process.stderr.write('standard error')",
      ]);

      const result = await runCliProcess(request);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('standard output');
      expect(result.stderr).toBe('standard error');
      await expect(readFile(request.stdoutArtifactPath, 'utf8')).resolves.toBe(
        'standard output'
      );
      await expect(readFile(request.stderrArtifactPath, 'utf8')).resolves.toBe(
        'standard error'
      );
    });

    it('delivers stdin content and closes stdin', async () => {
      const request = makeRequest([
        '-e',
        "let value=''; process.stdin.on('data', c => value += c); process.stdin.on('end', () => process.stdout.write(value || '<closed>'))",
      ]);
      request.stdin = 'input with\nmultiple lines';

      const withInput = await runCliProcess(request);
      expect(withInput.stdout).toBe('input with\nmultiple lines');

      const noInputRequest = makeRequest([
        '-e',
        "process.stdin.on('data', () => {}); process.stdin.on('end', () => process.stdout.write('<closed>'))",
      ]);
      const withoutInput = await runCliProcess(noInputRequest);
      expect(withoutInput.stdout).toBe('<closed>');
    });

    it('bounds previews by bytes while preserving complete artifacts', async () => {
      const request = makeRequest([
        '-e',
        "process.stdout.write('🙂🙂tail'); process.stderr.write('ééerror')",
      ]);
      request.maxCapturedOutputBytes = 5;

      const result = await runCliProcess(request);

      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(7);
      expect(Buffer.from(result.stdout).subarray(0, 4).toString()).toBe('🙂');
      expect(result.stdoutBytes).toBe(Buffer.byteLength('🙂🙂tail'));
      expect(result.stderrBytes).toBe(Buffer.byteLength('ééerror'));
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(true);
      await expect(readFile(request.stdoutArtifactPath, 'utf8')).resolves.toBe(
        '🙂🙂tail'
      );
      await expect(readFile(request.stderrArtifactPath, 'utf8')).resolves.toBe(
        'ééerror'
      );
    });

    it('bounds durable artifacts while continuing to drain process output', async () => {
      const request = makeRequest([
        '-e',
        "process.stdout.write('stdout-over-limit'); process.stderr.write('stderr-over-limit')",
      ]);
      request.maxArtifactOutputBytes = 6;

      const result = await runCliProcess(request);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('stdout-over-limit');
      expect(result.stderr).toBe('stderr-over-limit');
      expect(result.stdoutArtifactBytes).toBe(6);
      expect(result.stderrArtifactBytes).toBe(6);
      expect(result.stdoutArtifactTruncated).toBe(true);
      expect(result.stderrArtifactTruncated).toBe(true);
      await expect(readFile(request.stdoutArtifactPath, 'utf8')).resolves.toBe(
        'stdout'
      );
      await expect(readFile(request.stderrArtifactPath, 'utf8')).resolves.toBe(
        'stderr'
      );
    });

    it('redacts raw and JSON-escaped credentials before durable writes', async () => {
      const secret = 'token-"quoted\\value';
      const escaped = JSON.stringify(secret).slice(1, -1);
      const child = createFakeChild();
      const request = makeRequest([]);
      request.artifactRedactions = [secret];

      const result = await runCliProcess(request, {
        spawnProcess: () => {
          queueMicrotask(() => {
            child.stdout?.write(`{"message":"${escaped.slice(0, 8)}`);
            child.stdout?.end(`${escaped.slice(8)}"}\n`);
            child.stderr?.write(`failure ${secret.slice(0, 7)}`);
            child.stderr?.end(secret.slice(7));
            child.emit('exit', 0, null);
          });
          return child;
        },
      });

      const stdoutArtifact = await readFile(request.stdoutArtifactPath, 'utf8');
      const stderrArtifact = await readFile(request.stderrArtifactPath, 'utf8');
      expect(JSON.parse(stdoutArtifact)).toEqual({ message: '[REDACTED]' });
      expect(stderrArtifact).toBe('failure [REDACTED]');
      expect(stdoutArtifact).not.toContain(secret);
      expect(stdoutArtifact).not.toContain(escaped);
      expect(stderrArtifact).not.toContain(secret);
      expect(result.stdoutArtifactRedactionCount).toBe(1);
      expect(result.stderrArtifactRedactionCount).toBe(1);
    });

    it('rejects an invalid durable artifact quota before spawning', async () => {
      const request = makeRequest([]);
      request.maxArtifactOutputBytes = -1;
      const spawnProcess = jest.fn();

      await expect(runCliProcess(request, { spawnProcess })).rejects.toThrow(
        'maxArtifactOutputBytes'
      );
      expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('attempts graceful then forced process-tree termination on timeout', async () => {
      const child = createFakeChild();
      const terminationCalls: boolean[] = [];
      const request = makeRequest([]);
      request.timeoutMs = 10;
      request.terminationGraceMs = 5;

      const result = await runCliProcess(request, {
        spawnProcess: () => child,
        terminateProcessTree: async (target, force) => {
          expect(target).toBe(child);
          terminationCalls.push(force);
          if (force) {
            child.stdout?.end();
            child.stderr?.end();
            child.emit('exit', null, 'SIGKILL');
          }
        },
      });

      expect(result.timedOut).toBe(true);
      expect(result.signal).toBe('SIGKILL');
      expect(terminationCalls).toEqual([false, true]);
    });

    it('surfaces a nonzero Windows taskkill exit without waiting indefinitely', async () => {
      const child = createFakeChild();
      const request = makeRequest([]);
      request.timeoutMs = 5;
      request.terminationGraceMs = 1;
      const spawnTerminationProcess = jest.fn(
        (_command: string, args: readonly string[]) => {
          const terminator = createFakeChild();
          queueMicrotask(() => {
            terminator.emit('exit', args.includes('/F') ? 0 : 1, null);
          });
          return terminator;
        }
      );

      const result = await runCliProcess(request, {
        platform: 'win32',
        spawnProcess: () => child,
        spawnTerminationProcess,
        terminationCommandTimeoutMs: 20,
      });

      expect(result.timedOut).toBe(true);
      expect(result.error?.message).toContain(
        'taskkill failed with exit code 1'
      );
      expect(spawnTerminationProcess).toHaveBeenCalledTimes(2);
    });

    it('times out and kills a hung Windows taskkill process', async () => {
      const child = createFakeChild();
      const request = makeRequest([]);
      request.timeoutMs = 5;
      request.terminationGraceMs = 1;
      const terminators: ChildProcess[] = [];
      const spawnTerminationProcess = jest.fn(() => {
        const terminator = createFakeChild();
        terminator.kill = jest.fn(() => true);
        terminators.push(terminator);
        return terminator;
      });

      const result = await runCliProcess(request, {
        platform: 'win32',
        spawnProcess: () => child,
        spawnTerminationProcess,
        terminationCommandTimeoutMs: 5,
      });

      expect(result.timedOut).toBe(true);
      expect(result.error?.message).toContain('taskkill timed out after 5ms');
      expect(spawnTerminationProcess).toHaveBeenCalledTimes(2);
      expect(terminators).toHaveLength(2);
      for (const terminator of terminators) {
        expect(terminator.kill).toHaveBeenCalledWith('SIGKILL');
      }
    });

    it('settles once when duplicate process completion events arrive', async () => {
      const child = createFakeChild();
      const request = makeRequest([]);
      let resolutionCount = 0;

      const resultPromise = runCliProcess(request, {
        spawnProcess: () => {
          queueMicrotask(() => {
            child.stdout?.end('done');
            child.stderr?.end();
            child.emit('exit', 0, null);
            child.emit('exit', 9, null);
            child.emit('error', new Error('late error'));
          });
          return child;
        },
      }).then((result) => {
        resolutionCount += 1;
        return result;
      });

      const result = await resultPromise;
      await new Promise((resolveDelay) => setImmediate(resolveDelay));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('done');
      expect(resolutionCount).toBe(1);
    });

    it('fails before spawning when an artifact cannot be opened', async () => {
      const request = makeRequest([]);
      request.stdoutArtifactPath = temporaryDirectory;
      const spawnProcess = jest.fn();

      await expect(
        runCliProcess(request, { spawnProcess })
      ).rejects.toBeInstanceOf(Error);
      expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('uses shell false for native executables', async () => {
      const child = createFakeChild();
      const request = makeRequest(['safe argument']);
      let observedOptions: { shell?: boolean } | undefined;

      const resultPromise = runCliProcess(request, {
        spawnProcess: (_command, _args, options) => {
          observedOptions = options;
          queueMicrotask(() => {
            child.stdout?.end();
            child.stderr?.end();
            child.emit('exit', 0, null);
          });
          return child;
        },
      });

      await resultPromise;
      expect(observedOptions?.shell).toBe(false);
    });

    it('keeps shim arguments out of the PowerShell command line', async () => {
      const child = createFakeChild();
      const secretArgument = 'prompt with & metacharacters and SECRET';
      const request = makeRequest([secretArgument]);
      request.executable = {
        path: resolve(temporaryDirectory, 'agent.cmd'),
        kind: 'cmd',
      };
      let observedArgs: readonly string[] = [];
      let observedEnvironment: NodeJS.ProcessEnv | undefined;

      const resultPromise = runCliProcess(request, {
        platform: 'win32',
        windowsPowerShellPath: resolve(temporaryDirectory, 'powershell.exe'),
        spawnProcess: (_command, args, options) => {
          observedArgs = args;
          observedEnvironment = options.env;
          queueMicrotask(() => {
            child.stdout?.end();
            child.stderr?.end();
            child.emit('exit', 0, null);
          });
          return child;
        },
      });

      await resultPromise;
      expect(observedArgs.join(' ')).not.toContain(secretArgument);
      expect(observedArgs).toContain('-NonInteractive');
      expect(observedEnvironment?.YOUBENCHA_CLI_SHIM_ARGS_B64).toBe(
        Buffer.from(JSON.stringify([secretArgument]), 'utf8').toString('base64')
      );
    });
  });

  function makeRequest(args: string[]): CliProcessRequest {
    const identifier = `${Date.now()}-${Math.random()}`;
    return {
      executable: {
        path: resolve(process.execPath),
        kind: 'native',
      },
      args,
      cwd: temporaryDirectory,
      env: { ...process.env },
      timeoutMs: 5_000,
      maxCapturedOutputBytes: 1_024,
      stdoutArtifactPath: join(temporaryDirectory, `${identifier}.stdout.log`),
      stderrArtifactPath: join(temporaryDirectory, `${identifier}.stderr.log`),
    };
  }
});

function createFakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { value: 12345, configurable: true },
    stdin: { value: new PassThrough(), configurable: true },
    stdout: { value: new PassThrough(), configurable: true },
    stderr: { value: new PassThrough(), configurable: true },
  });
  return child;
}
