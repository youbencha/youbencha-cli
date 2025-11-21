# Example Scripts for Pre-Execution and Post-Evaluation

This directory contains example scripts for youBencha pre-execution hooks and post-evaluation processing.

## Pre-Execution Scripts

Pre-execution scripts run **after workspace setup but before agent execution**. They enable:

### Use Cases
- **Environment Variable Injection**: Inject API keys, secrets, or configuration
- **Code Preprocessing**: Search and replace tokens, placeholders
- **Code Generation**: Generate types, interfaces, or boilerplate
- **Setup Tasks**: Initialize databases, create mock data
- **File Manipulation**: Copy config files, create directories

### Available Environment Variables
Pre-execution scripts receive these environment variables:
- `WORKSPACE_DIR`: Path to the workspace where agent will work
- `REPO_DIR`: Path to repository (same as WORKSPACE_DIR)
- `ARTIFACTS_DIR`: Path to artifacts directory
- `TEST_CASE_NAME`: Name of the test case
- `REPO_URL`: Repository URL being tested
- `BRANCH`: Branch being tested

### Example: `setup-env.sh`
Demonstrates environment setup, config file creation, and variable injection.

```yaml
pre_execution:
  - name: script
    config:
      command: ./examples/scripts/setup-env.sh
      args:
        - "${WORKSPACE_DIR}"
      env:
        API_KEY: "test-key-123"
        ENV: "development"
      timeout_ms: 30000
```

---

## Post-Evaluation Scripts

Post-evaluation scripts run **after evaluation completes**. They enable results analysis and export.

### Scripts

### notify-slack.sh

Posts evaluation results to a Slack webhook.

**Usage:**
```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
./notify-slack.sh /path/to/results.json
```

**Integration with youBencha:**
```yaml
post_evaluation:
  - name: script
    config:
      command: ./examples/scripts/notify-slack.sh
      args:
        - "${RESULTS_PATH}"
      env:
        SLACK_WEBHOOK_URL: "${SLACK_WEBHOOK_URL}"
```

### analyze-trends.sh

Analyzes trends from a results history file (JSONL format).

**Usage:**
```bash
./analyze-trends.sh results-history.jsonl
```

Shows:
- Total runs and overall success rate
- Average metrics (duration, evaluators passed, files changed)
- Recent trend (last 7 days)
- Most common test failures

### detect-regression.sh

Compares the last two runs to detect regressions.

**Usage:**
```bash
# Check all tests
./detect-regression.sh results-history.jsonl

# Check specific test
./detect-regression.sh results-history.jsonl "Add welcome message"
```

**Exit codes:**
- 0: No regression detected
- 1: Regression detected

**CI Integration:**
```bash
# In your CI pipeline
yb run -c test.yaml

# Append to history
cat .youbencha-workspace/*/artifacts/results.json >> results-history.jsonl

# Check for regression
if ! ./examples/scripts/detect-regression.sh results-history.jsonl; then
    echo "Regression detected - failing build"
    exit 1
fi
```

## Requirements

All scripts require:
- `jq` - JSON processor (https://jqlang.github.io/jq/)
- `bash` - Shell scripting

Install jq:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Windows (WSL)
sudo apt-get install jq
```

## Customization

These scripts are templates - feel free to modify them for your needs:

- Add more metrics to track
- Change notification formats
- Integrate with different services
- Add alerting thresholds
- Export to databases

## More Examples

See the main documentation for more analysis patterns:
- [Post-Evaluation Guide](../../docs/post-evaluation.md)
- [Analyzing Results Guide](../../docs/analyzing-results.md)
