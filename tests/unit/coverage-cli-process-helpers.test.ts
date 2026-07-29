import { EventEmitter } from 'node:events';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import {
  cliProcessTestHooks as hooks,
  resolveCliExecutable,
  runCliProcess,
  type CliProcessRequest,
} from '../../src/lib/cli-process.js';

function request(
  overrides: Partial<CliProcessRequest> = {}
): CliProcessRequest {
  const root = path.join(os.tmpdir(), `youbencha-cli-process-${Date.now()}`);
  return {
    executable: { path: process.execPath, kind: 'native' },
    args: [],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 1_000,
    maxCapturedOutputBytes: 32,
    stdoutArtifactPath: path.join(root, 'stdout.txt'),
    stderrArtifactPath: path.join(root, 'stderr.txt'),
    ...overrides,
  };
}

describe('CLI process helper coverage', () => {
  it('covers default executable resolution and empty PATH values', async () => {
    await expect(resolveCliExecutable('node')).resolves.not.toBeNull();
    await expect(
      resolveCliExecutable('node', {
        env: { PATH: path.dirname(process.execPath) },
        platform: 'linux',
      })
    ).resolves.toBeNull();
    await expect(
      resolveCliExecutable('missing', { env: { PATH: '' }, platform: 'linux' })
    ).resolves.toBeNull();
    await expect(resolveCliExecutable('../node')).rejects.toThrow(
      'bare command name'
    );
  });

  it('validates every invalid request boundary', () => {
    const invalid = [
      request({ executable: { path: 'relative', kind: 'native' } }),
      request({ timeoutMs: 0 }),
      request({ timeoutMs: Number.POSITIVE_INFINITY }),
      request({ maxCapturedOutputBytes: -1 }),
      request({ maxCapturedOutputBytes: 1.5 }),
      request({ maxArtifactOutputBytes: -1 }),
      request({ maxArtifactOutputBytes: 1.5 }),
      request({
        stdoutArtifactPath: 'same.txt',
        stderrArtifactPath: path.resolve('same.txt'),
      }),
    ];

    for (const value of invalid) {
      expect(() => hooks.validateRequest(value)).toThrow();
    }
  });

  it('returns a normalized synchronous spawn failure', async () => {
    const result = await runCliProcess(request(), {
      spawnProcess: () => {
        throw 'spawn failed';
      },
    });

    expect(result.error?.message).toBe('Unable to start CLI process');
    expect(result.stdoutBytes).toBe(0);
  });

  it('covers byte capture and bounded artifact behavior', () => {
    const capture = new hooks.BoundedByteCapture(2);
    capture.append(Buffer.from('abcd'));
    capture.append(Buffer.from('ef'));
    expect(capture.toString()).toBe('ab');
    expect(capture.truncated).toBe(true);

    const destination = new PassThrough();
    const output: Buffer[] = [];
    destination.on('data', (chunk: Buffer) => output.push(chunk));
    const writer = new hooks.BoundedArtifactWriter(destination, 2, undefined);
    expect(writer.write(Buffer.from('abcd'))).toBe(true);
    expect(writer.write(Buffer.from('ef'))).toBe(true);
    writer.finish();
    expect(writer.truncated).toBe(true);
    expect(Buffer.concat(output).toString()).toBe('ab');
    expect(writer.redactionCount).toBe(0);
  });

  it('redacts streaming, overlapping, escaped, and empty secrets', () => {
    expect(hooks.redactionVariants(['', 'a"b', 'plain', 'plain'])).toEqual([
      'plain',
      'a\\"b',
      'a"b',
    ]);

    const redactor = new hooks.StreamingSecretRedactor([
      'long-secret',
      'secret',
    ]);
    expect(redactor.push(Buffer.from('prefix long-'))).toBe('pr');
    expect(redactor.push(Buffer.from('secret and secret'))).toContain(
      '[REDACTED]'
    );
    expect(redactor.finish()).toContain('[REDACTED]');
    expect(redactor.redactionCount).toBe(2);

    const buffered = new hooks.StreamingSecretRedactor(['secret']);
    expect(buffered.push(Buffer.from('sec'))).toBe('');
    expect(buffered.finish()).toBe('sec');
  });

  it('pipes string data and honors backpressure and null streams', () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const destinationWrite = jest
      .spyOn(destination, 'write')
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const pause = jest.spyOn(source, 'pause');
    const resume = jest.spyOn(source, 'resume');
    const writer = new hooks.BoundedArtifactWriter(destination, 50, undefined);
    const capture = new hooks.BoundedByteCapture(50);
    const onError = jest.fn();

    hooks.pipeToArtifact(null, writer, capture, onError);
    hooks.pipeToArtifact(source, writer, capture, onError);
    source.emit('data', 'text');
    expect(pause).toHaveBeenCalled();
    destination.emit('drain');
    expect(resume).toHaveBeenCalled();
    destinationWrite.mockRestore();
  });

  it('builds native and shim invocations and rejects unsupported shims', async () => {
    const native = request({ args: ['a'] });
    await expect(
      hooks.buildInvocation(native, 'linux', {})
    ).resolves.toMatchObject({
      command: process.execPath,
      args: ['a'],
    });

    const shim = request({
      executable: { path: 'C:\\tools\\agent.cmd', kind: 'cmd' },
      args: ['argument with spaces'],
      env: { VALUE: 'kept' },
    });
    await expect(hooks.buildInvocation(shim, 'linux', {})).rejects.toThrow(
      'Windows CLI shim'
    );
    await expect(
      hooks.buildInvocation(shim, 'win32', { windowsPowerShellPath: '' })
    ).rejects.toThrow('PowerShell is required');
    const built = await hooks.buildInvocation(shim, 'win32', {
      windowsPowerShellPath: 'C:\\powershell.exe',
    });
    expect(built.command).toBe('C:\\powershell.exe');
    expect(built.env.VALUE).toBe('kept');

    const bin = await makeTempDirectory();
    await writeFile(path.join(bin, 'pwsh.EXE'), '');
    await expect(
      hooks.buildInvocation(
        { ...shim, env: { PATH: bin, PATHEXT: '.EXE' } },
        'win32',
        {}
      )
    ).resolves.toMatchObject({ command: path.join(bin, 'pwsh.EXE') });
  });

  it('resolves Windows PowerShell from SystemRoot and PATH fallbacks', async () => {
    const root = await makeTempDirectory();
    const builtIn = path.join(
      root,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    await mkdir(path.dirname(builtIn), { recursive: true });
    await writeFile(builtIn, '');
    await expect(
      hooks.resolveWindowsPowerShell({ SystemRoot: root })
    ).resolves.toBe(builtIn);

    const bin = await makeTempDirectory();
    await writeFile(path.join(bin, 'pwsh.EXE'), '');
    await expect(
      hooks.resolveWindowsPowerShell({ PATH: bin, PATHEXT: '.EXE' })
    ).resolves.toBe(path.join(bin, 'pwsh.EXE'));
    await expect(
      hooks.resolveWindowsPowerShell({ PATH: '' })
    ).resolves.toBeNull();
  });

  it('covers executable helpers and environment normalization', async () => {
    expect(hooks.executableKind('tool.cmd')).toBe('cmd');
    expect(hooks.executableKind('tool.BAT')).toBe('bat');
    expect(hooks.executableKind('tool.ps1')).toBe('powershell');
    expect(hooks.executableKind('tool')).toBe('native');
    expect(hooks.windowsExecutableExtensions(undefined)).toContain('.PS1');
    expect(hooks.windowsExecutableExtensions('EXE;.ps1')).toEqual([
      '.EXE',
      '.ps1',
    ]);
    expect(hooks.getEnvironmentValue({ Path: 'value' }, 'PATH')).toBe('value');
    expect(hooks.getEnvironmentValue({}, 'PATH')).toBeUndefined();
    expect(hooks.stripSurroundingQuotes('"quoted"')).toBe('quoted');
    expect(hooks.stripSurroundingQuotes('"')).toBe('"');
    expect(hooks.stripSurroundingQuotes('plain')).toBe('plain');

    const root = await makeTempDirectory();
    const file = path.join(root, 'file');
    await writeFile(file, '');
    await chmod(file, 0o755);
    await expect(hooks.isExecutableRegularFile(file, 'linux')).resolves.toBe(
      true
    );
    await expect(hooks.isExecutableRegularFile(root, 'linux')).resolves.toBe(
      false
    );
    await chmod(file, 0o644);
    await expect(hooks.isExecutableRegularFile(file, 'win32')).resolves.toBe(
      true
    );
  });

  it('covers stream wait helpers and short-circuited delays', async () => {
    const opened = new PassThrough() as PassThrough & { closed?: boolean };
    const openPromise = hooks.waitForArtifactOpen(opened);
    opened.emit('open');
    await openPromise;

    const failed = new PassThrough();
    const failedPromise = hooks.waitForArtifactOpen(failed);
    failed.emit('error', new Error('open failed'));
    await expect(failedPromise).rejects.toThrow('open failed');

    const alreadyClosed = { closed: true } as NodeJS.WritableStream & {
      closed: boolean;
    };
    await expect(
      hooks.waitForArtifactClose(alreadyClosed)
    ).resolves.toBeUndefined();
    const closing = new PassThrough();
    const closePromise = hooks.waitForArtifactClose(closing);
    closing.emit('close');
    await closePromise;

    await expect(hooks.waitForReadableEnd(null)).resolves.toBeUndefined();
    const ended = new PassThrough() as PassThrough & {
      readableEnded?: boolean;
    };
    Object.defineProperty(ended, 'readableEnded', { value: true });
    await expect(hooks.waitForReadableEnd(ended)).resolves.toBeUndefined();
    const readable = new PassThrough();
    const endPromise = hooks.waitForReadableEnd(readable);
    readable.emit('end');
    await endPromise;

    await expect(
      hooks.waitForConditionOrDelay(() => true, 1)
    ).resolves.toBeUndefined();
    await expect(
      hooks.waitForConditionOrDelay(() => false, 0)
    ).resolves.toBeUndefined();
    await expect(
      hooks.waitForConditionOrDelay(() => false, 1)
    ).resolves.toBeUndefined();
  });

  it('normalizes and appends errors', () => {
    const original = new Error('first');
    expect(hooks.toError(original, 'fallback')).toBe(original);
    expect(hooks.toError('nope', 'fallback').message).toBe('fallback');
    expect(hooks.appendError(undefined, original)).toBe(original);
    expect(hooks.appendError(original, new Error('second')).message).toBe(
      'first; second'
    );
  });

  it('terminates POSIX process groups and handles process races', async () => {
    const child = new EventEmitter() as ChildProcess;
    await expect(
      hooks.terminateProcessTree(child, false, 'linux', {}, jest.fn(), 10)
    ).resolves.toBeUndefined();

    Object.defineProperty(child, 'pid', { value: 42, configurable: true });
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    await hooks.terminateProcessTree(child, false, 'linux', {}, jest.fn(), 10);
    await hooks.terminateProcessTree(child, true, 'linux', {}, jest.fn(), 10);
    expect(kill).toHaveBeenNthCalledWith(1, -42, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, -42, 'SIGKILL');

    kill.mockImplementationOnce(() => {
      const error = new Error('gone') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });
    await expect(
      hooks.terminateProcessTree(child, false, 'linux', {}, jest.fn(), 10)
    ).resolves.toBeUndefined();

    kill.mockImplementationOnce(() => {
      const error = new Error('denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    await expect(
      hooks.terminateProcessTree(child, false, 'linux', {}, jest.fn(), 10)
    ).rejects.toThrow('denied');
    kill.mockRestore();
  });

  it('formats Windows termination signals and ignores duplicate completion', async () => {
    const child = new EventEmitter() as ChildProcess;
    Object.defineProperty(child, 'pid', { value: 43 });
    const spawnTermination = jest.fn(
      (_command: string, args: readonly string[]) => {
        const terminator = new EventEmitter() as ChildProcess;
        terminator.kill = jest.fn(() => true);
        queueMicrotask(() => {
          terminator.emit('exit', null, undefined);
          terminator.emit('error', new Error('late'));
        });
        expect(args).toEqual(['/PID', '43', '/T', '/F']);
        return terminator;
      }
    );

    await expect(
      hooks.terminateProcessTree(
        child,
        true,
        'win32',
        {},
        spawnTermination,
        Number.NaN
      )
    ).rejects.toThrow('signal unknown');
  });

  it('records stream and stdin errors while handling overlapping finishes', async () => {
    const child = createFakeChild();
    const terminationStarted = new Promise<void>((resolveStarted) => {
      child.once('termination-started', resolveStarted);
    });
    const resultPromise = runCliProcess(
      request({ timeoutMs: 10, terminationGraceMs: 1 }),
      {
        spawnProcess: () => {
          queueMicrotask(() => {
            const stdinError = new Error('stdin failed');
            child.stdin?.emit('error', stdinError);
            child.stdout?.emit('error', new Error('artifact failed'));
            child.stderr?.emit('error', new Error('second artifact failed'));
          });
          return child;
        },
        terminateProcessTree: async (_target, force) => {
          child.emit('termination-started');
          if (force) {
            child.emit('error', new Error('spawn failed during termination'));
          }
        },
      }
    );

    await terminationStarted;
    const result = await resultPromise;
    expect(result.error?.message).toContain('spawn failed during termination');
  });

  it('uses default termination dependencies and ignores a late process error', async () => {
    const child = createFakeChild();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout?.end();
        child.stderr?.end();
        child.emit('exit', null, 'SIGTERM');
      });
      return true;
    });

    const result = await runCliProcess(request({ timeoutMs: 1 }), {
      platform: 'linux',
      spawnProcess: () => child,
    });
    expect(result.timedOut).toBe(true);
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGTERM');
    kill.mockRestore();

    const completed = createFakeChild();
    const completedResult = await runCliProcess(request(), {
      spawnProcess: () => {
        queueMicrotask(() => {
          completed.stdout?.end();
          completed.stderr?.end();
          completed.emit('exit', 0, null);
        });
        return completed;
      },
    });
    expect(completedResult.exitCode).toBe(0);
    completed.emit('error', new Error('after settlement'));
  });
});

async function makeTempDirectory(): Promise<string> {
  const root = path.join(
    os.tmpdir(),
    `youbencha-cli-process-helper-${Date.now()}-${Math.random()}`
  );
  await mkdir(root, { recursive: true });
  return root;
}

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
