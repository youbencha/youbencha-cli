# Analyzing youBencha Results: From Single Runs to Time-Series Analysis

## Overview

This guide explains how to extract maximum value from youBencha results at different scales:
- **Single Result**: Quick feedback on one evaluation
- **Suite of Results**: Cross-test comparison and pattern recognition
- **Results Over Time**: Regression detection and trend analysis

## Single Result Analysis

### What You Get

A single evaluation produces a `ResultsBundle` JSON file with:

```json
{
  "version": "1.0.0",
  "test_case": {
    "name": "Add welcome message",
    "description": "...",
    "repo": "...",
    "branch": "main",
    "commit": "abc123"
  },
  "execution": {
    "started_at": "2025-01-15T10:00:00Z",
    "completed_at": "2025-01-15T10:05:00Z",
    "duration_ms": 300000,
    "youbencha_version": "1.0.0"
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
        "files_changed": 1,
        "lines_added": 5,
        "lines_removed": 0,
        "total_changes": 5,
        "change_entropy": 0.0
      },
      "duration_ms": 245
    },
    {
      "evaluator": "agentic-judge",
      "status": "passed",
      "metrics": {
        "readme_was_modified": 1.0,
        "message_is_friendly": 1.0,
        "no_errors": 1.0
      },
      "duration_ms": 1523
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

### Key Insights from Single Results

1. **Binary Success**: Did the agent complete the task? (`summary.overall_status`)
2. **Scope of Changes**: How many files and lines changed? (`git-diff.metrics`)
3. **Quality Assessment**: Did it meet specific assertions? (`agentic-judge.metrics`)
4. **Performance**: How long did it take? (`execution.duration_ms`)
5. **Cost Tracking**: Token usage (in `youbencha.log.json`)

### Practical Use Cases

**During Prompt Engineering:**
```bash
# Quick iteration loop
yb run -c test.yaml
yb report --from .youbencha-workspace/.../artifacts/results.json

# Check key metrics
jq '.summary.overall_status' results.json
jq '.evaluators[] | select(.evaluator == "git-diff") | .metrics' results.json
```

**Debugging Failures:**
```bash
# Inspect failed evaluators
jq '.evaluators[] | select(.status == "failed")' results.json

# View agent logs
cat .youbencha-workspace/.../artifacts/youbencha.log.json

