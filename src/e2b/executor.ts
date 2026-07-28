import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TargetUnavailableError } from '../experiments/target-circuit-breaker.js';
import { ExperimentExecutionError } from '../experiments/retry.js';
import type { TokenBucket } from '../experiments/token-bucket.js';
import type {
  InterruptedExecutionContext,
  PlannedExperimentCell,
  SingleRunExecutionContext,
  SingleRunExecutionResult,
  SingleRunExecutor,
} from '../experiments/single-run-executor.js';
import { resultsBundleSchema } from '../schemas/result.schema.js';
import { youBenchaLogSchema } from '../schemas/youbenchalog.schema.js';
import {
  normalizeRemoteArtifactPath,
  validateArtifactPackage,
  writeValidatedArtifactPackage,
  type InspectedArchiveEntry,
} from './artifacts.js';
import type {
  E2BClient,
  E2BCreateSandboxRequest,
  E2BSandboxHandle,
  E2BSandboxMetadata,
} from './client.js';
import {
  resolveEffectiveNetworkPolicy,
  resolvePhaseEnvironment,
  validateDeadlines,
  validateProviderSecurityCapabilities,
  validateTemplateForCell,
} from './policies.js';
import { reconcileOrCreateSandbox } from './reconciliation.js';
import {
  E2B_CELL_MANIFEST_PATH,
  E2B_OUTPUT_ARCHIVE_PATH,
  E2B_OUTPUT_MANIFEST_PATH,
  E2B_RUNNER_PHASES,
  runnerCommand,
} from './runner-protocol.js';
import {
  e2bCellManifestSchema,
  e2bProviderConfigSchema,
  type E2BArtifactLimits,
  type E2BCellManifest,
  type E2BNetworkPolicy,
  type E2BProviderConfig,
  type E2BRequiredHarnessCapability,
  type E2BRunnerPhase,
  type E2BSecretReference,
  type E2BTemplateManifest,
} from './schemas.js';

const TEMPLATE_MANIFEST_PATH = '/opt/youbencha/manifest.json';
const MAX_TEMPLATE_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_MANIFEST_BYTES = 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class E2BPhaseExecutionError extends Error {
  public constructor(
    public readonly phase: E2BRunnerPhase,
    public readonly exitCode: number
  ) {
    super(`E2B runner phase ${phase} exited with code ${exitCode}`);
    this.name = 'E2BPhaseExecutionError';
  }
}

export interface E2BExecutorCellPolicy {
  requiredCapabilities: readonly E2BRequiredHarnessCapability[];
  networkRequirements?: readonly E2BNetworkPolicy[];
  secretReferences?: readonly E2BSecretReference[];
  adapterSchemaVersion?: string;
  phaseComponents?: Partial<Record<E2BRunnerPhase, string>>;
  snapshotId?: string;
}

export interface E2BSingleRunExecutorOptions {
  client: E2BClient;
  provider: E2BProviderConfig;
  owner: string;
  project: string;
  artifactsDirectory: string;
  resolveCellPolicy: (cell: PlannedExperimentCell) => E2BExecutorCellPolicy;
  creationLimiter?: TokenBucket;
  environment?: NodeJS.ProcessEnv;
  basePhaseEnvironment?: Readonly<Record<string, string>>;
  inspectArchive?: (
    archive: Uint8Array,
    limits: E2BArtifactLimits
  ) => Promise<readonly InspectedArchiveEntry[]>;
  isTargetUnavailable?: (
    phase: E2BRunnerPhase,
    exitCode: number,
    stdout: string,
    stderr: string
  ) => boolean;
  onWarning?: (message: string) => void;
  now?: () => Date;
}

function tarString(buffer: Uint8Array, start: number, length: number): string {
  return Buffer.from(buffer.subarray(start, start + length))
    .toString('utf8')
    .replace(/\0.*$/s, '')
    .trim();
}

