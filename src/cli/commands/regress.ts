import * as path from 'path';
import type { Command } from 'commander';
import {
  OrchestratorSingleRunExecutor,
  TargetCircuitBreakerExecutor,
  runExperiment,
  type SingleRunExecutor,
} from '../../experiments/index.js';
import {
  buildRegressionResult,
  createRegressionE2BExecutor,
  loadRegressionSuite,
  planRegressionSuite,
  validateRegressionE2BPlan,
  type LoadedRegressionSuite,
  type RegressionPlan,
} from '../../regression/index.js';
import { writeExperimentReports } from '../../reporters/experiment.js';
import { CliExitCode } from '../../lib/exit-codes.js';

export interface RegressCommandOptions {
  profile?: string;
  target?: string[];
  case?: string[];
  against?: string;
  repetitions?: string | number;
  provider?: 'host-trusted' | 'e2b';
  resume?: string;
  plan?: boolean;
}

interface RegressCommandDependencies {
  cwd?: string;
  executor?: SingleRunExecutor;
  createE2BExecutor?: (
    suite: LoadedRegressionSuite,
    plan: RegressionPlan
  ) => SingleRunExecutor;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function fail(error: unknown, write: (message: string) => void): void {
  write(error instanceof Error ? error.message : String(error));
  process.exitCode = CliExitCode.ExecutionError;
}

function repetitions(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--repetitions must be a positive integer');
  }
  return parsed;
}

function append(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function hostExecutor(suite: LoadedRegressionSuite): SingleRunExecutor {
  return new OrchestratorSingleRunExecutor({
    configFiles: new Map(
      suite.tasks.map((task) => [task.id, task.resolvedFile])
    ),
  });
}

export async function regressCommand(
  file: string,
  options: RegressCommandOptions,
  dependencies: RegressCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const write = dependencies.stdout ?? console.log;
  try {
    if (
      options.provider !== undefined &&
      options.provider !== 'host-trusted' &&
      options.provider !== 'e2b'
    ) {
      throw new Error('--provider must be host-trusted or e2b');
    }
    const suite = await loadRegressionSuite(path.resolve(cwd, file));
    const repetitionOverride = repetitions(options.repetitions);
    const caseIds =
      options.case !== undefined && options.case.length > 0
        ? options.case
        : undefined;
    const targetIds =
      options.target !== undefined && options.target.length > 0
        ? options.target
        : undefined;
    const plan = planRegressionSuite(suite, {
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      ...(caseIds === undefined ? {} : { caseIds }),
      ...(targetIds === undefined ? {} : { targetIds }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(repetitionOverride === undefined
        ? {}
        : { repetitions: repetitionOverride }),
    });
    const e2bPlan = validateRegressionE2BPlan(suite, plan);
    if (options.plan) {
      write(
        JSON.stringify(
          {
            suite: suite.definition.name,
            definitionHash: plan.definitionHash,
            selection: plan.selection,
            cellCount: plan.cellCount,
            maxConcurrent: plan.maxConcurrent,
            ...(e2bPlan.length === 0 ? {} : { e2b: e2bPlan }),
            cells: plan.cells.map((cell) => ({
              cellId: cell.cellId,
              caseId: cell.testcaseId,
              targetId: cell.variantName,
              repetition: cell.repetition,
              configHash: cell.configHash,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    let executor = dependencies.executor;
    if (executor === undefined) {
      if (plan.selection.provider === 'e2b') {
        if (suite.definition.execution.provider.type !== 'e2b') {
          throw new Error(
            'The suite does not define E2B provider policy; --provider e2b cannot invent remote security settings'
          );
        }
        if (dependencies.createE2BExecutor === undefined) {
          executor = createRegressionE2BExecutor(suite, plan, {
            cwd,
            onWarning: (message) =>
              (dependencies.stderr ?? console.error)(message),
          });
        } else {
          executor = dependencies.createE2BExecutor(suite, plan);
        }
      } else {
        executor = hostExecutor(suite);
      }
    }
    executor = new TargetCircuitBreakerExecutor(executor);
    const retry = suite.definition.execution.retry;
    const runtime = await runExperiment({
      plan,
      executor,
      retry: {
        max_attempts: retry.max_attempts,
        on: retry.on,
        backoff_ms: retry.backoff_ms,
        jitter: retry.jitter,
      },
      resultsDirectory: path.join(cwd, 'results', 'experiments'),
      ...(options.resume === undefined
        ? {}
        : { experimentId: options.resume, resume: true }),
    });
    const result = await buildRegressionResult({
      suite,
      plan,
      runtime,
      baselineRoot: path.join(cwd, 'results', 'baselines'),
      baselineTrustedParent: cwd,
      ...(options.against === undefined ? {} : { against: options.against }),
    });
    const reports = await writeExperimentReports(
      result,
      runtime.experimentDirectory
    );
    write(`Regression ${runtime.experimentId}: ${result.final_status}`);
    write(`Exit code: ${result.exit_code}`);
    write(`Results: ${reports.json}`);
    write(`Markdown: ${reports.markdown}`);
    write(`JUnit: ${reports.junit}`);
    process.exitCode = result.exit_code;
  } catch (error) {
    fail(error, dependencies.stderr ?? console.error);
  }
}

export function registerRegressCommand(program: Command): void {
  program
    .command('regress')
    .argument('<suite-file>', 'Version 2 regression suite YAML or JSON')
    .option('--profile <name>', 'Named suite profile')
    .option('--target <target-id>', 'Target to run (repeatable)', append, [])
    .option('--case <testcase-id>', 'Case to run (repeatable)', append, [])
    .option('--against <channel-or-path>', 'Override persisted baseline')
    .option('--repetitions <count>', 'Override repetition count')
    .option('--provider <name>', 'host-trusted or e2b')
    .option('--resume <experiment-id>', 'Resume an identical effective plan')
    .option('--plan', 'Print the selected plan without executing')
    .description('Run a target-neutral regression suite')
    .action(regressCommand);
}
