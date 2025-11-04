# API Contracts: youBencha Framework MVP

**Date**: 2025-11-03  
**Feature**: 001-youBencha-framework  
**Purpose**: Define interfaces and contracts for adapters, evaluators, and core components

---

## Overview

youBencha is a CLI tool, not a REST/GraphQL API. However, it has internal programmatic interfaces (contracts) that ensure modularity and pluggability. This document defines those contracts using TypeScript interfaces.

---

## 1. AgentAdapter Interface

**Purpose**: Standardize how youBencha interacts with different coding agents

**Contract**:

```typescript
/**
 * AgentAdapter interface for integrating coding agents with youBencha
 * 
 * Each agent (GitHub Copilot CLI, Claude Code, etc.) implements this interface
 * to enable evaluation within youBencha framework.
 */
interface AgentAdapter {
  /**
   * Unique identifier for this adapter
   * Example: 'copilot-cli', 'claude-code', 'aider'
   */
  readonly name: string;
  
  /**
   * Adapter version (semver)
   * Example: '1.0.0'
   */
  readonly version: string;
  
  /**
   * Check if the agent is installed and accessible
   * Should verify CLI availability, authentication, etc.
   * 
   * @returns Promise resolving to true if agent is ready, false otherwise
   * @throws Error with descriptive message if agent cannot be used
   */
  checkAvailability(): Promise<boolean>;
  
  /**
   * Execute the agent with the given configuration
   * 
   * @param context - Execution context with workspace and configuration
   * @returns Promise resolving to execution result with logs
   * @throws Error if execution fails fatally
   */
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  
  /**
   * Transform agent-specific output to youBencha Log format
   * 
   * @param rawOutput - Raw stdout/stderr from agent
   * @param result - Execution result metadata
   * @returns youBencha Log object conforming to schema
   */
  normalizeLog(
    rawOutput: string,
    result: AgentExecutionResult
  ): YouBenchaLog;
}

/**
 * Context provided to agent adapter for execution
 */
interface AgentExecutionContext {
  /** Path to workspace directory where agent should operate */
  workspaceDir: string;
  
  /** Path to the cloned repository (src-modified/) */
  repoDir: string;
  
  /** Agent-specific configuration from suite config */
  config: Record<string, any>;
  
  /** Timeout in milliseconds (0 = no timeout) */
  timeout: number;
  
  /** Environment variables to pass to agent */
  env: Record<string, string>;
}

/**
 * Result of agent execution
 */
interface AgentExecutionResult {
  /** Exit code from agent process */
  exitCode: number;
  
  /** Execution status */
  status: 'success' | 'failed' | 'timeout';
  
  /** Combined stdout and stderr */
  output: string;
  
  /** Execution start timestamp (ISO 8601) */
  startedAt: string;
  
  /** Execution completion timestamp (ISO 8601) */
  completedAt: string;
  
  /** Duration in milliseconds */
  durationMs: number;
  
  /** Any errors encountered */
  errors: Array<{
    message: string;
    timestamp: string;
    stackTrace?: string;
  }>;
}
```

**Contract Tests**:

```typescript
describe('AgentAdapter Contract', () => {
  let adapter: AgentAdapter;
  
  beforeEach(() => {
    adapter = new CopilotCLIAdapter(); // or any adapter implementation
  });
  
  test('has name property', () => {
    expect(adapter.name).toBeDefined();
    expect(typeof adapter.name).toBe('string');
  });
  
  test('has version property', () => {
    expect(adapter.version).toBeDefined();
    expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/); // semver
  });
  
  test('checkAvailability returns boolean', async () => {
    const result = await adapter.checkAvailability();
    expect(typeof result).toBe('boolean');
  });
  
  test('execute returns valid AgentExecutionResult', async () => {
    const context: AgentExecutionContext = {
      workspaceDir: '/tmp/test-workspace',
      repoDir: '/tmp/test-workspace/src-modified',
      config: {},
      timeout: 60000,
      env: {}
    };
    
    const result = await adapter.execute(context);
    
    expect(result.exitCode).toBeDefined();
    expect(result.status).toMatch(/^(success|failed|timeout)$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(result.completedAt).getTime()
    );
  });
  
  test('normalizeLog produces valid youBencha Log', () => {
    const mockResult: AgentExecutionResult = {
      exitCode: 0,
      status: 'success',
      output: 'agent output...',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      errors: []
    };
    
    const YouBenchaLog = adapter.normalizeLog('raw output', mockResult);
    
    expect(YouBenchaLog.version).toBe('1.0.0');
    expect(YouBenchaLog.agent).toBeDefined();
    expect(YouBenchaLog.execution).toBeDefined();
    expect(YouBenchaLog.environment).toBeDefined();
  });
});
```

