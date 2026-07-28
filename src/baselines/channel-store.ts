import { readFile, readdir } from 'fs/promises';
import * as path from 'path';
import {
  baselineChannelAuditSchema,
  type BaselineChannelAudit,
  type BaselineTargetMapping,
} from '../schemas/baseline-channel.schema.js';
import { canonicalJson, stableHash } from '../experiments/identity.js';
import {
  assertLinkSafePath,
  ensureLinkSafeDirectory,
} from '../experiments/artifact-security.js';
import {
  BaselineSnapshotStore,
  type BaselineSnapshot,
} from './snapshot-store.js';
import {
  SHA256,
  validateStoreName,
  writeExclusiveAtomic,
} from './storage-utils.js';

const GENERATION_FILE = /^(\d{12})\.json$/;

export interface PromoteBaselineChannelInput {
  channel: string;
  snapshotDigest: string;
  defaultTarget: string;
  sourceExperiment: string;
  targetMapping: {
    candidateTarget: string;
    baselineTarget?: string;
  };
  expectedDigest?: string | null;
  actor?: string;
  context?: string;
}

export interface BaselineChannel {
  name: string;
  snapshot_digest: string;
  default_target: string;
  generation: number;
  updated_at: string;
  source_experiment: string;
  audit_hash: string;
}

export interface BaselineChannelHistory {
  channel: BaselineChannel;
  audit: BaselineChannelAudit[];
}

export interface ResolvedBaseline {
  snapshot: BaselineSnapshot;
  channel?: BaselineChannel;
}

export interface BaselineChannelStoreOptions {
  now?: () => Date;
  trustedParentDirectory?: string;
  snapshotStore?: BaselineSnapshotStore;
}

function nonEmpty(label: string, value: string): void {
  if (value.trim() === '') throw new Error(`${label} must not be empty`);
}

function auditUnsigned(
  audit: BaselineChannelAudit
): Omit<BaselineChannelAudit, 'audit_hash'> {
  const unsigned: Partial<BaselineChannelAudit> = { ...audit };
  delete unsigned.audit_hash;
  return unsigned as Omit<BaselineChannelAudit, 'audit_hash'>;
}

function toChannel(audit: BaselineChannelAudit): BaselineChannel {
  return {
    name: audit.channel,
    snapshot_digest: audit.new_digest,
    default_target: audit.new_target,
    generation: audit.generation,
    updated_at: audit.timestamp,
    source_experiment: audit.source_experiment,
    audit_hash: audit.audit_hash,
  };
}

/**
 * A channel is a sequence of exclusively-created generation records. The next
 * generation filename is the compare-and-swap primitive, while each record
 * also forms a hash chain for accidental-corruption detection.
 */
export class BaselineChannelStore {
  private readonly now: () => Date;
  private readonly root: string;
  private readonly trustedParent: string;
  private readonly snapshots: BaselineSnapshotStore;

