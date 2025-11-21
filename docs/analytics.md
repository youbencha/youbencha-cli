# youBencha Analytics Feature

## Overview

The **analytics feature** provides strategic insights and actionable recommendations from youBencha evaluation results. Instead of just reporting what happened, analytics tells you **what it means** and **what to do about it**.

## Quick Start

```bash
# Analyze a single evaluation run
yb analyze --from results.json

# Specify output location
yb analyze --from .youbencha-workspace/run-abc123/artifacts/results.json --output analysis.md
```

## What Gets Analyzed

The `yb analyze` command examines:

1. **Overall Performance**: Pass/fail rates, execution time, agent success
2. **Evaluator Results**: Individual evaluator performance, bottlenecks
3. **Quality Metrics**: Similarity scores, threshold adherence, file changes
4. **Execution Efficiency**: Duration, resource usage patterns

## Analysis Report Structure

### Executive Summary
- Overall status with clear pass/fail indicator
- Key metrics at a glance (success rate, duration, evaluator results)
- Quick assessment of agent performance

### Key Insights
Observations grouped by type:
- ✅ **Successes**: What went well
- ❌ **Issues**: Problems that need immediate attention
- ⚠️ **Warnings**: Potential concerns or areas near thresholds
- ℹ️ **Observations**: Notable patterns or behaviors

### Strategic Recommendations
Actionable advice prioritized by impact:

**🔴 High Priority**
- Critical issues affecting quality or success
- Actions that will have immediate positive impact
- Problems that prevent meeting evaluation criteria

**🟡 Medium Priority**
- Performance optimizations
- Configuration improvements
- Issues that could become critical if ignored

**🟢 Low Priority / Best Practices**
- General improvements
- Cost optimization suggestions
- Long-term quality enhancements

### Performance Metrics
- Success rates and pass/fail percentages
- Execution timing breakdown
- Evaluator-level performance details
- Resource utilization summary

## Example Analysis Scenarios

### Scenario 1: Quality Below Threshold

**Situation**: Agent output similarity is 72% but threshold is 85%

**Insights Generated**:
- ❌ Issue: "Similarity below threshold: 72.0% vs 85% required"
- ⚠️ Warning: "Evaluation failed: 1 of 3 evaluators failed"

**Recommendations**:
- 🔴 High Priority: "Improve Agent Output Quality"
  - Review the prompt and increase context
  - Consider adjusting threshold if expectations are unrealistic
  - Expected Impact: Better alignment with expected results

### Scenario 2: Performance Bottleneck

**Situation**: One evaluator takes 35 seconds while others take < 2 seconds

**Insights Generated**:
- ⚠️ Warning: "Slowest evaluator: expected-diff took 35.0s"

**Recommendations**:
- 🟡 Medium Priority: "Optimize Slow Evaluator"
  - Review evaluator configuration
  - Consider caching mechanisms
  - Optimize workspace size
  - Expected Impact: Faster evaluation cycles

### Scenario 3: Close to Threshold

**Situation**: Similarity is 87% with 85% threshold (only 2% margin)

**Insights Generated**:
- ⚠️ Warning: "Similarity close to threshold: 87.0% (only 2.0% above minimum)"

**Recommendations**:
- 🟡 Medium Priority: "Quality Near Threshold"
  - Consider improving prompts for more robust results
  - Review threshold settings for appropriateness
  - Expected Impact: More robust and consistent results

### Scenario 4: Skipped Evaluators

**Situation**: Some evaluators are skipped due to missing prerequisites

**Insights Generated**:
- ⚠️ Warning: "2 evaluator(s) skipped: expected-diff, agentic-judge"

**Recommendations**:
- 🟡 Medium Priority: "Enable Skipped Evaluators"
  - Review evaluator prerequisites
  - Configure missing dependencies
  - Expected Impact: More comprehensive evaluation coverage

## Understanding Insights

### Insight Types

**Success** ✅
- Indicates things working as expected
- Confirms good performance
- Highlights positive outcomes

Example: "Agent (copilot-cli) completed successfully"

**Error** ❌
- Critical problems affecting evaluation
- Failed evaluators or threshold violations
- Issues requiring immediate action

Example: "Similarity below threshold: 72.0% vs 85% required"

**Warning** ⚠️
- Potential issues or concerns
- Performance near limits
- Areas that need attention

Example: "Slowest evaluator: expected-diff took 35.0s"

**Info** ℹ️
- Neutral observations
- Contextual information
- Notable patterns

Example: "Large change: 25 files modified, +1250/-450 lines"

## Using Analytics for Improvement

### 1. Immediate Actions (High Priority)
Address high-priority recommendations first. These typically involve:
- Quality issues preventing success
- Configuration errors
- Critical performance problems

### 2. Performance Tuning (Medium Priority)
Once high-priority items are resolved:
- Optimize slow evaluators
- Adjust thresholds based on insights
- Enable skipped evaluators

### 3. Continuous Improvement (Low Priority)
For ongoing optimization:
- Track costs over time
- Establish baselines
- Refine configurations

## Best Practices

### 1. Run Analysis on Every Evaluation
```bash
# Run evaluation
yb run -c suite.yaml

# Immediately analyze
yb analyze --from .youbencha-workspace/run-*/artifacts/results.json
```

