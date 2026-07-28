import * as fs from 'fs/promises';
import * as path from 'path';
import type { Command } from 'commander';
import {
  experimentResultSchema,
  type ExperimentResult,
} from '../../schemas/experiment-result.schema.js';
import {
  BaselineChannelStore,
  BaselineSnapshotStore,
} from '../../baselines/index.js';
import { CliExitCode } from '../../lib/exit-codes.js';

const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface BaselineCommandDependencies {
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  now?: () => Date;
}

function fail(error: unknown, write: (message: string) => void): void {
  write(error instanceof Error ? error.message : String(error));
  process.exitCode = CliExitCode.ExecutionError;
}

function baselineRoot(cwd: string): string {
  return path.join(cwd, 'results', 'baselines');
}

async function resolveResultFile(value: string, cwd: string): Promise<string> {
  const explicit = path.resolve(cwd, value);
  try {
    const stats = await fs.stat(explicit);
    return stats.isDirectory() ? path.join(explicit, 'results.json') : explicit;
  } catch {
    if (!EXPERIMENT_ID.test(value)) {
      throw new Error(
        `Experiment "${value}" was not found; provide an experiment ID, directory, or result file`
      );
    }
  }
  const experiments = path.resolve(cwd, 'results', 'experiments');
  const result = path.resolve(experiments, value, 'results.json');
  if (!result.startsWith(`${experiments}${path.sep}`)) {
    throw new Error(`Experiment ID "${value}" escapes the results directory`);
  }
  return result;
}

async function readResult(
  value: string,
  cwd: string
): Promise<ExperimentResult> {
  const file = await resolveResultFile(value, cwd);
  try {
    return experimentResultSchema.parse(
      JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    );
  } catch (error) {
    throw new Error(
      `Cannot read experiment result ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function baselinePromoteCommand(
  value: string,
  options: {
    channel: string;
    target: string;
    expect?: string;
    actor?: string;
    context?: string;
  },
  dependencies: BaselineCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const write = dependencies.stdout ?? console.log;
  try {
    const root = baselineRoot(cwd);
    const snapshotStore = new BaselineSnapshotStore(root, {
      trustedParentDirectory: cwd,
    });
    const channels = new BaselineChannelStore(root, {
      trustedParentDirectory: cwd,
      snapshotStore,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    });
    const result = await readResult(value, cwd);
    if (
      !result.aggregates.some(
        (aggregate) =>
          aggregate.variant_name === options.target &&
          (aggregate.scope === 'variant' ||
            aggregate.scope === 'testcase_variant')
      )
    ) {
      throw new Error(
        `Experiment ${result.experiment_id} has no aggregates for target "${options.target}"`
      );
    }
    const current = await channels.read(options.channel);
    const snapshot = await snapshotStore.write(result);
    const promoted = await channels.promote({
      channel: options.channel,
      snapshotDigest: snapshot.digest,
      defaultTarget: options.target,
      sourceExperiment: result.experiment_id,
      targetMapping: {
        candidateTarget: options.target,
        ...(current === undefined
          ? {}
          : { baselineTarget: current.channel.default_target }),
      },
      ...(options.expect === undefined
        ? {}
        : { expectedDigest: options.expect }),
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.context === undefined ? {} : { context: options.context }),
    });
    write(
      `Promoted ${options.target} to baseline channel ${options.channel}: ${promoted.channel.snapshot_digest} (generation ${promoted.channel.generation})`
    );
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export async function baselineShowCommand(
  reference: string,
  options: { json?: boolean },
  dependencies: BaselineCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const write = dependencies.stdout ?? console.log;
  try {
    const store = new BaselineChannelStore(baselineRoot(cwd), {
      trustedParentDirectory: cwd,
    });
    const resolved = await store.resolve(reference);
    const summary = {
      reference,
      digest: resolved.snapshot.digest,
      experimentId: resolved.snapshot.result.experiment_id,
      target: resolved.channel?.default_target,
      channel: resolved.channel?.name,
      generation: resolved.channel?.generation,
      updatedAt: resolved.channel?.updated_at,
    };
    if (options.json) {
      write(JSON.stringify(summary, null, 2));
      return;
    }
    write(
      `${summary.channel === undefined ? 'Baseline snapshot' : `Baseline channel ${summary.channel}`}: ${summary.digest}`
    );
    write(`Experiment: ${summary.experimentId}`);
    if (summary.target !== undefined) write(`Target: ${summary.target}`);
    if (summary.generation !== undefined)
      write(`Generation: ${summary.generation}`);
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export function registerBaselineCommand(program: Command): void {
  const baseline = program
    .command('baseline')
    .description('Inspect and promote audited regression baselines');
  baseline
    .command('promote')
    .argument('<experiment-id-or-path>', 'Experiment ID, directory, or result')
    .requiredOption('--channel <name>', 'Mutable baseline channel')
    .requiredOption('--target <target-id>', 'Candidate target to promote')
    .option('--expect <digest>', 'Required current channel digest (CAS)')
    .option('--actor <name>', 'Promotion actor for the audit record')
    .option('--context <text>', 'Promotion context for the audit record')
    .description('Create an immutable snapshot and advance a channel')
    .action(baselinePromoteCommand);
  baseline
    .command('show')
    .argument('<channel-or-digest>', 'Baseline channel or snapshot digest')
    .option('--json', 'Print machine-readable JSON')
    .description('Show a baseline channel or immutable snapshot')
    .action(baselineShowCommand);
}
