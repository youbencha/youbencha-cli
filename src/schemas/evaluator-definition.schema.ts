/**
 * Evaluator Definition Schema
 * 
 * Zod schema for standalone evaluator definitions that can be reused across test cases.
 * Evaluator definitions are stored in separate YAML files and referenced by path.
 */

import { z } from 'zod';

/**
 * Standalone evaluator definition schema
 * 
 * This schema defines a reusable evaluator configuration that can be
 * referenced from multiple test case files.
 * 
 * Example YAML:
 * ```yaml
 * name: agentic-judge:readme-grammar
 * description: "Checks that README.md has grammatically correct content"
 * config:
 *   type: copilot-cli
 *   agent_name: agentic-judge
 *   timeout: 300000
 *   assertions:
 *     grammatically_correct: "README.md content is grammatically correct. Score 1 if true, 0 if false."
 *     no_spelling_errors: "README.md has no spelling errors. Score 1 if true, 0 if false."
 * ```
 */
export const evaluatorDefinitionSchema = z.object({
  /**
   * Unique name for this evaluator
   * 
   * Should be descriptive and follow naming conventions:
   * - Built-in evaluators: 'git-diff', 'expected-diff'
   * - Agentic judges: 'agentic-judge:purpose' or 'agentic-judge-purpose'
   * 
   * Examples:
   * - 'agentic-judge:readme-grammar'
   * - 'agentic-judge-test-coverage'
   * - 'custom-security-check'
   */
  name: z.string().min(1, 'Evaluator name is required'),
  
  /**
   * Human-readable description of what this evaluator checks
   * 
   * Should clearly explain the purpose and what metrics/assertions it evaluates.
   */
  description: z.string().optional(),
  
  /**
   * Evaluator-specific configuration
   * 
   * This is the same config object that would be inline in a test case's
   * evaluators array. The structure depends on the evaluator type.
   * 
   * For agentic-judge evaluators, typically includes:
   * - type: 'copilot-cli'
   * - agent_name: 'agentic-judge'
   * - timeout: number (optional)
   * - custom_instructions: string (optional) - Additional instructions prepended to assertions
   * - assertions: Record<string, string>
   * 
   * For git-diff evaluators, typically includes:
   * - base_commit: string (optional)
   * - assertions: with max_files_changed, max_lines_added, etc.
   */
  config: z.record(z.any()).optional(),
});

/**
 * Inferred TypeScript type from schema
 */
export type EvaluatorDefinition = z.infer<typeof evaluatorDefinitionSchema>;
