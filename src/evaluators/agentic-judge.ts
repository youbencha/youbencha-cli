/**
 * Agentic Judge Evaluator
 * 
 * Uses a full agentic coding agent (via AgentAdapter) to evaluate code quality.
 * The agent executes with tools and iterative reasoning to assess evaluation criteria.
 * NOT a single LLM API call - uses full agentic workflow.
 */

import { Evaluator, EvaluationContext } from './base.js';
import { EvaluationResult } from '../schemas/result.schema.js';
import { AgentAdapter, AgentExecutionContext } from '../adapters/base.js';
import { CopilotCLIAdapter } from '../adapters/copilot-cli.js';

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
      // Check if agent configuration exists
      const agentConfig = context.config.agent as any;
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

      // Get adapter for configured agent type
      const agentConfig = context.config.agent as any;
      const agentType = agentConfig.type as string;
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
        return this.createSkippedResult(
          startedAt,
          'Agent output is not valid JSON or missing required fields (status, metrics, message)',
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
    const criteria = context.config.criteria as string[] || [];
    
    let prompt = `You are a code quality evaluator. Review the code in this repository and evaluate it against the following criteria:\n\n`;
    
    // Add criteria
    criteria.forEach((criterion, index) => {
      prompt += `${index + 1}. ${criterion}\n`;
    });
    
    prompt += `\nAnalyze the code using all available tools (read files, search, analyze patterns). `;
    prompt += `Provide thorough evaluation with specific examples and evidence.\n\n`;
    prompt += `Output your evaluation as JSON with the following structure:\n`;
    prompt += `{\n`;
    prompt += `  "status": "passed" | "failed",\n`;
    prompt += `  "metrics": { /* your detailed metrics as key-value pairs */ },\n`;
    prompt += `  "message": "Summary of evaluation findings"\n`;
    prompt += `}\n\n`;
    prompt += `Important:\n`;
    prompt += `- Use "passed" if code meets the criteria, "failed" if it does not\n`;
    prompt += `- Include specific metrics relevant to the criteria (e.g., error_handling_score: 8.5)\n`;
    prompt += `- Provide a clear message explaining your evaluation\n`;
    prompt += `- Output ONLY the JSON object, no additional text\n`;

    return prompt;
  }

  /**
   * Parse agent output as JSON evaluation result
   */
  private parseAgentOutput(output: string): AgentEvaluationOutput | null {
    try {
      // Try to find JSON in output (may have additional text)
      const jsonMatch = output.match(/\{[\s\S]*"status"[\s\S]*"metrics"[\s\S]*"message"[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : output;
      
      const parsed = JSON.parse(jsonText);
      
      // Validate required fields
      if (!parsed.status || !parsed.metrics || !parsed.message) {
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
