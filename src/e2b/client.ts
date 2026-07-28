import type {
  E2BLifecycle,
  E2BNetworkPolicy,
  E2BResourceExpectation,
} from './schemas.js';

export interface E2BClientCapabilities {
  securedAccess: boolean;
  outboundDeny: boolean;
  outboundAllowlist: boolean;
  immutableBuildSelection: boolean;
  snapshots: boolean;
}

export interface E2BSandboxMetadata {
  owner: string;
  project: string;
  experimentId: string;
  cellId: string;
  attemptId: string;
  targetId: string;
  ownershipNonceHash: string;
  intendedExpiryAt?: string;
  retentionReason?: string;
}

export interface E2BCreateSandboxRequest {
  templateId: string;
  expectedBuildId?: string;
  snapshotId?: string;
  timeoutMs: number;
  secureAccess: true;
  network: E2BNetworkPolicy;
  metadata: E2BSandboxMetadata;
}

export interface E2BRemoteCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface E2BRemoteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
  processGroupId?: string;
}

export interface E2BSandboxInfo {
  sandboxId: string;
  templateId: string;
  buildId: string;
  lifecycle: E2BLifecycle;
  secureAccess: boolean;
  resources: E2BResourceExpectation;
  network: E2BNetworkPolicy;
  metadata: E2BSandboxMetadata;
  createdAt?: string;
}

export interface E2BSandboxHandle {
  readonly sandboxId: string;
  getInfo(): Promise<E2BSandboxInfo>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  runCommand(command: E2BRemoteCommand): Promise<E2BRemoteCommandResult>;
  terminateProcessGroup(processGroupId: string): Promise<void>;
  isProcessGroupRunning(processGroupId: string): Promise<boolean>;
}

export interface E2BListSandboxFilter {
  owner: string;
  project: string;
  experimentId?: string;
  attemptId?: string;
  lifecycle?: E2BLifecycle;
}

/**
 * Provider-neutral seam for the E2B SDK. Production code can adapt the pinned
 * SDK while unit tests use a deterministic fake without network access.
 */
export interface E2BClient {
  readonly sdkVersion: string;
  readonly capabilities: E2BClientCapabilities;
  createSandbox(request: E2BCreateSandboxRequest): Promise<E2BSandboxHandle>;
  connectSandbox(sandboxId: string): Promise<E2BSandboxHandle>;
  listSandboxes(filter: E2BListSandboxFilter): Promise<E2BSandboxInfo[]>;
  killSandbox(sandboxId: string): Promise<void>;
  pauseSandbox(sandboxId: string): Promise<void>;
}