# Check diff
cat .youbencha-workspace/.../artifacts/git-diff.patch
```

## Suite of Results Analysis

### Multiple Test Cases, Same Agent

When you run multiple test cases with the same agent configuration, you can compare:

**Aggregate Success Rate:**
```bash
# Run test cases
for test in tests/*.yaml; do
    yb run -c "$test"
done

# Calculate pass rate
jq -s 'map(.summary.overall_status == "passed") | map(select(.) | 1) | add / length' results/*.json
```

**Identify Difficult Tasks:**
```bash
# Find test cases with most failures
jq -s 'map({
    name: .test_case.name,
    passed: (.summary.passed / .summary.total_evaluators)
}) | sort_by(.passed)' results/*.json
```

**Cost Analysis:**
```bash
# Total execution time across test cases
jq -s 'map(.execution.duration_ms) | add / 1000' results/*.json  # in seconds

# Average changes per test
jq -s 'map(.evaluators[] | select(.evaluator == "git-diff") | .metrics.total_changes) | add / length' results/*.json
```

### Compare Different Agents/Models

Run the same test case with different configurations:

```yaml
# test-gpt-5.yaml
agent:
  type: copilot-cli
  model: gpt-5
  config:
    prompt: "Add authentication middleware"

# test-claude.yaml
agent:
  type: copilot-cli
  model: claude-sonnet-4
  config:
    prompt: "Add authentication middleware"
```

**Comparison Metrics:**
```bash
# Success rate by model
jq -n '[
    inputs | {
        model: .agent.type,
        status: .summary.overall_status,
        duration: .execution.duration_ms
    }
]' gpt-results.json claude-results.json

# Quality scores by model
jq -n '[
    inputs | {
        model: .agent.type,
        scores: [.evaluators[] | select(.evaluator == "agentic-judge") | .metrics | to_entries[] | .value]
    }
]' gpt-results.json claude-results.json
```

## Time-Series Analysis

### Exporting Results Over Time

Use the database post-evaluation to append results to a JSONL file:

```yaml
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./history/results.jsonl
      include_full_bundle: true
      append: true
```

This creates a time-series dataset:

```jsonl
{"version":"1.0.0","test_case":{...},"execution":{...},"exported_at":"2025-01-15T10:00:00Z"}
{"version":"1.0.0","test_case":{...},"execution":{...},"exported_at":"2025-01-16T10:00:00Z"}
{"version":"1.0.0","test_case":{...},"execution":{...},"exported_at":"2025-01-17T10:00:00Z"}
```

### Regression Detection

**Did the latest model update break anything?**

```bash
# Compare last 2 runs for same test
tail -n 2 history/results.jsonl | jq -s '
    [{
        date: .[0].exported_at,
        status: .[0].summary.overall_status,
        passed: .[0].summary.passed
    }, {
        date: .[1].exported_at,
        status: .[1].summary.overall_status,
        passed: .[1].summary.passed
    }]
'

# Alert if regression
PREV=$(tail -n 2 history/results.jsonl | head -n 1 | jq '.summary.passed')
CURR=$(tail -n 1 history/results.jsonl | jq '.summary.passed')
if [ "$CURR" -lt "$PREV" ]; then
    echo "⚠️ REGRESSION DETECTED: Passed evaluators decreased from $PREV to $CURR"
fi
```

### Trend Analysis

**Extract metrics over time:**

```bash
# Pass rate trend (last 30 days)
jq -r '[.exported_at, (.summary.passed / .summary.total_evaluators)] | @csv' history/results.jsonl > pass_rate.csv

# Average execution time trend
jq -r '[.exported_at, .execution.duration_ms] | @csv' history/results.jsonl > duration.csv

# Change scope trend
jq -r '[.exported_at, (.evaluators[] | select(.evaluator == "git-diff") | .metrics.total_changes)] | @csv' history/results.jsonl > changes.csv
```

**Visualize with any tool:**

```python
# example with pandas
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('pass_rate.csv', names=['date', 'pass_rate'])
df['date'] = pd.to_datetime(df['date'])
df.plot(x='date', y='pass_rate', title='Agent Pass Rate Over Time')
plt.show()
```

### Cost Tracking

**Monthly token usage and cost:**

```bash
# Extract token counts from logs (requires youbencha.log.json)
jq -r '[
    .exported_at,
    .test_case.name,
    (.agent.youbencha_log_path | "cat .youbencha-workspace/*/artifacts/\(.)"),
    (.agent.youbencha_log_path | `jq ".tokens.total" \(.)`)
] | @csv' history/results.jsonl
```

## Advanced Analysis Patterns

### Correlation Analysis

**Do smaller changes correlate with higher quality scores?**

```bash
jq -s 'map({
    changes: (.evaluators[] | select(.evaluator == "git-diff") | .metrics.total_changes),
    quality: (.evaluators[] | select(.evaluator == "agentic-judge") | .metrics | to_entries | map(.value) | add / length)
}) | group_by(.changes < 10) | map({
    small_changes: .[0].changes < 10,
    avg_quality: (map(.quality) | add / length)
})' history/results.jsonl
```

### Performance Benchmarking

**Compare agent versions:**

```bash
# Group by agent version/model
jq -s 'group_by(.agent.type + "-" + (.agent.config.model // "default")) | map({
    agent: .[0].agent.type,
    model: .[0].agent.config.model,
    runs: length,
    success_rate: (map(select(.summary.overall_status == "passed")) | length / length),
    avg_duration: (map(.execution.duration_ms) | add / length),
    avg_changes: (map(.evaluators[] | select(.evaluator == "git-diff") | .metrics.total_changes) | add / length)
})' history/results.jsonl
```

### Anomaly Detection

**Detect unusual results:**

```bash
# Find outliers in execution time
jq -s '
    map(.execution.duration_ms) as $durations |
    ($durations | add / length) as $mean |
    ($durations | map(. - $mean | . * .) | add / length | sqrt) as $stddev |
    map(select(.execution.duration_ms > ($mean + 2 * $stddev))) |
    map({
        test: .test_case.name,
        duration: .execution.duration_ms,
        date: .exported_at
    })
' history/results.jsonl
```

## Integration with External Systems

### Webhook Notifications

Post results to Slack/Teams/Discord on completion:

```yaml
post_evaluation:
  - name: webhook
    config:
      url: ${SLACK_WEBHOOK_URL}
      method: POST
      headers:
        Content-Type: "application/json"
      retry_on_failure: true
