import type {
  Sandbox,
  ProcessInfo,
  SandboxInfo,
  SandboxNetworkOpts,
} from 'e2b';
import {
  E2B_CELL_MANIFEST_PATH,
  E2B_RUNNER_EXECUTABLE,
  E2B_RUNNER_PHASES,
  E2B_RUNNER_WORKING_DIRECTORY,
} from './runner-protocol.js';
import type {
  E2BClient,
  E2BClientCapabilities,
  E2BCreateSandboxRequest,
  E2BListSandboxFilter,
  E2BRemoteCommand,
  E2BRemoteCommandResult,
  E2BSandboxHandle,
  E2BSandboxInfo,
  E2BSandboxMetadata,
} from './client.js';
import type { E2BNetworkPolicy } from './schemas.js';

const SDK_VERSION = '2.36.1';
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const ALL_TRAFFIC = '0.0.0.0/0';

interface LoadedE2BSdk {
  Sandbox: typeof import('e2b').Sandbox;
}

async function loadE2BSdk(): Promise<LoadedE2BSdk> {
  const sdk = await import('e2b');
  return { Sandbox: sdk.Sandbox };
}

const METADATA_KEYS = {
  owner: 'yb_owner',
  project: 'yb_project',
  experimentId: 'yb_experiment_id',
  cellId: 'yb_cell_id',
  attemptId: 'yb_attempt_id',
  targetId: 'yb_target_id',
  ownershipNonceHash: 'yb_ownership_nonce_hash',
  templateBuildId: 'yb_template_build_id',
  intendedExpiryAt: 'yb_intended_expiry_at',
  retentionReason: 'yb_retention_reason',
} as const;

export interface E2BSdkClientOptions {
  apiKey?: string;
  requestTimeoutMs?: number;
}

export interface E2BSdkClientDependencies {
  loadSdk?: () => Promise<LoadedE2BSdk>;
}

function encodeMetadata(
  metadata: E2BSandboxMetadata,
  buildId?: string
): Record<string, string> {
  return {
    [METADATA_KEYS.owner]: metadata.owner,
    [METADATA_KEYS.project]: metadata.project,
    [METADATA_KEYS.experimentId]: metadata.experimentId,
    [METADATA_KEYS.cellId]: metadata.cellId,
    [METADATA_KEYS.attemptId]: metadata.attemptId,
    [METADATA_KEYS.targetId]: metadata.targetId,
    [METADATA_KEYS.ownershipNonceHash]: metadata.ownershipNonceHash,
    ...(buildId === undefined
      ? {}
      : { [METADATA_KEYS.templateBuildId]: buildId }),
    ...(metadata.intendedExpiryAt === undefined
      ? {}
      : { [METADATA_KEYS.intendedExpiryAt]: metadata.intendedExpiryAt }),
    ...(metadata.retentionReason === undefined
      ? {}
      : { [METADATA_KEYS.retentionReason]: metadata.retentionReason }),
  };
}

function decodeMetadata(
  metadata: Record<string, string>
): E2BSandboxMetadata | undefined {
  const required = [
    METADATA_KEYS.owner,
    METADATA_KEYS.project,
    METADATA_KEYS.experimentId,
    METADATA_KEYS.cellId,
    METADATA_KEYS.attemptId,
    METADATA_KEYS.targetId,
    METADATA_KEYS.ownershipNonceHash,
  ] as const;
  if (required.some((key) => metadata[key] === undefined)) return undefined;
  return {
    owner: metadata[METADATA_KEYS.owner],
    project: metadata[METADATA_KEYS.project],
    experimentId: metadata[METADATA_KEYS.experimentId],
    cellId: metadata[METADATA_KEYS.cellId],
    attemptId: metadata[METADATA_KEYS.attemptId],
    targetId: metadata[METADATA_KEYS.targetId],
    ownershipNonceHash: metadata[METADATA_KEYS.ownershipNonceHash],
    intendedExpiryAt: metadata[METADATA_KEYS.intendedExpiryAt],
    retentionReason: metadata[METADATA_KEYS.retentionReason],
  };
}

