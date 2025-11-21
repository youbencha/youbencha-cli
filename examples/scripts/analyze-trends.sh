#!/bin/bash
# Analyze trends from youBencha results history (JSONL file)
# Usage: ./analyze-trends.sh results-history.jsonl

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <results-history.jsonl>"
    exit 1
fi

HISTORY_FILE=$1

if [ ! -f "$HISTORY_FILE" ]; then
    echo "Error: File not found: $HISTORY_FILE"
    exit 1
fi

echo "=== youBencha Results Trend Analysis ==="
echo ""

# Total runs
TOTAL_RUNS=$(wc -l < "$HISTORY_FILE")
echo "Total Runs: $TOTAL_RUNS"
echo ""

# Overall success rate
echo "=== Overall Success Rate ==="
jq -s '
    map(select(.summary.overall_status == "passed")) | length as $passed |
    (input | length) as $total |
    {
        passed: $passed,
        total: $total,
        success_rate: (($passed / $total) * 100 | round)
    }
' "$HISTORY_FILE" "$HISTORY_FILE"
echo ""

# Average metrics
echo "=== Average Metrics ==="
jq -s '
    {
        avg_duration_seconds: (map(.execution.duration_ms) | add / length / 1000 | round),
        avg_evaluators_passed: (map(.summary.passed) | add / length | round),
        avg_files_changed: (
            map(.evaluators[] | select(.evaluator == "git-diff") | .metrics.files_changed // 0) |
            if length > 0 then (add / length | round) else 0 end
        )
    }
' "$HISTORY_FILE"
echo ""

# Recent trend (last 7 days)
echo "=== Recent Trend (Last 7 Days) ==="
WEEK_AGO=$(date -d '7 days ago' --iso-8601=seconds 2>/dev/null || date -v-7d -Iseconds)
jq -s --arg week "$WEEK_AGO" '
    map(select(.exported_at >= $week)) |
    {
        runs_last_7_days: length,
        success_rate: ((map(select(.summary.overall_status == "passed")) | length / length) * 100 | round),
        avg_duration: (map(.execution.duration_ms) | add / length / 1000 | round)
    }
' "$HISTORY_FILE"
echo ""

# Most common failures
echo "=== Most Common Test Failures ==="
jq -s '
    map(select(.summary.overall_status == "failed")) |
    group_by(.test_case.name) |
    map({
        test: .[0].test_case.name,
        failures: length
    }) |
    sort_by(.failures) |
    reverse |
    .[:5]
' "$HISTORY_FILE"
echo ""

echo "Analysis complete!"
