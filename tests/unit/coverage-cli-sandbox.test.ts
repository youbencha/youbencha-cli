import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const client = jest.fn();
const serviceConstructor = jest.fn();
jest.mock('../../src/e2b/index.js', () => ({
  E2BSdkClient: jest.fn().mockImplementation((options) => {
    client(options);
    return { client: true };
  }),
  E2BSandboxService: jest.fn().mockImplementation((sdk, options) => {
    serviceConstructor(sdk, options);
    return {
      list: async () => [],
      reap: async () => [],
      kill: async () => undefined,
    };
  }),
}));

import {
  registerSandboxCommand,
  sandboxKillCommand,
  sandboxListCommand,
  sandboxReapCommand,
} from '../../src/cli/commands/sandbox.js';

function sandbox(id = 'sandbox-1') {
  return {
    sandboxId: id,
    lifecycle: 'running' as const,
    metadata: {
      owner: 'owner',
      project: 'project',
      experimentId: 'experiment',
      targetId: 'target',
      intendedExpiryAt: undefined,
    },
  };
}

describe('sandbox command coverage', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
  });

  it('uses default E2B service configuration and identifier fallbacks', async () => {
    const output: string[] = [];
    await sandboxListCommand(
      {},
      {
        cwd: 'C:\\project',
        environment: {
          E2B_API_KEY: 'key',
          YOUBENCHA_E2B_OWNER: '***',
          YOUBENCHA_E2B_PROJECT: 'custom project',
        },
        stdout: (message) => output.push(message),
      }
    );
    expect(client).toHaveBeenCalledWith({ apiKey: 'key' });
    expect(serviceConstructor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ owner: 'youbencha', project: 'custom-project' })
    );
    expect(output).toEqual(['No managed E2B sandboxes found']);
  });

  it('uses process defaults for all command dependency objects', async () => {
    const previous = process.env.E2B_API_KEY;
    process.env.E2B_API_KEY = 'process-key';
    try {
      await sandboxListCommand({});
      await sandboxReapCommand({});
      await sandboxKillCommand('sandbox');
    } finally {
      if (previous === undefined) delete process.env.E2B_API_KEY;
      else process.env.E2B_API_KEY = previous;
    }
    expect(serviceConstructor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ owner: 'youbencha' })
    );
  });

  it('reports missing API keys through default and custom error writers', async () => {
    const errors: string[] = [];
    await sandboxListCommand(
      {},
      { environment: {}, stderr: (message) => errors.push(message) }
    );
    expect(errors[0]).toContain('E2B_API_KEY');
    expect(process.exitCode).toBe(1);

    await sandboxListCommand({}, { environment: {} });
    await sandboxKillCommand('id', {
      service: {
        list: async () => [],
        reap: async () => [],
        kill: async () => {
          throw 'string failure';
        },
      },
      stderr: (message) => errors.push(message),
    });
    expect(errors).toContain('string failure');
  });

  it('lists JSON and tabular sandboxes, including absent expiry', async () => {
    const output: string[] = [];
    const items = [
      sandbox('one'),
      {
        ...sandbox('two'),
        metadata: { ...sandbox().metadata, intendedExpiryAt: 'tomorrow' },
      },
    ];
    const service = {
      list: jest.fn(async () => items),
      reap: jest.fn(async () => items),
      kill: jest.fn(async () => undefined),
    };
    await sandboxListCommand(
      { experiment: 'experiment', json: true },
      { service, stdout: (message) => output.push(message) }
    );
    await sandboxListCommand(
      {},
      { service, stdout: (message) => output.push(message) }
    );
    expect(output.join('\n')).toContain('"sandboxId": "one"');
    expect(output.join('\n')).toContain('one\trunning');

    const now = new Date('2026-01-01T00:00:00Z');
    await sandboxReapCommand(
      { experiment: 'experiment' },
      { service, now: () => now, stdout: (message) => output.push(message) }
    );
    await sandboxReapCommand(
      {},
      { service, stdout: (message) => output.push(message) }
    );
    await sandboxKillCommand('one', {
      service,
      stdout: (message) => output.push(message),
    });
    expect(service.reap).toHaveBeenCalledWith('experiment', now);
    expect(service.reap).toHaveBeenCalledWith(undefined, undefined);
    expect(service.kill).toHaveBeenCalledWith('one');
  });

  it('reports reap failures', async () => {
    const errors: string[] = [];
    await sandboxReapCommand(
      {},
      {
        service: {
          list: async () => [],
          reap: async () => {
            throw new Error('reap failed');
          },
          kill: async () => undefined,
        },
        stderr: (message) => errors.push(message),
      }
    );
    expect(errors).toEqual(['reap failed']);
  });

  it('uses default error writers for reap and kill failures', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = {
      list: async () => [],
      reap: async () => {
        throw new Error('reap failed');
      },
      kill: async () => {
        throw new Error('kill failed');
      },
    };
    await sandboxReapCommand({}, { service: failing });
    await sandboxKillCommand('sandbox', { service: failing });
    expect(console.error).toHaveBeenCalledWith('reap failed');
    expect(console.error).toHaveBeenCalledWith('kill failed');
  });

  it('registers list, reap, and kill actions', () => {
    const action = jest.fn();
    const chain = {
      command: jest.fn(() => chain),
      description: jest.fn(() => chain),
      option: jest.fn(() => chain),
      argument: jest.fn(() => chain),
      action: jest.fn((callback) => {
        action(callback);
        return chain;
      }),
    };
    registerSandboxCommand(chain as never);
    expect(action).toHaveBeenCalledTimes(3);
  });
});