function sdkNetwork(policy: E2BNetworkPolicy): {
  allowInternetAccess: boolean;
  network: SandboxNetworkOpts;
} {
  switch (policy.outbound) {
    case 'none':
      return {
        allowInternetAccess: false,
        network: {
          denyOut: [ALL_TRAFFIC],
          allowPublicTraffic: false,
        },
      };
    case 'allowlist':
      return {
        allowInternetAccess: true,
        network: {
          allowOut: [...policy.allow],
          allowPublicTraffic: false,
        },
      };
    case 'unrestricted':
      return {
        allowInternetAccess: true,
        network: { allowPublicTraffic: false },
      };
  }
}

function mapNetwork(info: SandboxInfo): E2BNetworkPolicy {
  const allow = info.network?.allowOut;
  if (allow !== undefined && allow.length > 0) {
    return {
      inbound: 'none',
      outbound: 'allowlist',
      allow: [...allow],
    };
  }
  if (
    info.allowInternetAccess === false ||
    info.network?.denyOut?.includes(ALL_TRAFFIC)
  ) {
    return { inbound: 'none', outbound: 'none' };
  }
  return {
    inbound: 'none',
    outbound: 'unrestricted',
    explicit_opt_in: true,
  };
}

function isFixedRunnerCommand(command: E2BRemoteCommand): boolean {
  return (
    command.executable === E2B_RUNNER_EXECUTABLE &&
    command.cwd === E2B_RUNNER_WORKING_DIRECTORY &&
    command.args.length === 2 &&
    E2B_RUNNER_PHASES.includes(
      command.args[0] as (typeof E2B_RUNNER_PHASES)[number]
    ) &&
    command.args[1] === E2B_CELL_MANIFEST_PATH
  );
}

function commandText(command: E2BRemoteCommand): string {
  if (!isFixedRunnerCommand(command)) {
    throw new Error('E2B SDK adapter only accepts fixed runner commands');
  }
  // Every token was checked against a closed set of constant values above.
  return [command.executable, ...command.args].join(' ');
}

