import type {
  E2BRemoteCommand,
  E2BSandboxHandle,
} from '../../src/e2b/client.js';
import type {
  E2BCreateSandboxRequest,
  E2BSandboxMetadata,
} from '../../src/e2b/client.js';
import { E2BSdkClient } from '../../src/e2b/sdk-client.js';

const createMock = jest.fn();
const connectMock = jest.fn();
const getInfoMock = jest.fn();
const listMock = jest.fn();
const killMock = jest.fn();
const pauseMock = jest.fn();

const mockSandboxApi = {
  create: createMock,
  connect: connectMock,
  getInfo: getInfoMock,
  list: listMock,
  kill: killMock,
  pause: pauseMock,
};
jest.mock('e2b', () => ({ Sandbox: mockSandboxApi }));
const sdkLoader = async () => ({ Sandbox: mockSandboxApi as never });

const metadata: E2BSandboxMetadata = {
  owner: 'owner',
  project: 'project',
  experimentId: 'experiment',
  cellId: 'cell',
  attemptId: 'attempt',
  targetId: 'target',
  ownershipNonceHash: 'nonce',
};

const encodedMetadata = {
  yb_owner: 'owner',
  yb_project: 'project',
  yb_experiment_id: 'experiment',
  yb_cell_id: 'cell',
  yb_attempt_id: 'attempt',
  yb_target_id: 'target',
  yb_ownership_nonce_hash: 'nonce',
};

function remoteCommand(
  overrides: Partial<E2BRemoteCommand> = {}
): E2BRemoteCommand {
  return {
    executable: '/opt/youbencha/bin/run-cell',
    args: ['agent', '/work/input/cell.json'],
    cwd: '/work',
    env: {},
    timeoutMs: 100,
    ...overrides,
  };
}

function sdkInfo(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sandboxId: 'sandbox-1',
    templateId: 'template-1',
    state: 'running',
    cpuCount: 2,
    memoryMB: 4096,
    allowInternetAccess: true,
    network: { allowOut: ['api.example.com'] },
    metadata: { ...encodedMetadata, yb_template_build_id: 'build-1' },
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface FakeProcessHandle {
  pid: number;
  wait: jest.Mock;
  kill: jest.Mock;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

function fakeSandbox(processHandle?: FakeProcessHandle) {
  const handle =
    processHandle ??
    ({
      pid: 42,
      wait: jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }),
      kill: jest.fn().mockResolvedValue(true),
      stdout: '',
      stderr: '',
    } satisfies FakeProcessHandle);
  return {
    sandboxId: 'sandbox-1',
    files: {
      write: jest.fn(),
      read: jest.fn(),
    },
    commands: {
      run: jest.fn().mockResolvedValue(handle),
      kill: jest.fn(),
      list: jest.fn().mockResolvedValue([{ pid: 42 }]),
    },
    processHandle: handle,
  };
}

function createRequest(
  outbound: 'none' | 'allowlist' | 'unrestricted',
  overrides: Partial<E2BCreateSandboxRequest> = {}
): E2BCreateSandboxRequest {
  const network =
    outbound === 'allowlist'
      ? { inbound: 'none' as const, outbound, allow: ['api.example.com'] }
      : outbound === 'unrestricted'
        ? { inbound: 'none' as const, outbound, explicit_opt_in: true as const }
        : { inbound: 'none' as const, outbound };
  return {
    templateId: 'template-1',
    expectedBuildId: 'build-1',
    timeoutMs: 1000,
    resources: { cpu_count: 2, memory_mb: 4096 },
    network,
    metadata,
    ...overrides,
  };
}

