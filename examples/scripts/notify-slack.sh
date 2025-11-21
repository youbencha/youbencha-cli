#!/bin/bash
# Example script for posting youBencha results to Slack
# Usage: ./notify-slack.sh /path/to/results.json

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <results-json-path>"
    exit 1
fi

RESULTS_PATH=$1

if [ -z "$SLACK_WEBHOOK_URL" ]; then
    echo "Error: SLACK_WEBHOOK_URL environment variable not set"
    exit 1
fi

# Extract key information from results
STATUS=$(jq -r '.summary.overall_status' "$RESULTS_PATH")
NAME=$(jq -r '.test_case.name' "$RESULTS_PATH")
PASSED=$(jq -r '.summary.passed' "$RESULTS_PATH")
FAILED=$(jq -r '.summary.failed' "$RESULTS_PATH")
TOTAL=$(jq -r '.summary.total_evaluators' "$RESULTS_PATH")
DURATION=$(jq -r '.execution.duration_ms / 1000 | round' "$RESULTS_PATH")

# Determine color and emoji based on status
if [ "$STATUS" = "passed" ]; then
    COLOR="good"
    EMOJI="✅"
elif [ "$STATUS" = "failed" ]; then
    COLOR="danger"
    EMOJI="❌"
else
    COLOR="warning"
    EMOJI="⚠️"
fi

# Build Slack message
MESSAGE="$EMOJI Test: *$NAME*
Status: $STATUS
Evaluators: $PASSED passed, $FAILED failed (of $TOTAL total)
Duration: ${DURATION}s"

# Post to Slack
curl -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{
        \"attachments\": [{
            \"color\": \"$COLOR\",
            \"text\": \"$MESSAGE\",
            \"mrkdwn_in\": [\"text\"]
        }]
    }"

echo "Notification sent to Slack"
