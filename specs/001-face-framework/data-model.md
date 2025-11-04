# Data Model: youBencha Framework MVP

**Date**: 2025-11-03  
**Feature**: 001-youBencha-framework  
**Purpose**: Define core entities, their attributes, relationships, and validation rules

---

## Entity Overview

| Entity | Purpose | Storage |
|--------|---------|---------|
| SuiteConfiguration | Evaluation specification (repo, agent, evaluators, expected ref) | User-provided YAML/JSON file |
| youBenchaLog | Normalized agent execution log | Generated JSON artifact |
| EvaluationResult | Output from a single evaluator | Part of Results Bundle JSON |
| ResultsBundle | Aggregated evaluation output | Generated JSON file |
| Workspace | Isolated directory structure for evaluation | Filesystem |
| ExpectedReference | Comparison baseline configuration | Part of SuiteConfiguration |
| BranchAnalysis | Diff analysis between two branches | Generated for suggest-eval |
| EvaluatorSuggestion | Recommended evaluator with criteria | Generated suite template |

---

## 1. SuiteConfiguration

**Purpose**: User-provided specification for what to evaluate and how

**Attributes**:

```typescript
{
  // Repository Configuration
  repo: string;                    // Git URL (https:// or ssh://)
  branch?: string;                 // Branch to evaluate (default: main/master)
  commit?: string;                 // Specific commit SHA (optional)
  
  // Agent Configuration
  agent: {
    type: 'copilot-cli';           // Agent adapter to use (MVP: only copilot-cli)
    config?: Record<string, any>;  // Agent-specific configuration (passed to adapter)
  };
  
  // Expected Reference (optional)
  expected_source?: 'branch';      // MVP: only 'branch' supported
  expected?: string;               // Branch name when expected_source = 'branch'
  
  // Evaluators Configuration
  evaluators: Array<{
    name: string;                  // Evaluator name (git-diff, expected-diff, agentic-judge)
    config?: Record<string, any>;  // Evaluator-specific configuration
    // For agentic-judge evaluator:
    // {
    //   agent: {
    //     type: 'copilot-cli',       // Agent adapter to use for evaluation
    //     config: {
    //       tools: ['read', 'search', 'analyze'],  // Tools available to agent
    //       system_prompt: string    // Evaluation instructions for agent
    //     }
    //   },
    //   evaluation_criteria: string[]  // Specific criteria to evaluate
    // }
  }>;
  
  // Execution Configuration (optional)
  workspace_dir?: string;          // Custom workspace directory (default: .youbencha-workspace)
  timeout?: number;                // Max execution time in seconds (default: 1800)
}
```

**Example Configuration with Agentic Judge**:

```yaml
repo: https://github.com/example/my-project
branch: main
expected_source: branch
expected: feature/ai-completed

agent:
  type: copilot-cli

evaluators:
  - name: git-diff
  
  - name: expected-diff
    config:
      threshold: 0.85
  
  - name: agentic-judge
    config:
      agent:
        type: copilot-cli            # Same agent system as main evaluation
        config:
          tools:
            - read                   # Read file contents
            - search                 # Search for patterns
            - analyze                # Analyze code complexity
          system_prompt: |
            You are evaluating code quality. Review the modified code in src-modified/
            and compare with expected reference in src-expected/.
            
            Evaluate the following criteria:
            1. Error handling: All functions have proper try-catch or error returns
            2. Test coverage: ≥80% of modified code has corresponding tests
            3. Documentation: All public APIs have JSDoc comments
            
            Use your tools to:
            - Read relevant source files
            - Search for error handling patterns
            - Analyze test coverage
            
            Output your evaluation as JSON:
            {
              "status": "passed" | "failed" | "skipped",
              "metrics": {
                "error_handling_score": 0.0-1.0,
                "test_coverage_percent": 0-100,
                "documented_apis_percent": 0-100
              },
              "message": "Summary of findings",
              "artifacts": ["detailed-report.md"]
            }
      evaluation_criteria:
        - "All modified functions have proper error handling"
        - "Test coverage ≥80%"
        - "All public APIs documented with JSDoc"
```

**Validation Rules**:
- `repo` MUST be a valid Git URL
- `agent.type` MUST be 'copilot-cli' in MVP
- `evaluators` MUST contain at least one evaluator
- If `expected_source` is provided, `expected` MUST also be provided
- `expected_source` MUST be 'branch' in MVP (dataset/path support post-MVP)
- Evaluator names MUST match available evaluators (git-diff, expected-diff, agentic-judge)
- For agentic-judge evaluator: `config.agent.type` MUST be a valid agent adapter (MVP: 'copilot-cli')
- For agentic-judge evaluator: `config.agent.config.system_prompt` MUST include instructions to output EvaluationResult JSON

