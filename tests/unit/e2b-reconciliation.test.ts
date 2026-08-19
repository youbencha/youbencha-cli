import type {
  E2BClient,
  E2BCreateSandboxRequest,
  E2BListSandboxFilter,
  E2BRemoteCommand,
  E2BRemoteCommandResult,
  E2BSandboxHandle,
  E2BSandboxInfo,
} from '../../src/e2b/client.js';
import {
  E2BReconciliationError,
  E2BSandboxService,
  reconcileOrCreateSandbox,
} from '../../src/e2b/reconciliation.js';

const metadata = {
  owner: 'team',
  project: 'project',
  experimentId: 'experiment',
  cellId: 'a'.repeat(64),
  attemptId: 'attempt-1',
  targetId: 'candidate',
  ownershipNonceHash: 'b'.repeat(64),
};

const request: E2BCreateSandboxRequest = {
  templateId: 'template',
  expectedBuildId: 'build',
  timeoutMs: 60_000,
  secureAccess: true,
  network: { inbound: 'none', outbound: 'none' },
  metadata,
};

function info(
  sandboxId: string,
  overrides: Partial<E2BSandboxInfo> = {}
): E2BSandboxInfo {
  return {
    sandboxId,
    templateId: 'template',
    buildId: 'build',
    lifecycle: 'running',
    secureAccess: true,
    resources: { cpu_count: 2, memory_mb: 4096 },
    network: { inbound: 'none', outbound: 'none' },
    metadata,
    ...overrides,
  };
}

class Handle implements E2BSandboxHandle {
  public constructor(
    public readonly sandboxId: string,
    private readonly infoValue: E2BSandboxInfo
  ) {}
  public async getInfo(): Promise<E2BSandboxInfo> {
    return this.infoValue;
  }
  public async writeFile(): Promise<void> {}
  public async readFile(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  public async runCommand(
    _command: E2BRemoteCommand
  ): Promise<E2BRemoteCommandResult> {
    throw new Error('Not used');
  }
  public async terminateProcessGroup(): Promise<void> {}
  public async isProcessGroupRunning(): Promise<boolean> {
    return false;
  }
}

class Client implements E2BClient {
  public readonly sdkVersion = 'fake';
  public readonly capabilities = {
    securedAccess: true,
    outboundDeny: true,
    outboundAllowlist: true,
    immutableBuildSelection: true,
    snapshots: true,
  };
  public sandboxes: E2BSandboxInfo[] = [];
  public created = 0;
  public killed: string[] = [];
  public filters: E2BListSandboxFilter[] = [];

  public async createSandbox(
    createRequest: E2BCreateSandboxRequest
  ): Promise<E2BSandboxHandle> {
    this.created += 1;
    const created = info('new-sandbox', { metadata: createRequest.metadata });
    return new Handle(created.sandboxId, created);
  }
  public async connectSandbox(sandboxId: string): Promise<E2BSandboxHandle> {
    const found = this.sandboxes.find(
      (sandbox) => sandbox.sandboxId === sandboxId
    );
    if (found === undefined) throw new Error('not found');
    return new Handle(sandboxId, found);
  }
  public async listSandboxes(
    filter: E2BListSandboxFilter
  ): Promise<E2BSandboxInfo[]> {
    this.filters.push(filter);
    return this.sandboxes.filter((sandbox) => {
      if (
        sandbox.metadata.owner !== filter.owner ||
        sandbox.metadata.project !== filter.project
      ) {
        return false;
      }
      if (
        filter.experimentId !== undefined &&
        sandbox.metadata.experimentId !== filter.experimentId
      ) {
        return false;
      }
      if (
        filter.attemptId !== undefined &&
        sandbox.metadata.attemptId !== filter.attemptId
      ) {
        return false;
      }
      return (
        filter.lifecycle === undefined || sandbox.lifecycle === filter.lifecycle
      );
    });
  }
  public async killSandbox(sandboxId: string): Promise<void> {
    this.killed.push(sandboxId);
  }
  public async pauseSandbox(): Promise<void> {}
}

describe('E2B create reconciliation', () => {
  test('creates for zero matches and adopts exactly one owned match', async () => {
    const client = new Client();
    await expect(
      reconcileOrCreateSandbox({ client, request })
    ).resolves.toMatchObject({ adopted: false });
    expect(client.created).toBe(1);

    client.sandboxes = [info('existing')];
    await expect(
      reconcileOrCreateSandbox({ client, request })
    ).resolves.toMatchObject({
      adopted: true,
      sandbox: { sandboxId: 'existing' },
    });
    expect(client.created).toBe(1);
  });

  test('kills duplicate fully-owned matches and refuses mismatched ownership', async () => {
    const client = new Client();
    client.sandboxes = [info('one'), info('two')];
    await expect(
      reconcileOrCreateSandbox({ client, request })
    ).rejects.toMatchObject({
      code: 'duplicate_owned_sandboxes',
    });
    expect(client.killed.sort()).toEqual(['one', 'two']);

    client.killed = [];
    client.sandboxes = [
      info('conflict', {
        metadata: { ...metadata, cellId: 'c'.repeat(64) },
      }),
    ];
    await expect(
      reconcileOrCreateSandbox({ client, request })
    ).rejects.toBeInstanceOf(E2BReconciliationError);
    expect(client.killed).toEqual([]);
  });
});

describe('managed sandbox service', () => {
  test('lists, reaps expired retained sandboxes, and preserves unexpired ones', async () => {
    const client = new Client();
    client.sandboxes = [
      info('expired', {
        lifecycle: 'paused',
        metadata: {
          ...metadata,
          intendedExpiryAt: '2026-07-27T00:00:00.000Z',
        },
      }),
      info('future', {
        lifecycle: 'paused',
        metadata: {
          ...metadata,
          intendedExpiryAt: '2026-07-29T00:00:00.000Z',
        },
      }),
    ];
    const service = new E2BSandboxService(client, {
      owner: 'team',
      project: 'project',
    });
    await expect(service.list('experiment')).resolves.toHaveLength(2);
    await expect(
      service.reap('experiment', new Date('2026-07-28T00:00:00.000Z'))
    ).resolves.toMatchObject([{ sandboxId: 'expired' }]);
    expect(client.killed).toEqual(['expired']);

    client.sandboxes = [];
    await expect(service.reap()).resolves.toEqual([]);
  });

  test('refuses to kill a sandbox outside the configured owner scope', async () => {
    const client = new Client();
    client.sandboxes = [
      info('foreign', {
        metadata: { ...metadata, owner: 'other-team' },
      }),
    ];
    // connectSandbox looks up by ID without applying list filters.
    const service = new E2BSandboxService(client, {
      owner: 'team',
      project: 'project',
    });
    await expect(service.kill('foreign')).rejects.toMatchObject({
      code: 'sandbox_not_owned',
    });
    expect(client.killed).toEqual([]);
  });
});
