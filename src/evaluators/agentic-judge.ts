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
  readonly name = 'agentic-judge';
  readonly description = 'Uses agentic coding agent with tool use and iterative reasoning to evaluate code quality against specified criteria';
  readonly requiresExpectedReference = false;

  /**
   * Check if evaluator can run (agent configured and available)
   */
  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    try {
      // Check if agent configuration exists in suite config
      const agentConfig = context.suiteConfig.agent;
      if (!agentConfig || !agentConfig.type) {
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

      // Get adapter for configured agent type from suite config
      const agentConfig = context.suiteConfig.agent;
      const agentType = agentConfig.type;
      const adapter = await this.getAdapter(agentType);
      if (!adapter) {
        return this.createSkippedResult(
          startedAt,
          `Unknown adapter type: ${agentType}`
        );
      }

      // Build evaluation prompt
      const evaluationPrompt = this.buildEvaluationPrompt(context);

      // Execute agent with evaluation prompt
      const agentContext: AgentExecutionContext = {
        workspaceDir: context.modifiedDir,
        repoDir: context.modifiedDir,
        config: {
          ...(agentConfig.config || {}),
          prompt: evaluationPrompt,
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

      return {
        evaluator: this.name,
        status: evaluationOutput.status,
        metrics: {
          ...evaluationOutput.metrics,
          agent_type: agentType,
          agent_duration_ms: agentResult.durationMs,
        },
        message: evaluationOutput.message,
        duration_ms: durationMs,
        timestamp: completedAt,
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
    // Load prompt template
    const templatePath = join(__dirname, 'prompts', 'agentic-judge.template.txt');
    const template = readFileSync(templatePath, 'utf-8');
    
    // Format criteria list
    const criteria = context.config.criteria as string[] || [];
    const criteriaList = criteria
      .map((criterion, index) => `${index + 1}. ${criterion}`)
      .join('\n');
    
    // Replace placeholder with criteria
    return template.replace('{{CRITERIA}}', criteriaList);
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