**Relationships**:
- References Evaluator configurations (1:many)
- References ExpectedReference configuration (1:0..1)
- Used by Orchestrator to create Workspace and execute evaluation

---

## 2. FACELog

**Purpose**: Normalized agent execution log in standard format

**Attributes**:

```typescript
{
  version: '1.0.0';                // youBencha Log schema version
  
  // Agent Metadata
  agent: {
    name: string;                  // Agent name (e.g., 'GitHub Copilot CLI')
    version: string;               // Agent version
    adapter_version: string;       // youBencha adapter version
  };
  
  // Model Information
  model: {
    name: string;                  // Model name (e.g., 'gpt-4', 'claude-3-opus')
    provider: string;              // Provider (e.g., 'OpenAI', 'Anthropic')
    parameters: {
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      [key: string]: any;          // Model-specific parameters
    };
  };
  
  // Execution Metadata
  execution: {
    started_at: string;            // ISO 8601 timestamp
    completed_at: string;          // ISO 8601 timestamp
    duration_ms: number;           // Total execution time
    exit_code: number;             // Agent exit code (0 = success)
    status: 'success' | 'failed' | 'timeout';
  };
  
  // Messages & Interactions
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: string;             // ISO 8601 timestamp
    tool_calls?: Array<{           // If role = assistant and used tools
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;         // JSON string
      };
    }>;
    tool_call_id?: string;         // If role = tool
  }>;
  
  // Resource Usage
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd?: number;   // Optional cost estimation
  };
  
  // Errors (if any)
  errors: Array<{
    message: string;
    timestamp: string;
    stack_trace?: string;
  }>;
  
  // Environment Context
  environment: {
    os: string;                    // Operating system
    node_version: string;          // Node.js version
    youbencha_version: string;          // youBencha CLI version
    working_directory: string;     // Workspace path
  };
}
```

**Validation Rules**:
- `version` MUST be '1.0.0' for MVP
- `execution.started_at` MUST be before `execution.completed_at`
- `execution.duration_ms` MUST match time difference between started_at and completed_at
- `usage.total_tokens` MUST equal `prompt_tokens + completion_tokens`
- All timestamps MUST be valid ISO 8601 format

**Relationships**:
- Produced by AgentAdapter (1:1)
- Referenced by ResultsBundle (1:1)
- Input to log-based evaluators

---

## 3. EvaluationResult

**Purpose**: Output from a single evaluator run

**Attributes**:

```typescript
{
  evaluator: string;               // Evaluator name
  status: 'passed' | 'failed' | 'skipped';
  
  // Metrics (evaluator-specific)
  metrics: Record<string, any>;    // e.g., { files_changed: 5, similarity: 0.85 }
  
  // Human-readable message
  message: string;                 // e.g., "Expected-diff: 85% similar to reference branch"
  
  // Execution details
  duration_ms: number;             // Evaluator execution time
  timestamp: string;               // ISO 8601 timestamp
  
  // Artifacts (optional)
  artifacts?: Array<{
    type: string;                  // e.g., 'diff-patch', 'report-html'
    path: string;                  // Relative path in artifacts directory
    description: string;
  }>;
  
  // Error details (if status = skipped)
  error?: {
    message: string;
    stack_trace?: string;
  };
}
```

**Validation Rules**:
- `evaluator` MUST match an evaluator from SuiteConfiguration
- If `status` = 'skipped', `error` MUST be provided
- `metrics` structure varies by evaluator but MUST be JSON-serializable
- `duration_ms` MUST be positive integer
- `timestamp` MUST be valid ISO 8601 format

**Relationships**:
- Produced by Evaluator (1:1)
- Aggregated in ResultsBundle (many:1)

---

## 4. ResultsBundle

**Purpose**: Complete evaluation output with all results and metadata

**Attributes**:

```typescript
{
  version: '1.0.0';                // Results bundle schema version
  
  // Suite Metadata
  suite: {
    config_file: string;           // Path to suite configuration
    config_hash: string;           // SHA-256 hash of configuration
    repo: string;                  // Repository URL
    branch: string;                // Evaluated branch
    commit: string;                // Evaluated commit SHA
    expected_branch?: string;      // Expected reference branch (if used)
  };
  
  // Execution Metadata
  execution: {
    started_at: string;            // ISO 8601 timestamp
    completed_at: string;          // ISO 8601 timestamp
    duration_ms: number;           // Total evaluation time
    youbencha_version: string;          // youBencha CLI version
    environment: {
      os: string;
      node_version: string;
      workspace_dir: string;
    };
  };
  
  // Agent Execution
  agent: {
    type: string;                  // Agent adapter used
    youbencha_log_path: string;         // Path to youBencha Log JSON
    status: 'success' | 'failed' | 'timeout';
    exit_code: number;
  };
  
  // Evaluator Results
  evaluators: EvaluationResult[];  // Array of evaluation results
  
  // Summary Statistics
  summary: {
    total_evaluators: number;
    passed: number;
    failed: number;
    skipped: number;
    overall_status: 'passed' | 'failed' | 'partial';
  };
  
  // Artifacts Manifest
  artifacts: {
    face_log: string;              // Path to youBencha Log
    reports: string[];             // Paths to generated reports
    evaluator_artifacts: string[]; // Paths to evaluator outputs
  };
}
```

**Validation Rules**:
- `version` MUST be '1.0.0' for MVP
- `summary.total_evaluators` MUST equal length of `evaluators` array
- `summary.passed + failed + skipped` MUST equal `total_evaluators`
- `overall_status` = 'passed' if all evaluators passed
- `overall_status` = 'failed' if any evaluator failed
- `overall_status` = 'partial' if some skipped but none failed

**Relationships**:
- References youBenchaLog (1:1)
- Contains EvaluationResults (1:many)
- Input to Reporters (1:many)

---

## 5. Workspace

**Purpose**: Isolated directory structure for evaluation execution

**Structure**:

```
.youbencha-workspace/
├── run-<timestamp>/           # One directory per evaluation run
│   ├── src-modified/          # Cloned repo where agent modifies code
│   ├── src-expected/          # Expected reference branch (if configured)
│   ├── artifacts/
│   │   ├── youBencha.log.json      # youBencha Log
│   │   ├── results.json       # Results Bundle
│   │   ├── report.md          # Markdown report
│   │   └── evaluators/        # Evaluator-specific artifacts
│   │       ├── git-diff.patch
│   │       └── expected-diff.html
│   └── .lock                  # Lockfile to prevent concurrent runs
```

**Attributes**:

```typescript
{
  root_dir: string;              // Workspace root (.youbencha-workspace/)
  run_id: string;                // Unique run identifier (timestamp-based)
  src_modified_dir: string;      // Path to src-modified/
  src_expected_dir?: string;     // Path to src-expected/ (if expected ref used)
  artifacts_dir: string;         // Path to artifacts/
  lock_file: string;             // Path to .lock file
}
```

**Lifecycle**:
1. **Create**: Workspace created at evaluation start
2. **Clone**: Repository cloned into `src-modified/` and optionally `src-expected/`
3. **Execute**: Agent runs with `src-modified/` as working directory
4. **Evaluate**: Evaluators read from workspace directories
5. **Store**: Artifacts written to `artifacts/` directory
6. **Cleanup**: Workspace retained by default (user can delete manually or via CLI)

**Validation Rules**:
- Workspace directory MUST be writable
- Lockfile MUST prevent concurrent evaluations in same workspace
- `src-modified/` MUST exist before agent execution
- If expected reference configured, `src-expected/` MUST exist before expected-diff evaluator runs

---

## 6. ExpectedReference

**Purpose**: Configuration for comparison baseline

**Attributes**:

```typescript
{
  source: 'branch';                // MVP: only 'branch' supported
  value: string;                   // Branch name
  resolved_commit?: string;        // Commit SHA after resolution
}
```

**Resolution Process**:
1. User specifies `expected_source: 'branch'` and `expected: 'feature/ai-completed'` in suite config
2. During workspace setup, youBencha clones the specified branch into `src-expected/`
3. Records the commit SHA of the cloned branch in ExpectedReference
4. Evaluators that support comparison receive both `src-modified/` and `src-expected/` paths

**Validation Rules**:
- `source` MUST be 'branch' in MVP
- `value` MUST be a valid Git branch name
- Branch MUST exist in the repository (fail fast if not found)

---

## 7. BranchAnalysis

**Purpose**: Output from branch analyzer for evaluator suggestions