function tarNumber(buffer: Uint8Array, start: number, length: number): number {
  const field = buffer.subarray(start, start + length);
  if ((field[0] ?? 0) >= 0x80) {
    throw new Error('Base-256 tar numeric fields are not supported');
  }
  const value = tarString(buffer, start, length).replace(/\s/g, '');
  if (value === '') return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar numeric field');
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Unsafe tar numeric field');
  }
  return parsed;
}

function verifyTarChecksum(block: Uint8Array): void {
  const expected = tarNumber(block, 148, 8);
  let actual = 0;
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  }
  if (actual !== expected) throw new Error('Invalid tar header checksum');
}

function parseTar(
  tarBytes: Uint8Array,
  limits: E2BArtifactLimits
): InspectedArchiveEntry[] {
  const entries: InspectedArchiveEntry[] = [];
  let offset = 0;
  let reachedEnd = false;
  while (offset + 512 <= tarBytes.byteLength) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      reachedEnd = true;
      if (!tarBytes.subarray(offset).every((byte) => byte === 0)) {
        throw new Error('Tar archive has non-zero data after its end marker');
      }
      break;
    }
    verifyTarChecksum(header);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const rawEntryPath = prefix === '' ? name : `${prefix}/${name}`;
    const entryPath = rawEntryPath.startsWith('./')
      ? rawEntryPath.slice(2)
      : rawEntryPath;
    const size = tarNumber(header, 124, 12);
    if (size > limits.max_file_bytes) {
      throw new Error(`Tar entry ${entryPath} exceeds the per-file limit`);
    }
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const normalizedEntryPath =
      typeFlag === '5' ? entryPath.replace(/\/+$/, '') : entryPath;
    const contentsStart = offset + 512;
    const contentsEnd = contentsStart + size;
    if (contentsEnd > tarBytes.byteLength) {
      throw new Error(`Truncated tar entry ${entryPath}`);
    }
    if (normalizedEntryPath === '' && typeFlag === '5') {
      offset = contentsStart + Math.ceil(size / 512) * 512;
      continue;
    }
    const base = { path: normalizedEntryPath };
    switch (typeFlag) {
      case '\0':
      case '0':
        entries.push({
          ...base,
          type: 'file',
          contents: tarBytes.slice(contentsStart, contentsEnd),
        });
        break;
      case '1':
        entries.push({
          ...base,
          type: 'hardlink',
          linkTarget: tarString(header, 157, 100),
        });
        break;
      case '2':
        entries.push({
          ...base,
          type: 'symlink',
          linkTarget: tarString(header, 157, 100),
        });
        break;
      case '5':
        entries.push({ ...base, type: 'directory' });
        break;
      default:
        throw new Error(
          `Unsupported tar entry type ${JSON.stringify(typeFlag)}`
        );
    }
    offset = contentsStart + Math.ceil(size / 512) * 512;
    if (entries.length > limits.max_files * 4) {
      throw new Error('Tar archive has too many entries');
    }
  }
  if (!reachedEnd) throw new Error('Tar archive has no valid end marker');
  return entries;
}

