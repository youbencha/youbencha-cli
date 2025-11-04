# youBencha

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

## Quick Start

### 1. Create a Suite Configuration

Create a `suite.yaml` file:

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
      criteria:
        - "README.md was modified"
        - "A helpful comment was added"
```

### 2. Run an Evaluation

```bash
yb run -c suite.yaml
```

This will:
1. Clone the repository to an isolated workspace
2. Execute the agent with your prompt
3. Run all configured evaluators
4. Generate a results bundle

### 3. Generate a Report

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

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

## Built-in Evaluators

### git-diff

Analyzes Git changes made by the agent.

**Metrics:** files_changed, lines_added, lines_removed, change_entropy

### agentic-judge

Uses an agent to judge the quality of changes based on criteria.

**Metrics:** score, criteria_met

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

### Project Structure

```
src/
  adapters/      - Agent adapters
  cli/           - CLI commands
  core/          - Core orchestration logic
  evaluators/    - Built-in evaluators
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

## License

MIT
