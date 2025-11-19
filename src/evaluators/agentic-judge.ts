/**
 * Agentic Judge Evaluator
 * 
 * Uses a full agentic coding agent (via AgentAdapter) to evaluate code quality.
 * The agent executes with tools and iterative reasoning to assess evaluation criteria.
 * NOT a single LLM API call - uses full agentic workflow.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Evaluator, EvaluationContext } from './base.js';
import { EvaluationResult } from '../schemas/result.schema.js';
import { AgentAdapter, AgentExecutionContext } from '../adapters/base.js';
import { CopilotCLIAdapter } from '../adapters/copilot-cli.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Agent evaluation result from JSON output
 */
interface AgentEvaluationOutput {
  status: 'passed' | 'failed';
  metrics: Record<string, any>;
  message: string;
}

/**
 * AgenticJudgeEvaluator uses a coding agent to perform code quality evaluation
 */
export class AgenticJudgeEvaluator implements Evaluator {
  readonly name: string;
  readonly description = 'Uses an AI agent to evaluate code quality based on your custom assertions. The agent reads files, searches for patterns, and makes judgments like a human reviewer would. Great for assessing things like: test coverage, error handling, documentation quality, and best practices. Each assertion should be explicit and evaluable as pass/fail. Note: Results may vary between runs due to AI behavior.';
  readonly requiresExpectedReference = false;

  /**
   * Create a new agentic judge evaluator
   * @param name - Custom name for this evaluator instance (default: 'agentic-judge')
   */
  constructor(name: string = 'agentic-judge') {
    this.name = name;
  }

