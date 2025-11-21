#!/bin/bash
# Detect regressions by comparing the last two runs
# Usage: ./detect-regression.sh results-history.jsonl [test-case-name]

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <results-history.jsonl> [test-case-name]"
    exit 1
fi

HISTORY_FILE=$1
TEST_CASE_NAME=${2:-}

if [ ! -f "$HISTORY_FILE" ]; then
    echo "Error: File not found: $HISTORY_FILE"
    exit 1
fi

# Filter by test case name if provided
if [ -n "$TEST_CASE_NAME" ]; then
    FILTER=".test_case.name == \"$TEST_CASE_NAME\""
else
    FILTER="true"
fi

# Get last two runs
LAST_TWO=$(jq -s "map(select($FILTER)) | .[-2:]" "$HISTORY_FILE")

COUNT=$(echo "$LAST_TWO" | jq 'length')

if [ "$COUNT" -lt 2 ]; then
    echo "Not enough runs for comparison (need at least 2, found $COUNT)"
    exit 0
fi

# Compare the two runs
COMPARISON=$(echo "$LAST_TWO" | jq '
    .[0] as $prev | .[1] as $curr |
    {
        previous: {
            date: $prev.exported_at,
            status: $prev.summary.overall_status,
            passed: $prev.summary.passed,
            failed: $prev.summary.failed
        },
        current: {
            date: $curr.exported_at,
            status: $curr.summary.overall_status,
            passed: $curr.summary.passed,
            failed: $curr.summary.failed
        },
        regression: (
            ($curr.summary.overall_status == "failed" and $prev.summary.overall_status != "failed") or
            ($curr.summary.passed < $prev.summary.passed)
        )
    }
')

echo "=== Regression Detection ==="
echo "$COMPARISON" | jq '.'

# Check for regression
IS_REGRESSION=$(echo "$COMPARISON" | jq -r '.regression')

if [ "$IS_REGRESSION" = "true" ]; then
    echo ""
    echo "⚠️  REGRESSION DETECTED!"
    echo ""
    echo "The most recent run performed worse than the previous run."
    exit 1
else
    echo ""
    echo "✅ No regression detected"
    exit 0
fi
