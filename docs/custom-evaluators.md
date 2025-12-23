# Creating Custom Evaluators

This guide explains how to create custom evaluators for youBencha to evaluate AI agent outputs. youBencha supports two types of custom evaluators:

1. **Code-Based Evaluators** - TypeScript/JavaScript evaluators implementing the `Evaluator` interface
2. **LLM-Based Evaluators** - AI-powered evaluators using the agentic-judge pattern

## Overview

Evaluators analyze agent outputs and produce structured results with:
- **Status**: `passed`, `failed`, or `skipped`
- **Metrics**: Quantitative measurements (files changed, scores, etc.)
- **Message**: Human-readable summary
- **Assertions**: Optional pass/fail thresholds or criteria

All evaluators run **in parallel** via `Promise.allSettled()` for efficiency.

---

## Option 1: LLM-Based Custom Evaluators (Recommended)

The simplest way to create custom evaluators is using the **agentic-judge** pattern. This requires no code changes - just YAML configuration.

### Quick Start: Inline LLM Evaluator

Add a custom agentic-judge evaluator directly in your test case:

```yaml
name: "My Test Case"
description: "Testing agent capabilities"

repo: https://github.com/example/repo.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add authentication to the API"

evaluators:
  # Custom LLM evaluator for security review
  - name: agentic-judge-security
    config:
      type: copilot-cli
      agent_name: agentic-judge
      timeout: 300000  # 5 minutes
      
      assertions:
        auth_implemented: "Authentication is properly implemented. Score 1 if JWT/session auth exists, 0 if missing."
        no_hardcoded_secrets: "No hardcoded secrets or API keys in code. Score 1 if clean, 0 if secrets found."
        input_validation: "User inputs are validated. Score 1 if validation exists, 0.5 if partial, 0 if none."
```

### Naming Convention

Custom agentic-judge evaluators use these naming patterns:
- **Hyphen separator** (recommended): `agentic-judge-<focus-area>`
- **Colon separator**: `agentic-judge:<focus-area>`

Examples:
- `agentic-judge-security` - Security review
- `agentic-judge-performance` - Performance analysis
- `agentic-judge:test-coverage` - Test coverage assessment

### Reusable LLM Evaluator Files

For evaluators you want to share across test cases, create a separate YAML file:

```yaml
# evaluators/security-review.yaml
name: agentic-judge:security-review
description: "Reviews code changes for common security vulnerabilities"

config:
  type: copilot-cli
  agent_name: agentic-judge
  timeout: 300000
  
  # Optional: Add custom instructions before assertions
  prompt: |
    Focus on OWASP Top 10 vulnerabilities. Be thorough but fair.
    Only flag genuine security issues, not false positives.
  
  assertions:
    no_sql_injection: "No SQL injection vulnerabilities. Score 1 if parameterized queries used, 0 if raw string concatenation."
    no_xss: "No XSS vulnerabilities. Score 1 if outputs are sanitized, 0 if raw user input rendered."
    secure_auth: "Authentication is secure. Score 1 if proper hashing/tokens used, 0 if weak patterns."
    no_secrets: "No hardcoded secrets. Score 1 if clean, 0 if API keys/passwords in code."
```

Reference it in your test case:

```yaml
evaluators:
  - file: ./evaluators/security-review.yaml
```

### Writing Effective Assertions

Assertions define what the AI judge should evaluate. Each assertion should:

1. **Be specific and measurable** - Clear pass/fail criteria
2. **Include scoring guidance** - How to assign scores (1 = pass, 0 = fail, 0.5 = partial)
3. **Use snake_case keys** - For consistent metric naming

**Good Examples:**
```yaml
assertions:
  tests_added: "New tests were added for the changes. Score 1 if tests exist, 0.5 if partial coverage, 0 if no tests."
  functions_documented: "All public functions have JSDoc comments. Score 1 if all documented, 0.5 if some, 0 if none."
  error_handling: "Errors are caught and handled appropriately. Score 1 if comprehensive, 0.5 if partial, 0 if none."
```

