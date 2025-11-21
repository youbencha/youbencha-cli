# youBencha

<!-- This repository provides a testing and benchmarking framework for evaluating AI-powered coding agents. It allows developers to run reproducible evaluations, compare agent performance, and generate detailed reports through a simple CLI interface. -->

A friendly, developer-first CLI framework for evaluating agentic coding tools.

## What is youBencha?

youBencha is a testing and benchmarking framework designed to help developers evaluate and compare AI-powered coding agents. It provides:

- **Agent-agnostic architecture** - Test any agent through pluggable adapters
- **Flexible evaluation** - Use built-in evaluators or create custom ones
- **Reproducible results** - Standardized logging and comprehensive result bundles
- **Developer-friendly CLI** - Simple commands for running evaluations and generating reports

## Requirements

- **Node.js 20+** - youBencha requires Node.js version 20 or higher
- **Git** - For cloning repositories during evaluation
- **GitHub Copilot CLI** - Currently the only supported agent adapter (MVP)

## Installation

```bash
# Install globally
npm install -g youbencha

# Or install locally in your project
npm install --save-dev youbencha
```

### Install from Local Build

If you're developing youBencha locally:

```bash
# Build the project
npm run build

# Link globally to use the yb command
npm link
```

This creates a global symlink to your local package, making the `yb` command available system-wide. Any changes you make require rebuilding (`npm run build`) to take effect.

To unlink later:
```bash
npm unlink -g youbencha
```

## Quick Start

**New to youBencha?** Check out the [Getting Started Guide](GETTING-STARTED.md) for a detailed walkthrough.

### 1. Install

```bash
npm install -g youbencha
```

### 2. Create a suite configuration

youBencha supports both **YAML** and **JSON** formats for configuration files.

**Option A: YAML format (`suite.yaml`)**

```yaml
repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add a comment to README explaining what this repository is about"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      criteria:
        readme_modified: "README.md was modified. Score 1 if true, 0 if false."
        helpful_comment_added: "A helpful comment was added to README.md. Score 1 if true, 0 if false."
```

**Option B: JSON format (`suite.json`)**

```json
{
  "repo": "https://github.com/octocat/Hello-World.git",
  "branch": "master",
  "agent": {
    "type": "copilot-cli",
    "config": {
      "prompt": "Add a comment to README explaining what this repository is about"
    }
  },
  "evaluators": [
    { "name": "git-diff" },
    {
      "name": "agentic-judge",
      "config": {
        "type": "copilot-cli",
        "agent_name": "agentic-judge",
        "criteria": {
          "readme_modified": "README.md was modified. Score 1 if true, 0 if false.",
          "helpful_comment_added": "A helpful comment was added to README.md. Score 1 if true, 0 if false."
        }
      }
    }
  ]
}
```

> **💡 Tip**: Both formats support the same features and are validated using the same schema. Choose the format that best fits your workflow or existing tooling.

> **📁 Prompt Files**: Instead of inline prompts, you can load them from external files using `prompt_file: ./path/to/prompt.md`. See the [Prompt Files Guide](docs/prompt-files.md) for details.

### 3. Run the evaluation

```bash
# Using YAML format
yb run -c suite.yaml

# Or using JSON format
yb run -c suite.json

# See examples directory for more configurations
yb run -c examples/testcase-simple.yaml
yb run -c examples/testcase-simple.json
```

The workspace is kept by default for inspection. Add `--delete-workspace` to clean up after completion.

### 4. View results

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

**That's it!** youBencha will clone the repo, run the agent, evaluate the output, and generate a comprehensive report.

---

## What Makes youBencha Different?

- **Agent-Agnostic**: Works with any AI coding agent through pluggable adapters
- **Reproducible**: Standardized logging captures complete execution context
- **Flexible Evaluation**: Use built-in evaluators or create custom ones
- **Developer-Friendly**: Clear error messages, helpful CLI, extensive examples
- **Comprehensive Reports**: From metrics to human-readable insights

## Commands

### `yb run`

Run an evaluation suite.

```bash
yb run -c <config-file>
```

### `yb report`

Generate a report from evaluation results.

```bash
yb report --from <results-file> [--format <format>] [--output <path>]

Options:
  --from <path>      Path to results JSON file (required)
  --format <format>  Report format: json, markdown (default: markdown)
  --output <path>    Output path (optional)
```

### `yb suggest-suite`

Generate evaluation suite suggestions using AI agent interaction.

```bash
yb suggest-suite --agent <type> --output-dir <path> [--agent-file <path>]

Options:
  --agent <type>           Agent tool to use (e.g., copilot-cli) (required)
  --output-dir <path>      Path to successful agent output folder (required)
  --agent-file <path>      Custom agent file (default: agents/suggest-suite.agent.md)
  --save <path>            Path to save generated suite (optional)
```

