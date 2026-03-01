#!/bin/bash
# Analyze trust from youBencha results history
# Computes per-assertion pass rates, overall trust scores, and model comparisons
#
# Usage: ./analyze-trust.sh <results-history.jsonl> [--test-name <name>] [--min-runs <n>]
#
# Examples:
#   ./analyze-trust.sh trust-ledger.jsonl
#   ./analyze-trust.sh trust-ledger.jsonl --test-name "Add Rate Limiting"
#   ./analyze-trust.sh trust-ledger.jsonl --min-runs 5

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <results-history.jsonl> [--test-name <name>] [--min-runs <n>]"
    echo ""
    echo "Options:"
    echo "  --test-name <name>   Filter by test case name"
    echo "  --min-runs <n>       Minimum runs for trust calculation (default: 3)"
    exit 1
fi

HISTORY_FILE=$1
shift

TEST_NAME=""
MIN_RUNS=3

while [[ $# -gt 0 ]]; do
    case $1 in
        --test-name) TEST_NAME="$2"; shift 2 ;;
        --min-runs) MIN_RUNS="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ ! -f "$HISTORY_FILE" ]; then
    echo "Error: File not found: $HISTORY_FILE"
    exit 1
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║               youBencha Trust Analysis                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Build jq filter
if [ -n "$TEST_NAME" ]; then
    FILTER=".test_case.name == \"$TEST_NAME\""
    echo "Filter: test_case.name == \"$TEST_NAME\""
else
    FILTER="true"
    echo "Filter: all test cases"
fi
echo ""

# ─── Section 1: Overall Trust Score ───

echo "━━━ Overall Trust Score ━━━"
jq -s --argjson min "$MIN_RUNS" "
    map(select($FILTER)) |
    if length < \$min then
        {
            status: \"insufficient_data\",
            runs: length,
            min_required: \$min,
            message: \"Need at least \\(\$min) runs for trust calculation\"
        }
    else
        length as \$total |
        map(select(.summary.overall_status == \"passed\")) | length as \$passed |
        {
            total_runs: \$total,
            passed: \$passed,
            failed: (\$total - \$passed),
            trust_score: ((\$passed / \$total * 100) | round),
            trust_level: (
                if (\$passed / \$total) >= 0.95 then \"HIGH — Ship confidently\"
                elif (\$passed / \$total) >= 0.80 then \"MODERATE — Ship with caveats\"
                elif (\$passed / \$total) >= 0.60 then \"LOW — Needs prompt refinement\"
                else \"VERY LOW — Agent struggles with this task\"
                end
            )
        }
    end
" "$HISTORY_FILE"
echo ""

# ─── Section 2: Per-Evaluator Pass Rates ───

echo "━━━ Per-Evaluator Pass Rates ━━━"
jq -s "
    map(select($FILTER)) |
    map(.evaluators[]) |
    group_by(.evaluator) |
    map({
        evaluator: .[0].evaluator,
        total: length,
        passed: (map(select(.status == \"passed\")) | length),
        failed: (map(select(.status == \"failed\")) | length),
        skipped: (map(select(.status == \"skipped\")) | length),
        pass_rate: ((map(select(.status == \"passed\")) | length) / length * 100 | round)
    }) |
    sort_by(.pass_rate)
" "$HISTORY_FILE"
echo ""

# ─── Section 3: Per-Assertion Scores (Agentic Judges) ───

echo "━━━ Per-Assertion Trust Scores ━━━"
jq -s "
    map(select($FILTER)) |
    map(.evaluators[] | select(.evaluator | startswith(\"agentic-judge\"))) |
    map(select(.assertions != null) | .assertions | to_entries[]) |
    group_by(.key) |
    map({
        assertion: .[0].key,
        samples: length,
        avg_score: (map(.value | if type == \"number\" then . else 0 end) | add / length * 100 | round),
        min_score: (map(.value | if type == \"number\" then . else 0 end) | min),
        max_score: (map(.value | if type == \"number\" then . else 0 end) | max),
        always_passes: (all(.value == 1)),
        never_passes: (all(.value == 0))
    }) |
    sort_by(.avg_score)
" "$HISTORY_FILE"
echo ""

# ─── Section 4: Trend (Last 5 Runs) ───

echo "━━━ Recent Trend (Last 5 Runs) ━━━"
jq -s "
    map(select($FILTER)) |
    .[-5:] |
    to_entries |
    map({
        run: (.key + 1),
        date: .value.exported_at,
        status: .value.summary.overall_status,
        passed: .value.summary.passed,
        failed: .value.summary.failed,
        duration_s: (.value.execution.duration_ms / 1000 | round)
    })
" "$HISTORY_FILE"
echo ""

# ─── Section 5: Model Comparison (if multiple models used) ───

echo "━━━ Model Comparison ━━━"
jq -s "
    map(select($FILTER)) |
    group_by(.agent.type) |
    map({
        agent: .[0].agent.type,
        runs: length,
        pass_rate: ((map(select(.summary.overall_status == \"passed\")) | length) / length * 100 | round),
        avg_duration_s: (map(.execution.duration_ms) | add / length / 1000 | round)
    }) |
    sort_by(.pass_rate) |
    reverse
" "$HISTORY_FILE"
echo ""

# ─── Section 6: Weakest Assertions (Trust Gaps) ───

echo "━━━ Trust Gaps (Weakest Assertions) ━━━"
jq -s "
    map(select($FILTER)) |
    map(.evaluators[] | select(.evaluator | startswith(\"agentic-judge\"))) |
    map(select(.assertions != null) | .assertions | to_entries[]) |
    group_by(.key) |
    map({
        assertion: .[0].key,
        avg_score_pct: (map(.value | if type == \"number\" then . else 0 end) | add / length * 100 | round)
    }) |
    sort_by(.avg_score_pct) |
    .[:5] |
    if length == 0 then [{note: \"No assertion data found\"}] else . end
" "$HISTORY_FILE"
echo ""

# ─── Section 7: Recommendation ───

TRUST=$(jq -s "
    map(select($FILTER)) |
    if length < $MIN_RUNS then -1
    else
        length as \$total |
        (map(select(.summary.overall_status == \"passed\")) | length / \$total * 100 | round)
    end
" "$HISTORY_FILE")

echo "━━━ Recommendation ━━━"
if [ "$TRUST" -eq -1 ]; then
    echo "⏳ Insufficient data — run more evaluations to build trust"
    echo "   Suggestion: yb run -c <testcase>.yaml  (repeat $MIN_RUNS+ times)"
elif [ "$TRUST" -ge 95 ]; then
    echo "✅ HIGH TRUST ($TRUST%) — Agent reliably implements this spec"
    echo "   Safe to use in production workflows"
elif [ "$TRUST" -ge 80 ]; then
    echo "🟡 MODERATE TRUST ($TRUST%) — Agent mostly succeeds but has occasional failures"
    echo "   Review failing assertions and consider refining the prompt"
elif [ "$TRUST" -ge 60 ]; then
    echo "🟠 LOW TRUST ($TRUST%) — Agent struggles with some requirements"
    echo "   Focus on weakest assertions above — consider breaking the task into smaller specs"
else
    echo "🔴 VERY LOW TRUST ($TRUST%) — Agent cannot reliably implement this spec"
    echo "   Consider: simpler spec, different model, or more detailed prompt"
fi
echo ""
