import { constants as fsConstants, createWriteStream } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import { ChildProcess, type SpawnOptions, spawn } from 'node:child_process';

export type ResolvedExecutableKind = 'native' | 'cmd' | 'bat' | 'powershell';

export interface ResolvedExecutable {
  path: string;
  kind: ResolvedExecutableKind;
}

export interface ResolveCliExecutableOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface CliProcessRequest {
  executable: ResolvedExecutable;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxCapturedOutputBytes: number;
  stdoutArtifactPath: string;
  stderrArtifactPath: string;
  terminationGraceMs?: number;
}

export interface CliProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  error?: Error;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CliProcessDependencies {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnProcess;
  spawnTerminationProcess?: SpawnProcess;
  terminateProcessTree?: (child: ChildProcess, force: boolean) => Promise<void>;
  terminationCommandTimeoutMs?: number;
  windowsPowerShellPath?: string;
}

const DEFAULT_TERMINATION_GRACE_MS = 500;
const DEFAULT_TERMINATION_COMMAND_TIMEOUT_MS = 2_000;
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

/**
 * Resolve a static CLI command name without invoking a shell or loading a user
 * profile. Callers must supply a product-owned command name, not test-case
 * configuration.
 */
export async function resolveCliExecutable(
  command: string,
  options: ResolveCliExecutableOptions = {}
): Promise<ResolvedExecutable | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(command)) {
    throw new Error(`CLI command must be a bare command name: ${command}`);
  }

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathValue = getEnvironmentValue(env, 'PATH');
  if (!pathValue) {
    return null;
  }

  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  const directories = pathValue
    .split(pathDelimiter)
    .map((entry) => stripSurroundingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);
  const extensions =
    platform === 'win32'
      ? windowsExecutableExtensions(getEnvironmentValue(env, 'PATHEXT'))
      : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      if (await isExecutableRegularFile(candidate, platform)) {
        return {
          path: candidate,
          kind: executableKind(candidate),
        };
      }
    }
  }

  return null;
}

/**
 * Execute a resolved CLI with bounded in-memory previews and complete,
 * separately persisted stdout and stderr.
 */