  constructor(
    rootDirectory: string,
    options: BaselineChannelStoreOptions = {}
  ) {
    this.now = options.now ?? ((): Date => new Date());
    this.root = path.resolve(rootDirectory);
    this.trustedParent = path.resolve(
      options.trustedParentDirectory ?? path.parse(this.root).root
    );
    const relative = path.relative(this.trustedParent, this.root);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Baseline storage root escapes its trusted parent: ${this.root}`
      );
    }
    this.snapshots =
      options.snapshotStore ??
      new BaselineSnapshotStore(this.root, {
        trustedParentDirectory: this.trustedParent,
      });
  }

  async promote(
    input: PromoteBaselineChannelInput
  ): Promise<BaselineChannelHistory> {
    validateStoreName('baseline channel', input.channel);
    if (!SHA256.test(input.snapshotDigest)) {
      throw new Error(
        `Invalid baseline snapshot digest "${input.snapshotDigest}"`
      );
    }
    nonEmpty('Default target', input.defaultTarget);
    nonEmpty('Source experiment', input.sourceExperiment);
    nonEmpty('Candidate target', input.targetMapping.candidateTarget);
    if (input.targetMapping.baselineTarget !== undefined) {
      nonEmpty('Baseline target', input.targetMapping.baselineTarget);
    }
    if (
      input.expectedDigest !== undefined &&
      input.expectedDigest !== null &&
      !SHA256.test(input.expectedDigest)
    ) {
      throw new Error(
        `Invalid expected baseline digest "${input.expectedDigest}"`
      );
    }

    await this.snapshots.read(input.snapshotDigest);
    await ensureLinkSafeDirectory(this.trustedParent, this.root);
    const channelsDirectory = path.join(this.root, 'channels');
    const channelDirectory = path.join(channelsDirectory, input.channel);
    await ensureLinkSafeDirectory(this.trustedParent, channelsDirectory);
    await ensureLinkSafeDirectory(this.trustedParent, channelDirectory);

    const current = await this.read(input.channel);
    const actualDigest = current?.channel.snapshot_digest;
    if (
      input.expectedDigest !== undefined &&
      (input.expectedDigest ?? undefined) !== actualDigest
    ) {
      throw new Error(
        `Baseline channel "${input.channel}" compare-and-swap failed: expected ${input.expectedDigest ?? 'no current digest'}, found ${actualDigest ?? 'no current digest'}`
      );
    }

    const previous = current?.audit.at(-1);
    const generation = (previous?.generation ?? 0) + 1;
    const mapping: BaselineTargetMapping = {
      candidate_target: input.targetMapping.candidateTarget,
      ...(input.targetMapping.baselineTarget === undefined
        ? {}
        : { baseline_target: input.targetMapping.baselineTarget }),
    };
    const unsigned = {
      schema_version: '1.0.0',
      channel: input.channel,
      generation,
      ...(previous === undefined
        ? {}
        : {
            old_digest: previous.new_digest,
            old_target: previous.new_target,
            previous_audit_hash: previous.audit_hash,
          }),
      new_digest: input.snapshotDigest,
      new_target: input.defaultTarget,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.context === undefined ? {} : { context: input.context }),
      timestamp: this.now().toISOString(),
      source_experiment: input.sourceExperiment,
      target_mapping: mapping,
    } as const;
    const audit = baselineChannelAuditSchema.parse({
      ...unsigned,
      audit_hash: stableHash(unsigned),
    });
    const generationPath = path.join(
      channelDirectory,
      `${String(generation).padStart(12, '0')}.json`
    );
    await assertLinkSafePath(this.trustedParent, generationPath);
    if (
      !(await writeExclusiveAtomic(generationPath, `${canonicalJson(audit)}\n`))
    ) {
      const raced = await this.read(input.channel);
      const winner = raced?.audit.find(
        (entry) => entry.generation === generation
      );
      if (
        winner !== undefined &&
        canonicalJson(winner) === canonicalJson(audit)
      ) {
        return raced as BaselineChannelHistory;
      }
      throw new Error(
        `Baseline channel "${input.channel}" compare-and-swap failed: generation ${generation} was advanced concurrently`
      );
    }
    return {
      channel: toChannel(audit),
      audit: [...(current?.audit ?? []), audit],
    };
  }

  async read(name: string): Promise<BaselineChannelHistory | undefined> {
    validateStoreName('baseline channel', name);
    const channelDirectory = path.join(this.root, 'channels', name);
    await assertLinkSafePath(this.trustedParent, channelDirectory);
    let entries: string[];
    try {
      entries = await readdir(channelDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }

    const generationEntries = entries
      .map((entry) => ({ entry, match: GENERATION_FILE.exec(entry) }))
      .filter(
        (value): value is { entry: string; match: RegExpExecArray } =>
          value.match !== null
      )
      .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
    if (generationEntries.length === 0) return undefined;

    const audit: BaselineChannelAudit[] = [];
    for (const [index, { entry }] of generationEntries.entries()) {
      const recordPath = path.join(channelDirectory, entry);
      await assertLinkSafePath(this.trustedParent, recordPath);
      const parsed = baselineChannelAuditSchema.parse(
        JSON.parse(await readFile(recordPath, 'utf8'))
      );
      const expectedGeneration = index + 1;
      if (
        parsed.channel !== name ||
        parsed.generation !== expectedGeneration ||
        stableHash(auditUnsigned(parsed)) !== parsed.audit_hash ||
        (index > 0 &&
          parsed.previous_audit_hash !== audit[index - 1].audit_hash) ||
        (index > 0 && parsed.old_digest !== audit[index - 1].new_digest) ||
        (index > 0 && parsed.old_target !== audit[index - 1].new_target)
      ) {
        throw new Error(
          `Baseline channel "${name}" audit chain is invalid or tampered at generation ${parsed.generation}`
        );
      }
      audit.push(parsed);
    }
    const latest = audit[audit.length - 1];
    return { channel: toChannel(latest), audit };
  }

  async resolve(reference: string): Promise<ResolvedBaseline> {
    if (SHA256.test(reference)) {
      return { snapshot: await this.snapshots.read(reference) };
    }
    const history = await this.read(reference);
    if (history === undefined) {
      throw new Error(`Baseline channel "${reference}" does not exist`);
    }
    return {
      channel: history.channel,
      snapshot: await this.snapshots.read(history.channel.snapshot_digest),
    };
  }
}