async function boundedRead(
  sandbox: Sandbox,
  file: string,
  maxBytes: number
): Promise<Uint8Array> {
  const stream = await sandbox.files.read(file, { format: 'stream' });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('File exceeds configured download limit');
        throw new Error(`Remote file ${file} exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

class SdkSandboxHandle implements E2BSandboxHandle {
  public readonly sandboxId: string;

  public constructor(
    private readonly sandbox: Sandbox,
    private readonly options: E2BSdkClientOptions,
    private readonly loadSdk: () => Promise<LoadedE2BSdk>
  ) {
    this.sandboxId = sandbox.sandboxId;
  }

  public async getInfo(): Promise<E2BSandboxInfo> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    const info = await SandboxApi.getInfo(this.sandboxId, this.options);
    return mapSandboxInfo(info);
  }

  public async writeFile(file: string, contents: Uint8Array): Promise<void> {
    const copy = Uint8Array.from(contents);
    await this.sandbox.files.write(file, copy.buffer);
  }

  public readFile(file: string, maxBytes: number): Promise<Uint8Array> {
    return boundedRead(this.sandbox, file, maxBytes);
  }

  public async runCommand(
    command: E2BRemoteCommand
  ): Promise<E2BRemoteCommandResult> {
    if (
      Object.keys(command.env).some(
        (name) => name.toUpperCase() === 'E2B_API_KEY'
      )
    ) {
      throw new Error('E2B_API_KEY cannot be placed in a sandbox command');
    }
    let outputBytes = 0;
    const countOutput = (chunk: string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        throw new Error(
          'Remote runner command output exceeded the safety limit'
        );
      }
    };
    const startedAt = new Date().toISOString();
    const handle = await this.sandbox.commands.run(commandText(command), {
      background: true,
      cwd: command.cwd,
      envs: { ...command.env },
      timeoutMs: command.timeoutMs,
      requestTimeoutMs: command.timeoutMs,
      signal: command.signal,
      onStdout: countOutput,
      onStderr: countOutput,
    });
    try {
      const result = await handle.wait();
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        startedAt,
        completedAt: new Date().toISOString(),
        processGroupId: String(handle.pid),
      };
    } catch (error) {
      if (handle.exitCode !== undefined) {
        return {
          exitCode: handle.exitCode,
          stdout: handle.stdout,
          stderr: handle.stderr,
          startedAt,
          completedAt: new Date().toISOString(),
          processGroupId: String(handle.pid),
        };
      }
      await handle.kill().catch(() => false);
      throw error;
    }
  }

  public async terminateProcessGroup(processGroupId: string): Promise<void> {
    const pid = Number(processGroupId);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('Invalid remote process group identifier');
    }
    await this.sandbox.commands.kill(pid);
  }

  public async isProcessGroupRunning(processGroupId: string): Promise<boolean> {
    const pid = Number(processGroupId);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error('Invalid remote process group identifier');
    }
    const processes: ProcessInfo[] = await this.sandbox.commands.list();
    return processes.some((process) => process.pid === pid);
  }
}

function mapSandboxInfo(info: SandboxInfo): E2BSandboxInfo {
  const metadata = decodeMetadata(info.metadata);
  if (metadata === undefined) {
    throw new Error(
      `Sandbox ${info.sandboxId} lacks youBencha ownership metadata`
    );
  }
  return {
    sandboxId: info.sandboxId,
    templateId: info.templateId,
    buildId: info.metadata[METADATA_KEYS.templateBuildId] ?? info.templateId,
    lifecycle: info.state === 'paused' ? 'paused' : 'running',
    secureAccess: true,
    resources: {
      cpu_count: info.cpuCount,
      memory_mb: info.memoryMB,
    },
    network: mapNetwork(info),
    metadata,
    createdAt: info.startedAt.toISOString(),
  };
}

export class E2BSdkClient implements E2BClient {
  public readonly sdkVersion = SDK_VERSION;
  public readonly capabilities: E2BClientCapabilities = {
    securedAccess: true,
    outboundDeny: true,
    outboundAllowlist: true,
    immutableBuildSelection: true,
    snapshots: true,
  };

  private readonly loadSdk: () => Promise<LoadedE2BSdk>;

  public constructor(
    private readonly options: E2BSdkClientOptions = {},
    dependencies: E2BSdkClientDependencies = {}
  ) {
    this.loadSdk = dependencies.loadSdk ?? loadE2BSdk;
  }

  public async createSandbox(
    request: E2BCreateSandboxRequest
  ): Promise<E2BSandboxHandle> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    const network = sdkNetwork(request.network);
    // The SDK create surface accepts a template/snapshot selector, not a
    // template build ID. Immutable build identity is verified from the runner
    // manifest immediately after creation.
    const template = request.snapshotId ?? request.templateId;
    const sandbox = await SandboxApi.create(template, {
      ...this.options,
      timeoutMs: request.timeoutMs,
      secure: true,
      allowInternetAccess: network.allowInternetAccess,
      network: network.network,
      metadata: encodeMetadata(request.metadata, request.expectedBuildId),
      envs: {},
      lifecycle: { onTimeout: 'kill' },
    });
    return new SdkSandboxHandle(sandbox, this.options, this.loadSdk);
  }

  public async connectSandbox(sandboxId: string): Promise<E2BSandboxHandle> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    const sandbox = await SandboxApi.connect(sandboxId, this.options);
    return new SdkSandboxHandle(sandbox, this.options, this.loadSdk);
  }

  public async listSandboxes(
    filter: E2BListSandboxFilter
  ): Promise<E2BSandboxInfo[]> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    const queryMetadata = {
      [METADATA_KEYS.owner]: filter.owner,
      [METADATA_KEYS.project]: filter.project,
      ...(filter.experimentId === undefined
        ? {}
        : { [METADATA_KEYS.experimentId]: filter.experimentId }),
      ...(filter.attemptId === undefined
        ? {}
        : { [METADATA_KEYS.attemptId]: filter.attemptId }),
    };
    const states =
      filter.lifecycle === 'paused'
        ? (['paused'] as const)
        : filter.lifecycle === undefined
          ? (['running', 'paused'] as const)
          : (['running'] as const);
    const paginator = SandboxApi.list({
      ...this.options,
      query: { metadata: queryMetadata, state: [...states] },
      limit: 100,
    });
    const result: E2BSandboxInfo[] = [];
    while (paginator.hasNext) {
      const page = await paginator.nextItems(this.options);
      for (const info of page) {
        const metadata = decodeMetadata(info.metadata);
        if (metadata !== undefined) result.push(mapSandboxInfo(info));
      }
    }
    return result;
  }

  public async killSandbox(sandboxId: string): Promise<void> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    await SandboxApi.kill(sandboxId, this.options);
  }

  public async pauseSandbox(sandboxId: string): Promise<void> {
    const { Sandbox: SandboxApi } = await this.loadSdk();
    await SandboxApi.pause(sandboxId, {
      ...this.options,
      keepMemory: false,
    });
  }
}
