import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const stat = jest.fn();
const readdir = jest.fn();
const access = jest.fn();
const readFile = jest.fn();
const writeFile = jest.fn();
const mkdtemp = jest.fn();
const rm = jest.fn();
const spawn = jest.fn();
const resolveCliExecutable = jest.fn();
const runCliProcess = jest.fn();
const spinner = {
  start: jest.fn(),
  succeed: jest.fn(),
  fail: jest.fn(),
};

jest.mock('fs/promises', () => ({
  stat,
  readdir,
  access,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  constants: { R_OK: 4 },
}));
jest.mock('child_process', () => ({ spawn }));
jest.mock('../../src/lib/progress.js', () => ({
  createSpinner: () => spinner,
}));
jest.mock('../../src/lib/cli-process.js', () => ({
  resolveCliExecutable,
  runCliProcess,
}));
jest.mock('../../src/lib/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  credentialEnvironmentValues,
  handleSuggestTestCase,
  launchAgent,
  registerSuggestTestCaseCommand,
  validateAgentFile,
  validateAgentTool,
  validateOutputDir,
} from '../../src/cli/commands/suggest-testcase.js';
import logger from '../../src/lib/logger.js';

type EventCallback = (...args: never[]) => void;

function processDouble(
  outcome:
    | { event: 'close'; value: number | null }
    | { event: 'error'; value: Error }
) {
  const double = {
    on: jest.fn((event: string, callback: EventCallback) => {
      if (event === outcome.event) {
        queueMicrotask(() => callback(outcome.value as never));
      }
      return double;
    }),
    kill: jest.fn(),
  };
  return double;
}

