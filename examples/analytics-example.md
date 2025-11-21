# Example: Using Analytics to Improve Agent Performance

This example demonstrates how to use the `yb analyze` command to identify issues and improve your agent's performance.

## Scenario

You're evaluating an AI agent's ability to implement a user authentication feature. After running the evaluation, you want to understand what worked, what didn't, and how to improve.

## Step 1: Run the Evaluation

```bash
# Run your evaluation suite
yb run -c auth-feature-suite.yaml

# Output shows:
# ❌ Evaluation failed
# Results: .youbencha-workspace/run-20251121-120000/artifacts/results.json
```

The evaluation failed, but it's not immediately clear why or what to do about it.

## Step 2: Analyze the Results

```bash
# Run analysis
yb analyze --from .youbencha-workspace/run-20251121-120000/artifacts/results.json
```

### Console Output

```
[youBencha] [INFO] Analyzing results from .youbencha-workspace/run-20251121-120000/artifacts/results.json

[youBencha] [INFO] 🔍 Analyzing evaluation results...

[youBencha] [INFO] Analysis Complete:
[youBencha] [INFO]   ├─ Insights: 4
[youBencha] [INFO]   ├─ Recommendations: 3
[youBencha] [INFO]   └─ Success Rate: 66.7%

[youBencha] [INFO] 📊 Generating analytics report...

[youBencha] [INFO] 🔴 High Priority Recommendations:
[youBencha] [INFO]   • Improve Agent Output Quality
[youBencha] [INFO]     Review the prompt, increase context, or adjust the expected reference threshold in your suite configuration

[youBencha] [INFO] ✅ Analysis complete
[youBencha] [INFO]   Report: .youbencha-workspace/run-20251121-120000/artifacts/analysis.md

[youBencha] [INFO] Quick Summary:
[youBencha] [INFO]   ❌ 2 issue(s) found
[youBencha] [INFO]   ⚠️  1 warning(s)
[youBencha] [INFO]   ✅ 1 success(es)
```

## Step 3: Review the Analysis Report

The generated `analysis.md` file contains:

### Executive Summary
```markdown
## Executive Summary

### ❌ FAILED

| Metric | Value |
|--------|-------|
| Overall Status | ❌ failed |
| Evaluators Passed | 2/3 |
| Success Rate | 66.7% |
| Total Duration | 510.0s |
| Agent | copilot-cli (success) |
```

**Key Finding**: The agent completed successfully, but one evaluator failed.

### Key Insights

```markdown
## Key Insights

### ✅ Successes
- **Agent Execution:** Agent (copilot-cli) completed successfully

### ❌ Issues
- **Overall Performance:** Evaluation failed: 1 of 3 evaluators failed
- **Quality:** Similarity below threshold: 72.0% vs 85% required
  - Actual: 0.72, Expected: 0.85

### ⚠️ Warnings
- **Performance:** Slowest evaluator: expected-diff took 35.0s
```

**Key Findings**:
1. ✅ Agent ran without errors
2. ❌ Output similarity is only 72%, but we need 85%
3. ⚠️ The comparison evaluator is slow (35 seconds)

### Strategic Recommendations

```markdown
## Strategic Recommendations

### 🔴 High Priority

#### Improve Agent Output Quality

**Category:** quality
**Description:** Agent output similarity is below the expected threshold

**Recommended Action:**
Review the prompt, increase context, or adjust the expected reference threshold in your suite configuration

**Expected Impact:** Better alignment with expected results

### 🟡 Medium Priority

#### Optimize Slow Evaluator

**Description:** One or more evaluators are taking significant time
**Action:** Review evaluator configuration, consider caching, or optimize workspace size
**Impact:** Faster evaluation cycles
```

## Step 4: Take Action

Based on the recommendations, you have three options:

### Option A: Improve the Prompt (Recommended)

The agent's output is 72% similar to expected, which suggests it's on the right track but missing some key elements.

**Action**: Enhance your prompt with more context:

```yaml
# Before
agent:
  type: copilot-cli
  config:
    prompt: "Implement user authentication"

# After
agent:
  type: copilot-cli
  config:
    prompt: |
      Implement user authentication with the following requirements:
      - JWT-based authentication
      - Login and register endpoints
      - Password hashing with bcrypt
      - Authentication middleware
      - Proper error handling
      
      Follow the existing code style and patterns in the repository.
```

### Option B: Adjust the Threshold