function readFrameContentSize(
  archive: Uint8Array,
  maximumOutputBytes: number
): number {
  const buffer = Buffer.from(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  );
  if (buffer.byteLength < 6 || buffer.readUInt32LE(0) !== 0xfd2fb528) {
    throw new Error('Artifact archive is not one standard zstd frame');
  }
  const descriptor = buffer[4] ?? 0;
  if ((descriptor & 0x18) !== 0) {
    throw new Error('Zstd frame uses reserved descriptor bits');
  }
  const contentSizeFlag = descriptor >>> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const hasChecksum = (descriptor & 0x04) !== 0;
  const dictionaryFlag = descriptor & 0x03;
  let offset = 5;
  if (!singleSegment) offset += 1;
  const dictionarySize = [0, 1, 2, 4][dictionaryFlag] ?? 0;
  offset += dictionarySize;
  const contentSizeLength =
    contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 2 ** contentSizeFlag;
  if (contentSizeLength === 0) {
    throw new Error(
      'Zstd frame must declare its content size before decompression'
    );
  }
  if (offset + contentSizeLength > buffer.byteLength) {
    throw new Error('Truncated zstd frame header');
  }
  let declaredSize: bigint;
  switch (contentSizeLength) {
    case 1:
      declaredSize = BigInt(buffer[offset] ?? 0);
      break;
    case 2:
      declaredSize = BigInt(buffer.readUInt16LE(offset) + 256);
      break;
    case 4:
      declaredSize = BigInt(buffer.readUInt32LE(offset));
      break;
    case 8:
      declaredSize = buffer.readBigUInt64LE(offset);
      break;
    default:
      throw new Error('Unsupported zstd content-size field');
  }
  if (
    declaredSize > BigInt(maximumOutputBytes) ||
    declaredSize > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error('Zstd frame declares output above the artifact limit');
  }
  offset += contentSizeLength;

  let lastBlock = false;
  while (!lastBlock) {
    if (offset + 3 > buffer.byteLength) {
      throw new Error('Truncated zstd block header');
    }
    const blockHeader =
      (buffer[offset] ?? 0) |
      ((buffer[offset + 1] ?? 0) << 8) |
      ((buffer[offset + 2] ?? 0) << 16);
    offset += 3;
    lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3)
      throw new Error('Zstd frame has a reserved block type');
    if (blockSize > 128 * 1024) {
      throw new Error('Zstd frame block exceeds the format limit');
    }
    const payloadSize = blockType === 1 ? 1 : blockSize;
    if (offset + payloadSize > buffer.byteLength) {
      throw new Error('Truncated zstd block payload');
    }
    offset += payloadSize;
  }
  if (hasChecksum) offset += 4;
  if (offset !== buffer.byteLength) {
    throw new Error(
      'Concatenated zstd frames and trailing data are not accepted'
    );
  }
  return Number(declaredSize);
}

export async function inspectTarZstdArchive(
  archive: Uint8Array,
  limits: E2BArtifactLimits
): Promise<readonly InspectedArchiveEntry[]> {
  const maximumTarBytes =
    limits.max_uncompressed_bytes + limits.max_files * 1024 + 1024;
  const declaredSize = readFrameContentSize(archive, maximumTarBytes);
  const { decompress: decompressZstd } = await import('@mongodb-js/zstd');
  const tarBytes = await decompressZstd(Buffer.from(archive));
  if (
    tarBytes.byteLength !== declaredSize ||
    tarBytes.byteLength > maximumTarBytes
  ) {
    throw new Error(
      'Decompressed archive size does not match its bounded zstd frame declaration'
    );
  }
  return parseTar(tarBytes, limits);
}

