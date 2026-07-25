import * as fs from 'fs/promises';
import * as path from 'path';
import type { Command } from 'commander';
import {
  aggregateExperimentCells,
  BaselineStore,
  compareExperimentAggregates,
  loadExperiment,
  normalizeExperimentProvenance,
  OrchestratorSingleRunExecutor,
  planExperiment,
  rulesFromExperimentPolicy,
  runExperiment,
  type SingleRunExecutor,
} from '../../experiments/index.js';
import {
  experimentDefinitionSchema,
  type ExperimentDefinition,
} from '../../schemas/experiment.schema.js';
import {
  experimentResultSchema,
  type ExperimentResult,
} from '../../schemas/experiment-result.schema.js';
import {
  resultsBundleSchema,
  type ResultsBundle,
} from '../../schemas/result.schema.js';
import { youBenchaLogSchema } from '../../schemas/youbenchalog.schema.js';
import {
  writeExperimentJson,
  writeExperimentJunit,
  writeExperimentMarkdown,
  writeExperimentReports,
} from '../../reporters/experiment.js';
import { CliExitCode } from '../../lib/exit-codes.js';

const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORMATS = ['markdown', 'json', 'junit'] as const;
type ExperimentFormat = (typeof FORMATS)[number];

interface ExperimentCommandDependencies {
  cwd?: string;
  executor?: SingleRunExecutor;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function roots(cwd: string): {
  experiments: string;
  baselines: string;
} {
  const results = path.join(cwd, 'results');
  return {
    experiments: path.join(results, 'experiments'),
    baselines: path.join(results, 'baselines'),
  };
}

function setFailure(error: unknown, write: (message: string) => void): void {
  write(error instanceof Error ? error.message : String(error));
  process.exitCode = CliExitCode.ExecutionError;
}

async function existingPath(
  value: string,
  cwd: string
): Promise<string | undefined> {
  const resolved = path.resolve(cwd, value);
  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    return undefined;
  }
}

async function resolveResultFile(
  value: string,
  experimentRoot: string,
  cwd: string
): Promise<string> {
  const explicit = await existingPath(value, cwd);
  if (explicit !== undefined) {
    const stats = await fs.stat(explicit);
    return stats.isDirectory() ? path.join(explicit, 'results.json') : explicit;
  }
  if (!EXPERIMENT_ID.test(value)) {
    throw new Error(
      `Experiment "${value}" was not found; provide an existing result file/directory or a valid experiment ID`
    );
  }
  const root = path.resolve(experimentRoot);
  const candidate = path.resolve(root, value, 'results.json');
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Experiment ID "${value}" escapes the results directory`);
  }
  try {
    await fs.access(candidate);
  } catch {
    throw new Error(
      `Experiment "${value}" has no results at ${candidate}; run or resume it first`
    );
  }
  return candidate;
}

async function readExperimentResult(file: string): Promise<ExperimentResult> {
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

function definitionFromResult(
  result: ExperimentResult
): ExperimentDefinition | undefined {
  const effective = result.effective_configuration;
  if (effective === null || typeof effective !== 'object') return undefined;
  const definition = (effective as Record<string, unknown>).definition;
  const parsed = experimentDefinitionSchema.safeParse(definition);
  return parsed.success ? parsed.data : undefined;
}

async function resultBundle(
  directory: string,
  relativePath: string
): Promise<ResultsBundle> {
  const root = path.resolve(directory);
  const file = path.resolve(root, relativePath);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Cell result path escapes experiment directory: ${relativePath}`
    );
  }
  return resultsBundleSchema.parse(
    JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  );
}