```

**Custom webhook payload transformations** (use script post-evaluation):

```yaml
post_evaluation:
  - name: script
    config:
      command: ./scripts/notify-slack.sh
      args:
        - "${RESULTS_PATH}"
      env:
        SLACK_WEBHOOK_URL: "${SLACK_WEBHOOK_URL}"
```

```bash
#!/bin/bash
# notify-slack.sh
RESULTS=$1
STATUS=$(jq -r '.summary.overall_status' "$RESULTS")
NAME=$(jq -r '.test_case.name' "$RESULTS")

if [ "$STATUS" = "failed" ]; then
    MESSAGE="❌ Test '$NAME' failed"
    COLOR="danger"
else
    MESSAGE="✅ Test '$NAME' passed"
    COLOR="good"
fi

curl -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"attachments\":[{\"color\":\"$COLOR\",\"text\":\"$MESSAGE\"}]}"
```

### Database Integration

For production-grade time-series analysis, export to a proper database:

```yaml
# Future: direct database export
post_evaluation:
  - name: script
    config:
      command: python3
      args:
        - ./scripts/export-to-db.py
        - "${RESULTS_PATH}"
      env:
        DATABASE_URL: "${DATABASE_URL}"
```

```python
# export-to-db.py
import json
import sys
from sqlalchemy import create_engine
import os

with open(sys.argv[1]) as f:
    results = json.load(f)

engine = create_engine(os.environ['DATABASE_URL'])

# Insert into normalized tables
# (implementation depends on your schema)
```

### CI/CD Integration

**Fail builds on regression:**

```bash
#!/bin/bash
# ci-check.sh

yb run -c testcase-regression.yaml

# Check results
FAILED=$(jq '.summary.failed' .youbencha-workspace/.../artifacts/results.json)

if [ "$FAILED" -gt 0 ]; then
    echo "❌ Regression tests failed"
    exit 1
fi

echo "✅ All regression tests passed"
exit 0
```

## Best Practices

1. **Consistent Test Cases**: Use the same prompts and repos for trend analysis
2. **Version Control**: Store test cases in git for reproducibility
3. **Regular Cadence**: Run evaluations on a schedule (daily/weekly)
4. **Export Early**: Start collecting time-series data from day 1
5. **Normalize Metrics**: Use relative metrics (%, ratios) for cross-test comparison
6. **Document Baselines**: Record expected performance for each test case
7. **Alert on Regressions**: Set up automated notifications for failures
8. **Archive Artifacts**: Keep workspace directories for deep debugging

## Example Dashboards

### Daily Summary Report

```bash
#!/bin/bash
# daily-report.sh

echo "# youBencha Daily Report - $(date +%Y-%m-%d)"
echo ""
echo "## Summary"
TODAY=$(date +%Y-%m-%d)
jq -s --arg date "$TODAY" '
    map(select(.exported_at | startswith($date))) |
    {
        total_runs: length,
        passed: map(select(.summary.overall_status == "passed")) | length,
        failed: map(select(.summary.overall_status == "failed")) | length,
        avg_duration: (map(.execution.duration_ms) | add / length / 1000) | round,
        total_evaluators: (map(.summary.total_evaluators) | add),
        passed_evaluators: (map(.summary.passed) | add)
    }
' history/results.jsonl
```

### Weekly Trend Report

```bash
#!/bin/bash
# weekly-report.sh

WEEK_AGO=$(date -d '7 days ago' +%Y-%m-%d)

jq -s --arg week "$WEEK_AGO" '
    map(select(.exported_at >= $week)) |
    group_by(.test_case.name) |
    map({
        test: .[0].test_case.name,
        runs: length,
        success_rate: (map(select(.summary.overall_status == "passed")) | length / length * 100 | round),
        avg_duration: (map(.execution.duration_ms) | add / length / 1000 | round)
    })
' history/results.jsonl
```

## Conclusion

youBencha results provide value at every scale:

- **Single runs**: Immediate feedback for development
- **Suites**: Cross-comparison and capability assessment
- **Time-series**: Regression detection and trend analysis

By leveraging post-evaluations to export results to databases, webhooks, or custom scripts, you can build a comprehensive evaluation and monitoring system for your AI agents.
