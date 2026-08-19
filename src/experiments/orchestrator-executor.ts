import * as fs from 'fs/promises';
import * as path from 'path';
import { Orchestrator } from '../core/orchestrator.js';
import { youBenchaLogSchema } from '../schemas/youbenchalog.schema.js';
import type {
  PlannedExperimentCell,
  SingleRunExecutionContext,
  SingleRunExecutionResult,
  SingleRunExecutor,
} from './single-run-executor.js';

export interface OrchestratorSingleRunExecutorOptions {
  configFiles: ReadonlyMap<string, string>;
  orchestrator?: Pick<Orchestrator, 'runEvaluation'>;
}

/**
 * Production experiment adapter for the existing one-test-case orchestrator.
 * Scheduling and retry policy deliberately remain in the experiment layer.
 */
export class OrchestratorSingleRunExecutor implements SingleRunExecutor {
  private readonly orchestrator: Pick<Orchestrator, 'runEvaluation'>;

  public constructor(
    private readonly options: OrchestratorSingleRunExecutorOptions
  ) {
    this.orchestrator =
      options.orchestrator ?? new Orchestrator({ keepWorkspace: true });
  }

  public async execute(
    cell: PlannedExperimentCell,
    context: SingleRunExecutionContext
  ): Promise<SingleRunExecutionResult> {
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('Experiment cancelled');
    }
    const configFile = this.options.configFiles.get(cell.testcaseId);
    if (configFile === undefined) {
      throw new Error(
        `No source configuration is registered for test case "${cell.testcaseId}"`
      );
    }

    const result = await this.orchestrator.runEvaluation(
      cell.config,
      configFile,
      {
        workspaceRunId: [
          'experiment',
          context.experimentId,
          cell.cellId,
          context.attemptNumber,
          context.attemptId,
        ].join('-'),
      }
    );
    const artifactsDirectory = path.join(
      result.execution.environment.workspace_dir,
      'artifacts'
    );
    const resultPath = path.join(artifactsDirectory, 'results.json');
    const logPath = path.join(artifactsDirectory, result.artifacts.agent_log);

    try {
      const log = youBenchaLogSchema.parse(
        JSON.parse(await fs.readFile(logPath, 'utf8')) as unknown
      );
      const usageQuality = log.usage.measurement_source ?? 'unavailable';
      const costUsd = log.usage.cost_usd ?? log.usage.estimated_cost_usd;
      return {
        result,
        resultPath,
        tokenCount: log.usage.total_tokens,
        costUsd,
        usageQuality,
        tokenQuality: usageQuality,
        costQuality: costUsd === undefined ? 'unavailable' : usageQuality,
      };
    } catch {
      return {
        result,
        resultPath,
        usageQuality: 'unavailable',
        tokenQuality: 'unavailable',
        costQuality: 'unavailable',
      };
    }
  }
}