async function buildExperimentResult(
  loaded: Awaited<ReturnType<typeof loadExperiment>>,
  runtime: Awaited<ReturnType<typeof runExperiment>>,
  baselineStore: BaselineStore
): Promise<ExperimentResult> {
  const inputs = [];
  const plannedCells = new Map(
    planExperiment(loaded).cells.map((cell) => [cell.cellId, cell])
  );
  for (const cell of runtime.state.cells) {
    if (cell.result_path === undefined) continue;
    const result = await resultBundle(
      runtime.experimentDirectory,
      cell.result_path
    );
    const config = plannedCells.get(cell.cell_id);
    if (config === undefined) continue;
    const originalLog = path.join(
      result.execution.environment.workspace_dir,
      'artifacts',
      result.artifacts.agent_log
    );
    let log;
    try {
      log = youBenchaLogSchema.parse(
        JSON.parse(await fs.readFile(originalLog, 'utf8')) as unknown
      );
    } catch {
      log = undefined;
    }
    inputs.push({
      cellId: cell.cell_id,
      testcaseId: cell.testcase_id,
      configHash: config.configHash,
      config: config.config,
      result,
      log,
    });
  }
  const evaluatorCounts = new Map(
    inputs.map((input) => [
      input.cellId,
      {
        evaluator_passed: input.result.summary.passed,
        evaluator_failed: input.result.summary.failed,
      },
    ])
  );
  const aggregation = aggregateExperimentCells(
    runtime.state.cells.map((cell) => ({
      ...cell,
      ...evaluatorCounts.get(cell.cell_id),
    }))
  );
  const provenance = normalizeExperimentProvenance(inputs);
  const comparisons: ExperimentResult['comparisons'] = [];
  const comparisonWarnings: string[] = [];
  let baseline: ExperimentResult['baseline'];
  let comparisonStatus: 'passed' | 'failed' | 'partial' = 'passed';
  const policy = loaded.definition.regression;
  if (policy !== undefined) {
    const rules = rulesFromExperimentPolicy(policy);
    let baselineAggregates: ExperimentResult['aggregates'] = [];
    if (loaded.definition.baseline !== undefined) {
      try {
        const approved = await baselineStore.read(
          loaded.definition.baseline.name
        );
        baselineAggregates = approved.result.aggregates;
        baseline = {
          name: approved.manifest.name,
          content_hash: approved.manifest.content_hash,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        comparisonStatus = 'partial';
        comparisonWarnings.push(
          `Named baseline "${loaded.definition.baseline.name}" was not found`
        );
      }
    }
    for (const rule of rules) {
      const comparison = compareExperimentAggregates(
        aggregation.aggregates,
        rule.kind === 'minimum' && baselineAggregates.length === 0
          ? aggregation.aggregates
          : baselineAggregates,
        [rule]
      );
      comparisons.push(...comparison.findings);
      if (comparison.status === 'failed') comparisonStatus = 'failed';
      else if (
        comparison.status === 'partial' &&
        comparisonStatus === 'passed'
      ) {
        comparisonStatus = 'partial';
      }
    }
  }
  let finalStatus = runtime.finalStatus;
  let exitCode = runtime.exitCode;
  if (exitCode !== 1 && comparisonStatus === 'failed') {
    finalStatus = 'failed';
    exitCode = 2;
  } else if (exitCode === 0 && comparisonStatus === 'partial') {
    finalStatus = 'partial';
    exitCode = 3;
  }
  const completedAt = runtime.state.updated_at;
  return experimentResultSchema.parse({
    schema_version: '1.0.0',
    experiment_version: 1,
    experiment_id: runtime.experimentId,
    definition_hash: loaded.definitionHash,
    started_at: runtime.state.started_at ?? completedAt,
    completed_at: completedAt,
    final_status: finalStatus,
    exit_code: exitCode,
    effective_configuration: loaded.redactedEffectiveConfiguration,
    sources: provenance.sources,
    provenance: provenance.provenance,
    cells: runtime.state.cells,
    aggregates: aggregation.aggregates,
    ...(baseline === undefined ? {} : { baseline }),
    comparisons,
    artifacts: {
      json: 'results.json',
      markdown: 'report.md',
      junit: 'junit.xml',
    },
    warnings: [
      ...aggregation.warnings,
      ...provenance.warnings,
      ...comparisonWarnings,
    ],
  });
}

export async function experimentValidateCommand(
  file: string,
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  try {
    const loaded = await loadExperiment(file);
    const plan = planExperiment(loaded);
    write(
      `Valid experiment: ${loaded.definition.name} (${plan.cellCount} cells)`
    );
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export async function experimentPlanCommand(
  file: string,
  options: { json?: boolean },
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  try {
    const loaded = await loadExperiment(file);
    const plan = planExperiment(loaded);
    if (options.json) {
      write(
        `${JSON.stringify(
          {
            definitionHash: plan.definitionHash,
            cellCount: plan.cellCount,
            maxConcurrent: plan.maxConcurrent,
            budget: plan.budget,
            redactedEffectiveConfiguration: plan.redactedEffectiveConfiguration,
            cells: plan.cells.map((cell) => ({
              cellId: cell.cellId,
              testcaseId: cell.testcaseId,
              variantName: cell.variantName,
              repetition: cell.repetition,
              configHash: cell.configHash,
            })),
          },
          null,
          2
        )}`
      );
      return;
    }
    write(`Experiment: ${loaded.definition.name}`);
    write(`Cells: ${plan.cellCount}`);
    write(`Concurrency: ${plan.maxConcurrent}`);
    write(`Budget: ${JSON.stringify(plan.budget ?? {})}`);
    for (const cell of plan.cells) {
      write(
        `${cell.testcaseId} / ${cell.variantName} / repetition ${cell.repetition + 1} / ${cell.cellId}`
      );
    }
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export async function experimentRunCommand(
  file: string,
  options: { resume?: string },
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const write = dependencies.stdout ?? console.log;
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const locations = roots(cwd);
  try {
    const loaded = await loadExperiment(file);
    const plan = planExperiment(loaded);
    const executor =
      dependencies.executor ??
      new OrchestratorSingleRunExecutor({
        configFiles: new Map(
          loaded.testcases.map((testcase) => [
            testcase.id,
            testcase.resolvedFile,
          ])
        ),
      });
    const runtime = await runExperiment({
      plan,
      executor,
      retry: loaded.definition.execution.retry,
      resultsDirectory: locations.experiments,
      ...(options.resume === undefined
        ? {}
        : { experimentId: options.resume, resume: true }),
    });
    const result = await buildExperimentResult(
      loaded,
      runtime,
      new BaselineStore(locations.baselines)
    );
    const artifacts = await writeExperimentReports(
      result,
      runtime.experimentDirectory
    );
    write(`Experiment ${runtime.experimentId}: ${result.final_status}`);
    write(`Exit code: ${result.exit_code}`);
    write(`Results: ${artifacts.json}`);
    write(`Markdown: ${artifacts.markdown}`);
    write(`JUnit: ${artifacts.junit}`);
    process.exitCode = result.exit_code;
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export async function experimentCompareCommand(
  candidateValue: string,
  options: { baseline: string },
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const locations = roots(cwd);
  const write = dependencies.stdout ?? console.log;
  try {
    const candidate = await readExperimentResult(
      await resolveResultFile(candidateValue, locations.experiments, cwd)
    );
    const baselinePath = await existingPath(options.baseline, cwd);
    let baselineResult: ExperimentResult;
    let baselineName = options.baseline;
    if (baselinePath !== undefined) {
      baselineResult = await readExperimentResult(
        (await fs.stat(baselinePath)).isDirectory()
          ? path.join(baselinePath, 'results.json')
          : baselinePath
      );
      baselineName = path.basename(baselinePath);
    } else {
      const approved = await new BaselineStore(locations.baselines).read(
        options.baseline
      );
      baselineResult = approved.result;
    }
    const policy = definitionFromResult(candidate)?.regression;
    if (policy === undefined) {
      throw new Error(
        'Candidate result does not contain a configured regression policy'
      );
    }
    const comparison = compareExperimentAggregates(
      candidate.aggregates,
      baselineResult.aggregates,
      rulesFromExperimentPolicy(policy)
    );
    write(`Comparison with ${baselineName}: ${comparison.status}`);
    comparison.findings.forEach((finding) => write(finding.message));
    process.exitCode =
      comparison.status === 'failed'
        ? CliExitCode.EvaluationFailed
        : comparison.status === 'partial'
          ? CliExitCode.EvaluationPartial
          : CliExitCode.Success;
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export async function experimentApproveCommand(
  value: string,
  options: { name: string },
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const locations = roots(cwd);
  const write = dependencies.stdout ?? console.log;
  try {
    const result = await readExperimentResult(
      await resolveResultFile(value, locations.experiments, cwd)
    );
    const manifest = await new BaselineStore(locations.baselines).approve(
      options.name,
      result
    );
    write(`Approved baseline ${manifest.name}: ${manifest.content_hash}`);
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export async function experimentReportCommand(
  value: string,
  options: { format: string },
  dependencies: ExperimentCommandDependencies = {}
): Promise<void> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const locations = roots(cwd);
  const write = dependencies.stdout ?? console.log;
  try {
    if (!FORMATS.includes(options.format as ExperimentFormat)) {
      throw new Error(
        `Unsupported experiment report format "${options.format}"; use markdown, json, or junit`
      );
    }
    const file = await resolveResultFile(value, locations.experiments, cwd);
    const result = await readExperimentResult(file);
    const format = options.format as ExperimentFormat;
    const directory = path.dirname(file);
    const output =
      format === 'json'
        ? path.join(directory, 'results.json')
        : format === 'junit'
          ? path.join(directory, 'junit.xml')
          : path.join(directory, 'report.md');
    if (format === 'json') {
      await writeExperimentJson(result, output);
    } else if (format === 'junit') {
      await writeExperimentJunit(result, output);
    } else {
      await writeExperimentMarkdown(result, output, {
        reportDirectory: directory,
      });
    }
    write(`Report: ${output}`);
  } catch (error) {
    setFailure(error, dependencies.stderr ?? console.error);
  }
}

export function registerExperimentCommand(program: Command): void {
  const experiment = program
    .command('experiment')
    .description('Plan, run, compare, and report repeatable experiments');
  experiment
    .command('validate')
    .argument('<file>', 'Experiment YAML or JSON file')
    .description('Validate an experiment without executing it')
    .action(experimentValidateCommand);
  experiment
    .command('plan')
    .argument('<file>', 'Experiment YAML or JSON file')
    .option('--json', 'Print the expanded plan as JSON')
    .description('Expand an experiment without executing it')
    .action(experimentPlanCommand);
  experiment
    .command('run')
    .argument('<file>', 'Experiment YAML or JSON file')
    .option('--resume <id>', 'Resume an existing experiment ID')
    .description('Run or resume an experiment')
    .action(experimentRunCommand);
  experiment
    .command('compare')
    .argument(
      '<candidate>',
      'Candidate experiment ID, directory, or result file'
    )
    .requiredOption(
      '--baseline <name-or-path>',
      'Named baseline or result path'
    )
    .description('Compare an experiment with a baseline')
    .action(experimentCompareCommand);
  experiment
    .command('approve')
    .argument(
      '<experiment-id-or-path>',
      'Experiment ID, directory, or result file'
    )
    .requiredOption('--name <name>', 'Immutable baseline name')
    .description('Approve an experiment as a named baseline')
    .action(experimentApproveCommand);
  experiment
    .command('report')
    .argument(
      '<experiment-id-or-path>',
      'Experiment ID, directory, or result file'
    )
    .option('--format <format>', 'markdown, json, or junit', 'markdown')
    .description('Render an experiment report')
    .action(experimentReportCommand);
}