---

## 2. Evaluator Interface

**Purpose**: Standardize how youBencha runs evaluators on agent outputs

**Contract**:

```typescript
/**
 * Evaluator interface for analyzing agent outputs
 * 
 * Each evaluator (git-diff, expected-diff, agentic-judge, etc.) implements
 * this interface to enable pluggable evaluation.
 */
interface Evaluator {
  /**
   * Unique identifier for this evaluator
   * Example: 'git-diff', 'expected-diff', 'agentic-judge'
   */
  readonly name: string;
  
  /**
   * Human-readable description
   */
  readonly description: string;
  
  /**
   * Whether this evaluator requires expected reference
   * If true, will be skipped if no expected reference configured
   */
  readonly requiresExpectedReference: boolean;
  
  /**
   * Check if evaluator can run in current environment
   * Example: checking for required tools, API keys, etc.
   * 
   * @returns Promise resolving to true if evaluator can run
   */
  checkPreconditions(context: EvaluationContext): Promise<boolean>;
  
  /**
   * Run the evaluation
   * 
   * @param context - Evaluation context with workspace paths and config
   * @returns Promise resolving to evaluation result
   * @throws Error only for fatal errors; use EvaluationResult.status='skipped' for recoverable issues
   */
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}

/**
 * Context provided to evaluator for evaluation
 */
interface EvaluationContext {
  /** Path to modified source directory (where agent made changes) */
  modifiedDir: string;
  
  /** Path to expected reference directory (if configured) */
  expectedDir?: string;
  
  /** Path to artifacts directory where evaluator can write outputs */
  artifactsDir: string;
  
  /** youBencha Log from agent execution */
  YouBenchaLog: YouBenchaLog;
  
  /** Evaluator-specific configuration from suite config */
  config: Record<string, any>;
  
  /** Suite configuration for context */
  suiteConfig: SuiteConfiguration;
}

/**
 * Configuration for agentic-judge evaluator
 * 
 * This evaluator uses the agent adapter system (same as main agent execution)
 * to perform agentic code evaluation with tool use and iterative reasoning.
 */
interface AgenticJudgeConfig {
  /** Agent configuration - uses AgentAdapter interface */
  agent: {
    /** Agent type (e.g., 'copilot-cli') */
    type: string;
    
    /** Agent-specific configuration */
    config: {
      /** Tools available to the judge agent */
      tools?: string[];
      
      /** System prompt with evaluation instructions
       * MUST include:
       * - Evaluation criteria
       * - Instructions to output EvaluationResult JSON
       * - Available workspace paths (src-modified/, src-expected/)
       */
      system_prompt: string;
      
      /** Additional agent-specific settings */
      [key: string]: any;
    };
  };
  
  /** Natural language evaluation criteria (included in system prompt) */
  evaluation_criteria: string[];
  
  /** Maximum time for agent execution (seconds) */
  timeout?: number;
}

/**
 * Example agentic-judge configuration:
 * 
 * {
 *   agent: {
 *     type: 'copilot-cli',
 *     config: {
 *       tools: ['read', 'search', 'analyze'],
 *       system_prompt: `
 *         You are a code quality evaluator. Review modified code for:
 *         1. Error handling completeness
 *         2. Test coverage (≥80%)
 *         3. Documentation quality
 *         
 *         Use tools to read files, search patterns, analyze coverage.
 *         
 *         Output JSON conforming to EvaluationResult:
 *         {
 *           "status": "passed" | "failed",
 *           "metrics": {
 *             "error_handling_score": 0.0-1.0,
 *             "test_coverage_percent": 0-100,
 *             "documented_apis_percent": 0-100
 *           },
 *           "message": "Summary of findings"
 *         }
 *       `
 *     }
 *   },
 *   evaluation_criteria: [
 *     "All functions have proper error handling",
 *     "Test coverage ≥80%",
 *     "All public APIs documented"
 *   ]
 * }
 */

/**
 * Result from evaluator execution
 */
interface EvaluationResult {
  /** Evaluator name */
  evaluator: string;
  
  /** Evaluation status */
  status: 'passed' | 'failed' | 'skipped';
  
  /** Evaluator-specific metrics */
  metrics: Record<string, any>;
  
  /** Human-readable message explaining result */
  message: string;
  
  /** Duration in milliseconds */
  durationMs: number;
  
  /** Timestamp when evaluation completed (ISO 8601) */
  timestamp: string;
  
  /** Optional artifacts produced by evaluator */
  artifacts?: Array<{
    type: string;
    path: string; // relative to artifacts directory
    description: string;
  }>;
  
  /** Error details if status = 'skipped' */
  error?: {
    message: string;
    stackTrace?: string;
  };
}
```

