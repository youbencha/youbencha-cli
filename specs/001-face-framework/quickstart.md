# Quickstart Guide: youBencha Framework MVP

**Date**: 2025-11-03  
**Feature**: 001-face-framework  
**Purpose**: Fast-track developers from zero to first evaluation run

---

## Prerequisites

- **Node.js 20+** installed ([download](https://nodejs.org/))
- **Git** installed and configured
- **GitHub Copilot CLI** installed and authenticated (for agent evaluation)
  ```bash
  # Install GitHub Copilot CLI
  npm install -g @githubnext/github-copilot-cli
  
  # Authenticate
  github-copilot-cli auth login
  ```

---

## Installation

```bash
# Clone youBencha repository
git clone https://github.com/your-org/youBencha.git
cd youBencha

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install globally (optional)
npm link
```

---

## Quick Start: Run Your First Evaluation

### Step 1: Create a Suite Configuration

Create `my-suite.yaml`:

```yaml
# Repository to evaluate
repo: https://github.com/example/my-project
branch: main

# Agent configuration
agent:
  type: copilot-cli
  config:
    prompt: "Add error handling to the login function"

# Evaluators to run
evaluators:
  - name: git-diff
    config: {}
  
  - name: agentic-judge
    config:
      criteria: "Code includes proper error handling with try-catch blocks"
      model: gpt-4
```

### Step 2: Run Evaluation

```bash
yb run -c my-suite.yaml
```

**What happens**:
1. ✅ youBencha clones the repository into `.youbencha-workspace/run-<timestamp>/src-modified/`
2. ✅ GitHub Copilot CLI executes with your prompt
3. ✅ Agent output is normalized to youBencha Log format
4. ✅ Evaluators run in parallel analyzing the changes
5. ✅ Results are saved to `.youbencha-workspace/run-<timestamp>/artifacts/results.json`

**Expected output**:
```
🚀 Starting youBencha evaluation...
📦 Cloning repository: https://github.com/example/my-project
🤖 Executing agent: copilot-cli
⏱️  Agent completed in 12.3s
🔍 Running 2 evaluators...
  ✓ git-diff (0.5s)
  ✓ agentic-judge (3.2s)
✅ Evaluation complete!
📄 Results: .youbencha-workspace/run-2025-11-03-143022/artifacts/results.json
```

### Step 3: Generate Human-Readable Report

```bash
yb report --from .youbencha-workspace/run-2025-11-03-143022/artifacts/results.json
```

**Output**: Markdown report at `.youbencha-workspace/run-2025-11-03-143022/artifacts/report.md`

---

## Example: Compare Against Expected Reference

### Step 1: Create Suite with Expected Reference

Create `compare-suite.yaml`:

```yaml
repo: https://github.com/example/my-project
branch: main

# Expected reference configuration
expected_source: branch
expected: feature/ai-completed  # Branch with ideal implementation

agent:
  type: copilot-cli
  config:
    prompt: "Implement user authentication"

evaluators:
  - name: expected-diff
    config:
      threshold: 0.80  # Require 80% similarity to expected
  
  - name: git-diff
    config: {}
```

### Step 2: Run Evaluation

```bash
yb run -c compare-suite.yaml
```

**What happens**:
1. ✅ Clones `main` branch into `src-modified/`
2. ✅ Clones `feature/ai-completed` branch into `src-expected/`
3. ✅ Agent modifies code in `src-modified/`
4. ✅ `expected-diff` evaluator compares the two directories
5. ✅ Produces similarity score (0.0-1.0) and detailed diff

**Expected output**:
```
🚀 Starting youBencha evaluation...
📦 Cloning source branch: main
📦 Cloning expected branch: feature/ai-completed
🤖 Executing agent: copilot-cli
⏱️  Agent completed in 15.7s
🔍 Running 2 evaluators...
  ✓ expected-diff (1.2s) - 87% similar to expected
  ✓ git-diff (0.4s)
✅ Evaluation complete!
```

---

## Example: Auto-Suggest Evaluators

### Step 1: Analyze Branch Differences

```bash
yb suggest-eval --source main --expected feature/completed
```

**What happens**:
1. ✅ Clones both branches
2. ✅ Analyzes differences (files changed, patterns detected)
3. ✅ Maps patterns to relevant evaluators
4. ✅ Generates `suggested-suite.yaml` with recommended configuration

**Expected output**:
```
🔍 Analyzing branches...
  Source: main (commit abc123)
  Expected: feature/completed (commit def456)

📊 Changes detected:
  • 12 files modified
  • 487 lines added, 123 lines removed
  • Test files added: 3
  • Configuration changed: package.json

💡 Suggested evaluators:
  1. expected-diff (compare implementation to ideal)
  2. git-diff (track structural changes)
  3. agentic-judge (assess test coverage quality)

📝 Suite template saved to: suggested-suite.yaml
```

### Step 2: Review and Run Suggested Suite

```bash
# Review suggestions
cat suggested-suite.yaml

# Run with suggested configuration
yb run -c suggested-suite.yaml
```

---

## Understanding Results

### Results JSON Structure

```json
{
  "version": "1.0.0",
  "suite": {
    "repo": "https://github.com/example/my-project",
    "branch": "main",
    "commit": "abc123def456"
  },
  "execution": {
    "started_at": "2025-11-03T14:30:22.123Z",
    "completed_at": "2025-11-03T14:30:37.456Z",
    "duration_ms": 15333
  },
  "agent": {
    "type": "copilot-cli",
    "status": "success",
    "exit_code": 0
  },
  "evaluators": [
    {
      "evaluator": "git-diff",
      "status": "passed",
      "metrics": {
        "files_changed": 3,
        "lines_added": 45,
        "lines_removed": 12
      },
      "message": "3 files changed, 45 insertions(+), 12 deletions(-)",
      "duration_ms": 523
    },
    {
      "evaluator": "agentic-judge",
      "status": "passed",
      "metrics": {
        "score": 0.85
      },
      "message": "Code includes proper error handling (score: 0.85/1.0)",
      "duration_ms": 3241
    }
  ],
  "summary": {
    "total_evaluators": 2,
    "passed": 2,
    "failed": 0,
    "skipped": 0,
    "overall_status": "passed"
  }
}
```

### Markdown Report Example

```markdown
# youBencha Evaluation Report

**Repository**: https://github.com/example/my-project  
**Branch**: main (abc123def456)  
**Date**: 2025-11-03 14:30:22  
**Duration**: 15.3s  
**Status**: ✅ PASSED

## Agent Execution

- **Type**: copilot-cli
- **Status**: success
- **Duration**: 12.3s

## Evaluator Results

### ✅ git-diff (0.5s)

**Status**: PASSED

**Metrics**:
- Files changed: 3
- Lines added: 45
- Lines removed: 12

**Message**: 3 files changed, 45 insertions(+), 12 deletions(-)

---

### ✅ agentic-judge (3.2s)

**Status**: PASSED

**Metrics**:
- Score: 0.85

**Message**: Code includes proper error handling (score: 0.85/1.0)

---

## Summary

- Total evaluators: 2
- Passed: 2
- Failed: 0
- Skipped: 0
- Overall: ✅ PASSED
```

---

## Common Use Cases

### 1. Regression Testing in CI

```yaml
# .github/workflows/agent-eval.yml
name: youBencha Evaluation

on: [pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install youBencha
        run: npm install -g @youBencha/cli
      
      - name: Run evaluation
        run: yb run -c .youbencha/pr-suite.yaml
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: youBencha-results
          path: .youbencha-workspace/*/artifacts/results.json
```

### 2. Compare Multiple Prompts

```bash
# Evaluate prompt variations
yb run -c prompt-v1.yaml
yb run -c prompt-v2.yaml
yb run -c prompt-v3.yaml

# Compare results
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

### 3. Iterative Improvement

```bash
# Baseline evaluation
yb run -c baseline.yaml

# Promote successful run as expected reference
git checkout -b expected-baseline
git add .
git commit -m "Baseline implementation"

# Future iterations compare against baseline
# (update suite to use expected_source: branch, expected: expected-baseline)
```

---

## Configuration Reference

### Suite Configuration Options

```yaml
# Required
repo: string                    # Git repository URL
agent:
  type: string                  # 'copilot-cli' (MVP only)
  config: object                # Agent-specific config
evaluators:
  - name: string                # Evaluator name
    config: object              # Evaluator-specific config

# Optional
branch: string                  # Default: main/master
commit: string                  # Specific commit SHA
expected_source: 'branch'       # Expected reference type (MVP: branch only)
expected: string                # Expected reference value (branch name)
workspace_dir: string           # Default: .youbencha-workspace
timeout: number                 # Seconds, default: 1800 (30 min)
```

### Environment Variables

```bash
# OpenAI API key (for agentic-judge evaluator)
export OPENAI_API_KEY=sk-...

# Custom workspace location
export YOUBENCHA_WORKSPACE_DIR=/tmp/youbencha-workspaces

# Disable colored output (for CI)
export NO_COLOR=1

# Log level (debug, info, warn, error)
export YOUBENCHA_LOG_LEVEL=debug
```

---

## Troubleshooting

### "Agent not found" Error

**Problem**: `copilot-cli` not installed or not in PATH

**Solution**:
```bash
# Check if installed
which github-copilot-cli

# Install if missing
npm install -g @githubnext/github-copilot-cli

# Verify
github-copilot-cli --version
```

### "Repository clone failed" Error

**Problem**: Invalid Git URL or authentication issue

**Solution**:
- Verify repository URL is correct
- Ensure SSH key or HTTPS credentials configured
- Try cloning manually: `git clone <repo-url>`

### "Evaluator skipped" Warning

**Problem**: Evaluator preconditions not met

**Common causes**:
- `expected-diff` evaluator requires `expected_source` configuration
- `agentic-judge` evaluator requires `OPENAI_API_KEY` environment variable

**Solution**: Check evaluator requirements in suite config

### "Workspace locked" Error

**Problem**: Previous evaluation didn't complete or clean up

**Solution**:
```bash
# Remove lock file
rm .youbencha-workspace/*/.lock

# Or clean entire workspace
rm -rf .youbencha-workspace
```

---

## Next Steps

- **Read the full documentation**: `docs/README.md`
- **Explore evaluator options**: `docs/evaluators.md`
- **Add custom evaluators**: `docs/extending.md`
- **Configure CI/CD**: `docs/ci-integration.md`
- **Join the community**: [GitHub Discussions](https://github.com/your-org/youBencha/discussions)

---

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- adapter.test.ts

# Watch mode
npm test -- --watch
```

### Building from Source

```bash
# TypeScript compilation
npm run build

# Watch mode for development
npm run build:watch

# Lint code
npm run lint

# Format code
npm run format
```

### Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Write tests first (TDD requirement)
4. Implement feature
5. Verify tests pass: `npm test`
6. Submit pull request

---

**Ready to evaluate your first agent!** 🚀

Run `youBencha --help` for full CLI documentation.



