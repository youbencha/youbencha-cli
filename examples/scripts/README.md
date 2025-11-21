# Example Post-Evaluation Scripts

This directory contains example scripts for analyzing and processing youBencha results.

## Scripts

### notify-slack.sh

Posts evaluation results to a Slack webhook.

**Usage:**
```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
./notify-slack.sh /path/to/results.json
```

**Integration with youBencha:**
```yaml
post_evaluators:
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