export async function runCliProcess(
  request: CliProcessRequest,
  dependencies: CliProcessDependencies = {}
): Promise<CliProcessResult> {
  validateRequest(request);

  const platform = dependencies.platform ?? process.platform;
  const invocation = await buildInvocation(request, platform, dependencies);

  await Promise.all([
    mkdir(dirname(request.stdoutArtifactPath), { recursive: true }),
    mkdir(dirname(request.stderrArtifactPath), { recursive: true }),
  ]);

  const stdoutArtifact = createWriteStream(request.stdoutArtifactPath, {
    flags: 'w',
  });
  const stderrArtifact = createWriteStream(request.stderrArtifactPath, {
    flags: 'w',
  });

  await Promise.all([
    waitForArtifactOpen(stdoutArtifact),
    waitForArtifactOpen(stderrArtifact),
  ]).catch(async (error: unknown) => {
    stdoutArtifact.destroy();
    stderrArtifact.destroy();
    await Promise.allSettled([
      waitForArtifactClose(stdoutArtifact),
      waitForArtifactClose(stderrArtifact),
    ]);
    throw toError(error, 'Unable to open CLI output artifact');
  });

  const spawnProcess = dependencies.spawnProcess ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnProcess(invocation.command, invocation.args, {
      cwd: request.cwd,
      env: invocation.env,
      shell: false,
      detached: platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    stdoutArtifact.end();
    stderrArtifact.end();
    await Promise.allSettled([
      waitForArtifactClose(stdoutArtifact),
      waitForArtifactClose(stderrArtifact),
    ]);
    return {
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      error: toError(error, 'Unable to start CLI process'),
    };
  }

  return await new Promise<CliProcessResult>((resolveResult) => {
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let timedOut = false;
    let processError: Error | undefined;
    let artifactError: Error | undefined;
    let naturalFinishStarted = false;
    let terminationStarted = false;
    let settled = false;

    const stdoutCapture = new BoundedByteCapture(
      request.maxCapturedOutputBytes
    );
    const stderrCapture = new BoundedByteCapture(
      request.maxCapturedOutputBytes
    );
    const stdoutEnded = waitForReadableEnd(child.stdout);
    const stderrEnded = waitForReadableEnd(child.stderr);

    const recordArtifactError = (error: Error): void => {
      artifactError ??= error;
      void beginFinish('artifact-error');
    };

    pipeToArtifact(
      child.stdout,
      stdoutArtifact,
      stdoutCapture,
      recordArtifactError
    );
    pipeToArtifact(
      child.stderr,
      stderrArtifact,
      stderrCapture,
      recordArtifactError
    );

    const finishArtifacts = async (destroy: boolean): Promise<void> => {
      if (destroy) {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }

      stdoutArtifact.end();
      stderrArtifact.end();
      await Promise.allSettled([
        waitForArtifactClose(stdoutArtifact),
        waitForArtifactClose(stderrArtifact),
      ]);
    };

    const settle = async (destroyStreams: boolean): Promise<void> => {
      if (settled) {
        return;
      }
      if (!destroyStreams) {
        await Promise.all([stdoutEnded, stderrEnded]);
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      await finishArtifacts(destroyStreams);
      resolveResult({
        exitCode,
        signal,
        stdout: stdoutCapture.toString(),
        stderr: stderrCapture.toString(),
        stdoutBytes: stdoutCapture.totalBytes,
        stderrBytes: stderrCapture.totalBytes,
        stdoutTruncated: stdoutCapture.truncated,
        stderrTruncated: stderrCapture.truncated,
        timedOut,
        error: processError ?? artifactError,
      });
    };

    async function beginFinish(
      reason: 'natural' | 'spawn-error' | 'timeout' | 'artifact-error'
    ): Promise<void> {
      if (settled) {
        return;
      }

      if (reason === 'natural') {
        if (naturalFinishStarted) {
          return;
        }
        naturalFinishStarted = true;
        await settle(false);
        return;
      }

      if (reason === 'spawn-error') {
        if (terminationStarted) {
          return;
        }
        terminationStarted = true;
        await settle(true);
        return;
      }

      if (terminationStarted) {
        return;
      }
      terminationStarted = true;

      const graceMs =
        request.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
      const terminate =
        dependencies.terminateProcessTree ??
        ((target: ChildProcess, force: boolean): Promise<void> =>
          terminateProcessTree(
            target,
            force,
            platform,
            request.env,
            dependencies.spawnTerminationProcess ?? spawn,
            dependencies.terminationCommandTimeoutMs ??
              DEFAULT_TERMINATION_COMMAND_TIMEOUT_MS
          ));

      await terminate(child, false).catch((error: unknown) => {
        processError = appendError(
          processError,
          toError(error, 'Unable to terminate CLI process tree')
        );
      });
      await waitForConditionOrDelay(() => settled, graceMs);

      if (!settled) {
        await terminate(child, true).catch((error: unknown) => {
          processError = appendError(
            processError,
            toError(error, 'Unable to force-terminate CLI process tree')
          );
        });
        await waitForConditionOrDelay(() => settled, graceMs);
      }

      // A descendant may keep inherited output handles open after its parent
      // exits. At the deadline, stop waiting for those streams indefinitely.
      await settle(true);
    }

    child.once('error', (error) => {
      processError = error;
      void beginFinish('spawn-error');
    });

    child.once('exit', (code, exitSignal) => {
      exitCode = code;
      signal = exitSignal;
      void beginFinish('natural');
    });

    child.stdin?.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
        processError ??= error;
      }
    });
    child.stdin?.end(request.stdin);

    const timeout = setTimeout(() => {
      timedOut = true;
      void beginFinish('timeout');
    }, request.timeoutMs);
    timeout.unref();
  });
}

class BoundedByteCapture {
  private readonly chunks: Buffer[] = [];
  private capturedBytes = 0;
  totalBytes = 0;