describe('suggest-testcase command coverage', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform'
  );

  beforeEach(() => {
    jest.clearAllMocks();
    stat.mockResolvedValue({ isDirectory: () => true, isFile: () => true });
    readdir.mockResolvedValue([]);
    access.mockResolvedValue(undefined);
    readFile.mockImplementation(async (file: unknown) =>
      String(file).includes('stdout')
        ? 'name: suggested\n'
        : ' agent instructions '
    );
    writeFile.mockResolvedValue(undefined);
    mkdtemp.mockResolvedValue('/tmp/suggestion-artifacts');
    rm.mockResolvedValue(undefined);
    resolveCliExecutable.mockResolvedValue('/bin/codex');
    runCliProcess.mockResolvedValue({
      error: undefined,
      timedOut: false,
      exitCode: 0,
      stdoutArtifactTruncated: false,
    });
    spawn.mockImplementation(() => processDouble({ event: 'close', value: 0 }));
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
    jest.restoreAllMocks();
  });

  it('validates accessible directories and distinguishes failure causes', async () => {
    await expect(validateOutputDir('.')).resolves.toBeUndefined();

    stat.mockResolvedValueOnce({ isDirectory: () => false });
    await expect(validateOutputDir('file')).rejects.toThrow(
      'Cannot access directory'
    );

    stat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );
    await expect(validateOutputDir('missing')).rejects.toThrow(
      'Directory not found'
    );

    stat.mockResolvedValueOnce({ isDirectory: () => true });
    readdir.mockRejectedValueOnce(new Error('denied'));
    await expect(validateOutputDir('denied')).rejects.toThrow(
      'Cannot access directory'
    );
  });

  it('validates supported tools on Windows and Unix and reports probe failures', async () => {
    for (const agent of ['copilot-cli', 'codex-cli', 'aider', 'cursor']) {
      await expect(validateAgentTool(agent)).resolves.toBeUndefined();
    }

    Object.defineProperty(process, 'platform', { value: 'linux' });
    await expect(validateAgentTool('aider')).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledWith('which', ['aider'], expect.any(Object));

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'close', value: 1 })
    );
    await expect(validateAgentTool('codex-cli')).rejects.toThrow(
      'not installed'
    );

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'error', value: new Error('spawn') })
    );
    await expect(validateAgentTool('cursor')).rejects.toThrow(
      'Failed to check'
    );
    await expect(validateAgentTool('unsupported')).rejects.toThrow(
      'Unsupported agent type'
    );
  });

  it('validates readable agent files and reports missing/non-file paths', async () => {
    await expect(validateAgentFile('agent.md')).resolves.toContain('agent.md');
    stat.mockResolvedValueOnce({ isFile: () => false });
    await expect(validateAgentFile('directory')).rejects.toThrow(
      'Path is not a file'
    );
    access.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    );
    await expect(validateAgentFile('missing')).rejects.toThrow(
      'Agent file not found'
    );
    access.mockRejectedValueOnce(new Error('denied'));
    await expect(validateAgentFile('denied')).rejects.toThrow('denied');
  });

  it('runs headless Codex, redacts credentials, saves output, and cleans up', async () => {
    process.env.TEST_API_KEY = 'super-secret';
    await launchAgent('codex-cli', 'agent.md', '.', 'saved.yaml');
    expect(runCliProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactRedactions: expect.arrayContaining(['super-secret']),
      })
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('saved.yaml'),
      'name: suggested\n',
      'utf8'
    );
    expect(rm).toHaveBeenCalled();
    delete process.env.TEST_API_KEY;

    await launchAgent('codex-cli', 'agent.md', '.');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('name: suggested')
    );
  });

  it.each([
    ['missing executable', null, undefined, 'not installed'],
    ['process error', '/bin/codex', { error: new Error('bad') }, 'could not'],
    ['timeout', '/bin/codex', { timedOut: true }, 'timed out'],
    ['exit failure', '/bin/codex', { exitCode: 7 }, 'exited with code 7'],
    ['unknown exit', '/bin/codex', { exitCode: null }, 'unknown'],
    [
      'truncated',
      '/bin/codex',
      { exitCode: 0, stdoutArtifactTruncated: true },
      'output limit',
    ],
  ])('reports Codex %s', async (_name, executable, result, message) => {
    resolveCliExecutable.mockResolvedValue(executable);
    if (result) {
      runCliProcess.mockResolvedValue({
        error: undefined,
        timedOut: false,
        exitCode: 0,
        stdoutArtifactTruncated: false,
        ...result,
      });
    }
    await expect(launchAgent('codex-cli', 'agent.md', '.')).rejects.toThrow(
      message
    );
    if (executable) expect(rm).toHaveBeenCalled();
  });

  it('rejects empty Codex suggestions', async () => {
    readFile.mockImplementation(async (file: unknown) =>
      String(file).includes('stdout') ? '   ' : 'instructions'
    );
    await expect(launchAgent('codex-cli', 'agent.md', '.')).rejects.toThrow(
      'without returning'
    );
  });

  it('launches Copilot on Windows and Unix and launches Aider', async () => {
    const signalHandlers: Array<() => void> = [];
    jest.spyOn(process, 'on').mockImplementation(((event, callback) => {
      if (event === 'SIGINT') signalHandlers.push(callback as () => void);
      return process;
    }) as typeof process.on);

    await launchAgent('copilot-cli', 'agent.md', '.');
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.any(Array),
      expect.any(Object)
    );

    Object.defineProperty(process, 'platform', { value: 'linux' });
    await launchAgent('copilot-cli', 'agent.md', '.');
    expect(spawn).toHaveBeenCalledWith(
      'copilot',
      ['suggest'],
      expect.any(Object)
    );
    await launchAgent('aider', 'agent.md', '.');
    expect(spawn).toHaveBeenCalledWith(
      'aider',
      expect.any(Array),
      expect.any(Object)
    );
    expect(signalHandlers.length).toBe(3);
  });

  it('handles Cursor, unsupported agents, spawn failures, and interruption', async () => {
    await expect(
      launchAgent('cursor', 'agent.md', '.')
    ).resolves.toBeUndefined();
    await expect(launchAgent('unknown', 'agent.md', '.')).rejects.toThrow(
      'Unsupported agent type'
    );

    spawn.mockImplementationOnce(() => undefined);
    await expect(launchAgent('aider', 'agent.md', '.')).rejects.toThrow(
      'Failed to spawn'
    );

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'close', value: 2 })
    );
    await expect(launchAgent('aider', 'agent.md', '.')).rejects.toThrow(
      'Agent exited'
    );

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'error', value: new Error('broken') })
    );
    await expect(launchAgent('aider', 'agent.md', '.')).rejects.toThrow(
      'Failed to launch'
    );

    const hanging = {
      on: jest.fn(() => hanging),
      kill: jest.fn(),
    };
    spawn.mockReturnValueOnce(hanging);
    jest.spyOn(process, 'on').mockImplementation(((event, callback) => {
      if (event === 'SIGINT') {
        queueMicrotask(() => (callback as () => void)());
      }
      return process;
    }) as typeof process.on);
    const launched = launchAgent('aider', 'agent.md', '.');
    await expect(launched).rejects.toThrow('interrupted');
    expect(hanging.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('runs headless and interactive workflows and reports each validation stage', async () => {
    await handleSuggestTestCase({
      agent: 'codex-cli',
      outputDir: '.',
      agentFile: 'agent.md',
    });

    spawn.mockImplementation(() => processDouble({ event: 'close', value: 0 }));
    await handleSuggestTestCase({
      agent: 'aider',
      outputDir: '.',
      agentFile: 'agent.md',
    });

    stat.mockRejectedValueOnce(new Error('directory denied'));
    await expect(
      handleSuggestTestCase({
        agent: 'aider',
        outputDir: '.',
        agentFile: 'agent.md',
      })
    ).rejects.toThrow();

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'close', value: 1 })
    );
    await expect(
      handleSuggestTestCase({
        agent: 'aider',
        outputDir: '.',
        agentFile: 'agent.md',
      })
    ).rejects.toThrow();

    access.mockRejectedValueOnce(new Error('agent denied'));
    await expect(
      handleSuggestTestCase({
        agent: 'aider',
        outputDir: '.',
        agentFile: 'agent.md',
      })
    ).rejects.toThrow();

    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'close', value: 0 })
    );
    spawn.mockImplementationOnce(() =>
      processDouble({ event: 'close', value: 2 })
    );
    await expect(
      handleSuggestTestCase({
        agent: 'aider',
        outputDir: '.',
        agentFile: 'agent.md',
      })
    ).rejects.toThrow();
  });

  it('registers its command action and maps action failures to exit 1', async () => {
    let action: ((options: never) => Promise<void>) | undefined;
    const chain = {
      command: jest.fn(() => chain),
      description: jest.fn(() => chain),
      requiredOption: jest.fn(() => chain),
      option: jest.fn(() => chain),
      action: jest.fn((callback: typeof action) => {
        action = callback;
        return chain;
      }),
    };
    registerSuggestTestCaseCommand(chain as never);
    stat.mockRejectedValueOnce(new Error('bad directory'));
    await action?.({
      agent: 'aider',
      outputDir: '.',
      agentFile: 'agent.md',
    } as never);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('extracts only non-empty credential-like environment values', () => {
    expect(
      credentialEnvironmentValues({
        NORMAL: 'visible',
        ACCESS_TOKEN: 'token',
        CLIENT_SECRET: 'secret',
        DB_PASSWORD: 'password',
        API_KEY: 'key',
        AUTHORIZATION: 'auth',
        EMPTY_TOKEN: '',
        UNDEFINED_SECRET: undefined,
      })
    ).toEqual(['token', 'secret', 'password', 'key', 'auth']);
  });
});