**Contract Tests**:

```typescript
describe('Evaluator Contract', () => {
  let evaluator: Evaluator;
  
  beforeEach(() => {
    evaluator = new GitDiffEvaluator(); // or any evaluator implementation
  });
  
  test('has name property', () => {
    expect(evaluator.name).toBeDefined();
    expect(typeof evaluator.name).toBe('string');
  });
  
  test('has description property', () => {
    expect(evaluator.description).toBeDefined();
    expect(typeof evaluator.description).toBe('string');
  });
  
  test('has requiresExpectedReference property', () => {
    expect(typeof evaluator.requiresExpectedReference).toBe('boolean');
  });
  
  test('checkPreconditions returns boolean', async () => {
    const context: EvaluationContext = {
      modifiedDir: '/tmp/src-modified',
      artifactsDir: '/tmp/artifacts',
      YouBenchaLog: {} as YouBenchaLog,
      config: {},
      suiteConfig: {} as SuiteConfiguration
    };
    
    const result = await evaluator.checkPreconditions(context);
    expect(typeof result).toBe('boolean');
  });
  
  test('evaluate returns valid EvaluationResult', async () => {
    const context: EvaluationContext = {
      modifiedDir: '/tmp/src-modified',
      artifactsDir: '/tmp/artifacts',
      YouBenchaLog: {} as YouBenchaLog,
      config: {},
      suiteConfig: {} as SuiteConfiguration
    };
    
    const result = await evaluator.evaluate(context);
    
    expect(result.evaluator).toBe(evaluator.name);
    expect(result.status).toMatch(/^(passed|failed|skipped)$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.message).toBe('string');
    expect(typeof result.metrics).toBe('object');
    
    if (result.status === 'skipped') {
      expect(result.error).toBeDefined();
    }
  });
  
  test('skips gracefully when expected reference required but not provided', async () => {
    if (!evaluator.requiresExpectedReference) {
      return; // test not applicable
    }
    
    const context: EvaluationContext = {
      modifiedDir: '/tmp/src-modified',
      // expectedDir intentionally omitted
      artifactsDir: '/tmp/artifacts',
      YouBenchaLog: {} as YouBenchaLog,
      config: {},
      suiteConfig: {} as SuiteConfiguration
    };
    
    const result = await evaluator.evaluate(context);
    expect(result.status).toBe('skipped');
    expect(result.error).toBeDefined();
  });
});
```

---

## 3. Reporter Interface

**Purpose**: Standardize how youBencha generates reports from results

**Contract**:

```typescript
/**
 * Reporter interface for generating evaluation reports
 * 
 * Each reporter (JSON, Markdown, HTML, etc.) implements this interface
 * to transform ResultsBundle into desired format.
 */
interface Reporter {
  /**
   * Unique identifier for this reporter
   * Example: 'json', 'markdown', 'html'
   */
  readonly name: string;
  
  /**
   * File extension for generated report
   * Example: '.json', '.md', '.html'
   */
  readonly extension: string;
  
  /**
   * Generate report from results bundle
   * 
   * @param bundle - Complete evaluation results
   * @param options - Reporter-specific options
   * @returns Promise resolving to report content as string
   */
  generate(
    bundle: ResultsBundle,
    options?: Record<string, any>
  ): Promise<string>;
  
  /**
   * Write report to file
   * 
   * @param bundle - Complete evaluation results
   * @param outputPath - Path where report should be written
   * @param options - Reporter-specific options
   */
  writeToFile(
    bundle: ResultsBundle,
    outputPath: string,
    options?: Record<string, any>
  ): Promise<void>;
}
```

---

## 4. Orchestrator Contract

**Purpose**: Define how core orchestrator coordinates evaluation flow

**Contract**:

```typescript
/**
 * Orchestrator coordinates the entire evaluation workflow
 */
interface Orchestrator {
  /**
   * Run complete evaluation from suite configuration
   * 
   * @param suiteConfig - Evaluation specification
   * @returns Promise resolving to results bundle
   */
  runEvaluation(suiteConfig: SuiteConfiguration): Promise<ResultsBundle>;
  
  /**
   * Generate report from existing results
   * 
   * @param resultsPath - Path to results JSON file
   * @param format - Report format ('json' | 'markdown')
   * @returns Promise resolving to report file path
   */
  generateReport(
    resultsPath: string,
    format: 'json' | 'markdown'
  ): Promise<string>;
  
  /**
   * Suggest evaluators based on branch analysis
   * 
   * @param sourceBranch - Source branch name
   * @param expectedBranch - Expected/ideal branch name
   * @param repoPath - Path to repository
   * @returns Promise resolving to suggested suite config
   */
  suggestEvaluators(
    sourceBranch: string,
    expectedBranch: string,
    repoPath: string
  ): Promise<string>; // YAML suite config
}
```

---

## 5. Workspace Manager Contract

**Purpose**: Define workspace lifecycle management

**Contract**:

```typescript
/**
 * WorkspaceManager handles isolated evaluation workspaces
 */
interface WorkspaceManager {
  /**
   * Create new workspace for evaluation run
   * 
   * @param runId - Unique run identifier
   * @returns Promise resolving to workspace paths
   */
  createWorkspace(runId: string): Promise<Workspace>;
  
  /**
   * Clone repository into workspace
   * 
   * @param workspace - Workspace to clone into
   * @param repoUrl - Git repository URL
   * @param branch - Branch to clone
   * @param targetDir - Target directory (src-modified or src-expected)
   * @returns Promise resolving to commit SHA
   */
  cloneRepository(
    workspace: Workspace,
    repoUrl: string,
    branch: string,
    targetDir: 'src-modified' | 'src-expected'
  ): Promise<string>;
  
  /**
   * Clean up workspace (delete directories)
   * 
   * @param workspace - Workspace to clean up
   */
  cleanup(workspace: Workspace): Promise<void>;
  
  /**
   * Check if workspace is locked (evaluation in progress)
   * 
   * @param workspace - Workspace to check
   * @returns True if locked
   */
  isLocked(workspace: Workspace): boolean;
  
  /**
   * Acquire lock for workspace
   * 
   * @param workspace - Workspace to lock
   * @throws Error if already locked
   */
  acquireLock(workspace: Workspace): Promise<void>;
  
  /**
   * Release lock for workspace
   * 
   * @param workspace - Workspace to unlock
   */
  releaseLock(workspace: Workspace): Promise<void>;
}
```

---

## 6. Branch Analyzer Contract