**Attributes**:

```typescript
{
  source_branch: string;
  expected_branch: string;
  
  // File-level changes
  files: {
    added: string[];               // List of added file paths
    modified: string[];            // List of modified file paths
    deleted: string[];             // List of deleted file paths
    renamed: Array<{
      from: string;
      to: string;
    }>;
  };
  
  // Line-level changes
  lines: {
    added: number;
    removed: number;
    total_changed: number;
  };
  
  // File type distribution
  file_types: Record<string, number>;  // e.g., { '.ts': 12, '.md': 3 }
  
  // Detected patterns
  patterns: {
    tests_added: boolean;
    tests_modified: boolean;
    config_changed: boolean;
    dependencies_updated: boolean;
    docs_added: boolean;
    docs_modified: boolean;
  };
  
  // Change density
  density: {
    files_changed_ratio: number;   // changed files / total files
    lines_changed_ratio: number;   // changed lines / total lines
  };
}
```

**Validation Rules**:
- `source_branch` and `expected_branch` MUST be valid branch names
- All file paths MUST be relative to repository root
- `lines.total_changed` MUST equal `lines.added + lines.removed`
- Ratios MUST be between 0.0 and 1.0

**Relationships**:
- Input to EvaluatorSuggester (1:1)
- Generated by BranchAnalyzer (1:1)

---

## 8. EvaluatorSuggestion

**Purpose**: Recommended evaluator with configuration for suite template

**Attributes**:

```typescript
{
  evaluator: string;               // Evaluator name
  reason: string;                  // Why this evaluator is suggested
  config: Record<string, any>;     // Suggested configuration
  priority: number;                // 1 = highest priority
}
```

**Example Suggestions**:

```typescript
[
  {
    evaluator: 'expected-diff',
    reason: 'Code files modified - compare against expected reference',
    config: { threshold: 0.85, ignore_patterns: ['*.lock', 'dist/'] },
    priority: 1
  },
  {
    evaluator: 'git-diff',
    reason: 'Track structural changes (files added/removed/modified)',
    config: {},
    priority: 2
  },
  {
    evaluator: 'agentic-judge',
    reason: 'Documentation added - assess completeness and clarity',
    config: { 
      criteria: 'Evaluate documentation completeness and clarity',
      model: 'gpt-4'
    },
    priority: 3
  }
]
```

**Relationships**:
- Generated by EvaluatorSuggester (many:1 BranchAnalysis)
- Used to populate suite template YAML

---

## State Transitions

### Evaluation Run Lifecycle

```
IDLE
  ↓ [youBencha run command]
WORKSPACE_SETUP (create dirs, clone repos)
  ↓
AGENT_EXECUTION (run agent adapter)
  ↓
LOG_NORMALIZATION (transform to youBencha Log)
  ↓
EVALUATOR_EXECUTION (run evaluators in parallel)
  ↓
RESULT_AGGREGATION (create results bundle)
  ↓
ARTIFACT_STORAGE (write JSON, generate reports)
  ↓
COMPLETE (exit with status code)
```

### Evaluator State Machine

```
PENDING
  ↓ [orchestrator starts evaluation]
RUNNING
  ↓ [success]           ↓ [failure]         ↓ [error]
PASSED              FAILED              SKIPPED
  ↓                     ↓                   ↓
RESULTS AGGREGATED
```

---

## Validation Summary

| Entity | Validation Layer | Validator |
|--------|-----------------|-----------|
| SuiteConfiguration | Parse-time | Zod schema in `suite.schema.ts` |
| youBenchaLog | Generation-time | Zod schema in `youbencha.schema.ts` |
| EvaluationResult | Generation-time | Zod schema in `result.schema.ts` |
| ResultsBundle | Aggregation-time | Zod schema in `result.schema.ts` |
| Workspace | Setup-time | File system checks in `workspace.ts` |
| ExpectedReference | Clone-time | Git validation in `workspace.ts` |
| BranchAnalysis | Generation-time | Type checking (TypeScript) |
| EvaluatorSuggestion | Generation-time | Type checking (TypeScript) |

---

## Implementation Notes

- All timestamps use ISO 8601 format: `YYYY-MM-DDTHH:mm:ss.sssZ`
- All file paths stored relative to workspace root for portability
- All schemas versioned (`version` field) for backward compatibility
- All monetary values (cost) in USD with 4 decimal precision
- All ratios/percentages stored as decimals (0.0-1.0) not integers (0-100)