**Interactive Workflow:**

The `suggest-suite` command launches an interactive AI agent session that:
1. Analyzes your agent's output folder
2. Asks about your baseline/source for comparison
3. Requests your original instructions/intent
4. Detects patterns in the changes (auth, tests, API, docs, etc.)
5. Recommends appropriate evaluators with reasoning
6. Generates a complete suite configuration

**Example Session:**

```bash
$ yb suggest-suite --agent copilot-cli --output-dir ./my-feature

🤖 Launching interactive agent session...

Agent: What branch should I use as the baseline for comparison?
You: main

Agent: What were the original instructions you gave to the agent?
You: Add JWT authentication with rate limiting and comprehensive error handling

Agent: I've analyzed the changes and detected:
- Authentication/security code patterns
- New test files added
- Error handling patterns

Here's your suggested suite.yaml:

[Generated suite configuration with reasoning]

To use this suite:
1. Save as 'suite.yaml' in your project
2. Run: yb run -c suite.yaml
3. Review evaluation results
```

**Use Cases:**

- **After successful agent work** - Generate evaluation suite for validation
- **Quality assurance** - Ensure agent followed best practices
- **Documentation** - Understand what evaluations are appropriate
- **Learning** - See how different changes map to evaluators

## Expected Reference Comparison

youBencha supports comparing agent outputs against an expected reference branch. This is useful when you have a "correct" or "ideal" implementation to compare against.

### Configuration

Add an expected reference to your suite configuration:

```yaml
repo: https://github.com/octocat/Hello-World.git
branch: main
expected_source: branch
expected: feature/completed  # The reference branch

agent:
  type: copilot-cli
  config:
    prompt: "Implement the feature"

evaluators:
  - name: expected-diff
    config:
      threshold: 0.80  # Require 80% similarity to pass
```

### Threshold Guidelines

The `threshold` determines how similar the agent output must be to the expected reference:

- **1.0** (100%) - Exact match (very strict)
- **0.9-0.99** - Very similar with minor differences (strict)
- **0.7-0.89** - Mostly similar with moderate differences (balanced)
- **<0.7** - Significantly different (lenient)

**Recommended thresholds:**
- **0.95+** for generated files (e.g., migrations, configs)
- **0.80-0.90** for implementation code
- **0.70-0.80** for creative tasks with multiple valid solutions

### Use Cases

**1. Test-Driven Development**
```yaml
expected: tests-implemented
# Compare agent implementation against expected test-driven approach
```

**2. Refactoring Verification**
```yaml
expected: refactored-solution
# Ensure agent refactoring matches expected improvements
```

**3. Bug Fix Validation**
```yaml
expected: bug-fixed
# Compare agent's bug fix with known correct fix
```

### Interpretation

The expected-diff evaluator provides:

- **Aggregate Similarity**: Overall similarity score (0.0 to 1.0)
- **File-level Details**: Individual similarity for each file
- **Status Counts**: matched, changed, added, removed files

Example report section:

```
### expected-diff

| Metric | Value |
|--------|-------|
| Aggregate Similarity | 85.0% |
| Threshold | 80.0% |
| Files Matched | 5 |
| Files Changed | 2 |
| Files Added | 0 |
| Files Removed | 0 |

#### File-level Details

| File | Similarity | Status |
|------|-----------|--------|
| src/main.ts | 75.0% | 🔄 changed |
| src/utils.ts | 100.0% | ✓ matched |
```

## Built-in Evaluators

### git-diff

Analyzes Git changes made by the agent with assertion-based pass/fail criteria.

**Metrics:** files_changed, lines_added, lines_removed, total_changes, change_entropy

**Supported Assertions:**
- `max_files_changed` - Maximum number of files that can be changed
- `max_lines_added` - Maximum number of lines that can be added
- `max_lines_removed` - Maximum number of lines that can be removed
- `max_total_changes` - Maximum total changes (additions + deletions)
- `min_change_entropy` - Minimum entropy (enforces distributed changes)
- `max_change_entropy` - Maximum entropy (enforces focused changes)

**Example:**
```yaml
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5
        max_lines_added: 100
        max_change_entropy: 2.0  # Keep changes focused
```

### expected-diff

Compares agent output against expected reference branch.

**Metrics:** aggregate_similarity, threshold, files_matched, files_changed, files_added, files_removed, file_similarities

**Requires:** expected_source and expected configured in suite

### agentic-judge

Uses an AI agent to evaluate code quality based on custom assertions. The agent reads files, searches for patterns, and makes judgments like a human reviewer.