**Purpose**: Define branch comparison analysis

**Contract**:

```typescript
/**
 * BranchAnalyzer compares two branches and detects patterns
 */
interface BranchAnalyzer {
  /**
   * Analyze differences between two branches
   * 
   * @param repoPath - Path to repository
   * @param sourceBranch - Source branch name
   * @param targetBranch - Target branch name
   * @returns Promise resolving to analysis results
   */
  analyze(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string
  ): Promise<BranchAnalysis>;
  
  /**
   * Detect file type distribution
   * 
   * @param files - Array of file paths
   * @returns Map of extension to count
   */
  detectFileTypes(files: string[]): Record<string, number>;
  
  /**
   * Detect change patterns (tests, config, docs, etc.)
   * 
   * @param analysis - Branch analysis
   * @returns Detected patterns
   */
  detectPatterns(analysis: BranchAnalysis): BranchAnalysis['patterns'];
}
```

---

## 7. Evaluator Suggester Contract

**Purpose**: Define evaluator recommendation logic

**Contract**:

```typescript
/**
 * EvaluatorSuggester recommends evaluators based on branch analysis
 */
interface EvaluatorSuggester {
  /**
   * Suggest evaluators for given branch analysis
   * 
   * @param analysis - Branch analysis results
   * @param availableEvaluators - List of evaluator names available
   * @returns Promise resolving to suggestions
   */
  suggest(
    analysis: BranchAnalysis,
    availableEvaluators: string[]
  ): Promise<EvaluatorSuggestion[]>;
  
  /**
   * Generate suite configuration YAML from suggestions
   * 
   * @param repoUrl - Repository URL
   * @param sourceBranch - Source branch
   * @param expectedBranch - Expected branch
   * @param suggestions - Evaluator suggestions
   * @returns YAML suite configuration
   */
  generateSuiteTemplate(
    repoUrl: string,
    sourceBranch: string,
    expectedBranch: string,
    suggestions: EvaluatorSuggestion[]
  ): string;
}
```

---

## Contract Testing Strategy

### Test Levels

1. **Unit Tests**: Test individual implementations of interfaces
2. **Contract Tests**: Verify implementations conform to interface contracts
3. **Integration Tests**: Test interaction between components via interfaces

### Coverage Requirements

- All interface methods MUST have contract tests
- Contract tests MUST verify return types, error handling, and side effects
- Implementations MUST pass all contract tests before merge

### Example Test Structure

```typescript
// tests/contract/adapter.test.ts
describe('AgentAdapter Contract Tests', () => {
  const adapters = [
    new CopilotCLIAdapter(),
    // Add new adapters here as implemented
  ];
  
  adapters.forEach(adapter => {
    describe(`${adapter.name} Adapter`, () => {
      // Contract tests here (see examples above)
    });
  });
});
```

---

## Version Compatibility

### Interface Versioning

- Interfaces follow semantic versioning
- Breaking changes increment major version
- New optional methods/properties increment minor version
- Implementation must declare which interface version it implements

### Forward Compatibility

- New adapters/evaluators can be added without modifying core
- Core orchestrator uses plugin discovery pattern
- Versioned schemas (youBencha Log, Results Bundle) allow evolution

---

## Implementation Checklist

- [ ] Define TypeScript interfaces in `src/adapters/base.ts`
- [ ] Define TypeScript interfaces in `src/evaluators/base.ts`
- [ ] Define TypeScript interfaces in `src/reporters/base.ts`
- [ ] Write contract tests in `tests/contract/`
- [ ] Implement CopilotCLIAdapter conforming to AgentAdapter
- [ ] Implement GitDiffEvaluator conforming to Evaluator
- [ ] Implement ExpectedDiffEvaluator conforming to Evaluator
- [ ] Implement AgenticJudgeEvaluator conforming to Evaluator
- [ ] Implement JSONReporter conforming to Reporter
- [ ] Implement MarkdownReporter conforming to Reporter
- [ ] Verify all implementations pass contract tests

