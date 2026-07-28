import * as path from 'path';
import type { Command } from 'commander';
import {
  E2BSandboxService,
  E2BSdkClient,
  type E2BSandboxInfo,
} from '../../e2b/index.js';
import { CliExitCode } from '../../lib/exit-codes.js';

interface ManagedSandboxService {
  list(experimentId?: string): Promise<E2BSandboxInfo[]>;
  reap(experimentId?: string, now?: Date): Promise<E2BSandboxInfo[]>;
  kill(sandboxId: string): Promise<void>;
}

interface SandboxCommandDependencies {
  cwd?: string;
  service?: ManagedSandboxService;
  environment?: NodeJS.ProcessEnv;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  now?: () => Date;
}

function identifier(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 128);
  return normalized === '' ? fallback : normalized;
}

function service(
  dependencies: SandboxCommandDependencies
): ManagedSandboxService {
  if (dependencies.service !== undefined) return dependencies.service;
  const environment = dependencies.environment ?? process.env;
  if (!environment.E2B_API_KEY) {
    throw new Error(
      'E2B_API_KEY is required in the local control-plane environment'
    );
  }
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  return new E2BSandboxService(
    new E2BSdkClient({ apiKey: environment.E2B_API_KEY }),
    {
      owner: identifier(
        environment.YOUBENCHA_E2B_OWNER ?? 'youbencha',
        'youbencha'
      ),
      project: identifier(
        environment.YOUBENCHA_E2B_PROJECT ?? path.basename(cwd),
        'project'
      ),
    }
  );
}

function fail(error: unknown, write: (message: string) => void): void {
  write(error instanceof Error ? error.message : String(error));
  process.exitCode = CliExitCode.ExecutionError;
}

export async function sandboxListCommand(
  options: { experiment?: string; json?: boolean },
  dependencies: SandboxCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  try {
    const sandboxes = await service(dependencies).list(options.experiment);
    if (options.json) {
      write(JSON.stringify(sandboxes, null, 2));
      return;
    }
    if (sandboxes.length === 0) {
      write('No managed E2B sandboxes found');
      return;
    }
    for (const sandbox of sandboxes) {
      write(
        [
          sandbox.sandboxId,
          sandbox.lifecycle,
          sandbox.metadata.experimentId,
          sandbox.metadata.targetId,
          sandbox.metadata.intendedExpiryAt ?? '-',
        ].join('\t')
      );
    }
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export async function sandboxReapCommand(
  options: { experiment?: string },
  dependencies: SandboxCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  try {
    const reaped = await service(dependencies).reap(
      options.experiment,
      dependencies.now?.()
    );
    write(`Reaped ${reaped.length} expired managed E2B sandbox(es)`);
    for (const sandbox of reaped) write(sandbox.sandboxId);
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export async function sandboxKillCommand(
  sandboxId: string,
  dependencies: SandboxCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  try {
    await service(dependencies).kill(sandboxId);
    write(`Killed managed E2B sandbox ${sandboxId}`);
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export function registerSandboxCommand(program: Command): void {
  const sandbox = program
    .command('sandbox')
    .description('Inspect and clean up youBencha-owned E2B sandboxes');
  sandbox
    .command('list')
    .option('--experiment <id>', 'Filter by experiment ID')
    .option('--json', 'Print machine-readable JSON')
    .description('List running or paused managed sandboxes')
    .action(sandboxListCommand);
  sandbox
    .command('reap')
    .option('--experiment <id>', 'Filter by experiment ID')
    .description('Kill expired retained sandboxes')
    .action(sandboxReapCommand);
  sandbox
    .command('kill')
    .argument('<sandbox-id>', 'Managed E2B sandbox ID')
    .description('Kill one sandbox after verifying ownership metadata')
    .action(sandboxKillCommand);
}