**Features:**
- Evaluable assertions as pass/fail
- Supports multiple independent judges for different areas
- Each judge maintains focused context (1-3 assertions recommended)

**Metrics:** Custom metrics based on your assertions

**Multiple Judges:** You can define multiple agentic-judge evaluators to break down evaluation into focused areas:

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

**Naming Convention:** Use `agentic-judge-<focus-area>` or `agentic-judge:<focus-area>` to create specialized judges.

**See:** [docs/multiple-agentic-judges.md](docs/multiple-agentic-judges.md) for detailed guide

## Development

### Setup

```bash
# Clone repository
git clone https://github.com/yourusername/youbencha.git
cd youbencha

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run with coverage
npm test -- --coverage
```

## Post-Evaluators: Exporting and Analyzing Results

Post-evaluations run after evaluation completes, enabling you to export results to external systems, run custom analysis, or trigger downstream workflows.

### Available Post-Evaluators

**1. Database Export** - Append results to JSONL file for time-series analysis

```yaml
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./results-history.jsonl
      include_full_bundle: true
      append: true
```

**2. Webhook** - POST results to HTTP endpoint

```yaml
post_evaluation:
  - name: webhook
    config:
      url: ${SLACK_WEBHOOK_URL}
      method: POST
      headers:
        Content-Type: "application/json"
      retry_on_failure: true
      timeout_ms: 5000
```

**3. Custom Script** - Execute custom analysis or integration

```yaml
post_evaluation:
  - name: script
    config:
      command: ./scripts/notify-slack.sh
      args:
        - "${RESULTS_PATH}"
      env:
        SLACK_WEBHOOK_URL: "${SLACK_WEBHOOK_URL}"
      timeout_ms: 30000
```

### Value Propositions

**Single Result**: Immediate feedback on one evaluation
- Quick validation during prompt engineering
- Debugging agent failures
- Understanding scope of changes

**Suite of Results**: Cross-test comparison
- Identify difficult tasks
- Compare agent configurations
- Aggregate metrics and pass rates

**Results Over Time**: Regression detection and trends
- Track performance changes across model/prompt updates
- Cost optimization and ROI tracking
- Long-term quality trends

### Example Scripts

See `examples/scripts/` for ready-to-use scripts:
- `notify-slack.sh` - Post results to Slack
- `analyze-trends.sh` - Analyze time-series data
- `detect-regression.sh` - Compare last two runs

### Documentation

- [Getting Started Guide](GETTING-STARTED.md) - Comprehensive walkthrough for new users
- [Post-Evaluation Guide](docs/post-evaluation.md) - Complete reference for post-evaluation hooks
- [Analyzing Results Guide](docs/analyzing-results.md) - Analysis patterns and best practices
- [Prompt Files Guide](docs/prompt-files.md) - Loading prompts from external files
- [Reusable Evaluators Guide](docs/reusable-evaluators.md) - Sharing evaluator configurations
- [Multiple Agentic Judges Guide](docs/multiple-agentic-judges.md) - Using multiple focused evaluators

### Project Structure

```
src/
  adapters/      - Agent adapters
  cli/           - CLI commands
  core/          - Core orchestration logic
  evaluators/    - Built-in evaluators
  post-evaluations/ - Post-evaluation exporters
  lib/           - Utility libraries
  reporters/     - Report generators
  schemas/       - Zod schemas for validation
tests/
  contract/      - Contract tests
  integration/   - Integration tests
  unit/          - Unit tests
```

## Architecture

youBencha follows a pluggable architecture:

- **Agent-Agnostic**: Agent-specific logic isolated in adapters
- **Pluggable Evaluators**: Add new evaluators without core changes
- **Reproducible**: Complete execution context captured
- **youBencha Log Compliance**: Normalized logging format across agents

## Security Considerations

### ⚠️ Important Security Notes

**Before running evaluations:**

1. **Suite configurations execute code**: Only run suite configurations from trusted sources
2. **Agent file system access**: Agents have full access to the workspace directory
3. **Isolation strongly recommended**: Run evaluations in containers or VMs for untrusted code
4. **Repository cloning**: Validates repository URLs but exercise caution with private repos

### Trusted Execution Environments

We recommend running youBencha in isolated environments:

```bash
# Docker example
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  node:20 \
  npx youbencha run -c suite.yaml

# Or use dedicated CI/CD runners
```

### Reporting Security Issues

Please report security vulnerabilities via [GitHub Security Advisories](https://github.com/youbencha/youbencha-cli/security/advisories) or email security@youbencha.dev. **Do not open public issues for security vulnerabilities.**

For more details, see [SECURITY.md](SECURITY.md).

## License

MIT