**Avoid:**
```yaml
assertions:
  # Too vague - how is "good" measured?
  code_quality: "Code quality is good"
  
  # No scoring guidance
  has_tests: "Tests exist for the code"
```

### Using Custom Instructions (`prompt`)

Add a `prompt` field to provide additional context to the AI judge:

```yaml
config:
  type: copilot-cli
  agent_name: agentic-judge
  
  prompt: |
    This is a TypeScript project using Express.js.
    Focus on async/await patterns and proper middleware usage.
    Consider the project's existing code style when evaluating.
  
  assertions:
    follows_patterns: "Code follows existing project patterns. Score 1 if consistent, 0 if not."
```

### Using External Prompt Files

For longer instructions, use a separate file:

```yaml
config:
  type: copilot-cli
  agent_name: agentic-judge
  prompt_file: ./prompts/security-review-instructions.md
  
  assertions:
    # ...
```

### Multiple Focused Judges

Break down complex evaluations into focused judges:

```yaml
evaluators:
  # Judge 1: Error Handling
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        try_catch_blocks: "Error-prone code has try-catch. Score 1 if present, 0 if missing."
        error_logging: "Errors are logged properly. Score 1 if logged, 0 if silent."
  
  # Judge 2: Documentation
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions have JSDoc. Score 1 if all, 0.5 if some, 0 if none."
        readme_updated: "README reflects changes. Score 1 if updated, 0 if outdated."
  
  # Judge 3: Testing
  - name: agentic-judge-testing
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        unit_tests: "Unit tests added. Score 1 if comprehensive, 0.5 if partial, 0 if none."
        edge_cases: "Edge cases tested. Score 1 if covered, 0 if not."
```

---

## Option 2: Code-Based Custom Evaluators

For complex evaluation logic that requires programmatic analysis, implement the `Evaluator` interface in TypeScript.

### The Evaluator Interface

```typescript
// src/evaluators/base.ts
export interface Evaluator {
  /** Unique identifier for this evaluator */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Whether this evaluator requires expected reference */
  readonly requiresExpectedReference: boolean;

  /** Check if evaluator can run in current environment */
  checkPreconditions(context: EvaluationContext): Promise<boolean>;

  /** Run the evaluation */
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}
```

### EvaluationContext

The context provides access to:

```typescript
export interface EvaluationContext {
  /** Path to modified source directory (where agent made changes) */
  modifiedDir: string;

  /** Path to expected reference directory (if configured) */
  expectedDir?: string;

  /** Path to artifacts directory where evaluator can write outputs */
  artifactsDir: string;

  /** youBencha Log from agent execution */
  agentLog: YouBenchaLog;

  /** Evaluator-specific configuration from test case config */
  config: Record<string, unknown>;

  /** Test case configuration for context (optional for eval-only mode) */
  testCaseConfig?: TestCaseConfig;
}
```

### EvaluationResult

Evaluators return:

```typescript
export interface EvaluationResult {
  /** Name of the evaluator that produced this result */
  evaluator: string;

  /** Evaluation status */
  status: 'passed' | 'failed' | 'skipped';

  /** Metrics collected during evaluation */
  metrics: Record<string, unknown>;

  /** Human-readable summary */
  message: string;

  /** Execution duration in milliseconds */
  duration_ms: number;

  /** ISO timestamp of completion */
  timestamp: string;

  /** Optional assertion values */
  assertions?: Record<string, unknown>;

  /** Optional artifacts generated */
  artifacts?: EvaluationArtifact[];

  /** Optional error details (for skipped status) */
  error?: {
    message: string;
    stack_trace?: string;
  };
}
```

### Example: Custom Complexity Evaluator

Here's a complete example of a code-based evaluator that measures code complexity:

```typescript
// src/evaluators/complexity.ts
// Note: Import paths are relative to the src/evaluators/ directory
// Use .js extensions for ES module compatibility

import { Evaluator, EvaluationContext } from './base.js';
import { EvaluationResult } from '../schemas/result.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Configuration for ComplexityEvaluator
 */
interface ComplexityConfig {
  max_cyclomatic_complexity?: number;
  max_lines_per_function?: number;
  file_patterns?: string[];  // e.g., ['**/*.ts', '**/*.js']
}

/**
 * ComplexityEvaluator measures code complexity metrics
 */
export class ComplexityEvaluator implements Evaluator {
  readonly name = 'complexity';
  readonly description = 'Measures code complexity including cyclomatic complexity and function length';
  readonly requiresExpectedReference = false;

  /**
   * Check if evaluator can run
   */
  async checkPreconditions(context: EvaluationContext): Promise<boolean> {
    try {
      await fs.access(context.modifiedDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Evaluate code complexity
   */
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const startedAt = new Date().toISOString();

    try {
      const config = context.config as ComplexityConfig;
      
      // Check preconditions
      const canRun = await this.checkPreconditions(context);
      if (!canRun) {
        return this.createSkippedResult(startedAt, 'Source directory not accessible');
      }

      // Analyze files
      const files = await this.findSourceFiles(context.modifiedDir, config.file_patterns);
      const complexityResults = await this.analyzeComplexity(files);

      // Check against thresholds
      const { status, violations } = this.evaluateThresholds(complexityResults, config);

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      return {
        evaluator: this.name,
        status,
        metrics: {
          files_analyzed: files.length,
          average_complexity: complexityResults.averageComplexity,
          max_complexity: complexityResults.maxComplexity,
          average_function_length: complexityResults.averageFunctionLength,
          violations: violations.length > 0 ? violations : undefined,
        },
        message: this.buildMessage(complexityResults, status, violations),
        duration_ms: durationMs,
        timestamp: completedAt,
        assertions: config.max_cyclomatic_complexity || config.max_lines_per_function
          ? {
              max_cyclomatic_complexity: config.max_cyclomatic_complexity,
              max_lines_per_function: config.max_lines_per_function,
            }
          : undefined,
      };
    } catch (error) {
      return this.createErrorResult(startedAt, error);
    }
  }

  /**
   * Find source files to analyze
   */
  private async findSourceFiles(dir: string, patterns?: string[]): Promise<string[]> {
    // Implementation: recursively find files matching patterns
    const files: string[] = [];
    // ... file finding logic
    return files;
  }

  /**
   * Analyze complexity of source files
   */
  private async analyzeComplexity(files: string[]): Promise<{
    averageComplexity: number;
    maxComplexity: number;
    averageFunctionLength: number;
  }> {
    // Implementation: parse files and calculate complexity
    // Could use libraries like escomplex, complexity-report, etc.
    return {
      averageComplexity: 0,
      maxComplexity: 0,
      averageFunctionLength: 0,
    };
  }

  /**
   * Evaluate against configured thresholds
   */
  private evaluateThresholds(
    results: { averageComplexity: number; maxComplexity: number; averageFunctionLength: number },
    config: ComplexityConfig
  ): { status: 'passed' | 'failed'; violations: string[] } {
    const violations: string[] = [];

    if (config.max_cyclomatic_complexity && results.maxComplexity > config.max_cyclomatic_complexity) {
      violations.push(
        `max_complexity (${results.maxComplexity}) exceeds threshold (${config.max_cyclomatic_complexity})`
      );
    }

    return {
      status: violations.length === 0 ? 'passed' : 'failed',
      violations,
    };
  }

  /**
   * Build human-readable message
   */
  private buildMessage(
    results: { averageComplexity: number; maxComplexity: number },
    status: 'passed' | 'failed',
    violations: string[]
  ): string {
    const summary = `Avg complexity: ${results.averageComplexity.toFixed(1)}, Max: ${results.maxComplexity}`;
    if (status === 'passed') {
      return `✓ ${summary}`;
    }
    return `✗ ${summary} | Violations: ${violations.join('; ')}`;
  }

  /**
   * Create skipped result
   */
  private createSkippedResult(startedAt: string, message: string): EvaluationResult {
    const completedAt = new Date().toISOString();
    return {
      evaluator: this.name,
      status: 'skipped',
      metrics: {},
      message,
      duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      timestamp: completedAt,
      error: { message },
    };
  }

  /**
   * Create error result
   */
  private createErrorResult(startedAt: string, error: unknown): EvaluationResult {
    const completedAt = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      evaluator: this.name,
      status: 'skipped',
      metrics: {},
      message: `Evaluation error: ${errorMessage}`,
      duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      timestamp: completedAt,
      error: {
        message: errorMessage,
        stack_trace: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}
```

