import type { TokenBucket } from '../experiments/token-bucket.js';
import type {
  E2BClient,
  E2BCreateSandboxRequest,
  E2BSandboxHandle,
  E2BSandboxInfo,
  E2BSandboxMetadata,
} from './client.js';

export class E2BReconciliationError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'E2BReconciliationError';
  }
}

function metadataMatches(
  actual: E2BSandboxMetadata,
  expected: E2BSandboxMetadata
): boolean {
  return (
    actual.owner === expected.owner &&
    actual.project === expected.project &&
    actual.experimentId === expected.experimentId &&
    actual.cellId === expected.cellId &&
    actual.attemptId === expected.attemptId &&
    actual.targetId === expected.targetId &&
    actual.ownershipNonceHash === expected.ownershipNonceHash
  );
}

export interface ReconcileCreateOptions {
  client: E2BClient;
  request: E2BCreateSandboxRequest;
  creationLimiter?: TokenBucket;
  signal?: AbortSignal;
}

export interface ReconciledSandbox {
  sandbox: E2BSandboxHandle;
  adopted: boolean;
}

/**
 * Closes the provider create/persist crash gap. An attempt may adopt exactly
 * one fully-owned sandbox, create when no match exists, and fails after
 * killing duplicate fully-owned matches.
 */
export async function reconcileOrCreateSandbox(
  options: ReconcileCreateOptions
): Promise<ReconciledSandbox> {
  const { metadata } = options.request;
  const candidates = await options.client.listSandboxes({
    owner: metadata.owner,
    project: metadata.project,
    experimentId: metadata.experimentId,
    attemptId: metadata.attemptId,
  });
  const mismatched = candidates.filter(
    (candidate) => !metadataMatches(candidate.metadata, metadata)
  );
  if (mismatched.length > 0) {
    throw new E2BReconciliationError(
      'ownership_conflict',
      'Attempt metadata matched a sandbox with different ownership fields'
    );
  }
  if (candidates.length === 1) {
    return {
      sandbox: await options.client.connectSandbox(candidates[0].sandboxId),
      adopted: true,
    };
  }
  if (candidates.length > 1) {
    await Promise.allSettled(
      candidates.map((candidate) =>
        options.client.killSandbox(candidate.sandboxId)
      )
    );
    throw new E2BReconciliationError(
      'duplicate_owned_sandboxes',
      `Found and killed ${candidates.length} sandboxes for one attempt`
    );
  }

  await options.creationLimiter?.acquire(options.signal);
  return {
    sandbox: await options.client.createSandbox(options.request),
    adopted: false,
  };
}

export interface E2BSandboxServiceOptions {
  owner: string;
  project: string;
}

/**
 * User-facing managed-sandbox operations. Mutations first verify the complete
 * owner/project metadata and therefore cannot affect unrelated E2B sandboxes.
 */
export class E2BSandboxService {
  public constructor(
    private readonly client: E2BClient,
    private readonly options: E2BSandboxServiceOptions
  ) {}

  public list(experimentId?: string): Promise<E2BSandboxInfo[]> {
    return this.client.listSandboxes({
      owner: this.options.owner,
      project: this.options.project,
      experimentId,
    });
  }

  public async kill(sandboxId: string): Promise<void> {
    await this.requireOwnedSandbox(sandboxId);
    await this.client.killSandbox(sandboxId);
  }

  public async reap(
    experimentId?: string,
    now = new Date()
  ): Promise<E2BSandboxInfo[]> {
    const candidates = await this.client.listSandboxes({
      owner: this.options.owner,
      project: this.options.project,
      experimentId,
      lifecycle: 'paused',
    });
    const expired = candidates.filter((sandbox) => {
      const expiry = sandbox.metadata.intendedExpiryAt;
      return expiry !== undefined && Date.parse(expiry) <= now.getTime();
    });
    await Promise.all(
      expired.map((sandbox) => this.client.killSandbox(sandbox.sandboxId))
    );
    return expired;
  }

  private async requireOwnedSandbox(
    sandboxId: string
  ): Promise<E2BSandboxInfo> {
    // Listing is read-only. Connecting to a paused sandbox would resume it
    // before ownership was verified.
    const managed = await this.client.listSandboxes({
      owner: this.options.owner,
      project: this.options.project,
    });
    const info = managed.find((sandbox) => sandbox.sandboxId === sandboxId);
    if (info === undefined) {
      throw new E2BReconciliationError(
        'sandbox_not_owned',
        `Sandbox ${sandboxId} is not owned by this youBencha project`
      );
    }
    return info;
  }
}
