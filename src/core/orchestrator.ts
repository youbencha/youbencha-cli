/**
 * Orchestrator
 * 
 * Main evaluation orchestration - coordinates workspace setup, agent execution,
 * evaluator runs, results bundling, and cleanup.
 */

import * as path from 'path';
import { createHash } from 'crypto';
import { TestCaseConfig } from '../schemas/testcase.schema.js';
import { EvalConfig } from '../schemas/eval.schema.js';
import { ResultsBundle, EvaluationResult } from '../schemas/result.schema.js';
import { PostEvaluationResult } from '../schemas/post-evaluation.schema.js';
import { PreExecutionResult } from '../schemas/pre-execution.schema.js';
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
import { PreExecution, PreExecutionContext } from '../pre-execution/base.js';
import { ScriptPreExecution } from '../pre-execution/script.js';
import { PostEvaluation, PostEvaluationContext } from '../post-evaluation/base.js';
import { WebhookPostEvaluation } from '../post-evaluation/webhook.js';
import { DatabasePostEvaluation } from '../post-evaluation/database.js';
import { ScriptPostEvaluation } from '../post-evaluation/script.js';
import { resolveEvaluatorConfigs, type ResolvedEvaluatorConfig } from '../lib/evaluator-loader.js';
import { resolvePromptValue } from '../lib/prompt-loader.js';
import * as logger from '../lib/logger.js';

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /** Keep workspace after evaluation (for debugging) - defaults to true */
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
 * Internal test case config with resolved evaluators (no file references)
 */
interface ResolvedTestCaseConfig extends Omit<TestCaseConfig, 'evaluators'> {
  evaluators: ResolvedEvaluatorConfig[];
}

/**
 * Orchestrator for evaluation workflow
 */