function exactNetworkMatch(
  actual: E2BNetworkPolicy,
  expected: E2BNetworkPolicy
): boolean {
  if (
    actual.inbound !== expected.inbound ||
    actual.outbound !== expected.outbound
  ) {
    return false;
  }
  if (actual.outbound === 'allowlist' && expected.outbound === 'allowlist') {
    const left = [...actual.allow].map((entry) => entry.toLowerCase()).sort();
    const right = [...expected.allow]
      .map((entry) => entry.toLowerCase())
      .sort();
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return true;
}

function ownershipNonceHash(
  owner: string,
  project: string,
  experimentId: string,
  cellId: string,
  attemptId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify({ owner, project, experimentId, cellId, attemptId }))
    .digest('hex');
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function phaseTimeout(
  provider: E2BProviderConfig,
  phase: E2BRunnerPhase
): number {
  return phase === 'post-evaluate'
    ? provider.deadlines.phases_ms.post_evaluate
    : provider.deadlines.phases_ms[phase];
}

function defaultPhaseComponent(phase: E2BRunnerPhase): string {
  switch (phase) {
    case 'prepare':
      return 'source';
    case 'agent':
      return 'agent';
    case 'evaluate':
      return 'evaluator';
    case 'post-evaluate':
      return 'post_evaluation';
    case 'package':
      return 'package';
  }
}

function buildCellManifest(
  cell: PlannedExperimentCell,
  context: SingleRunExecutionContext,
  template: E2BTemplateManifest,
  provider: E2BProviderConfig,
  network: E2BNetworkPolicy,
  policy: E2BExecutorCellPolicy
): E2BCellManifest {
  const { agent, ...task } = cell.config;
  const agentCapability = policy.requiredCapabilities.find(
    (capability) =>
      capability.component === 'agent' && capability.type === agent.type
  );
  if (agentCapability === undefined) {
    throw new Error(
      `Cell ${cell.cellId} lacks an agent capability for ${agent.type}`
    );
  }
  return e2bCellManifestSchema.parse({
    schema_version: '1.0.0',
    experiment_id: context.experimentId,
    cell_id: cell.cellId,
    attempt_id: context.attemptId,
    target: {
      id: cell.variantName,
      agent_type: agent.type,
      requested_model: agent.model,
      expected_harness_version: agentCapability.version,
      adapter_schema_version:
        policy.adapterSchemaVersion ?? agentCapability.adapter_schema_version,
      config: agent.config ?? {},
    },
    task,
    template: {
      template_id: template.template_id,
      build_id: template.build_id,
    },
    required_capabilities: policy.requiredCapabilities,
    network,
    deadlines: provider.deadlines,
    artifact_limits: provider.artifact_limits,
    secret_references: policy.secretReferences ?? [],
  });
}

function attemptArtifactsDirectory(
  root: string,
  cell: PlannedExperimentCell,
  context: SingleRunExecutionContext
): string {
  for (const [label, value] of [
    ['experiment', context.experimentId],
    ['attempt', context.attemptId],
  ] as const) {
    if (!IDENTIFIER.test(value)) {
      throw new Error(`Invalid ${label} identifier "${value}"`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(cell.cellId)) {
    throw new Error(`Invalid cell identifier "${cell.cellId}"`);
  }
  return path.join(
    path.resolve(root),
    context.experimentId,
    'cells',
    cell.cellId,
    `attempt-${context.attemptNumber}-${context.attemptId}`
  );
}

async function ensureSafeArtifactRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const filesystemRoot = path.parse(resolved).root;
  const relative = path.relative(filesystemRoot, resolved);
  let current = filesystemRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(
          `Configured E2B artifact path contains a symlink or non-directory: ${current}`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw mkdirError;
        }
      }
      const createdStats = await fs.lstat(current);
      if (createdStats.isSymbolicLink() || !createdStats.isDirectory()) {
        throw new Error(
          `Configured E2B artifact path is not a safe directory: ${current}`
        );
      }
    }
  }
  return resolved;
}

