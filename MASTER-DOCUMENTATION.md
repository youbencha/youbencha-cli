# youBencha: Complete Feature & Functionality Documentation

**Version:** 0.1.0  
**Last Updated:** November 2024

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What is youBencha?](#what-is-youbencha)
3. [Core Value Propositions](#core-value-propositions)
4. [Architecture & Design](#architecture--design)
5. [Installation & Setup](#installation--setup)
6. [CLI Commands Reference](#cli-commands-reference)
7. [Configuration Setup](#configuration-setup)
8. [Agent Adapters](#agent-adapters)
9. [Evaluators](#evaluators)
10. [Pre-Execution Hooks](#pre-execution-hooks)
11. [Post-Evaluation Hooks](#post-evaluation-hooks)
12. [Advanced Features](#advanced-features)
13. [Results & Reporting](#results--reporting)
14. [Security Considerations](#security-considerations)
15. [Best Practices](#best-practices)
16. [Integration Examples](#integration-examples)
17. [Troubleshooting](#troubleshooting)

---

## Executive Summary

youBencha is a developer-first CLI framework for evaluating AI-powered coding agents. It provides:

- **Agent-agnostic architecture** through pluggable adapters
- **Flexible evaluation** with built-in and custom evaluators
- **Reproducible results** via standardized logging (youBencha Log format)
- **Comprehensive reporting** with metrics and human-readable insights
- **Pipeline extensibility** through pre-execution and post-evaluation hooks
- **Time-series analysis** capabilities for regression detection and trend tracking

The framework enables developers to objectively measure AI agent performance, compare different models or configurations, and track quality over time.

---

## What is youBencha?

youBencha is a testing and benchmarking framework designed to help developers evaluate and compare AI-powered coding agents. Unlike traditional software testing frameworks, youBencha specializes in evaluating the quality, scope, and correctness of code changes made by AI agents.

### Problem Statement

Organizations using AI coding agents face several challenges:

1. **Lack of objective measurement** - How do you know if the agent did a good job?
2. **No standardized evaluation** - Different agents produce different formats, making comparison difficult
3. **Regression detection** - How do you ensure new model versions don't break existing capabilities?
4. **Quality assessment** - Beyond "does it compile?", how do you evaluate code quality?
5. **Cost tracking** - Understanding token usage and execution time across evaluations

### youBencha's Solution

youBencha provides:

- **Standardized evaluation pipeline** that works with any agent
- **Pluggable evaluators** for different quality dimensions (correctness, style, scope, similarity)
- **Reproducible execution** with isolated workspaces and comprehensive logging
- **Flexible reporting** from single-run feedback to time-series analysis
- **Extensible architecture** supporting custom evaluators and workflows

---

## Core Value Propositions

### For AI Engineers

**Immediate Feedback During Development**
- Quick validation during prompt engineering
- Debug agent failures with full context (logs, diffs, metrics)
- Iterate rapidly on agent configurations

**Example Workflow:**
\`\`\`bash
# Edit prompt
vim suite.yaml

# Run evaluation
yb run -c suite.yaml

# Review results
yb report --from .youbencha-workspace/run-*/artifacts/results.json

# Iterate
\`\`\`

### For Development Teams

**Capability Assessment**
- Cross-test comparison to identify hardest tasks
- Pattern recognition for common failure modes
- Aggregate metrics (pass rate, similarity scores, costs)
- Choose between different agent configurations objectively

**Use Cases:**
- Agent selection and vendor comparison
- Understanding agent strengths and weaknesses
- Test case refinement based on data

### For Organizations

**Regression Detection & Trend Analysis**
- Track performance across model/prompt updates
- Detect quality degradation early
- Cost optimization and ROI tracking
- Long-term performance benchmarking

**Value:**
- Data-driven decisions about tooling and processes
- Budget forecasting based on historical trends
- Compliance and audit trails for AI-generated code

---

## Architecture & Design

### Pipeline Architecture

youBencha follows a **multi-stage pipeline** where evaluation flows through distinct phases:

\`\`\`
1. Workspace Setup
   └─> Clone repository to isolated directory
   
2. Pre-Execution Hooks (Optional)
   └─> Setup environment, inject secrets, generate code
   
3. Agent Execution
   └─> Run coding agent via adapter (e.g., Copilot CLI)
   
4. Log Normalization
   └─> Transform agent output to youBencha Log format
   
5. Evaluators (Parallel Execution)
   ├─> git-diff: Measure scope of changes
   ├─> expected-diff: Compare to reference implementation
   └─> agentic-judge: AI-powered quality assessment
   
6. Results Aggregation
   └─> Bundle all outputs into ResultsBundle JSON
   
7. Post-Evaluation (Parallel Execution)
   ├─> Database export (JSONL, future: PostgreSQL)
   ├─> Webhook notifications (Slack, Teams, custom)
   └─> Custom scripts (analysis, integration)
   
8. Reporting
   └─> Generate human-readable Markdown/JSON reports
\`\`\`

### Core Mental Model

**Isolation First**: All operations occur in isolated workspaces (\`.youbencha-workspace/run-{timestamp}-{hash}/\`) - never mutate the original repository.

**Pluggable Components**: 
- **Agent Adapters**: Interface with different AI agents
- **Evaluators**: Measure different quality dimensions
- **Post-Evaluators**: Export/analyze results

**Parallel Execution**: Evaluators and post-evaluators run concurrently for performance.

**Reproducibility**: Complete execution context captured in youBencha Log format.

### Project Structure

\`\`\`
youbencha/
├── src/
│   ├── adapters/        # Agent adapters (copilot-cli, future: cursor, etc.)
│   ├── cli/             # CLI commands (run, report, validate, etc.)
│   ├── core/            # Core orchestration logic
│   │   ├── orchestrator.ts    # Central coordinator
│   │   ├── workspace.ts       # Workspace management
│   │   └── diff-analyzer.ts   # Diff analysis utilities
│   ├── evaluators/      # Built-in evaluators
│   │   ├── git-diff.ts
│   │   ├── expected-diff.ts
│   │   └── agentic-judge.ts
│   ├── pre-execution/   # Pre-execution hooks
│   │   └── script.ts    # Script-based pre-execution
│   ├── post-evaluation/ # Post-evaluation exporters
│   │   ├── database.ts  # JSONL export
│   │   ├── webhook.ts   # HTTP POST notifications
│   │   └── script.ts    # Custom scripts
│   ├── reporters/       # Report generators (markdown, json)
│   ├── lib/             # Utility libraries
│   └── schemas/         # Zod validation schemas
└── tests/
    ├── contract/        # Schema validation, interface contracts
    ├── integration/     # End-to-end workflows
    └── unit/            # Component isolation tests
\`\`\`

---

## Installation & Setup

### System Requirements

- **Node.js 20+** (check with \`node --version\`)
- **Git** (check with \`git --version\`)
- **AI Agent** - Currently supported:
  - GitHub Copilot CLI: \`npm install -g @githubnext/github-copilot-cli\`

### Installation Methods

**Global Installation (Recommended)**
\`\`\`bash
npm install -g youbencha

# Verify installation
yb --version
\`\`\`

**Local Project Installation**
\`\`\`bash
npm install --save-dev youbencha

# Use with npx
npx yb --version
\`\`\`

**Development Installation (from source)**
\`\`\`bash
# Clone repository
git clone https://github.com/youbencha/youbencha-cli.git
cd youbencha-cli

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link

# Verify
yb --version
\`\`\`

### Quick Start (3 Steps)

**1. Initialize Configuration**
\`\`\`bash
yb init
# Creates suite.yaml with helpful comments
\`\`\`

**2. Customize Configuration**
\`\`\`yaml
# suite.yaml
repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add a comment explaining what this repo is about"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        readme_modified: "README.md was modified. Score 1 if true, 0 if false."
        helpful_comment: "A helpful comment was added. Score 1 if yes, 0 if no."
\`\`\`

**3. Run Evaluation**
\`\`\`bash
yb run -c suite.yaml
yb report --from .youbencha-workspace/run-*/artifacts/results.json
\`\`\`

---

## CLI Commands Reference

### \`yb init\`

**Purpose:** Create a starter configuration file with helpful comments.

**Usage:**
\`\`\`bash
yb init [--force]
\`\`\`

**Options:**
- \`--force\`: Overwrite existing suite.yaml if present

**Output:** Creates \`suite.yaml\` in current directory with a fully-commented template.

---

### \`yb run\`

**Purpose:** Execute an evaluation suite against an AI agent.

**Usage:**
\`\`\`bash
yb run -c <config-file> [--delete-workspace]
\`\`\`

**Options:**
- \`-c, --config <path>\`: Path to suite configuration (YAML or JSON) **(required)**
- \`--delete-workspace\`: Delete workspace after completion (default: keep for inspection)

**Behavior:**
1. Validates configuration
2. Creates isolated workspace
3. Clones repository
4. Runs pre-execution hooks (if configured)
5. Executes agent
6. Runs evaluators in parallel
7. Runs post-evaluation hooks in parallel
8. Saves results to workspace

**Output:**
\`\`\`
.youbencha-workspace/
└── run-{timestamp}-{hash}/
    ├── src-modified/              # Code after agent execution
    ├── src-expected/              # Reference code (if configured)
    ├── artifacts/
    │   ├── results.json           # Machine-readable results
    │   ├── report.md              # Human-readable report
    │   ├── youbencha.log.json     # Agent execution log
    │   ├── git-diff.patch         # Git diff output
    │   └── expected-diff.json     # Similarity analysis (if applicable)
    └── .youbencha.lock            # Workspace metadata
\`\`\`

---

### \`yb report\`

**Purpose:** Generate human-readable report from evaluation results.

**Usage:**
\`\`\`bash
yb report --from <results-file> [--format <format>] [--output <path>]
\`\`\`

**Options:**
- \`--from <path>\`: Path to results.json **(required)**
- \`--format <format>\`: Output format: \`json\`, \`markdown\` (default: \`markdown\`)
- \`--output <path>\`: Custom output path (default: artifacts directory)

---

### \`yb validate\`

**Purpose:** Validate suite configuration without running evaluation.

**Usage:**
\`\`\`bash
yb validate -c <config-file> [-v]
\`\`\`

**Options:**
- \`-c, --config <path>\`: Path to suite configuration **(required)**
- \`-v, --verbose\`: Show detailed validation information

**What it Checks:**
- YAML/JSON syntax
- Schema compliance
- File references (prompts, evaluators)
- Evaluator configurations
- Security constraints (no localhost repos)

---

### \`yb list\`

**Purpose:** List available built-in evaluators and their descriptions.

**Usage:**
\`\`\`bash
yb list
\`\`\`

**Output:**
\`\`\`
Available Evaluators:

git-diff
  Analyzes Git changes made by the agent
  
expected-diff
  Compares agent output against expected reference branch
  
agentic-judge
  Uses AI agent to evaluate code quality based on custom assertions
\`\`\`

---

### \`yb suggest-suite\`

**Purpose:** Generate evaluation suite suggestions using AI agent interaction.

**Usage:**
\`\`\`bash
yb suggest-suite --agent <type> --output-dir <path> [--agent-file <path>] [--save <path>]
\`\`\`

**Options:**
- \`--agent <type>\`: Agent to use (e.g., \`copilot-cli\`) **(required)**
- \`--output-dir <path>\`: Path to successful agent output folder **(required)**
- \`--agent-file <path>\`: Custom agent file (default: \`agents/suggest-suite.agent.md\`)
- \`--save <path>\`: Save generated suite to file

**Interactive Workflow:**
1. Analyzes agent output directory
2. Asks about baseline/source for comparison
3. Requests original instructions/intent
4. Detects patterns (auth, tests, API changes, docs)
5. Recommends appropriate evaluators with reasoning
6. Generates complete suite configuration

---

## Configuration Setup

### Configuration Format Support

youBencha supports both **YAML** and **JSON** formats with automatic detection based on file extension.

**Required Fields:**
- \`repo\`: Repository URL (HTTP/HTTPS only, no localhost)
- \`agent.type\`: Agent adapter type
- \`evaluators\`: Array of evaluator configurations

**Optional Fields:**
- \`name\`: Test case name (recommended)
- \`description\`: Test case description (recommended)
- \`branch\`: Git branch (default: repository default branch)
- \`commit\`: Specific commit SHA to checkout
- \`expected_source\`: Reference source type (\`branch\`, \`commit\`)
- \`expected\`: Reference branch/commit for comparison
- \`timeout\`: Operation timeout in milliseconds (default: 300000)
- \`workspace_dir\`: Custom workspace directory
- \`pre_execution\`: Array of pre-execution hooks
- \`post_evaluation\`: Array of post-evaluation hooks

### Prompt Files

Load prompts from external files for better organization:

**Agent Prompt from File:**
\`\`\`yaml
agent:
  type: copilot-cli
  config:
    prompt_file: ./prompts/add-auth.md
\`\`\`

**Evaluator Prompt from File:**
\`\`\`yaml
evaluators:
  - name: agentic-judge
    config:
      prompt_file: ./prompts/strict-eval.txt
      assertions:
        # ...
\`\`\`

**Mutual Exclusivity:** Cannot specify both \`prompt\` and \`prompt_file\` - use one or the other.

---

## Agent Adapters

### Copilot CLI Adapter (MVP)

**Type:** \`copilot-cli\`

**Requirements:**
- GitHub Copilot CLI installed: \`npm install -g @githubnext/github-copilot-cli\`
- GitHub authentication configured

**Configuration:**
\`\`\`yaml
agent:
  type: copilot-cli
  agent_name: my-agent      # Optional: Use named agent from .github/agents/
  model: claude-sonnet-4.5  # Optional: Specify model
  config:
    prompt: "Your task description"
    # OR
    prompt_file: ./prompts/task.md
\`\`\`

**Supported Models:**
- \`claude-sonnet-4.5\`, \`claude-sonnet-4\`, \`claude-haiku-4.5\`
- \`gpt-5\`, \`gpt-5.1\`, \`gpt-5.1-codex-mini\`, \`gpt-5.1-codex\`
- \`gemini-3-pro-preview\`

**Named Agents:**

When \`agent_name\` is specified:
1. \`.github/agents/\` directory is automatically copied to workspace
2. Agent invoked with \`--agent <name>\` flag
3. Agent-specific instructions applied

---

## Evaluators

### Built-in Evaluators

#### 1. git-diff

**Purpose:** Analyze Git changes made by the agent with assertion-based pass/fail thresholds.

**Configuration:**
\`\`\`yaml
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5        # Maximum files that can be modified
        max_lines_added: 100        # Maximum lines that can be added
        max_lines_removed: 50       # Maximum lines that can be removed
        max_total_changes: 150      # Maximum total changes (additions + deletions)
        min_change_entropy: 0.5     # Minimum entropy (enforce distributed changes)
        max_change_entropy: 2.0     # Maximum entropy (enforce focused changes)
\`\`\`

**Metrics Produced:**
- \`files_changed\`: Number of files modified
- \`lines_added\`: Total lines added
- \`lines_removed\`: Total lines removed
- \`total_changes\`: Sum of additions and deletions
- \`change_entropy\`: Distribution of changes across files
- \`changed_files\`: Array of file paths
- \`file_metrics\`: Per-file change statistics

---

#### 2. expected-diff

**Purpose:** Compare agent output against an expected reference implementation.

**Requirements:**
- Must configure \`expected_source\` and \`expected\` in test case

**Configuration:**
\`\`\`yaml
# Test case configuration
repo: https://github.com/example/repo.git
branch: main
expected_source: branch      # Or: commit
expected: feature/completed  # Reference branch/commit

evaluators:
  - name: expected-diff
    config:
      threshold: 0.85  # Require 85% similarity to pass
\`\`\`

**Threshold Guidelines:**
- **1.0** (100%): Exact match (very strict)
- **0.9-0.99**: Very similar, minor differences (strict)
- **0.7-0.89**: Mostly similar, moderate differences (balanced)
- **<0.7**: Significantly different (lenient)

**Recommended Thresholds:**
- **0.95+**: Generated files (migrations, configs)
- **0.80-0.90**: Implementation code
- **0.70-0.80**: Creative tasks with multiple valid solutions

---

#### 3. agentic-judge

**Purpose:** Use AI agent to evaluate code quality based on custom assertions.

**Configuration:**
\`\`\`yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge  # Optional: Use custom judge agent
      model: claude-sonnet-4.5    # Optional: Specify model
      prompt_file: ./strict.txt   # Optional: Custom instructions
      assertions:
        error_handling: "Code includes proper error handling. Score 1 if complete, 0.5 if partial, 0 if missing."
        documentation: "Functions have JSDoc comments. Score 1 if all documented, 0 if none."
        tests_added: "Unit tests were added. Score 1 if comprehensive, 0.5 if basic, 0 if none."
\`\`\`

**Scoring:**
- Typically 0-1 scale (binary) or 0-10 scale (granular)
- Specify scale in assertion text

---

### Multiple Agentic Judges

**Purpose:** Break evaluation into focused areas with specialized judges.

**Benefits:**
- Each judge evaluates 1-3 related assertions
- Cleaner results
- Independent pass/fail status per judge
- Parallel execution

**Naming Conventions:**
- \`agentic-judge-<focus-area>\`: Hyphen separator (recommended)
- \`agentic-judge:<focus-area>\`: Colon separator

**Example:**
\`\`\`yaml
evaluators:
  # Judge 1: Error Handling
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        has_try_catch: "Includes try-catch blocks. Score 1 if present, 0 if absent."
  
  # Judge 2: Documentation
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions have JSDoc. Score 1 if all, 0 if none."
\`\`\`

---

### Reusable Evaluator Definitions

**Purpose:** Define evaluators in separate files for reusability.

**Evaluator Definition File:**
\`\`\`yaml
# evaluators/test-coverage.yaml
name: agentic-judge:test-coverage
description: "Ensures code changes include appropriate test coverage"

config:
  type: copilot-cli
  agent_name: agentic-judge
  assertions:
    tests_added: "New tests were added. Score 1 if yes, 0 if no."
\`\`\`

**Reference in Test Case:**
\`\`\`yaml
evaluators:
  - file: ./evaluators/test-coverage.yaml  # External definition
  - name: git-diff                          # Inline definition
\`\`\`

---

## Pre-Execution Hooks

**Purpose:** Run custom scripts after workspace setup but before agent execution.

**Use Cases:**
- Environment variable injection
- Search and replace in source code
- Code generation
- File setup
- Mock data creation

**Configuration:**
\`\`\`yaml
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          mkdir -p \${WORKSPACE_DIR}/config
          cat > \${WORKSPACE_DIR}/config/auth.json << EOF
          {"jwtSecret": "test-key"}
          EOF
      timeout_ms: 30000
\`\`\`

**Available Environment Variables:**
- \`WORKSPACE_DIR\`: Workspace directory path
- \`REPO_DIR\`: Repository directory
- \`ARTIFACTS_DIR\`: Artifacts directory
- \`TEST_CASE_NAME\`: Test case name
- \`REPO_URL\`: Repository URL
- \`BRANCH\`: Branch being tested

**Error Handling:**
- Failed pre-execution stops entire evaluation
- Agent NOT executed if pre-execution fails

---

## Post-Evaluation Hooks

**Purpose:** Run actions after evaluation for results export, analysis, and integration.

**Key Characteristics:**
- Run in **parallel** (not sequential)
- Never fail main evaluation
- Immutable access to results

---

### 1. Database Post-Evaluator

**Purpose:** Export results to structured storage.

**Configuration:**
\`\`\`yaml
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./results-history.jsonl
      include_full_bundle: true
      append: true
\`\`\`

---

### 2. Webhook Post-Evaluator

**Purpose:** POST results to HTTP endpoint.

**Configuration:**
\`\`\`yaml
post_evaluation:
  - name: webhook
    config:
      url: \${SLACK_WEBHOOK_URL}
      method: POST
      headers:
        Content-Type: "application/json"
      retry_on_failure: true
\`\`\`

---

### 3. Script Post-Evaluator

**Purpose:** Execute custom scripts.

**Configuration:**
\`\`\`yaml
post_evaluation:
  - name: script
    config:
      command: ./scripts/analyze.sh
      args: ["\${RESULTS_PATH}"]
      env:
        SLACK_WEBHOOK: "\${SLACK_WEBHOOK_URL}"
\`\`\`

---

## Advanced Features

### Model Selection

Specify which AI model to use:

\`\`\`yaml
agent:
  type: copilot-cli
  model: claude-sonnet-4.5
\`\`\`

### Expected Reference Comparison

Compare against "correct" reference:

\`\`\`yaml
repo: https://github.com/example/repo.git
branch: main
expected_source: branch
expected: feature/completed

evaluators:
  - name: expected-diff
    config:
      threshold: 0.85
\`\`\`

### Workspace Management

**Isolation:** All operations in isolated directories.

**Structure:**
\`\`\`
.youbencha-workspace/
└── run-{timestamp}-{hash}/
    ├── src-modified/
    ├── src-expected/
    ├── artifacts/
    └── .youbencha.lock
\`\`\`

---

## Results & Reporting

### Results Bundle Schema

Complete evaluation artifact with test case metadata, execution details, evaluator results, and summary.

### Value at Different Scales

**Single Result:** Quick feedback (did it work? what changed?)

**Suite of Results:** Cross-comparison (hardest tasks, pass rate)

**Time-Series:** Regression detection, trend analysis

**Analysis:**
\`\`\`bash
# Pass rate across suite
jq -s 'map(.summary.overall_status == "passed") | 
       map(select(.) | 1) | add / length' results/*.json

# Detect regression
PREV=\$(tail -n 2 history.jsonl | head -n 1 | jq '.summary.passed')
CURR=\$(tail -n 1 history.jsonl | jq '.summary.passed')
if [ "\$CURR" -lt "\$PREV" ]; then
    echo "⚠️ REGRESSION"
fi
\`\`\`

---

## Security Considerations

### Repository Validation

Blocks localhost and internal network repos to prevent SSRF.

### Workspace Isolation

All operations scoped to isolated workspace.

### Command Execution Security

Pre-execution/post-evaluation scripts:
- Use \`shell: true\` for flexibility
- Pass only controlled environment variables
- Never inherit full \`process.env\`

### Credentials Management

**Best Practices:**
1. Use environment variables for secrets
2. Never hardcode credentials
3. Reference with \`\${VAR}\` syntax

---

## Best Practices

### Configuration

1. Start simple (git-diff + agentic-judge)
2. Make assertions specific
3. Use descriptive metric names
4. Version control configurations

### Evaluators

1. Multiple focused judges (1-3 assertions each)
2. Appropriate thresholds
3. Reusable definitions

### Results Analysis

1. Consistent test cases
2. Export early (time-series from day 1)
3. Alert on regressions

---

## Integration Examples

### CI/CD Integration

**GitHub Actions:**
\`\`\`yaml
name: youBencha Tests
on: [pull_request, schedule]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install -g youbencha
      - run: yb run -c suite.yaml
      - run: |
          FAILED=\$(jq '.summary.failed' results.json)
          [ "\$FAILED" -eq 0 ] || exit 1
\`\`\`

### Slack Notifications

**Script:**
\`\`\`bash
#!/bin/bash
RESULTS=\$1
STATUS=\$(jq -r '.summary.overall_status' "\$RESULTS")
curl -X POST "\$SLACK_WEBHOOK_URL" -d "{\\"text\\":\\"Status: \$STATUS\\"}"
\`\`\`

---

## Troubleshooting

### Configuration Errors

- YAML: Use spaces, not tabs
- JSON: No trailing commas
- Validate syntax before running

### Agent Errors

- Install agent: \`npm install -g @githubnext/github-copilot-cli\`
- Configure auth: \`gh auth login\`

### Evaluator Errors

- Check spelling
- Verify file paths
- Use \`yb list\` for available evaluators

---

## Conclusion

youBencha provides a comprehensive framework for evaluating AI coding agents with:

1. Agent-agnostic architecture
2. Flexible evaluation
3. Reproducible execution
4. Extensible workflows
5. Production-ready security

**Getting Started:**
1. Install: \`npm install -g youbencha\`
2. Initialize: \`yb init\`
3. Run: \`yb run -c suite.yaml\`
4. Report: \`yb report --from results.json\`

**Resources:**
- GitHub: https://github.com/youbencha/youbencha-cli
- Documentation: \`docs/\` directory
- Examples: \`examples/\` directory

---

*Document generated November 2024 for youBencha v0.1.0*