export class Orchestrator {
  private options: OrchestratorOptions;
  private workspaceManager: WorkspaceManager;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      keepWorkspace: true, // Changed default to true - keep workspace by default
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
   * @param testCaseConfig - Test case configuration
   * @param configFile - Path to the config file used
   * @returns Results bundle with evaluation results
   */
  async runEvaluation(testCaseConfig: TestCaseConfig, configFile: string): Promise<ResultsBundle> {
    const startedAt = new Date().toISOString();
    logger.info('Starting evaluation workflow');

    let workspace: Workspace | null = null;

    try {
      // 0. Resolve evaluator file references to inline configurations
      const configFileDir = path.dirname(path.resolve(configFile));
      const resolvedEvaluators = resolveEvaluatorConfigs(
        testCaseConfig.evaluators,
        configFileDir
      );
      
      // Create a resolved test case config with inline evaluators
      const resolvedTestCaseConfig: ResolvedTestCaseConfig = {
        ...testCaseConfig,
        evaluators: resolvedEvaluators,
      };
      
      // 1. Create workspace and clone repository
      workspace = await this.setupWorkspace(resolvedTestCaseConfig);
      logger.info(`Workspace created: ${workspace.runId}`);

      // 2. Run pre-execution hooks (if configured)
      if (resolvedTestCaseConfig.pre_execution && resolvedTestCaseConfig.pre_execution.length > 0) {
        logger.info(`Running ${resolvedTestCaseConfig.pre_execution.length} pre-execution hook(s)...`);
        const preExecutionResults = await this.runPreExecutions(
          resolvedTestCaseConfig,
          workspace
        );
        
        // Check if any pre-execution failed
        const failedPreExecutions = preExecutionResults.filter(r => r.status === 'failed');
        if (failedPreExecutions.length > 0) {
          const errorMsg = `Pre-execution failed: ${failedPreExecutions.map(r => r.message).join(', ')}`;
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
        
        logger.info('Pre-execution completed successfully');
      }

      // 3. Execute agent
      const { agentLog, agentExecution } = await this.executeAgent(
        resolvedTestCaseConfig,
        workspace,
        configFileDir
      );
      logger.info(`Agent execution completed: ${agentExecution.status}`);

      // 4. Save youBencha log
      const agentLogPath = await saveYouBenchaLog(
        agentLog,
        workspace.paths.artifactsDir
      );
      logger.info(`youBencha log saved: ${agentLogPath}`);

      // 5. Run evaluators
      const evaluatorResults = await this.runEvaluators(
        resolvedTestCaseConfig,
        workspace,
        agentLog,
        configFileDir
      );
      logger.info(`Evaluators completed: ${evaluatorResults.length} results`);

      // 6. Build results bundle
      const resultsBundle = await this.buildResultsBundle(
        resolvedTestCaseConfig,
        configFile,
        workspace,
        agentExecution,
        agentLogPath,
        evaluatorResults,
        startedAt
      );

      // 7. Save results bundle
      const resultsBundlePath = await saveResultsBundle(
        resultsBundle,
        workspace.paths.artifactsDir
      );
      logger.info(`Results bundle saved: ${resultsBundlePath}`);

      // 8. Run post-evaluations (if configured)
      if (resolvedTestCaseConfig.post_evaluation && resolvedTestCaseConfig.post_evaluation.length > 0) {
        logger.info(`Running ${resolvedTestCaseConfig.post_evaluation.length} post-evaluation(s)...`);
        const postEvaluationResults = await this.runPostEvaluations(
          resolvedTestCaseConfig,
          resultsBundle,
          resultsBundlePath,
          workspace
        );
        logger.info(`Post-evaluations completed: ${postEvaluationResults.length} results`);
      }

      // 8. Cleanup workspace (unless keeping)
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
   * Run evaluation-only workflow (no agent execution)
   * 
   * This method runs evaluators on existing directories without executing an agent.
   * Useful for:
   * - Re-evaluating existing agent outputs
   * - Evaluating manual code changes
   * - Testing evaluators during development
   * - CI/CD integration with other tools
   * 
   * @param evalConfig - Eval configuration
   * @param configFile - Path to the config file used
   * @returns Results bundle with evaluation results
   */
  async runEvaluationOnly(evalConfig: EvalConfig, configFile: string): Promise<ResultsBundle> {
    const startedAt = new Date().toISOString();
    logger.info('Starting evaluation-only workflow (no agent execution)');

    // Detect environment
    const env = detectEnvironment();

    // Validate that the directory exists
    const fs = await import('fs/promises');
    try {
      const dirStat = await fs.stat(evalConfig.directory);
      if (!dirStat.isDirectory()) {
        throw new Error(`Path is not a directory: ${evalConfig.directory}`);
      }
    } catch (error) {
      throw new Error(`Directory does not exist: ${evalConfig.directory}`);
    }

    // Validate expected directory if provided
    let expectedDir: string | undefined;
    if (evalConfig.expected_directory) {
      try {
        const expectedDirStat = await fs.stat(evalConfig.expected_directory);
        if (!expectedDirStat.isDirectory()) {
          throw new Error(`Expected path is not a directory: ${evalConfig.expected_directory}`);
        }
        expectedDir = path.resolve(evalConfig.expected_directory);
      } catch (error) {
        throw new Error(`Expected directory does not exist: ${evalConfig.expected_directory}`);
      }
    }

    // Resolve paths
    const modifiedDir = path.resolve(evalConfig.directory);
    const outputDir = evalConfig.output_dir || '.youbencha-eval';
    
    // Create output directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runId = `eval-${timestamp}`;
    const artifactsDir = path.join(outputDir, runId, 'artifacts');
    
    await fs.mkdir(artifactsDir, { recursive: true });
    logger.info(`Output directory created: ${path.join(outputDir, runId)}`);

    try {
      // Create a minimal YouBenchaLog for eval-only mode
      const agentLog: YouBenchaLog = {
        version: '1.0.0',
        agent: {
          name: 'manual',
          version: '1.0.0',
          adapter_version: '1.0.0',
        },
        model: {
          name: 'none',
          provider: 'manual',
          parameters: {},
        },
        execution: {
          started_at: startedAt,
          completed_at: startedAt,
          duration_ms: 0,
          status: 'success',
          exit_code: 0,
        },
        messages: [
          {
            role: 'user',
            content: 'Manual evaluation (no agent execution)',
            timestamp: startedAt,
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        },
        errors: [],
        environment: {
          os: env.os,
          node_version: env.nodeVersion,
          youbencha_version: env.youbenchaVersion,
          working_directory: modifiedDir,
        },
      };

      // Save youBencha log
      const agentLogPath = await saveYouBenchaLog(agentLog, artifactsDir);
      logger.info(`youBencha log saved: ${agentLogPath}`);

      // Run evaluators using a synthetic workspace-like context
      logger.info('Running evaluators...');
      const evaluatorResults = await this.runEvaluatorsForEvalOnly(
        evalConfig,
        modifiedDir,
        expectedDir,
        artifactsDir,
        agentLog
      );
      logger.info(`Evaluators completed: ${evaluatorResults.length} results`);

      // Build results bundle
      const resultsBundle = await this.buildResultsBundleForEvalOnly(
        evalConfig,
        configFile,
        modifiedDir,
        expectedDir,
        path.join(outputDir, runId),
        artifactsDir,
        agentLogPath,
        evaluatorResults,
        startedAt
      );

      // Save results bundle
      const resultsBundlePath = await saveResultsBundle(resultsBundle, artifactsDir);
      logger.info(`Results bundle saved: ${resultsBundlePath}`);

      // Run post-evaluations (if configured)
      if (evalConfig.post_evaluation && evalConfig.post_evaluation.length > 0) {
        logger.info(`Running ${evalConfig.post_evaluation.length} post-evaluation(s)...`);
        
        const runDirPath = path.join(outputDir, runId);
        
        // Create a synthetic workspace object for post-evaluations
        const syntheticWorkspace: Pick<Workspace, 'paths'> = {
          paths: {
            root: outputDir,
            runDir: runDirPath,
            artifactsDir,
            evaluatorArtifactsDir: artifactsDir,
            modifiedDir,
            expectedDir,
            lockFile: path.join(runDirPath, '.lock'),
          },
        };
        
        const postEvaluationResults = await this.runPostEvaluationsForEvalOnly(
          evalConfig,
          resultsBundle,
          resultsBundlePath,
          syntheticWorkspace
        );
        logger.info(`Post-evaluations completed: ${postEvaluationResults.length} results`);
      }

      return resultsBundle;
    } catch (error) {
      logger.error('Evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Run evaluators for eval-only mode
   */
  private async runEvaluatorsForEvalOnly(
    evalConfig: EvalConfig,
    modifiedDir: string,
    expectedDir: string | undefined,
    artifactsDir: string,
    agentLog: YouBenchaLog
  ): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    // Run evaluators in parallel using Promise.allSettled
    const evaluatorPromises = evalConfig.evaluators.map(async (evaluatorConfig) => {
      try {
        const evaluator = this.getEvaluator(evaluatorConfig.name);
        if (!evaluator) {
          return {
            evaluator: evaluatorConfig.name,
            status: 'skipped' as const,
            metrics: {},
            message: `Unknown evaluator: ${evaluatorConfig.name}`,
            duration_ms: 0,
            timestamp: new Date().toISOString(),
            error: {
              message: `Evaluator '${evaluatorConfig.name}' not found`,
            },
          };
        }

        // Build evaluation context
        const context: EvaluationContext = {
          modifiedDir,
          expectedDir,
          artifactsDir,
          agentLog,
          config: evaluatorConfig.config || {},
          testCaseConfig: undefined, // No test case config in eval-only mode
        };

        // Run evaluator
        const result = await evaluator.evaluate(context);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          evaluator: evaluatorConfig.name,
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
   * Build results bundle for eval-only mode
   */
  private async buildResultsBundleForEvalOnly(
    evalConfig: EvalConfig,
    configFile: string,
    modifiedDir: string,
    expectedDir: string | undefined,
    runDir: string,
    artifactsDir: string,
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
    const allArtifacts = await getArtifactManifest(artifactsDir);
    const evaluatorArtifacts = allArtifacts.filter(
      (f) => !f.includes('youbencha.log.json') && !f.includes('results.json')
    );

    // Generate config hash
    const configHash = createHash('sha256')
      .update(JSON.stringify(evalConfig, null, 0))
      .digest('hex')
      .substring(0, 16);

    return {
      version: '1.0.0',
      test_case: {
        name: evalConfig.name,
        description: evalConfig.description,
        config_file: configFile,
        config_hash: configHash,
        repo: `file://${modifiedDir}`, // Use file:// URL for local directory
        branch: 'eval-only',
        commit: 'manual',
        expected_branch: expectedDir ? 'eval-only-expected' : undefined,
      },
      execution: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        youbencha_version: env.youbenchaVersion,
        environment: {
          os: `${env.os} ${env.osVersion}`,
          node_version: env.nodeVersion,
          workspace_dir: runDir,
        },
      },
      agent: {
        type: 'manual',
        youbencha_log_path: 'youbencha.log.json',
        status: 'success',
        exit_code: 0,
      },
      evaluators: evaluatorResults,
      summary,
      artifacts: {
        agent_log: path.basename(agentLogPath),
        reports: [],
        evaluator_artifacts: evaluatorArtifacts,
      },
    };
  }

  /**
   * Run post-evaluations for eval-only mode
   */
  private async runPostEvaluationsForEvalOnly(
    evalConfig: EvalConfig,
    resultsBundle: ResultsBundle,
    resultsBundlePath: string,
    workspace: Pick<Workspace, 'paths'>
  ): Promise<PostEvaluationResult[]> {
    if (!evalConfig.post_evaluation || evalConfig.post_evaluation.length === 0) {
      return [];
    }

    // Reuse the existing post-evaluation logic with a synthetic test case config
    // Only post_evaluation field is needed by runPostEvaluations
    const syntheticTestCaseConfig: Pick<ResolvedTestCaseConfig, 'post_evaluation'> = {
      post_evaluation: evalConfig.post_evaluation,
    };

    return this.runPostEvaluations(
      syntheticTestCaseConfig as ResolvedTestCaseConfig,
      resultsBundle,
      resultsBundlePath,
      workspace as Workspace
    );
  }

  /**
   * Setup workspace and clone repository
   */
  private async setupWorkspace(testCaseConfig: ResolvedTestCaseConfig): Promise<Workspace> {
    logger.info('Setting up workspace...');

    const workspaceConfig: WorkspaceConfig = {
      repo: testCaseConfig.repo,
      branch: testCaseConfig.branch,
      commit: testCaseConfig.commit,
      expectedBranch: testCaseConfig.expected,
      workspaceRoot: testCaseConfig.workspace_dir,
      timeout: testCaseConfig.timeout,
    };

    const workspace = await this.workspaceManager.createWorkspace(workspaceConfig);

    return workspace;
  }

  /**
   * Run pre-execution hooks in sequence
   * Pre-executions run after workspace setup but before agent execution
   */
  private async runPreExecutions(
    testCaseConfig: ResolvedTestCaseConfig,
    workspace: Workspace
  ): Promise<PreExecutionResult[]> {
    if (!testCaseConfig.pre_execution || testCaseConfig.pre_execution.length === 0) {
      return [];
    }

    logger.info('Running pre-executions...');

    const results: PreExecutionResult[] = [];

    // Run pre-executions in sequence (not parallel) to maintain order
    for (const config of testCaseConfig.pre_execution) {
      const startTime = Date.now();
      
      try {
        const preExecution = this.getPreExecution(config.name);
        if (!preExecution) {
          const result: PreExecutionResult = {
            pre_executor: config.name,
            status: 'skipped',
            message: `Unknown pre-execution: ${config.name}`,
            duration_ms: 0,
            timestamp: new Date().toISOString(),
            error: {
              message: `Pre-execution '${config.name}' not found`,
            },
          };
          results.push(result);
          logger.warn(result.message);
          continue;
        }

        // Build pre-execution context
        const context: PreExecutionContext = {
          workspaceDir: workspace.paths.modifiedDir,
          repoDir: workspace.paths.modifiedDir,
          artifactsDir: workspace.paths.artifactsDir,
          testCaseName: testCaseConfig.name,
          repoUrl: testCaseConfig.repo,
          branch: testCaseConfig.branch || workspace.branch,
          config: config.config || {},
        };

        // Check preconditions
        const canRun = await preExecution.checkPreconditions(context);
        if (!canRun) {
          const result: PreExecutionResult = {
            pre_executor: config.name,
            status: 'skipped',
            message: 'Pre-execution preconditions not met',
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
          results.push(result);
          logger.warn(`Pre-execution ${config.name} skipped: preconditions not met`);
          continue;
        }

        // Execute pre-execution
        const result = await preExecution.execute(context);
        results.push(result);
        
        if (result.status === 'success') {
          logger.info(`Pre-execution ${config.name} completed successfully`);
        } else if (result.status === 'failed') {
          logger.error(`Pre-execution ${config.name} failed: ${result.message}`);
        } else {
          logger.warn(`Pre-execution ${config.name} skipped: ${result.message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result: PreExecutionResult = {
          pre_executor: config.name,
          status: 'failed',
          message: `Pre-execution error: ${errorMessage}`,
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          error: {
            message: errorMessage,
            stack_trace: error instanceof Error ? error.stack : undefined,
          },
        };
        results.push(result);
        logger.error(`Pre-execution ${config.name} threw error: ${errorMessage}`);
      }
    }

    return results;
  }

  /**
   * Execute agent via adapter
   */
  /**
   * Execute agent via adapter
   */
  private async executeAgent(
    testCaseConfig: ResolvedTestCaseConfig,
    workspace: Workspace,
    configFileDir: string
  ): Promise<{
    agentLog: YouBenchaLog;
    agentExecution: ResultsBundle['agent'];
  }> {
    // Copy agent files if agent name is specified and type is copilot-cli
    if (testCaseConfig.agent.type === 'copilot-cli' && testCaseConfig.agent.agent_name) {
      logger.info(`Copying agent definition for: ${testCaseConfig.agent.agent_name}`);
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

    // Resolve prompt from either inline prompt or prompt file
    const promptFromConfig = testCaseConfig.agent.config?.prompt;
    const promptFileFromConfig = testCaseConfig.agent.config?.prompt_file;
    const resolvedPrompt = resolvePromptValue(
      typeof promptFromConfig === 'string' ? promptFromConfig : undefined,
      typeof promptFileFromConfig === 'string' ? promptFileFromConfig : undefined,
      configFileDir
    );

    // Display agent context before execution
    if (resolvedPrompt) {
      if (promptFileFromConfig) {
        logger.info(`Agent prompt loaded from file: "${promptFileFromConfig}"`);
      } else {
        logger.info(`Agent prompt: "${resolvedPrompt}"`);
      }
    }
    logger.info(`Agent type: ${testCaseConfig.agent.type}`);
    if (testCaseConfig.agent.agent_name) {
      logger.info(`Agent name: ${testCaseConfig.agent.agent_name}`);
    }
    logger.info(`Working directory: ${workspace.paths.modifiedDir}`);
    logger.info('Starting agent execution...');
    console.log(''); // Add blank line for readability

    // Get agent adapter
    const adapter = this.getAgentAdapter(testCaseConfig.agent.type);

    // Check availability
    const isAvailable = await adapter.checkAvailability();
    if (!isAvailable) {
      throw new Error(`Agent ${testCaseConfig.agent.type} is not available or not authenticated`);
    }

    // Execute agent
    const executionContext: AgentExecutionContext = {
      workspaceDir: workspace.paths.modifiedDir,
      repoDir: workspace.paths.modifiedDir,
      artifactsDir: workspace.paths.artifactsDir,
      config: {
        ...(testCaseConfig.agent.config || {}),
        // Override with resolved prompt (replaces both prompt and prompt_file with the actual prompt content)
        prompt: resolvedPrompt,
        // Remove prompt_file from config since we've resolved it
        prompt_file: undefined,
        // Pass agent name if specified in test case config
        agent: testCaseConfig.agent.agent_name,
        // Pass model if specified in test case config
        model: testCaseConfig.agent.model,
      },
      timeout: testCaseConfig.timeout || 300000, // 5 min default
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
      type: testCaseConfig.agent.type,
      youbencha_log_path: 'youbencha.log.json',
      status: result.status,
      exit_code: result.exitCode,
    };

    return { agentLog, agentExecution };
  }

  /**
   * Run all configured evaluators
   */
  private async runEvaluators(
    testCaseConfig: ResolvedTestCaseConfig,
    workspace: Workspace,
    agentLog: YouBenchaLog,
    configFileDir: string
  ): Promise<EvaluationResult[]> {
    logger.info('Running evaluators...');

    const results: EvaluationResult[] = [];

    // Run evaluators in parallel using Promise.allSettled
    const evaluatorPromises = testCaseConfig.evaluators.map(async (evaluatorConfig) => {
      try {
        const evaluator = this.getEvaluator(evaluatorConfig.name);
        if (!evaluator) {
          return {
            evaluator: evaluatorConfig.name,
            status: 'skipped' as const,
            metrics: {},
            message: `Unknown evaluator: ${evaluatorConfig.name}`,
            duration_ms: 0,
            timestamp: new Date().toISOString(),
            error: {
              message: `Evaluator '${evaluatorConfig.name}' not found`,
            },
          };
        }

        // Resolve prompt_file in evaluator config if present
        const evaluatorConfigWithResolvedPrompt = { ...evaluatorConfig.config };
        if (evaluatorConfig.config) {
          const promptFromConfig = evaluatorConfigWithResolvedPrompt.prompt as string | undefined;
          const promptFileFromConfig = evaluatorConfigWithResolvedPrompt.prompt_file as string | undefined;
          
          // Validate mutual exclusivity
          if (promptFromConfig && promptFileFromConfig) {
            throw new Error(
              `Evaluator "${evaluatorConfig.name}": Cannot specify both "prompt" and "prompt_file". Please use only one.`
            );
          }
          
          if (promptFileFromConfig || promptFromConfig) {
            const resolvedPrompt = resolvePromptValue(
              typeof promptFromConfig === 'string' ? promptFromConfig : undefined,
              typeof promptFileFromConfig === 'string' ? promptFileFromConfig : undefined,
              configFileDir
            );
            // Update config with resolved prompt, removing prompt_file
            evaluatorConfigWithResolvedPrompt.prompt = resolvedPrompt;
            delete evaluatorConfigWithResolvedPrompt.prompt_file;
          }
        }

        // Build evaluation context
        const context: EvaluationContext = {
          modifiedDir: workspace.paths.modifiedDir,
          expectedDir: workspace.paths.expectedDir,
          artifactsDir: workspace.paths.artifactsDir,
          agentLog,
          config: evaluatorConfigWithResolvedPrompt || {},
          testCaseConfig,
        };

        // Run evaluator
        const result = await evaluator.evaluate(context);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          evaluator: evaluatorConfig.name,
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
    testCaseConfig: ResolvedTestCaseConfig,
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
    const configHash = this.generateConfigHash(testCaseConfig);

    return {
      version: '1.0.0',
      test_case: {
        name: testCaseConfig.name,
        description: testCaseConfig.description,
        config_file: configFile,
        config_hash: configHash,
        repo: testCaseConfig.repo,
        branch: testCaseConfig.branch || workspace.branch || 'unknown',
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
   * Generate hash of test case configuration for reproducibility
   */
  private generateConfigHash(testCaseConfig: TestCaseConfig): string {
    const configString = JSON.stringify(testCaseConfig, null, 0);
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
        // Support custom-named agentic-judge evaluators
        // Names like 'agentic-judge-error-handling' or 'agentic-judge-docs'
        if (evaluatorName.startsWith('agentic-judge-') || evaluatorName.startsWith('agentic-judge:')) {
          return new AgenticJudgeEvaluator(evaluatorName);
        }
        return null;
    }
  }

  /**
   * Get pre-execution instance
   */
  private getPreExecution(name: string): PreExecution | null {
    switch (name) {
      case 'script':
        return new ScriptPreExecution();
      default:
        return null;
    }
  }

  /**
   * Get post-evaluation instance
   */
  private getPostEvaluation(name: string): PostEvaluation | null {
    switch (name) {
      case 'webhook':
        return new WebhookPostEvaluation();
      case 'database':
        return new DatabasePostEvaluation();
      case 'script':
        return new ScriptPostEvaluation();
      default:
        return null;
    }
  }

  /**
   * Run post-evaluations in parallel
   * Post-evaluations never fail the main evaluation - errors are captured in results
   */
  private async runPostEvaluations(
    testCaseConfig: ResolvedTestCaseConfig,
    resultsBundle: ResultsBundle,
    resultsBundlePath: string,
    workspace: Workspace
  ): Promise<PostEvaluationResult[]> {
    if (!testCaseConfig.post_evaluation || testCaseConfig.post_evaluation.length === 0) {
      return [];
    }

    logger.info('Running post-evaluations...');

    // Run all post-evaluations in parallel using Promise.allSettled
    const postEvaluationPromises = testCaseConfig.post_evaluation.map(async (config) => {
      const startTime = Date.now();
      
      try {
        // Get post-evaluation instance
        const postEvaluation = this.getPostEvaluation(config.name);
        if (!postEvaluation) {
          logger.warn(`Unknown post-evaluation: ${config.name}, skipping`);
          return {
            post_evaluator: config.name,
            status: 'skipped' as const,
            message: `Unknown post-evaluation type: ${config.name}`,
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        // Create context
        const context: PostEvaluationContext = {
          resultsBundle,
          resultsBundlePath,
          artifactsDir: workspace.paths.artifactsDir,
          workspaceDir: workspace.paths.runDir,
          config: config.config,
        };

        // Check preconditions
        const canRun = await postEvaluation.checkPreconditions(context);
        if (!canRun) {
          logger.warn(`Post-evaluation ${config.name} preconditions not met, skipping`);
          return {
            post_evaluator: config.name,
            status: 'skipped' as const,
            message: 'Preconditions not met',
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        // Execute post-evaluation
        logger.info(`Executing post-evaluation: ${config.name}`);
        const result = await postEvaluation.execute(context);
        
        if (result.status === 'success') {
          logger.info(`✓ ${config.name}: ${result.message}`);
        } else if (result.status === 'failed') {
          logger.warn(`✗ ${config.name}: ${result.message}`);
        } else {
          logger.info(`⊘ ${config.name}: ${result.message}`);
        }

        return result;
      } catch (error) {
        // Catch any unexpected errors and convert to failed result
        logger.error(`Post-evaluation ${config.name} threw unexpected error:`, error);
        return {
          post_evaluator: config.name,
          status: 'failed' as const,
          message: 'Unexpected error during execution',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack_trace: error instanceof Error ? error.stack : undefined,
          },
        };
      }
    });

    // Wait for all post-evaluations to complete
    const settled = await Promise.allSettled(postEvaluationPromises);

    // Extract results from settled promises
    const results = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Should not happen since we catch all errors above, but handle it anyway
        const config = testCaseConfig.post_evaluation![index];
        logger.error(`Post-evaluation ${config.name} promise rejected:`, result.reason);
        return {
          post_evaluator: config.name,
          status: 'failed' as const,
          message: 'Promise rejected unexpectedly',
          duration_ms: 0,
          timestamp: new Date().toISOString(),
          error: {
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        };
      }
    });

    return results;
  }
}
