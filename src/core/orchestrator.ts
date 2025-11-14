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
import { ExpectedDiffEvaluator } from '../evaluators/expected-diff.js';
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
  
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize?: number;
  
  /** Maximum directory depth (default: 10) */
  maxDirectoryDepth?: number;
  
  /** Maximum workspace size in bytes (default: 1GB) */
  maxWorkspaceSize?: number;
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
      maxFileSize: 10 * 1024 * 1024,        // 10MB
      maxDirectoryDepth: 10,
      maxWorkspaceSize: 1024 * 1024 * 1024, // 1GB
      ...options,
    };
    this.workspaceManager = new WorkspaceManager();
  }

  /**
   * Run complete evaluation workflow
   * 
   * @param suiteConfig - Suite configuration
   * @param configFile - Path to the config file used
   * @returns Results bundle with evaluation results
   */
  async runEvaluation(suiteConfig: SuiteConfig, configFile: string): Promise<ResultsBundle> {
    const startedAt = new Date().toISOString();
    const isPRMode = !!suiteConfig.pull_request;
    
    if (isPRMode) {
      logger.info('Starting evaluation workflow (PR evaluation mode)');
    } else {
      logger.info('Starting evaluation workflow');
    }

    let workspace: Workspace | null = null;

    try {
      // 1. Create workspace and clone repository
      workspace = await this.setupWorkspace(suiteConfig);
      logger.info(`Workspace created: ${workspace.runId}`);

      // 2. Execute agent (skip in PR mode)
      let agentLog: YouBenchaLog;
      let agentExecution: ResultsBundle['agent'];
      
      if (isPRMode) {
        // Skip agent execution in PR mode - create minimal log
        logger.info('Skipping agent execution (PR evaluation mode)');
        agentLog = this.createMinimalYouBenchaLog(suiteConfig, workspace);
        agentExecution = {
          type: 'none',
          youbencha_log_path: 'youbencha.log.json',
          status: 'skipped',
          exit_code: 0,
        };
      } else {
        // Normal agent execution
        const result = await this.executeAgent(suiteConfig, workspace);
        agentLog = result.agentLog;
        agentExecution = result.agentExecution;
        logger.info(`Agent execution completed: ${agentExecution.status}`);
      }

      // 3. Save youBencha log
      const agentLogPath = await saveYouBenchaLog(
        agentLog,
        workspace.paths.artifactsDir
      );
      logger.info(`youBencha log saved: ${agentLogPath}`);

      // 4. Run evaluators
      const evaluatorResults = await this.runEvaluators(
        suiteConfig,
        workspace,
        agentLog
      );
      logger.info(`Evaluators completed: ${evaluatorResults.length} results`);

      // 5. Build results bundle
      const resultsBundle = await this.buildResultsBundle(
        suiteConfig,
        configFile,
        workspace,
        agentExecution,
        agentLogPath,
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

    // Extract PR number if in PR mode
    let pullRequestNumber: number | undefined;
    if (suiteConfig.pull_request) {
      const prMatch = suiteConfig.pull_request.url.match(/\/pull\/(\d+)\/?$/);
      if (prMatch) {
        pullRequestNumber = parseInt(prMatch[1], 10);
        logger.info(`Pull request mode: evaluating PR #${pullRequestNumber}`);
      }
    }

    const workspaceConfig: WorkspaceConfig = {
      repo: suiteConfig.repo,
      branch: suiteConfig.branch,
      commit: suiteConfig.commit,
      pullRequestNumber,
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
    agentLog: YouBenchaLog;
    agentExecution: ResultsBundle['agent'];
  }> {
    // Ensure agent config is defined (should be guaranteed by schema validation)
    if (!suiteConfig.agent) {
      throw new Error('Agent configuration is required for non-PR evaluation mode');
    }

    // Copy agent files if agent name is specified and type is copilot-cli
    if (suiteConfig.agent.type === 'copilot-cli' && suiteConfig.agent.agent_name) {
      logger.info(`Copying agent definition for: ${suiteConfig.agent.agent_name}`);
      const fs = await import('fs-extra');
      const sourceAgentsDir = path.join(process.cwd(), '.github', 'agents');
      const destAgentsDir = path.join(workspace.paths.modifiedDir, '.github', 'agents');
      try {
        await fs.default.copy(sourceAgentsDir, destAgentsDir);
        logger.info('Agent files copied successfully');
      } catch (error) {
        logger.warn(`Failed to copy agent files: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Display agent context before execution
    const prompt = suiteConfig.agent.config?.prompt as string | undefined;
    if (prompt) {
      logger.info(`Agent prompt: "${prompt}"`);
    }
    logger.info(`Agent type: ${suiteConfig.agent.type}`);
    if (suiteConfig.agent.agent_name) {
      logger.info(`Agent name: ${suiteConfig.agent.agent_name}`);
    }
    logger.info(`Working directory: ${workspace.paths.modifiedDir}`);
    logger.info('Starting agent execution...');
    console.log(''); // Add blank line for readability

    // Get agent adapter
    const adapter = this.getAgentAdapter(suiteConfig.agent.type);

    // Check availability
    const isAvailable = await adapter.checkAvailability();
    if (!isAvailable) {
      throw new Error(`Agent ${suiteConfig.agent.type} is not available or not authenticated`);
    }

    // Execute agent
    const executionContext: AgentExecutionContext = {
      workspaceDir: workspace.paths.modifiedDir,
      repoDir: workspace.paths.modifiedDir,
      config: {
        ...(suiteConfig.agent.config || {}),
        // Pass agent name if specified in suite config
        agent: suiteConfig.agent.agent_name,
      },
      timeout: suiteConfig.timeout || 300000, // 5 min default
      env: {},
    };

    const result = await adapter.execute(executionContext);

    // Display completion summary
    console.log(''); // Add blank line for readability
    logger.info(`Agent execution completed: ${result.status}`);
    logger.info(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    logger.info(`Exit code: ${result.exitCode}`);

    // Normalize to youBencha log
    const agentLog = adapter.normalizeLog(result.output, result);

    // Display usage metrics if available
    if (agentLog.usage) {
      logger.info(`Token usage: ${agentLog.usage.total_tokens} tokens (prompt: ${agentLog.usage.prompt_tokens}, completion: ${agentLog.usage.completion_tokens})`);
      if (agentLog.usage.estimated_cost_usd) {
        logger.info(`Estimated cost: $${agentLog.usage.estimated_cost_usd.toFixed(4)}`);
      }
    }

    // Build agent execution metadata
    const agentExecution = {
      type: suiteConfig.agent.type,
      youbencha_log_path: 'youbencha.log.json',
      status: result.status,
      exit_code: result.exitCode,
    };

    return { agentLog, agentExecution };
  }

  /**
   * Create a minimal YouBencha log for PR evaluation mode (no agent execution)
   */
  private createMinimalYouBenchaLog(
    _suiteConfig: SuiteConfig,
    workspace: Workspace
  ): YouBenchaLog {
    const timestamp = new Date().toISOString();
    return {
      version: '1.0.0',
      agent: {
        name: 'pr-evaluation',
        version: 'n/a',
        adapter_version: 'n/a',
      },
      model: {
        name: 'none',
        provider: 'none',
        parameters: {},
      },
      execution: {
        started_at: timestamp,
        completed_at: timestamp,
        duration_ms: 0,
        exit_code: 0,
        status: 'success',
      },
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      messages: [
        {
          role: 'system',
          content: 'PR evaluation mode - agent execution skipped',
          timestamp,
        },
      ],
      errors: [],
      environment: {
        os: process.platform,
        node_version: process.version,
        youbencha_version: '0.1.0',
        working_directory: workspace.paths.modifiedDir,
      },
    };
  }

  /**
   * Run all configured evaluators
   */
  private async runEvaluators(
    suiteConfig: SuiteConfig,
    workspace: Workspace,
    agentLog: YouBenchaLog
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
          agentLog,
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
    configFile: string,
    workspace: Workspace,
    agentExecution: ResultsBundle['agent'],
    agentLogPath: string,
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
        config_file: configFile,
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
        agent_log: path.basename(agentLogPath),
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
      case 'expected-diff':
        return new ExpectedDiffEvaluator();
      case 'agentic-judge':
        return new AgenticJudgeEvaluator();
      // Add more evaluators here as they're implemented
      default:
        return null;
    }
  }
}