### 2. Track Analysis Over Time
Save analysis reports with timestamps:
```bash
yb analyze --from results.json --output analysis-$(date +%Y%m%d-%H%M%S).md
```

### 3. Compare Before and After
Run analysis before and after configuration changes to measure impact:
```bash
# Before change
yb run -c suite-v1.yaml
yb analyze --from results.json --output analysis-before.md

# Make changes to suite configuration

# After change
yb run -c suite-v2.yaml
yb analyze --from results.json --output analysis-after.md

# Compare recommendations
diff analysis-before.md analysis-after.md
```

### 4. Share Analysis Reports
Analytics reports are human-readable and great for:
- Team reviews
- Progress tracking
- Decision making
- Documentation

## Metrics Reference

### Overall Metrics

**Success Rate**: Percentage of successful agent executions
- 100%: Agent completed without errors
- 0%: Agent failed or timed out

**Evaluator Pass Rate**: Percentage of evaluators that passed
- 100%: All evaluators passed
- 0%: All evaluators failed or skipped

**Total Duration**: End-to-end execution time
- Includes agent execution and all evaluator runs
- Measured in seconds

**Avg Evaluator Duration**: Average time per evaluator
- Helps identify which evaluators are slow
- Useful for performance optimization

### Quality Metrics

**Aggregate Similarity**: Overall similarity to expected output
- Range: 0.0 to 1.0 (0% to 100%)
- Higher is better
- Compared against configured threshold

**Files Changed/Added/Removed**: Scope of changes
- Indicates size and complexity of agent output
- Large numbers may suggest breaking down tasks

### Performance Metrics

**Execution Time**: How long things take
- Total duration
- Per-evaluator duration
- Agent execution time

## Future Analytics Features

The current implementation provides single-run analysis. Future enhancements will include:

### Multi-Run Aggregation
```bash
# Compare multiple runs
yb analyze --from run1/results.json run2/results.json run3/results.json
```

### Trend Analysis
```bash
# Analyze trends over time
yb analyze --from workspace/**/results.json --trend
```

### Configuration Comparison
```bash
# Compare different configurations
yb analyze --from workspace/**/results.json --group-by config
```

### Cost Analysis
- Token usage tracking
- Cost estimation per run
- Cost trends over time
- Budget recommendations

### Baseline Establishment
- Set performance baselines
- Detect regressions automatically
- Alert on degraded performance

## Technical Details

### Data Structures

**SingleRunAnalysis**: Complete analysis of one evaluation
- Source results bundle
- Generated insights
- Strategic recommendations
- Performance metrics
- Cost analysis (when available)

**Recommendation**: Actionable advice
- Category: quality, performance, cost, configuration
- Priority: high, medium, low
- Title, description, action, expected impact

**PerformanceInsight**: Observation from analysis
- Type: success, warning, error, info
- Category: domain-specific grouping
- Message with optional metric values

### Analysis Logic

The analyzer examines:

1. **Overall Status**: Pass/fail/partial assessment
2. **Evaluator Performance**: Individual results and timing
3. **Quality Metrics**: Threshold adherence, similarity scores
4. **Execution Patterns**: Time distribution, bottlenecks
5. **Configuration Issues**: Missing prerequisites, skipped evaluators

### Recommendation Engine

Recommendations are generated based on:
- Failed evaluators → quality improvements
- Slow evaluators → performance optimization
- Skipped evaluators → configuration fixes
- Near-threshold results → robustness improvements
- Successful runs → best practice suggestions

## FAQs

**Q: How is `analyze` different from `report`?**

A: `report` shows *what happened* (descriptive), while `analyze` shows *what it means and what to do* (prescriptive). Use `report` for raw results, `analyze` for insights.

**Q: Can I run analysis without running an evaluation?**

A: Yes! As long as you have a `results.json` file, you can analyze it anytime.

**Q: Do recommendations change based on my configuration?**

A: Recommendations are context-aware and consider your specific thresholds, evaluators, and results.

**Q: Can I customize what gets analyzed?**

A: Currently, analysis covers standard metrics. Future versions will support custom analysis rules.

**Q: How do I use this in CI/CD?**

A: Run `yb analyze` after `yb run` and check the exit code. High-priority recommendations can fail the build if desired.

## Examples

### Example 1: Successful Run
```bash
$ yb analyze --from success-results.json

Analysis Complete:
  ├─ Insights: 3
  ├─ Recommendations: 2
  └─ Success Rate: 100.0%

✅ Analysis complete
  Report: success-results-analysis.md

Quick Summary:
  ✅ 3 success(es)

See full report for detailed recommendations.
```

### Example 2: Failed Run with Issues
```bash
$ yb analyze --from failed-results.json

Analysis Complete:
  ├─ Insights: 5
  ├─ Recommendations: 4
  └─ Success Rate: 33.3%

🔴 High Priority Recommendations:
  • Improve Agent Output Quality
    Review the prompt, increase context, or adjust threshold

✅ Analysis complete
  Report: failed-results-analysis.md

Quick Summary:
  ❌ 2 issue(s) found
  ⚠️  2 warning(s)
  ✅ 1 success(es)
```

## Related Commands

- `yb run`: Execute an evaluation
- `yb report`: Generate detailed results report
- `yb validate`: Check configuration before running

## Getting Help

For more information:
```bash
yb analyze --help
```

For examples and patterns, see the `examples/` directory in the repository.