If your expected reference is aspirational rather than realistic, you might adjust the threshold:

```yaml
# Before
evaluators:
  - name: expected-diff
    config:
      threshold: 0.85  # Very strict

# After
evaluators:
  - name: expected-diff
    config:
      threshold: 0.70  # More realistic
```

⚠️ **Warning**: Lowering thresholds reduces quality standards. Only do this if the threshold was unrealistic.

### Option C: Improve the Expected Reference

If the expected reference is incomplete or incorrect, update it:

```bash
# Review the expected reference branch
git checkout feature/auth-complete
# Make improvements
# Commit and push
```

## Step 5: Re-run and Compare

```bash
# Run with improved prompt
yb run -c auth-feature-suite-v2.yaml

# Analyze new results
yb analyze --from .youbencha-workspace/run-20251121-130000/artifacts/results.json --output analysis-v2.md

# Compare the two analyses
diff analysis-v1.md analysis-v2.md
```

### New Results

```
[youBencha] [INFO] Analysis Complete:
[youBencha] [INFO]   ├─ Insights: 3
[youBencha] [INFO]   ├─ Recommendations: 2
[youBencha] [INFO]   └─ Success Rate: 100.0%

[youBencha] [INFO] ✅ Analysis complete

[youBencha] [INFO] Quick Summary:
[youBencha] [INFO]   ✅ 3 success(es)
```

**Success!** The improved prompt increased similarity to 89%, passing the 85% threshold.

## Key Takeaways

1. **Use `analyze` after every evaluation** to understand results beyond pass/fail
2. **Follow high-priority recommendations first** - they have the most impact
3. **Compare analyses over time** to track improvement
4. **Iterate based on insights** rather than guessing what to change

## Common Patterns

### Pattern 1: Quality Issues
- **Symptom**: Similarity below threshold
- **Common Causes**: Vague prompt, missing context, unrealistic expectations
- **Solution**: Enhance prompt with specific requirements

### Pattern 2: Performance Issues
- **Symptom**: Slow evaluators (>30 seconds)
- **Common Causes**: Large workspace, network latency, inefficient evaluator config
- **Solution**: Optimize workspace size, review evaluator settings

### Pattern 3: Coverage Issues
- **Symptom**: Evaluators being skipped
- **Common Causes**: Missing prerequisites, incorrect configuration
- **Solution**: Check evaluator requirements, provide needed config

### Pattern 4: Near-Threshold Results
- **Symptom**: Passing but close to threshold (margin <5%)
- **Common Causes**: Fragile configuration, inconsistent agent output
- **Solution**: Improve robustness or adjust threshold with headroom

## Advanced Usage

### Save Analysis for Tracking

```bash
# Save with timestamp for historical tracking
yb analyze --from results.json --output "analysis-$(date +%Y%m%d-%H%M%S).md"

# Later, review progression
ls -l analysis-*.md
```

### Automate Analysis in CI

```bash
# In your CI script
yb run -c suite.yaml || true  # Don't fail on evaluation failure
yb analyze --from .youbencha-workspace/*/artifacts/results.json

# Read recommendations to decide if CI should fail
# (Future: machine-readable format for parsing)
```

### Create a Quality Dashboard

```bash
# Run periodic evaluations
cron: 0 */6 * * * cd /app && yb run -c suite.yaml && yb analyze --from results.json --output /dashboard/latest-analysis.md
```

## Related Documentation

- [Analytics Documentation](../docs/analytics.md) - Complete feature reference
- [Analytics Roadmap](../docs/analytics-roadmap.md) - Future features including multi-run aggregation
- [Getting Started](../GETTING-STARTED.md) - youBencha basics

## FAQ

**Q: How is `analyze` different from `report`?**

A: `report` shows *what happened* (raw metrics, status), while `analyze` tells you *what it means and what to do* (insights, recommendations). Use both:
- `report` for detailed results
- `analyze` for strategic direction

**Q: Can I customize the recommendations?**

A: Not yet. Current recommendations are based on built-in heuristics. Future versions will support custom analysis rules.

**Q: What if I disagree with a recommendation?**

A: Recommendations are suggestions, not requirements. Use your judgment. If you consistently disagree, please file an issue - we'll improve the logic!

**Q: Can I analyze multiple runs together?**

A: Not in the current version. Phase 2 (planned) will add multi-run aggregation. See [Analytics Roadmap](../docs/analytics-roadmap.md).
