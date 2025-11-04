/**
 * Orchestrator
 * 
 * Main evaluation orchestration - coordinates workspace setup, agent execution,
 * evaluator runs, results bundling, and cleanup.
 */

import * as path from 'path';
import { createHash } from 'crypto';
import { SuiteConfig } from '../schemas/suite.schema.js';
import { ResultsBundle, EvaluationResult } from '../schemas/result.schema.js';
import { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import { WorkspaceManager, Workspace, WorkspaceConfig } from './workspace.js';
import { detectEnvironment } from './env.js';
import { saveYouBenchaLog, saveResultsBundle, getArtifactManifest } from './storage.js';
import { AgentAdapter, AgentExecutionContext } from '../adapters/base.js';
import { CopilotCLIAdapter } from '../adapters/copilot-cli.js';
import { Evaluator, EvaluationContext } from '../evaluators/base.js';
import { GitDiffEvaluator } from '../evaluators/git-diff.js';
import { AgenticJudgeEvaluator } from '../evaluators/agentic-judge.js';
import * as logger from '../lib/logger.js';

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /** Keep workspace after evaluation (for debugging) */
  keepWorkspace?: boolean;
  
  /** Maximum number of concurrent evaluators (default: 4) */
  maxConcurrentEvaluators?: number;
}

/**
 * Orchestrator for evaluation workflow
 */