### Registering Code-Based Evaluators

To use your custom evaluator, register it in the orchestrator:

1. **Import your evaluator** in `src/core/orchestrator.ts`:
```typescript
import { ComplexityEvaluator } from '../evaluators/complexity.js';
```

2. **Add to the `getEvaluator` method**:
```typescript
private getEvaluator(evaluatorName: string): Evaluator | null {
  switch (evaluatorName) {
    case 'git-diff':
      return new GitDiffEvaluator();
    case 'expected-diff':
      return new ExpectedDiffEvaluator();
    case 'agentic-judge':
      return new AgenticJudgeEvaluator();
    case 'complexity':  // Add your evaluator
      return new ComplexityEvaluator();
    default:
      // Support custom-named agentic-judge evaluators
      if (evaluatorName.startsWith('agentic-judge-') || evaluatorName.startsWith('agentic-judge:')) {
        return new AgenticJudgeEvaluator(evaluatorName);
      }
      return null;
  }
}
```

3. **Use in test case**:
```yaml
evaluators:
  - name: complexity
    config:
      max_cyclomatic_complexity: 10
      max_lines_per_function: 50
      file_patterns:
        - "**/*.ts"
        - "**/*.js"
```

---

## Best Practices

### For LLM-Based Evaluators

1. **Keep assertions focused** - 1-3 assertions per evaluator for clarity
2. **Use descriptive names** - `agentic-judge-security` not `agentic-judge-1`
3. **Include scoring guidance** - Tell the AI how to assign scores
4. **Be specific** - Vague assertions lead to inconsistent results
5. **Test your evaluators** - Run them on known good/bad outputs

### For Code-Based Evaluators

1. **Never throw from `evaluate()`** - Return `status: 'skipped'` for recoverable errors
2. **Use `status: 'skipped'` appropriately** - Only for recoverable issues
3. **Include meaningful metrics** - Help users understand what was measured
4. **Write comprehensive tests** - Contract tests in `tests/contract/`, unit tests in `tests/unit/`
5. **Document configuration options** - Users need to know available config

### General Best Practices

1. **Evaluators should be idempotent** - Same input = same output
2. **Evaluators run in parallel** - Don't depend on other evaluators' results
3. **Keep evaluation fast** - Long-running evaluations slow down the workflow
4. **Use artifacts for detailed output** - Save large data to files, not metrics

---

## Troubleshooting

### LLM Evaluator Returns Unexpected Results

- Check that assertions are clear and specific
- Add more context in the `prompt` field
- Verify the AI agent has access to the files it needs

### Evaluator Always Returns 'skipped'

- Check `checkPreconditions()` is returning `true`
- Verify the configuration is valid
- Check error messages in the result

### Evaluator Not Found

- Verify the evaluator name matches exactly
- For code-based: ensure it's registered in `orchestrator.ts`
- For file-based: check the file path is correct relative to test case

---

## See Also

- [Reusable Evaluators Guide](./reusable-evaluators.md) - Sharing evaluator configurations
- [Multiple Agentic Judges Guide](./multiple-agentic-judges.md) - Using multiple focused evaluators
- [Prompt Files Guide](./prompt-files.md) - Loading prompts from external files
- [Eval Command Guide](./eval-command.md) - Running evaluators without agent execution