function combinedSignal(
  input: AbortSignal | undefined,
  watchdogMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const forwardAbort = (): void =>
    controller.abort(input?.reason ?? new Error('Experiment cancelled'));
  input?.addEventListener('abort', forwardAbort, { once: true });
  if (input?.aborted) forwardAbort();
  const timeout = setTimeout(
    () => controller.abort(new Error('E2B outer watchdog expired')),
    watchdogMs
  );
  timeout.unref();
  return {
    signal: controller.signal,
    dispose: (): void => {
      clearTimeout(timeout);
      input?.removeEventListener('abort', forwardAbort);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('E2B execution cancelled');
  }
}

function isProviderRateLimit(error: unknown): boolean {
  if (error instanceof Error && error.name === 'RateLimitError') return true;
  if (error === null || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return (
    record.status === 429 || record.statusCode === 429 || record.code === 429
  );
}

export class E2BSingleRunExecutor implements SingleRunExecutor {
  private readonly provider: E2BProviderConfig;
  private readonly now: () => Date;

  public constructor(private readonly options: E2BSingleRunExecutorOptions) {
    this.provider = e2bProviderConfigSchema.parse(options.provider);
    validateDeadlines(this.provider.deadlines);
    this.now = options.now ?? ((): Date => new Date());
  }

  public async reconcileInterrupted(
    context: InterruptedExecutionContext
  ): Promise<void> {
    if (context.signal?.aborted) {
      throw (
        context.signal.reason ??
        new Error('E2B interrupted-attempt reconciliation was cancelled')
      );
    }
    const candidates = await this.options.client.listSandboxes({
      owner: this.options.owner,
      project: this.options.project,
      experimentId: context.experimentId,
      attemptId: context.attemptId,
    });
    const owned = candidates.filter(
      (candidate) =>
        candidate.metadata.cellId === context.cellId &&
        candidate.metadata.targetId === context.targetId &&
        (context.sandboxId === undefined ||
          candidate.sandboxId === context.sandboxId)
    );
    if (owned.length !== candidates.length) {
      throw new Error(
        `Interrupted E2B attempt ${context.attemptId} has conflicting ownership metadata`
      );
    }
    if (owned.length > 1) {
      await Promise.allSettled(
        owned.map((sandbox) =>
          this.options.client.killSandbox(sandbox.sandboxId)
        )
      );
      throw new Error(
        `Interrupted E2B attempt ${context.attemptId} owned multiple sandboxes; all matches were killed`
      );
    }
    const sandbox = owned[0];
    if (sandbox !== undefined) {
      await this.options.client.killSandbox(sandbox.sandboxId);
    }
  }

  public async execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult> {
    const policy = this.options.resolveCellPolicy(cell);
    const network = resolveEffectiveNetworkPolicy(
      [this.provider.network, ...(policy.networkRequirements ?? [])],
      this.provider.strict_reproducibility
    );
    validateProviderSecurityCapabilities(
      network,
      this.options.client.capabilities
    );
    const startedAt = this.now();
    const retention =
      this.provider.retention.mode === 'pause-on-failure'
        ? {
            intendedExpiryAt: new Date(
              startedAt.getTime() + this.provider.retention.max_retention_ms
            ).toISOString(),
            retentionReason: this.provider.retention.reason,
          }
        : {};
    const metadata: E2BSandboxMetadata = {
      owner: this.options.owner,
      project: this.options.project,
      experimentId: context.experimentId,
      cellId: cell.cellId,
      attemptId: context.attemptId,
      targetId: cell.variantName,
      ownershipNonceHash: ownershipNonceHash(
        this.options.owner,
        this.options.project,
        context.experimentId,
        cell.cellId,
        context.attemptId
      ),
      ...retention,
    };
    const request: E2BCreateSandboxRequest = {
      templateId: this.provider.template.template_id,
      expectedBuildId: this.provider.template.build_id,
      snapshotId: policy.snapshotId,
      timeoutMs: this.provider.deadlines.sandbox_ttl_ms,
      secureAccess: true,
      network,
      metadata,
    };

    const watchdog = combinedSignal(
      context.signal,
      this.provider.deadlines.watchdog_ms
    );
    let sandbox: E2BSandboxHandle | undefined;
    let executionError: unknown;
    let succeeded = false;
    let sandboxStartedAt: Date | undefined;
    let returnedResult: SingleRunExecutionResult | undefined;
    let lifecycleProvenance:
      | {
          sdkVersion: string;
          secureAccess: boolean;
          resources: { cpu_count: number; memory_mb: number };
          networkPolicy: E2BNetworkPolicy;
          runnerProtocol: string;
          artifactProtocol: string;
          fixtureSnapshotId?: string;
        }
      | undefined;
    try {
      await context.reportLifecycle?.({
        executionProvider: 'e2b',
        lifecycleState: 'creating',
        templateId: request.templateId,
      });
      throwIfAborted(watchdog.signal);
      const reconciled = await reconcileOrCreateSandbox({
        client: this.options.client,
        request,
        creationLimiter: this.options.creationLimiter,
        signal: watchdog.signal,
      });
      sandbox = reconciled.sandbox;
      const info = await sandbox.getInfo();
      sandboxStartedAt =
        info.createdAt === undefined ? this.now() : new Date(info.createdAt);
      if (
        !info.secureAccess ||
        !exactNetworkMatch(info.network, network) ||
        info.resources.cpu_count !==
          this.provider.expected_resources.cpu_count ||
        info.resources.memory_mb !== this.provider.expected_resources.memory_mb
      ) {
        throw new Error(
          'Resolved sandbox security controls or resources do not match the requested policy'
        );
      }
      await context.reportLifecycle?.({
        executionProvider: 'e2b',
        lifecycleState: 'running',
        sandboxId: sandbox.sandboxId,
        templateId: info.templateId,
        templateBuildId: info.buildId,
        sdkVersion: this.options.client.sdkVersion,
        secureAccess: info.secureAccess,
        resources: info.resources,
        networkPolicy: info.network,
        fixtureSnapshotId: policy.snapshotId,
        sandboxStartedAt: sandboxStartedAt.toISOString(),
      });

      const templateValue = parseJson(
        await sandbox.readFile(
          TEMPLATE_MANIFEST_PATH,
          MAX_TEMPLATE_MANIFEST_BYTES
        ),
        'E2B template manifest'
      );
      const templateValidation = validateTemplateForCell(templateValue, {
        protocolVersion: '1.0.0',
        artifactProtocolVersion: '1.0.0',
        templateId: this.provider.template.template_id,
        expectedBuildId: this.provider.template.build_id,
        expectedResources: this.provider.expected_resources,
        requiredCapabilities: policy.requiredCapabilities,
        strictReproducibility: this.provider.strict_reproducibility,
      });
      for (const warning of templateValidation.warnings) {
        this.options.onWarning?.(warning);
      }
      if (
        !this.provider.runtime_package_installation &&
        templateValidation.manifest.runtime_package_installation
      ) {
        throw new Error(
          'Resolved template permits runtime package installation contrary to provider policy'
        );
      }
      lifecycleProvenance = {
        sdkVersion: this.options.client.sdkVersion,
        secureAccess: info.secureAccess,
        resources: info.resources,
        networkPolicy: info.network,
        runnerProtocol: templateValidation.manifest.protocol_version,
        artifactProtocol: templateValidation.manifest.artifact_protocol.version,
        ...(policy.snapshotId === undefined
          ? {}
          : { fixtureSnapshotId: policy.snapshotId }),
      };
      await context.reportLifecycle?.({
        executionProvider: 'e2b',
        lifecycleState: 'running',
        sandboxId: sandbox.sandboxId,
        templateId: templateValidation.manifest.template_id,
        templateBuildId: templateValidation.manifest.build_id,
        ...lifecycleProvenance,
      });
      const cellManifest = buildCellManifest(
        cell,
        context,
        templateValidation.manifest,
        this.provider,
        network,
        policy
      );
      await sandbox.writeFile(
        E2B_CELL_MANIFEST_PATH,
        Buffer.from(JSON.stringify(cellManifest))
      );

      for (const phase of E2B_RUNNER_PHASES) {
        throwIfAborted(watchdog.signal);
        const phaseCommand = runnerCommand(phase);
        const resolvedEnvironment =
          phase === 'package'
            ? resolvePhaseEnvironment(
                [],
                {
                  targetId: cell.variantName,
                  component: 'package',
                  phase: 'agent',
                  environment: this.options.environment,
                },
                this.options.basePhaseEnvironment
              )
            : resolvePhaseEnvironment(
                policy.secretReferences ?? [],
                {
                  targetId: cell.variantName,
                  component:
                    policy.phaseComponents?.[phase] ??
                    defaultPhaseComponent(phase),
                  phase,
                  environment: this.options.environment,
                },
                this.options.basePhaseEnvironment
              );
        const result = await sandbox.runCommand({
          ...phaseCommand,
          env: resolvedEnvironment.env,
          timeoutMs: phaseTimeout(this.provider, phase),
          signal: watchdog.signal,
        });
        if (result.processGroupId !== undefined) {
          if (await sandbox.isProcessGroupRunning(result.processGroupId)) {
            await sandbox.terminateProcessGroup(result.processGroupId);
            if (await sandbox.isProcessGroupRunning(result.processGroupId)) {
              throw new Error(
                `Residual process group remained after E2B phase ${phase}`
              );
            }
          }
        }
        if (result.exitCode !== 0) {
          const unavailable =
            this.options.isTargetUnavailable?.(
              phase,
              result.exitCode,
              result.stdout,
              result.stderr
            ) ??
            (phase === 'agent' &&
              /(authentication|unauthori[sz]ed|model\b.*\b(unavailable|not found|retired))/i.test(
                `${result.stdout}\n${result.stderr}`
              ));
          if (unavailable) {
            throw new TargetUnavailableError(
              cell.variantName,
              `Target ${cell.variantName} is unavailable or unauthenticated`
            );
          }
          throw new E2BPhaseExecutionError(phase, result.exitCode);
        }
      }

      await context.reportLifecycle?.({
        executionProvider: 'e2b',
        lifecycleState: 'collecting',
        sandboxId: sandbox.sandboxId,
        templateId: templateValidation.manifest.template_id,
        templateBuildId: templateValidation.manifest.build_id,
        ...lifecycleProvenance,
      });
      const artifactManifest = parseJson(
        await sandbox.readFile(
          E2B_OUTPUT_MANIFEST_PATH,
          MAX_ARTIFACT_MANIFEST_BYTES
        ),
        'E2B artifact manifest'
      );
      const archive = await sandbox.readFile(
        E2B_OUTPUT_ARCHIVE_PATH,
        this.provider.artifact_limits.max_compressed_bytes
      );
      const inspect = this.options.inspectArchive ?? inspectTarZstdArchive;
      const inspectedEntries = await inspect(
        archive,
        this.provider.artifact_limits
      );
      const artifactPackage = validateArtifactPackage(
        artifactManifest,
        archive,
        inspectedEntries,
        {
          ownership: {
            experimentId: context.experimentId,
            cellId: cell.cellId,
            attemptId: context.attemptId,
          },
          limits: this.provider.artifact_limits,
          expectedArtifactProtocolVersion:
            templateValidation.manifest.artifact_protocol.version,
        }
      );
      const safeArtifactsRoot = await ensureSafeArtifactRoot(
        this.options.artifactsDirectory
      );
      const attemptRoot = attemptArtifactsDirectory(
        safeArtifactsRoot,
        cell,
        context
      );
      const artifactDirectory = path.join(attemptRoot, 'artifacts');
      await writeValidatedArtifactPackage(artifactPackage, artifactDirectory);
      const remoteResult = resultsBundleSchema.parse(artifactPackage.result);
      const result = resultsBundleSchema.parse({
        ...remoteResult,
        execution: {
          ...remoteResult.execution,
          environment: {
            ...remoteResult.execution.environment,
            workspace_dir: attemptRoot,
          },
        },
      });
      const resultPath = path.join(
        artifactDirectory,
        ...artifactPackage.manifest.remote_result_path.split('/')
      );
      let tokenCount: number | undefined;
      let costUsd: number | undefined;
      let tokenQuality: 'measured' | 'estimated' | 'unavailable' =
        'unavailable';
      let costQuality: 'measured' | 'estimated' | 'unavailable' = 'unavailable';
      try {
        const logRelativePath = normalizeRemoteArtifactPath(
          result.artifacts.agent_log
        );
        const log = youBenchaLogSchema.parse(
          JSON.parse(
            await fs.readFile(
              path.join(artifactDirectory, ...logRelativePath.split('/')),
              'utf8'
            )
          ) as unknown
        );
        tokenCount = log.usage.total_tokens;
        costUsd = log.usage.cost_usd ?? log.usage.estimated_cost_usd;
        tokenQuality = log.usage.measurement_source ?? 'unavailable';
        costQuality = costUsd === undefined ? 'unavailable' : tokenQuality;
      } catch {
        // Usage is optional evidence. The validated result remains usable when
        // a harness does not emit a current youBencha log.
      }
      succeeded = true;
      returnedResult = {
        result,
        resultPath,
        tokenCount,
        costUsd,
        usageQuality: tokenQuality,
        tokenQuality,
        costQuality,
        sandboxCostQuality: 'unavailable',
      };
      return returnedResult;
    } catch (error) {
      executionError = error;
      if (isProviderRateLimit(error)) {
        throw new ExperimentExecutionError(
          'E2B sandbox creation was rate limited',
          'provider_rate_limit'
        );
      }
      throw error;
    } finally {
      watchdog.dispose();
      if (sandbox !== undefined) {
        const sandboxCompletedAt = this.now();
        const sandboxRuntimeMs =
          sandboxStartedAt === undefined
            ? undefined
            : Math.max(
                0,
                sandboxCompletedAt.getTime() - sandboxStartedAt.getTime()
              );
        if (returnedResult !== undefined) {
          returnedResult.sandboxRuntimeMs = sandboxRuntimeMs;
        }
        const retain =
          !succeeded &&
          !watchdog.signal.aborted &&
          this.provider.retention.mode === 'pause-on-failure';
        try {
          if (retain && this.provider.retention.mode === 'pause-on-failure') {
            await this.options.client.pauseSandbox(sandbox.sandboxId);
            await context.reportLifecycle?.({
              executionProvider: 'e2b',
              lifecycleState: 'paused',
              sandboxId: sandbox.sandboxId,
              retainedUntil: metadata.intendedExpiryAt,
              retentionReason: this.provider.retention.reason,
              ...(sandboxStartedAt === undefined
                ? {}
                : { sandboxStartedAt: sandboxStartedAt.toISOString() }),
              sandboxCompletedAt: sandboxCompletedAt.toISOString(),
              sandboxRuntimeMs,
              ...lifecycleProvenance,
            });
          } else {
            await context.reportLifecycle?.({
              executionProvider: 'e2b',
              lifecycleState: 'killing',
              sandboxId: sandbox.sandboxId,
              ...(sandboxStartedAt === undefined
                ? {}
                : { sandboxStartedAt: sandboxStartedAt.toISOString() }),
              ...lifecycleProvenance,
            });
            await this.options.client.killSandbox(sandbox.sandboxId);
            await context.reportLifecycle?.({
              executionProvider: 'e2b',
              lifecycleState: 'killed',
              sandboxId: sandbox.sandboxId,
              ...(sandboxStartedAt === undefined
                ? {}
                : { sandboxStartedAt: sandboxStartedAt.toISOString() }),
              sandboxCompletedAt: sandboxCompletedAt.toISOString(),
              sandboxRuntimeMs,
              ...lifecycleProvenance,
            });
          }
        } catch (cleanupError) {
          await context.reportLifecycle?.({
            executionProvider: 'e2b',
            lifecycleState: 'lost',
            sandboxId: sandbox.sandboxId,
            ...(sandboxStartedAt === undefined
              ? {}
              : { sandboxStartedAt: sandboxStartedAt.toISOString() }),
            sandboxCompletedAt: sandboxCompletedAt.toISOString(),
            sandboxRuntimeMs,
            ...lifecycleProvenance,
          });
          this.options.onWarning?.(
            `E2B sandbox ${sandbox.sandboxId} cleanup failed and requires reconciliation`
          );
          if (executionError === undefined) {
            this.options.onWarning?.(
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            );
          }
        }
      }
    }
  }
}