  constructor(private readonly limit: number) {}

  get truncated(): boolean {
    return this.totalBytes > this.capturedBytes;
  }

  append(chunk: Buffer): void {
    this.totalBytes += chunk.length;
    const remaining = this.limit - this.capturedBytes;
    if (remaining <= 0) {
      return;
    }
    const captured = chunk.subarray(0, remaining);
    this.chunks.push(captured);
    this.capturedBytes += captured.length;
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.capturedBytes).toString('utf8');
  }
}

function pipeToArtifact(
  source: NodeJS.ReadableStream | null,
  destination: NodeJS.WritableStream,
  capture: BoundedByteCapture,
  onError: (error: Error) => void
): void {
  if (!source) {
    return;
  }

  source.on('data', (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    capture.append(chunk);
    if (!destination.write(chunk)) {
      source.pause();
      destination.once('drain', () => source.resume());
    }
  });
  source.once('error', onError);
  destination.once('error', onError);
}

async function buildInvocation(
  request: CliProcessRequest,
  platform: NodeJS.Platform,
  dependencies: CliProcessDependencies
): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> {
  if (request.executable.kind === 'native') {
    return {
      command: request.executable.path,
      args: [...request.args],
      env: { ...request.env },
    };
  }

  if (platform !== 'win32') {
    throw new Error(
      `Windows CLI shim cannot be executed on ${platform}: ${request.executable.path}`
    );
  }

  const powerShellPath =
    dependencies.windowsPowerShellPath ??
    (await resolveWindowsPowerShell(request.env));
  if (!powerShellPath) {
    throw new Error('PowerShell is required to execute this Windows CLI shim');
  }

  const shimPathVariable = 'YOUBENCHA_CLI_SHIM_PATH_B64';
  const shimArgsVariable = 'YOUBENCHA_CLI_SHIM_ARGS_B64';
  const wrapper = [
    "$ErrorActionPreference = 'Stop'",
    `$shim = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${shimPathVariable}))`,
    `$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${shimArgsVariable}))`,
    '$shimArgs = @($json | ConvertFrom-Json)',
    `Remove-Item Env:\\${shimPathVariable}, Env:\\${shimArgsVariable} -ErrorAction SilentlyContinue`,
    '& $shim @shimArgs',
    'if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }',
  ].join('; ');

  return {
    command: powerShellPath,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(wrapper, 'utf16le').toString('base64'),
    ],
    env: {
      ...request.env,
      [shimPathVariable]: Buffer.from(request.executable.path, 'utf8').toString(
        'base64'
      ),
      [shimArgsVariable]: Buffer.from(
        JSON.stringify(request.args),
        'utf8'
      ).toString('base64'),
    },
  };
}

async function resolveWindowsPowerShell(
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const systemRoot = getEnvironmentValue(env, 'SystemRoot');
  if (systemRoot) {
    const builtIn = join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    if (await isExecutableRegularFile(builtIn, 'win32')) {
      return builtIn;
    }
  }

  return (
    (await resolveCliExecutable('pwsh', { env, platform: 'win32' }))?.path ??
    null
  );
}