export class Orchestrator {
  private options: OrchestratorOptions;
  private workspaceManager: WorkspaceManager;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      keepWorkspace: false,
      maxConcurrentEvaluators: 4,
      ...options,
    };
    this.workspaceManager = new WorkspaceManager();
  }

  /**
   * Run complete evaluation workflow
   * 
   * @param suiteConfig - Suite configuration
   * @returns Results bundle with evaluation results
   */
  async runEvaluation(suiteConfig: SuiteConfig): Promise<ResultsBundle> {
    const startedAt = new Date().toISOString();
    logger.info('Starting evaluation workflow');

    let workspace: Workspace | null = null;

    try {
      // 1. Create workspace and clone repository
      workspace = await this.setupWorkspace(suiteConfig);
      logger.info(`Workspace created: ${workspace.runId}`);

      // 2. Execute agent
      const { faceLog, agentExecution } = await this.executeAgent(
        suiteConfig,
        workspace
      );
      logger.info(`Agent execution completed: ${agentExecution.status}`);

      // 3. Save youBencha log
      const faceLogPath = await saveYouBenchaLog(
        faceLog,
        workspace.paths.artifactsDir
      );
      logger.info(`youBencha log saved: ${faceLogPath}`);

      // 4. Run evaluators
      const evaluatorResults = await this.runEvaluators(
        suiteConfig,
        workspace,
        faceLog
      );
      logger.info(`Evaluators completed: ${evaluatorResults.length} results`);

      // 5. Build results bundle
      const resultsBundle = await this.buildResultsBundle(
        suiteConfig,
        workspace,
        agentExecution,
        faceLogPath,
        evaluatorResults,
        startedAt
      );

      // 6. Save results bundle
      const resultsBundlePath = await saveResultsBundle(
        resultsBundle,
        workspace.paths.artifactsDir
      );
      logger.info(`Results bundle saved: ${resultsBundlePath}`);

      // 7. Cleanup workspace (unless keeping)
      if (!this.options.keepWorkspace) {
        await this.workspaceManager.cleanup(workspace);
        logger.info('Workspace cleaned up');
      }

      return resultsBundle;
    } catch (error) {
      // Cleanup on error
      if (workspace && !this.options.keepWorkspace) {
        try {
          await this.workspaceManager.cleanup(workspace);
        } catch (cleanupError) {
          logger.error('Failed to cleanup workspace after error', cleanupError);
        }
      }

      throw error;
    }
  }

  /**
   * Setup workspace and clone repository
   */
  private async setupWorkspace(suiteConfig: SuiteConfig): Promise<Workspace> {
    logger.info('Setting up workspace...');

    const workspaceConfig: WorkspaceConfig = {
      repo: suiteConfig.repo,
      branch: suiteConfig.branch,
      commit: suiteConfig.commit,
      expectedBranch: suiteConfig.expected,
      workspaceRoot: suiteConfig.workspace_dir,
      timeout: suiteConfig.timeout,
    };

    const workspace = await this.workspaceManager.createWorkspace(workspaceConfig);

    return workspace;
  }

  /**
   * Execute agent via adapter
   */
  private async executeAgent(
    suiteConfig: SuiteConfig,
    workspace: Workspace
  ): Promise<{
    faceLog: YouBenchaLog;
    agentExecution: ResultsBundle['agent'];
  }> {
    logger.info('Executing agent...');

    // Get agent adapter
    const adapter = this.getAgentAdapter(suiteConfig.agent.type);

    // Check availability
    const isAvailable = await adapter.checkAvailability();
    if (!isAvailable) {
      throw new Error(`Agent ${suiteConfig.agent.type} is not available or not authenticated`);
    }

    // Execute agent
    const executionContext: AgentExecutionContext = {
      workspaceDir: workspace.paths.runDir,
      repoDir: workspace.paths.modifiedDir,
      config: suiteConfig.agent.config || {},
      timeout: suiteConfig.timeout || 300000, // 5 min default
      env: {},
    };

    const result = await adapter.execute(executionContext);

    // Normalize to youBencha log
    const faceLog = adapter.normalizeLog(result.output, result);

    // Build agent execution metadata
    const agentExecution = {
      type: suiteConfig.agent.type,
      youbencha_log_path: 'youbencha.log.json',
      status: result.status,
      exit_code: result.exitCode,
    };

    return { faceLog, agentExecution };
  }

  /**
   * Run all configured evaluators
   */
  private async runEvaluators(
    suiteConfig: SuiteConfig,
    workspace: Workspace,
    faceLog: YouBenchaLog
  ): Promise<EvaluationResult[]> {
    logger.info('Running evaluators...');

    const results: EvaluationResult[] = [];

    // Run evaluators in parallel using Promise.allSettled
    const evaluatorPromises = suiteConfig.evaluators.map(async (evalConfig) => {
      try {
        const evaluator = this.getEvaluator(evalConfig.name);
        if (!evaluator) {
          return {
            evaluator: evalConfig.name,
            status: 'skipped' as const,
            metrics: {},
            message: `Unknown evaluator: ${evalConfig.name}`,
            duration_ms: 0,
            timestamp: new Date().toISOString(),
            error: {
              message: `Evaluator '${evalConfig.name}' not found`,
            },
          };
        }

        // Build evaluation context
        const context: EvaluationContext = {
          modifiedDir: workspace.paths.modifiedDir,
          expectedDir: workspace.paths.expectedDir,
          artifactsDir: workspace.paths.artifactsDir,
          faceLog,
          config: evalConfig.config || {},
          suiteConfig,
        };

        // Run evaluator
        const result = await evaluator.evaluate(context);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          evaluator: evalConfig.name,
          status: 'skipped' as const,
          metrics: {},
          message: `Evaluator error: ${errorMessage}`,
          duration_ms: 0,
          timestamp: new Date().toISOString(),
          error: {
            message: errorMessage,
            stack_trace: error instanceof Error ? error.stack : undefined,
          },
        };
      }
    });

    const settledResults = await Promise.allSettled(evaluatorPromises);

    // Collect results
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        // Promise rejected (should not happen as we catch errors above)
        logger.error('Evaluator promise rejected', settled.reason);
        results.push({
          evaluator: 'unknown',
          status: 'skipped',
          metrics: {},
          message: `Evaluator failed: ${settled.reason}`,
          duration_ms: 0,
          timestamp: new Date().toISOString(),
          error: {
            message: String(settled.reason),
          },
        });
      }
    }

    return results;
  }

  /**
   * Build complete results bundle
   */
  private async buildResultsBundle(
    suiteConfig: SuiteConfig,
    workspace: Workspace,
    agentExecution: ResultsBundle['agent'],
    faceLogPath: string,
    evaluatorResults: EvaluationResult[],
    startedAt: string
  ): Promise<ResultsBundle> {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    const env = detectEnvironment();

    // Calculate summary statistics
    const summary = this.calculateSummary(evaluatorResults);

    // Get artifacts manifest
    const allArtifacts = await getArtifactManifest(workspace.paths.artifactsDir);
    const evaluatorArtifacts = allArtifacts.filter(
      (f) => !f.includes('youbencha.log.json') && !f.includes('results.json')
    );

    // Generate config hash
    const configHash = this.generateConfigHash(suiteConfig);

    return {
      version: '1.0.0',
      suite: {
        config_file: 'suite.yaml',
        config_hash: configHash,
        repo: suiteConfig.repo,
        branch: suiteConfig.branch || workspace.branch || 'unknown',
        commit: workspace.modifiedCommit,
        expected_branch: workspace.expectedBranch,
      },
      execution: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        youbencha_version: env.youbenchaVersion,
        environment: {
          os: `${env.os} ${env.osVersion}`,
          node_version: env.nodeVersion,
          workspace_dir: workspace.paths.runDir,
        },
      },
      agent: agentExecution,
      evaluators: evaluatorResults,
      summary,
      artifacts: {
        face_log: path.basename(faceLogPath),
        reports: [], // Reports generated separately via yb report command
        evaluator_artifacts: evaluatorArtifacts,
      },
    };
  }

  /**
   * Calculate summary statistics from evaluator results
   */
  private calculateSummary(results: EvaluationResult[]): ResultsBundle['summary'] {
    const total = results.length;
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    // Overall status logic:
    // - passed: all evaluators passed
    // - failed: any evaluator failed
    // - partial: some passed, some skipped, none failed
    let overallStatus: 'passed' | 'failed' | 'partial';
    if (failed > 0) {
      overallStatus = 'failed';
    } else if (passed === total) {
      overallStatus = 'passed';
    } else {
      overallStatus = 'partial';
    }

    return {
      total_evaluators: total,
      passed,
      failed,
      skipped,
      overall_status: overallStatus,
    };
  }

  /**
   * Generate hash of suite configuration for reproducibility
   */
  private generateConfigHash(suiteConfig: SuiteConfig): string {
    const configString = JSON.stringify(suiteConfig, null, 0);
    return createHash('sha256').update(configString).digest('hex').substring(0, 16);
  }

  /**
   * Get agent adapter instance
   */
  private getAgentAdapter(adapterType: string): AgentAdapter {
    switch (adapterType) {
      case 'copilot-cli':
        return new CopilotCLIAdapter();
      default:
        throw new Error(`Unknown agent adapter type: ${adapterType}`);
    }
  }

  /**
   * Get evaluator instance
   */
  private getEvaluator(evaluatorName: string): Evaluator | null {
    switch (evaluatorName) {
      case 'git-diff':
        return new GitDiffEvaluator();
      case 'agentic-judge':
        return new AgenticJudgeEvaluator();
      // Add more evaluators here as they're implemented
      default:
        return null;
    }
  }
}
