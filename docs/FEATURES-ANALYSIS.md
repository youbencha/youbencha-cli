# youBencha Features & Functionality Analysis

A comprehensive analysis of youBencha's features, architecture, and capabilities for evaluating AI-powered coding agents.

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [CLI Commands](#cli-commands)
4. [Agent Adapters](#agent-adapters)
5. [Evaluators](#evaluators)
6. [Pre-Execution Hooks](#pre-execution-hooks)
7. [Post-Evaluation Hooks](#post-evaluation-hooks)
8. [Configuration System](#configuration-system)
9. [Workspace Management](#workspace-management)
10. [Reporting System](#reporting-system)
11. [Security Features](#security-features)
12. [Extensibility](#extensibility)

---

## Overview

**youBencha** is a Node.js-based CLI framework for evaluating and benchmarking AI-powered coding agents. It provides:

- **Agent-Agnostic Architecture**: Test any coding agent through pluggable adapters
- **Flexible Evaluation Pipeline**: Run built-in or custom evaluators on agent outputs
- **Reproducible Results**: Standardized logging (youBencha Log) and comprehensive result bundles
- **Developer-Friendly CLI**: Simple commands with detailed feedback and reporting

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **Run Evaluations** | Execute agents on repositories and evaluate their changes |
| **Eval-Only Mode** | Evaluate existing code without agent execution |
| **Multiple Evaluators** | Run git-diff, expected-diff, and agentic-judge evaluators in parallel |
| **Pre/Post Hooks** | Execute scripts before/after evaluation |
| **Comprehensive Reporting** | Generate JSON and Markdown reports |
| **Workspace Isolation** | All operations run in isolated, cleanable workspaces |

---

## Core Architecture

### Pipeline Architecture

youBencha follows a **pipeline architecture** with distinct stages:

```
1. Workspace Setup     → Clone repo(s) to isolated directories
2. Pre-Execution       → Run setup scripts (optional)
3. Agent Execution     → Run coding agent via adapter
4. Log Normalization   → Transform output to YouBenchaLog format
5. Evaluators          → Run evaluators in parallel
6. Results Bundling    → Aggregate into ResultsBundle JSON
7. Post-Evaluation     → Export to external systems (optional)
8. Reporting           → Generate human-readable reports
```

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central coordinator for evaluation workflow |
| **Workspace Manager** | `src/core/workspace.ts` | Manages isolated workspace directories |
| **Agent Adapters** | `src/adapters/` | Interface with coding agents (copilot-cli) |
| **Evaluators** | `src/evaluators/` | Analyze and score agent outputs |
| **Pre-Execution** | `src/pre-execution/` | Run scripts before agent execution |
| **Post-Evaluation** | `src/post-evaluation/` | Export results after evaluation |
| **Reporters** | `src/reporters/` | Generate JSON/Markdown reports |
| **Schemas** | `src/schemas/` | Zod validation schemas |

---

## CLI Commands

### `yb run`

Run a complete evaluation workflow with agent execution.

```bash
yb run -c <config-file>
yb run -c testcase.yaml                    # Keep workspace (default)
yb run -c testcase.yaml --delete-workspace # Delete workspace after
```

**Features:**
- Clones repository to isolated workspace
- Executes configured agent (e.g., copilot-cli)
- Runs all evaluators in parallel
- Generates results bundle and artifacts
- Supports YAML and JSON configuration formats

### `yb eval`

Run evaluators on existing directories without agent execution.

```bash
yb eval -c <eval-config-file>
```

**Use Cases:**
- Re-evaluate agent outputs with different evaluators
- Evaluate manual code changes
- Test custom evaluators during development
- CI/CD integration with other tools

### `yb report`

Generate human-readable reports from evaluation results.

```bash
yb report --from <results-file> [--format <format>] [--output <path>]
```

**Formats:**
- `markdown` (default) - Human-readable Markdown
- `json` - Structured JSON for programmatic use

### `yb validate`

Validate configuration files without running evaluation.

```bash
yb validate -c <config-file> [-v, --verbose]
```

**Checks:**
- File existence and size
- YAML/JSON syntax
- Schema validation against Zod schemas
- Evaluator configuration warnings
- Prompt length recommendations

### `yb init`

Create a starter testcase.yaml configuration.

```bash
yb init [--force]
```

### `yb list`

List available evaluators and their descriptions.

```bash
yb list
```

### `yb suggest-testcase`

Interactive AI-guided test case generation.

```bash
yb suggest-testcase --agent <type> --output-dir <path> [--agent-file <path>]
```

**Workflow:**
1. Analyzes agent output folder
2. Asks about baseline/source for comparison
3. Requests original instructions/intent
4. Detects patterns in changes
5. Recommends appropriate evaluators
6. Generates complete test case configuration

---

## Agent Adapters

### Interface (`AgentAdapter`)

All adapters implement:

```typescript
interface AgentAdapter {
  readonly name: string;           // 'copilot-cli'
  readonly version: string;        // '1.0.0'
  
  checkAvailability(): Promise<boolean>;
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog;
}
```

### Copilot CLI Adapter

**Location:** `src/adapters/copilot-cli.ts`

**Features:**
- Executes GitHub Copilot CLI with prompts
- Supports model selection (claude-sonnet-4.5, gpt-5, etc.)
- Named agents support (e.g., `agentic-judge`)
- Real-time output streaming
- Timeout handling
- Log normalization to youBencha Log format

**Configuration:**
```yaml
agent:
  type: copilot-cli
  agent_name: agentic-judge  # Optional named agent
  model: claude-sonnet-4.5   # Optional model override
  config:
    prompt: "Add authentication to the API"
    # OR
    prompt_file: ./prompts/auth-prompt.md
```

**Supported Models:**
- `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`
- `gpt-5`, `gpt-5.1`, `gpt-5.1-codex-mini`, `gpt-5.1-codex`
- `gemini-3-pro-preview`

---

## Evaluators

### Interface (`Evaluator`)

All evaluators implement:

```typescript
interface Evaluator {
  readonly name: string;
  readonly description: string;
  readonly requiresExpectedReference: boolean;
  
  checkPreconditions(context: EvaluationContext): Promise<boolean>;
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}
```

### Built-in Evaluators

#### 1. git-diff

**Location:** `src/evaluators/git-diff.ts`

Analyzes Git changes with assertion-based thresholds.

**Metrics:**
| Metric | Description |
|--------|-------------|
| `files_changed` | Number of modified files |
| `lines_added` | Lines added |
| `lines_removed` | Lines removed |
| `total_changes` | Total additions + deletions |
| `change_entropy` | Distribution of changes (Shannon entropy) |

**Assertions:**
```yaml
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5
        max_lines_added: 100
        max_lines_removed: 50
        max_total_changes: 150
        min_change_entropy: 0.5
        max_change_entropy: 2.0
```

**Features:**
- Auto-stages untracked files before diff
- Saves diff as artifact (`git-diff.patch`)
- Calculates change entropy for distribution analysis

#### 2. expected-diff

**Location:** `src/evaluators/expected-diff.ts`

Compares agent output against expected reference branch.

**Metrics:**
| Metric | Description |
|--------|-------------|
| `aggregate_similarity` | Overall similarity score (0.0 - 1.0) |
| `files_matched` | Files with 100% similarity |
| `files_changed` | Files with differences |
| `files_added` | Files only in modified |
| `files_removed` | Files only in expected |
| `file_similarities` | Per-file similarity scores |

**Configuration:**
```yaml
repo: https://github.com/example/repo.git
branch: main
expected_source: branch
expected: feature/completed  # Reference branch

evaluators:
  - name: expected-diff
    config:
      threshold: 0.80  # 80% similarity required to pass
```

**Threshold Guidelines:**
- **0.95+** - Exact/near-exact match (generated files, configs)
- **0.80-0.90** - Implementation code
- **0.70-0.80** - Creative tasks with multiple valid solutions

#### 3. agentic-judge

**Location:** `src/evaluators/agentic-judge.ts`

Uses an AI agent to evaluate code quality based on custom assertions.

**Features:**
- Full agentic workflow (not single LLM API call)
- Uses same AgentAdapter interface as main execution
- Reads files, searches patterns, makes judgments
- Supports named agents and custom instructions
- Produces structured JSON output

**Configuration:**
```yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        readme_modified: "README.md was modified. Score 1 if true, 0 if false."
        helpful_comment: "A helpful comment was added. Score 1 if true, 0 if false."
        no_errors: "No syntax errors or broken markdown. Score 1 if valid, 0 if broken."
```

**Multiple Judges:**
```yaml
evaluators:
  # Judge 1: Error Handling
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        has_try_catch: "Code includes try-catch blocks. Score 1 if present, 0 if absent."
        errors_logged: "Errors are properly logged. Score 1 if logged, 0 if not."
  
  # Judge 2: Documentation
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions have JSDoc. Score 1 if documented, 0 if not."
```

---

## Pre-Execution Hooks

**Location:** `src/pre-execution/`

Run custom scripts after workspace setup but before agent execution.

### Execution Order

```
Workspace Setup → Pre-Execution Hooks → Agent Execution → Evaluators
```

### Script Pre-Executor

**Configuration:**
```yaml
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          mkdir -p ${WORKSPACE_DIR}/config
          cat > ${WORKSPACE_DIR}/.env << 'EOF'
          API_KEY=${API_KEY}
          DATABASE_URL=${DATABASE_URL}
          EOF
      env:
        API_KEY: "${API_KEY}"
        DATABASE_URL: "${DATABASE_URL}"
      working_dir: ${WORKSPACE_DIR}
      timeout_ms: 30000
```

### Use Cases

| Use Case | Description |
|----------|-------------|
| **Environment Setup** | Inject API keys, create config files |
| **Code Generation** | Run codegen scripts before agent |
| **Search & Replace** | Replace placeholders in source |
| **File Setup** | Copy fixtures, create directories |
| **Mock Data** | Seed databases, create test data |

### Available Variables

- `WORKSPACE_DIR` - Path to workspace
- `REPO_DIR` - Path to repository
- `ARTIFACTS_DIR` - Path to artifacts
- `TEST_CASE_NAME` - Name of test case
- `REPO_URL` - Repository URL
- `BRANCH` - Branch being tested

### Error Handling

- Failed pre-execution **stops** agent execution
- Timeout default: 30 seconds
- Runs **sequentially** (not parallel)

---

## Post-Evaluation Hooks

**Location:** `src/post-evaluation/`

Export or process results after evaluation completes.

### Execution Characteristics

- **Optional and Non-Blocking**: Never fail the main evaluation
- **Isolated Execution**: Errors don't affect other post-evaluators
- **Parallel Execution**: Multiple hooks run concurrently
- **Immutable Results**: Read-only access to results

### Built-in Post-Evaluators

#### 1. Webhook

POST results to HTTP endpoints.

```yaml
post_evaluation:
  - name: webhook
    config:
      url: https://api.example.com/results
      method: POST
      headers:
        Authorization: "Bearer ${WEBHOOK_TOKEN}"
        Content-Type: "application/json"
      retry_on_failure: true
      timeout_ms: 5000
```

#### 2. Database

Store results in JSON file for historical analysis.

```yaml
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./results-history.jsonl
      include_full_bundle: true
      append: true
```

#### 3. Script

Run custom analysis scripts.

```yaml
post_evaluation:
  - name: script
    config:
      command: ./scripts/analyze-results.sh
      args:
        - "${RESULTS_PATH}"
      env:
        SLACK_WEBHOOK: "${SLACK_WEBHOOK_URL}"
      timeout_ms: 30000
```

---

## Configuration System

### Test Case Configuration

**Schema:** `src/schemas/testcase.schema.ts`

```yaml
# Required fields
name: "Test Case Name"
description: "What this test case evaluates"
repo: https://github.com/owner/repo.git
agent:
  type: copilot-cli
  config:
    prompt: "Your instructions to the agent"
evaluators:
  - name: git-diff

# Optional fields
branch: main
commit: abc123
expected_source: branch
expected: feature/completed
workspace_dir: ./custom-workspace
timeout: 300000  # 5 minutes

pre_execution:
  - name: script
    config: {...}

post_evaluation:
  - name: webhook
    config: {...}
```

### Eval Configuration

**Schema:** `src/schemas/eval.schema.ts`

```yaml
name: "Eval Name"
description: "Evaluate existing code"
directory: ./src
expected_directory: ./expected  # Optional
output_dir: .youbencha-eval     # Default
evaluators:
  - name: git-diff
  - name: agentic-judge
    config: {...}
```

### Configuration Features

- **YAML and JSON Support**: Both formats fully supported
- **Prompt Files**: Load prompts from external files
- **Reusable Evaluators**: Reference evaluator configs from files
- **Environment Variables**: Use `${VAR}` syntax
- **Mutual Exclusivity**: `prompt` and `prompt_file` are mutually exclusive

### Prompt File Loading

```yaml
agent:
  type: copilot-cli
  config:
    prompt_file: ./prompts/detailed-instructions.md

evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      prompt_file: ./evaluator-prompts/quality-check.md
```

### Reusable Evaluator Definitions

**evaluators/quality-check.yaml:**
```yaml
name: agentic-judge
config:
  type: copilot-cli
  agent_name: agentic-judge
  assertions:
    has_tests: "Unit tests are present. Score 1 if true, 0 if false."
    follows_patterns: "Code follows existing patterns. Score 1 if true, 0 if false."
```

**testcase.yaml:**
```yaml
evaluators:
  - file: ./evaluators/quality-check.yaml
```

---

## Workspace Management

**Location:** `src/core/workspace.ts`

### Workspace Structure

```
.youbencha-workspace/
└── run-{timestamp}-{hash}/
    ├── src-modified/      # Agent works here
    ├── src-expected/      # Expected reference (optional)
    ├── artifacts/
    │   ├── youbencha.log.json
    │   ├── results.json
    │   ├── git-diff.patch
    │   └── copilot-logs/
    └── .lock              # Lockfile for concurrency
```

### Features

| Feature | Description |
|---------|-------------|
| **Isolation** | Never mutates original repository |
| **Locking** | Prevents concurrent workspace conflicts |
| **Stale Lock Detection** | Removes locks from dead processes |
| **Shallow Cloning** | `--depth 1` for performance |
| **Branch Support** | Clones specific branches |
| **Commit Checkout** | Can checkout specific commits |
| **Cleanup** | Automatic or manual workspace removal |

### Workspace Lifecycle

1. **Create** - Generate unique run ID, create directories
2. **Clone** - Clone repository with optional branch/commit
3. **Lock** - Create lockfile with PID
4. **Use** - Agent and evaluators operate here
5. **Cleanup** - Remove workspace (unless `--delete-workspace` skipped)

---

## Reporting System

**Location:** `src/reporters/`

### Markdown Reporter

Generates human-readable reports with:

- **Summary Section**: Overall status, pass/fail counts
- **Test Case Configuration**: Repository, branch, commit details
- **Execution Details**: Duration, environment, timestamps
- **Agent Execution**: Status, exit code, log path
- **Evaluator Results**: Per-evaluator metrics, artifacts, errors
- **Artifacts**: Links to logs and generated files

### JSON Reporter

Outputs complete `ResultsBundle` as JSON for programmatic consumption.

### Result Structure

```typescript
interface ResultsBundle {
  version: '1.0.0';
  test_case: {
    name: string;
    description: string;
    config_file: string;
    config_hash: string;
    repo: string;
    branch: string;
    commit: string;
    expected_branch?: string;
  };
  execution: {
    started_at: string;
    completed_at: string;
    duration_ms: number;
    youbencha_version: string;
    environment: { os, node_version, workspace_dir };
  };
  agent: {
    type: string;
    youbencha_log_path: string;
    status: 'success' | 'failed' | 'timeout';
    exit_code: number;
  };
  evaluators: EvaluationResult[];
  summary: {
    total_evaluators: number;
    passed: number;
    failed: number;
    skipped: number;
    overall_status: 'passed' | 'failed' | 'partial';
  };
  artifacts: {
    agent_log: string;
    reports: string[];
    evaluator_artifacts: string[];
  };
}
```

---

## Security Features

### Repository Validation

Prevents access to internal/localhost URLs:

```typescript
// Blocked hostnames
- localhost
- 127.0.0.1, 0.0.0.0, ::1
- 192.168.*, 10.*, 172.16.*
```

### Workspace Isolation

- All operations in `.youbencha-workspace/`
- Never mutates user's working directory
- Cleanup mandatory (unless explicitly kept)

### Credential Management

- Use environment variables, never hardcode secrets
- Pre-execution receives controlled environment
- Post-evaluation has read-only access to results

### Script Execution

- Commands from trusted configuration files only
- Path validation prevents traversal
- Timeout enforcement

---

## Extensibility

### Adding New Evaluators

1. Create class implementing `Evaluator` interface
2. Add to `getEvaluator()` switch in orchestrator
3. Return `EvaluationResult` with status, metrics, message
4. Use `status: 'skipped'` for recoverable errors

### Adding New Agent Adapters

1. Create class implementing `AgentAdapter` interface
2. Implement `checkAvailability()`, `execute()`, `normalizeLog()`
3. Add to `getAgentAdapter()` switch in orchestrator
4. Register in `testcase.schema.ts` agent type enum

### youBencha Log Schema

Standardized format for cross-agent comparison:

```typescript
interface YouBenchaLog {
  version: '1.0.0';
  agent: { name, version, adapter_version };
  model: { name, provider, parameters };
  execution: { started_at, completed_at, duration_ms, exit_code, status };
  messages: Message[];
  usage: { prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd };
  errors: LogError[];
  environment: { os, node_version, youbencha_version, working_directory };
}
```

---

## Summary

youBencha provides a comprehensive, extensible framework for evaluating AI coding agents with:

- **6 CLI Commands**: run, eval, report, validate, init, suggest-testcase, list
- **1 Agent Adapter**: copilot-cli (with support for multiple models)
- **3 Evaluators**: git-diff, expected-diff, agentic-judge
- **1 Pre-Executor**: script
- **3 Post-Evaluators**: webhook, database, script
- **2 Report Formats**: markdown, json
- **Complete Configuration System**: YAML/JSON, prompt files, reusable evaluators
- **Robust Workspace Management**: Isolation, locking, cleanup
- **Security**: URL validation, credential management, script sandboxing

The architecture is designed for extensibility, allowing easy addition of new adapters, evaluators, and post-evaluation hooks as the ecosystem grows.