async function terminateProcessTree(
  child: ChildProcess,
  force: boolean,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  spawnTerminationProcess: SpawnProcess,
  terminationCommandTimeoutMs: number
): Promise<void> {
  if (!child.pid) {
    return;
  }

  if (platform !== 'win32') {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
    return;
  }

  const systemRoot = getEnvironmentValue(env, 'SystemRoot');
  const taskkillPath = systemRoot
    ? join(systemRoot, 'System32', 'taskkill.exe')
    : 'taskkill.exe';
  const args = ['/PID', String(child.pid), '/T'];
  if (force) {
    args.push('/F');
  }

  await new Promise<void>((resolveTermination, rejectTermination) => {
    let settled = false;
    const terminator = spawnTerminationProcess(taskkillPath, args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectTermination(error);
      } else {
        resolveTermination();
      }
    };

    terminator.once('error', (error) => finish(error));
    terminator.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const status =
        code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`;
      finish(
        new Error(
          `taskkill failed with ${status} for process tree ${child.pid}`
        )
      );
    });

    const boundedTimeoutMs =
      Number.isFinite(terminationCommandTimeoutMs) &&
      terminationCommandTimeoutMs > 0
        ? terminationCommandTimeoutMs
        : DEFAULT_TERMINATION_COMMAND_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      const timeoutError = new Error(
        `taskkill timed out after ${boundedTimeoutMs}ms for process tree ${child.pid}`
      );
      finish(timeoutError);
      try {
        terminator.kill('SIGKILL');
      } catch {
        // The timeout error already records the actionable cleanup result.
      }
    }, boundedTimeoutMs);
  });
}

function executableKind(filePath: string): ResolvedExecutableKind {
  switch (extname(filePath).toLowerCase()) {
    case '.cmd':
      return 'cmd';
    case '.bat':
      return 'bat';
    case '.ps1':
      return 'powershell';
    default:
      return 'native';
  }
}

function windowsExecutableExtensions(pathExt: string | undefined): string[] {
  const extensions = (pathExt ?? WINDOWS_EXECUTABLE_EXTENSIONS.join(';'))
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => (value.startsWith('.') ? value : `.${value}`));

  if (!extensions.some((value) => value.toLowerCase() === '.ps1')) {
    extensions.push('.PS1');
  }
  return extensions;
}

async function isExecutableRegularFile(
  candidate: string,
  platform: NodeJS.Platform
): Promise<boolean> {
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      await access(candidate, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function getEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const key = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
  return key ? env[key] : undefined;
}

function stripSurroundingQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function validateRequest(request: CliProcessRequest): void {
  if (!isAbsolute(request.executable.path)) {
    throw new Error('Resolved executable path must be absolute');
  }
  if (request.timeoutMs <= 0 || !Number.isFinite(request.timeoutMs)) {
    throw new Error('timeoutMs must be a positive finite number');
  }
  if (
    request.maxCapturedOutputBytes < 0 ||
    !Number.isSafeInteger(request.maxCapturedOutputBytes)
  ) {
    throw new Error('maxCapturedOutputBytes must be a non-negative integer');
  }
  if (
    resolve(request.stdoutArtifactPath) === resolve(request.stderrArtifactPath)
  ) {
    throw new Error('stdout and stderr artifact paths must be different');
  }
}

function waitForArtifactOpen(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    const onOpen = (): void => {
      cleanup();
      resolveOpen();
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectOpen(error);
    };
    const cleanup = (): void => {
      stream.off('open', onOpen);
      stream.off('error', onError);
    };
    stream.once('open', onOpen);
    stream.once('error', onError);
  });
}

function waitForArtifactClose(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolveClose) => {
    if ((stream as { closed?: boolean }).closed) {
      resolveClose();
      return;
    }
    stream.once('close', resolveClose);
  });
}

function waitForReadableEnd(
  stream: NodeJS.ReadableStream | null
): Promise<void> {
  return new Promise((resolveEnd) => {
    if (
      !stream ||
      (stream as { readableEnded?: boolean }).readableEnded ||
      (stream as { destroyed?: boolean }).destroyed
    ) {
      resolveEnd();
      return;
    }
    const onEnd = (): void => {
      cleanup();
      resolveEnd();
    };
    const cleanup = (): void => {
      stream.off('end', onEnd);
      stream.off('close', onEnd);
      stream.off('error', onEnd);
    };
    stream.once('end', onEnd);
    stream.once('close', onEnd);
    stream.once('error', onEnd);
  });
}

async function waitForConditionOrDelay(
  condition: () => boolean,
  delayMs: number
): Promise<void> {
  if (condition() || delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, delayMs);
    timer.unref();
  });
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function appendError(existing: Error | undefined, next: Error): Error {
  return existing ? new Error(`${existing.message}; ${next.message}`) : next;
}