  /**
   * Check if evaluator can run (agent configured and available)
   */
  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    try {
      // Check if agent configuration exists in test case config
      const agentConfig = context.testCaseConfig.agent;
      if (!agentConfig || !agentConfig.type) {
        return false;
      }
      const agentType = context.config.type;
      if (!agentType) {
        return false;
      }
      // Validate assertions exists and is not empty
      const assertions = context.config.assertions || context.config.criteria; // Support both for transition
      if (!assertions) {
        return false;
      }
      if (Array.isArray(assertions) && assertions.length === 0) {
        return false;
      }
      if (typeof assertions === 'object' && !Array.isArray(assertions) && Object.keys(assertions).length === 0) {
        return false;
      }

      // Get the adapter
      const adapter = await this.getAdapter(agentConfig.type);
      if (!adapter) {
        return false;
      }

      // Check if agent is available
      return await adapter.checkAvailability();
    } catch (error) {
      return false;
    }
  }

  /**
   * Evaluate code using configured agent
   */
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const startedAt = new Date().toISOString();

    try {
      // Check preconditions
      const canRun = await this.checkPreconditions(context);
      if (!canRun) {
        return this.createSkippedResult(
          startedAt,
          'Agent not configured or not available - check agent.type in evaluator config and ensure agent is installed'
        );
      }
      // Get adapter for configured agent type from test case config
      const agentConfig = context.testCaseConfig.agent;
      console.log('Agent config from suiteConfig:', agentConfig);
      const agentType = context.config?.type as string;
      console.log('Agent type from config:', agentType);
      if (!agentType) {
        return this.createSkippedResult(
          startedAt,
          'Agent type not specified in evaluator config (config.type)'
        );
      }
      const adapter = await this.getAdapter(agentType);
      if (!adapter) {
        return this.createSkippedResult(
          startedAt,
          `Unknown adapter type: ${agentType}`
        );
      }

      //if type == copilot-cli and agentName is specified, copy .github/agents folder to modifiedDir
      console.log('context.config:', context.config);
      if (agentType === 'copilot-cli' && context.config.agent_name) {
        console.log('Copying .github/agents to modifiedDir for copilot-cli agent...');
        const fs = await import('fs-extra');
        const sourceAgentsDir = join(process.cwd(), '.github', 'agents');
        console.log('Source agents dir:', sourceAgentsDir);
        const destAgentsDir = join(context.modifiedDir, '.github', 'agents');
        console.log('Destination agents dir:', destAgentsDir);
        try {
          await fs.default.copy(sourceAgentsDir, destAgentsDir);
          console.log('Copied .github/agents successfully');
        } catch (error) {
          console.error('Failed to copy .github/agents:', error);
        }
      }

      // Build evaluation prompt
      const evaluationPrompt = this.buildEvaluationPrompt(context);

      // Execute agent with evaluation prompt
      const agentContext: AgentExecutionContext = {
        workspaceDir: context.modifiedDir,
        repoDir: context.modifiedDir,
        artifactsDir: context.artifactsDir,
        config: {
          prompt: evaluationPrompt,
          // Pass through agent parameter if specified in evaluator config
          agent: context.config.agent_name,
        },
        timeout: (context.config.timeout as number) || 300000, // 5 min default
        env: {},
      };

      const agentResult = await adapter.execute(agentContext);

      // Handle agent execution failures
      if (agentResult.status === 'failed') {
        return this.createSkippedResult(
          startedAt,
          `Agent execution failed: ${agentResult.errors.map(e => e.message).join('; ')}`,
          agentResult.durationMs
        );
      }

      if (agentResult.status === 'timeout') {
        return this.createSkippedResult(
          startedAt,
          'Agent execution timed out',
          agentResult.durationMs
        );
      }

      // Parse agent output as JSON
      const evaluationOutput = this.parseAgentOutput(agentResult.output);
      if (!evaluationOutput) {
        // Provide detailed error message with output preview
        const outputPreview = agentResult.output.substring(0, 500).replace(/\n/g, ' ');
        return this.createSkippedResult(
          startedAt,
          `Agent output is not valid JSON or missing required fields (status, metrics, message). Output preview: "${outputPreview}..."`,
          agentResult.durationMs
        );
      }

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Separate assertion results from other metrics
      // evaluationOutput.metrics contains the assertion scores (e.g., readme_modified: 1)
      // We need to move those to the assertions field at top level
      const assertionResults = { ...evaluationOutput.metrics };
      
      // Keep only non-assertion metadata in metrics
      const metadataMetrics = {
        agent_type: agentType,
        agent_duration_ms: agentResult.durationMs,
      };

      return {
        evaluator: this.name,
        status: evaluationOutput.status,
        metrics: metadataMetrics,
        message: evaluationOutput.message,
        duration_ms: durationMs,
        timestamp: completedAt,
        assertions: assertionResults as Record<string, unknown>,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        evaluator: this.name,
        status: 'skipped',
        metrics: {},
        message: `Evaluation error: ${errorMessage}`,
        duration_ms: durationMs,
        timestamp: completedAt,
        error: {
          message: errorMessage,
          stack_trace: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Build evaluation prompt for agent
   */
  private buildEvaluationPrompt(context: EvaluationContext): string {
    const instructionsFile = context.config['instructions-file'] as string | undefined;
    const agentName = context.config['agent_name'] as string | undefined;
    
    // Get assertions (support both new and legacy names)
    const assertions = context.config.assertions || context.config.criteria;
    
    // Mode 1: Load instructions from specified file
    if (instructionsFile) {
      // Support both absolute and relative paths
      const filePath = instructionsFile.startsWith('/') || instructionsFile.match(/^[a-zA-Z]:/)
        ? instructionsFile
        : join(process.cwd(), instructionsFile);
      
      const template = readFileSync(filePath, 'utf-8');
      
      // Format assertions list
      const assertionsList = this.formatAssertions(assertions);
      
      // Replace placeholders with actual values (support both ASSERTIONS and CRITERIA)
      return template.replace('{{ASSERTIONS}}', assertionsList).replace('{{CRITERIA}}', assertionsList);
    }
    if (agentName) {
      //agent has instructions, just send assertions
      const assertionsList = this.formatAssertions(assertions);
      return `Evaluation Assertions:\n${assertionsList}`;
    }
    // Mode 2: Use default markdown template
    const templatePath = join(__dirname, 'prompts', 'agentic-judge.template.md');
    const template = readFileSync(templatePath, 'utf-8');
    
    // Format assertions list
    const assertionsList = this.formatAssertions(assertions);
    
    // Replace placeholders with actual values (support both ASSERTIONS and CRITERIA)
    return template.replace('{{ASSERTIONS}}', assertionsList).replace('{{CRITERIA}}', assertionsList);
  }

  /**
   * Format assertions list for prompt
   */
  private formatAssertions(assertions: any): string {
    if (Array.isArray(assertions)) {
      // Legacy array format: ["assertion 1", "assertion 2"]
      return assertions
        .map((assertion, index) => `${index + 1}. ${assertion}`)
        .join('\n');
    } else if (typeof assertions === 'object' && assertions !== null) {
      // New object format: {"key1": "assertion 1", "key2": "assertion 2"}
      // Use snake_case keys for consistency with youBencha Log format
      return Object.entries(assertions)
        .map(([key, value]) => `- **${key}**: ${value}`)
        .join('\n');
    }
    return '';
  }

  /**
   * Parse agent output as JSON evaluation result
   */
  private parseAgentOutput(output: string): AgentEvaluationOutput | null {
    try {
      // Strategy 1: Try to extract JSON from markdown code block
      const markdownMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (markdownMatch) {
        const jsonText = markdownMatch[1].trim();
        const parsed = this.validateAndParse(jsonText);
        if (parsed) return parsed;
      }

      // Strategy 2: Try to find JSON object with required fields
      const jsonObjectMatch = output.match(/\{[\s\S]*?"status"[\s\S]*?"metrics"[\s\S]*?"message"[\s\S]*?\}/);
      if (jsonObjectMatch) {
        const parsed = this.validateAndParse(jsonObjectMatch[0]);
        if (parsed) return parsed;
      }

      // Strategy 3: Try to parse entire output as JSON
      const parsed = this.validateAndParse(output.trim());
      if (parsed) return parsed;

      // Strategy 4: Try to find last complete JSON object in output
      const lastBraceIndex = output.lastIndexOf('}');
      if (lastBraceIndex > 0) {
        const firstBraceIndex = output.lastIndexOf('{', lastBraceIndex);
        if (firstBraceIndex >= 0) {
          const jsonCandidate = output.substring(firstBraceIndex, lastBraceIndex + 1);
          const parsed = this.validateAndParse(jsonCandidate);
          if (parsed) return parsed;
        }
      }

      // Strategy 5: Find all JSON objects with required fields and use the last valid one
      // This handles cases where agent outputs multiple JSON blocks (e.g., thought process + final result)
      const jsonMatches = output.match(/\{[^{}]*"status"[^{}]*"metrics"[^{}]*"message"[^{}]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        for (let i = jsonMatches.length - 1; i >= 0; i--) {
          const parsed = this.validateAndParse(jsonMatches[i]);
          if (parsed) return parsed;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate and parse JSON string into AgentEvaluationOutput
   */
  private validateAndParse(jsonText: string): AgentEvaluationOutput | null {
    try {
      const parsed = JSON.parse(jsonText);
      
      // Validate required fields exist
      if (!parsed.status || !parsed.metrics || !parsed.message) {
        return null;
      }

      // Validate types
      if (typeof parsed.status !== 'string') {
        return null;
      }
      if (typeof parsed.metrics !== 'object' || parsed.metrics === null || Array.isArray(parsed.metrics)) {
        return null;
      }
      if (typeof parsed.message !== 'string') {
        return null;
      }

      // Validate status value
      if (parsed.status !== 'passed' && parsed.status !== 'failed') {
        return null;
      }

      return parsed as AgentEvaluationOutput;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get adapter instance for given type
   */
  private async getAdapter(adapterType: string): Promise<AgentAdapter | null> {
    switch (adapterType) {
      case 'copilot-cli':
        return new CopilotCLIAdapter();
      // Add more adapters here as they're implemented
      default:
        return null;
    }
  }

  /**
   * Create a skipped evaluation result
   */
  private createSkippedResult(
    startedAt: string,
    message: string,
    agentDurationMs?: number
  ): EvaluationResult {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    return {
      evaluator: this.name,
      status: 'skipped',
      metrics: agentDurationMs ? { agent_duration_ms: agentDurationMs } : {},
      message,
      duration_ms: durationMs,
      timestamp: completedAt,
      error: {
        message,
      },
    };
  }
}