describe('E2BSdkClient deterministic SDK bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['none', false, { denyOut: ['0.0.0.0/0'], allowPublicTraffic: false }],
    [
      'allowlist',
      true,
      { allowOut: ['api.example.com'], allowPublicTraffic: false },
    ],
    ['unrestricted', true, { allowPublicTraffic: false }],
  ] as const)(
    'creates a sandbox with %s networking',
    async (outbound, allowInternetAccess, network) => {
      const sandbox = fakeSandbox();
      createMock.mockResolvedValue(sandbox);
      const client = new E2BSdkClient(
        {
          apiKey: 'key',
          requestTimeoutMs: 3000,
        },
        { loadSdk: sdkLoader }
      );

      const handle = await client.createSandbox(createRequest(outbound));

      expect(handle.sandboxId).toBe('sandbox-1');
      expect(createMock).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({
          apiKey: 'key',
          secure: true,
          allowInternetAccess,
          network,
          metadata: {
            ...encodedMetadata,
            yb_template_build_id: 'build-1',
          },
          envs: {},
          lifecycle: { onTimeout: 'kill' },
        })
      );
    }
  );

  test('uses snapshots and encodes optional ownership metadata', async () => {
    createMock.mockResolvedValue(fakeSandbox());
    const client = new E2BSdkClient({}, { loadSdk: sdkLoader });
    await client.createSandbox(
      createRequest('none', {
        snapshotId: 'snapshot-1',
        expectedBuildId: undefined,
        metadata: {
          ...metadata,
          intendedExpiryAt: '2026-01-02T00:00:00.000Z',
          retentionReason: 'debug',
        },
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      'snapshot-1',
      expect.objectContaining({
        metadata: {
          ...encodedMetadata,
          yb_intended_expiry_at: '2026-01-02T00:00:00.000Z',
          yb_retention_reason: 'debug',
        },
      })
    );
  });

  test('uses the lazy default SDK loader', async () => {
    createMock.mockResolvedValue(fakeSandbox());
    await expect(
      new E2BSdkClient().createSandbox(createRequest('none'))
    ).resolves.toEqual(expect.objectContaining({ sandboxId: 'sandbox-1' }));
  });

  test('connects, maps sandbox information, and validates ownership', async () => {
    const sandbox = fakeSandbox();
    connectMock.mockResolvedValue(sandbox);
    getInfoMock
      .mockResolvedValueOnce(sdkInfo())
      .mockResolvedValueOnce(
        sdkInfo({
          state: 'paused',
          allowInternetAccess: false,
          network: { denyOut: ['0.0.0.0/0'] },
          metadata: encodedMetadata,
        })
      )
      .mockResolvedValueOnce(
        sdkInfo({
          allowInternetAccess: true,
          network: { denyOut: ['0.0.0.0/0'] },
        })
      )
      .mockResolvedValueOnce(
        sdkInfo({
          allowInternetAccess: true,
          network: undefined,
        })
      )
      .mockResolvedValueOnce(
        sdkInfo({
          network: undefined,
          metadata: { unrelated: 'value' },
        })
      );
    const client = new E2BSdkClient({ apiKey: 'key' }, { loadSdk: sdkLoader });
    const handle = await client.connectSandbox('sandbox-1');

    expect(await handle.getInfo()).toEqual(
      expect.objectContaining({
        sandboxId: 'sandbox-1',
        buildId: 'build-1',
        lifecycle: 'running',
        network: {
          inbound: 'none',
          outbound: 'allowlist',
          allow: ['api.example.com'],
        },
        metadata,
      })
    );
    expect(await handle.getInfo()).toEqual(
      expect.objectContaining({
        buildId: 'template-1',
        lifecycle: 'paused',
        network: { inbound: 'none', outbound: 'none' },
      })
    );
    expect((await handle.getInfo()).network.outbound).toBe('none');
    expect(await handle.getInfo()).toEqual(
      expect.objectContaining({
        network: {
          inbound: 'none',
          outbound: 'unrestricted',
          explicit_opt_in: true,
        },
      })
    );
    await expect(handle.getInfo()).rejects.toThrow(/ownership metadata/);
  });

  test('writes a defensive byte copy and reads a bounded stream', async () => {
    const sandbox = fakeSandbox();
    const releaseLock = jest.fn();
    const cancel = jest.fn();
    const read = jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2]) })
      .mockResolvedValueOnce({ done: false, value: Uint8Array.from([3]) })
      .mockResolvedValueOnce({ done: true });
    sandbox.files.read.mockResolvedValue({
      getReader: () => ({ read, cancel, releaseLock }),
    });
    connectMock.mockResolvedValue(sandbox);
    const handle = await new E2BSdkClient(
      {},
      { loadSdk: sdkLoader }
    ).connectSandbox('sandbox-1');
    const input = Uint8Array.from([4, 5]);

    await handle.writeFile('/work/file', input);
    input[0] = 9;
    expect(new Uint8Array(sandbox.files.write.mock.calls[0][1])).toEqual(
      Uint8Array.from([4, 5])
    );
    await expect(handle.readFile('/work/file', 3)).resolves.toEqual(
      Uint8Array.from([1, 2, 3])
    );
    expect(releaseLock).toHaveBeenCalled();

    read.mockReset().mockResolvedValue({
      done: false,
      value: Uint8Array.from([1, 2, 3, 4]),
    });
    await expect(handle.readFile('/work/file', 3)).rejects.toThrow(
      /exceeds 3 bytes/
    );
    expect(cancel).toHaveBeenCalled();
  });

  test('runs only fixed commands and returns normal and recovered exits', async () => {
    const processHandle: FakeProcessHandle = {
      pid: 42,
      wait: jest
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' })
        .mockRejectedValueOnce(new Error('SDK wait failed')),
      kill: jest.fn(),
      stdout: 'partial',
      stderr: 'failure',
    };
    const sandbox = fakeSandbox(processHandle);
    connectMock.mockResolvedValue(sandbox);
    const handle = await new E2BSdkClient(
      {},
      { loadSdk: sdkLoader }
    ).connectSandbox('sandbox-1');

    await expect(handle.runCommand(remoteCommand())).resolves.toEqual(
      expect.objectContaining({
        exitCode: 0,
        stdout: 'ok',
        processGroupId: '42',
      })
    );
    processHandle.exitCode = 7;
    await expect(handle.runCommand(remoteCommand())).resolves.toEqual(
      expect.objectContaining({
        exitCode: 7,
        stdout: 'partial',
        stderr: 'failure',
      })
    );
    for (const invalid of [
      remoteCommand({ executable: '/bin/other' }),
      remoteCommand({ cwd: '/tmp' }),
      remoteCommand({ args: ['bad'] }),
      remoteCommand({ args: ['unknown', '/work/input/cell.json'] }),
      remoteCommand({ args: ['agent', '/work/input/other.json'] }),
    ]) {
      await expect(handle.runCommand(invalid)).rejects.toThrow(
        /fixed runner commands/
      );
    }
    await expect(
      handle.runCommand(remoteCommand({ env: { e2b_api_key: 'secret' } }))
    ).rejects.toThrow(/E2B_API_KEY/);
  });

  test('kills a failed command and enforces the output safety limit', async () => {
    const processHandle: FakeProcessHandle = {
      pid: 42,
      wait: jest.fn().mockRejectedValue(new Error('wait failed')),
      kill: jest.fn().mockRejectedValue(new Error('kill failed')),
      stdout: '',
      stderr: '',
    };
    const sandbox = fakeSandbox(processHandle);
    connectMock.mockResolvedValue(sandbox);
    const handle = await new E2BSdkClient(
      {},
      { loadSdk: sdkLoader }
    ).connectSandbox('sandbox-1');

    await expect(handle.runCommand(remoteCommand())).rejects.toThrow(
      /wait failed/
    );
    expect(processHandle.kill).toHaveBeenCalled();

    sandbox.commands.run.mockImplementation(
      async (
        _command: string,
        options: { onStdout: (chunk: string) => void }
      ) => {
        options.onStdout('x'.repeat(4 * 1024 * 1024 + 1));
        return processHandle;
      }
    );
    await expect(handle.runCommand(remoteCommand())).rejects.toThrow(
      /output exceeded/
    );
  });

  test('validates and manages remote process groups', async () => {
    const sandbox = fakeSandbox();
    connectMock.mockResolvedValue(sandbox);
    const handle = await new E2BSdkClient(
      {},
      { loadSdk: sdkLoader }
    ).connectSandbox('sandbox-1');

    await handle.terminateProcessGroup('42');
    expect(sandbox.commands.kill).toHaveBeenCalledWith(42);
    await expect(handle.isProcessGroupRunning('42')).resolves.toBe(true);
    sandbox.commands.list.mockResolvedValue([{ pid: 7 }]);
    await expect(handle.isProcessGroupRunning('42')).resolves.toBe(false);
    for (const invalid of ['0', '-1', '1.2', 'NaN']) {
      await expect(handle.terminateProcessGroup(invalid)).rejects.toThrow(
        /Invalid/
      );
      await expect(handle.isProcessGroupRunning(invalid)).rejects.toThrow(
        /Invalid/
      );
    }
  });

  test.each([
    [undefined, ['running', 'paused']],
    ['paused', ['paused']],
    ['running', ['running']],
  ] as const)('lists %s lifecycle sandboxes', async (lifecycle, states) => {
    const paginator = {
      hasNext: true,
      nextItems: jest.fn().mockImplementationOnce(async function (this: {
        hasNext: boolean;
      }) {
        this.hasNext = false;
        return [sdkInfo(), sdkInfo({ metadata: { invalid: 'metadata' } })];
      }),
    };
    listMock.mockReturnValue(paginator);
    const client = new E2BSdkClient(
      { requestTimeoutMs: 25 },
      { loadSdk: sdkLoader }
    );
    const result = await client.listSandboxes({
      owner: 'owner',
      project: 'project',
      experimentId: 'experiment',
      attemptId: 'attempt',
      lifecycle,
    });

    expect(result).toHaveLength(1);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          metadata: expect.objectContaining({
            yb_owner: 'owner',
            yb_project: 'project',
            yb_experiment_id: 'experiment',
            yb_attempt_id: 'attempt',
          }),
          state: states,
        },
      })
    );
  });

  test('omits optional list metadata and delegates kill and pause', async () => {
    listMock.mockReturnValue({ hasNext: false, nextItems: jest.fn() });
    const client = new E2BSdkClient({ apiKey: 'key' }, { loadSdk: sdkLoader });
    await client.listSandboxes({ owner: 'owner', project: 'project' });
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          metadata: { yb_owner: 'owner', yb_project: 'project' },
          state: ['running', 'paused'],
        },
      })
    );
    await client.killSandbox('sandbox-1');
    await client.pauseSandbox('sandbox-1');
    expect(killMock).toHaveBeenCalledWith('sandbox-1', { apiKey: 'key' });
    expect(pauseMock).toHaveBeenCalledWith('sandbox-1', {
      apiKey: 'key',
      keepMemory: false,
    });
  });

  test('exposes the fixed SDK and capability contract', () => {
    const client = new E2BSdkClient();
    expect(client.sdkVersion).toBe('2.36.1');
    expect(client.capabilities).toEqual({
      securedAccess: true,
      outboundDeny: true,
      outboundAllowlist: true,
      immutableBuildSelection: true,
      snapshots: true,
    });
  });
});

// Compile-time guard that the test double exercises the complete public handle.
function acceptsHandle(_handle: E2BSandboxHandle): void {}
void acceptsHandle;
