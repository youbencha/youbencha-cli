# Testing Patterns for youBencha

This directory contains example evaluation suites that demonstrate common testing patterns applied to agent evaluation.

## Quick Reference

| Suite | Use Case | Duration | When to Use |
|-------|----------|----------|-------------|
| [smoke-tests.yaml](./smoke-tests.yaml) | Quick sanity checks | < 2 min | Every commit, pre-merge checks |
| [comprehensive-suite.yaml](./comprehensive-suite.yaml) | Deep quality review | 3-5 min | Before merging, weekly reviews |
| [regression-suite.yaml](./regression-suite.yaml) | Compare to baseline | 2-3 min | Refactoring, bug fixes |
| [ci-optimized.yaml](./ci-optimized.yaml) | CI/CD integration | < 2 min | Pull request validation |

## Pattern 1: Smoke Tests

**Concept:** Run fast, lightweight checks before expensive evaluations.

**Like:** Pre-commit hooks, linting, syntax checks

**Example criteria:**
- Code has no syntax errors
- At least one file was modified
- No TODO comments in production code
- Basic patterns present (error handling, tests, etc.)

**When to use:**
- On every commit in CI
- Before running comprehensive evaluations
- As a quick quality gate

```bash
yb run -c smoke-tests.yaml
# ✅ Passes → proceed to comprehensive tests
# ❌ Fails → fix obvious issues first
```

## Pattern 2: Comprehensive Tests

**Concept:** Deep quality evaluation with detailed evidence trail.

**Like:** Full test suite with integration tests

**Example criteria:**
- Error handling is comprehensive
- Error messages are helpful
- Logging is implemented
- Error recovery strategies present
- Test coverage is adequate

**When to use:**
- Before merging important changes
- Weekly quality reviews
- Initial agent output validation

```bash
yb run -c comprehensive-suite.yaml
# Review evidence trail:
# - Files examined
# - Patterns found
# - Confidence scores
# - Detailed reasoning
```

## Pattern 3: Regression Tests

**Concept:** Compare against known-good baseline to detect regressions.

**Like:** Snapshot tests, baseline performance tests

**Uses:**
- `expected-diff` to compare structure
- `agentic-judge` to verify behavior preservation

**When to use:**
- Refactoring (should preserve behavior)
- Bug fixes (should be minimal changes)
- Comparing agent implementations

```bash
yb run -c regression-suite.yaml
# Check similarity score: ≥85% expected
# Review per-file details if low
# Verify behavior preservation criteria
```

## Pattern 4: CI-Optimized

**Concept:** Fast, focused evaluation for CI/CD pipelines.

**Like:** Parallel test execution with fail-fast

**Optimizations:**
- Strict timeout (≤2 minutes)
- Only critical criteria
- Skip expensive evaluations

**When to use:**
- Pull request validation
- Automated quality gates
- Branch protection rules

```bash
# In CI pipeline:
yb run -c ci-optimized.yaml
if [ $? -eq 0 ]; then
  echo "✅ Quality gate passed"
else
  echo "❌ Quality gate failed - review criteria"
  exit 1
fi
```

## Choosing the Right Pattern

### Decision Tree

```
Are you in CI/CD pipeline?
├─ Yes → Use ci-optimized.yaml (fast feedback)
└─ No → Continue...

Is this a quick check?
├─ Yes → Use smoke-tests.yaml (< 2 min)
└─ No → Continue...

Do you have a baseline to compare?
├─ Yes → Use regression-suite.yaml (refactoring, bug fixes)
└─ No → Use comprehensive-suite.yaml (new features)
```

### Workflow Recommendations

**For new features:**
1. Run `smoke-tests.yaml` after agent completes
2. If pass, run `comprehensive-suite.yaml` for detailed review
3. Review evidence trail and adjust criteria as needed

**For refactoring:**
1. Run `regression-suite.yaml` comparing to original
2. Check `expected-diff` similarity (≥85% typical)
3. Verify behavior preservation criteria

**For bug fixes:**
1. Run `regression-suite.yaml` with high threshold (≥90%)
2. Confirm minimal changes (git-diff)
3. Verify fix addresses the issue (agentic-judge)

**For CI/CD:**
1. Run `ci-optimized.yaml` on every PR
2. Block merge if fails
3. Run `comprehensive-suite.yaml` locally before merge

## Customizing Patterns

### Adjust Timeouts

```yaml
# For faster CI feedback
timeout: 60000  # 1 minute

# For thorough analysis
timeout: 300000  # 5 minutes
```

### Adjust Similarity Thresholds

```yaml
# For refactoring (structure changes)
threshold: 0.80  # 80% similarity

# For bug fixes (minimal changes)
threshold: 0.95  # 95% similarity

# For config updates (should match exactly)
threshold: 0.98  # 98% similarity
```

### Modify Criteria

Make criteria specific and measurable:

❌ **Bad:** "Code quality is good"  
✅ **Good:** "All functions under 50 lines with clear naming"

❌ **Bad:** "Tests exist"  
✅ **Good:** "All CRUD operations have unit tests with ≥80% coverage"

## Integration Examples

### GitHub Actions

```yaml
name: Agent Quality Gate
on: [pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install -g youbencha
      - run: yb run -c examples/testing-patterns/ci-optimized.yaml
```

### GitLab CI

```yaml
agent-quality:
  stage: test
  script:
    - npm install -g youbencha
    - yb run -c examples/testing-patterns/ci-optimized.yaml
  only:
    - merge_requests
```

### Jenkins

```groovy
stage('Agent Evaluation') {
  steps {
    sh 'npm install -g youbencha'
    sh 'yb run -c examples/testing-patterns/ci-optimized.yaml'
  }
}
```

## Best Practices

1. **Start with smoke tests** - Catch obvious issues fast
2. **Use specific criteria** - "All async functions have try-catch" beats "error handling exists"
3. **Set appropriate timeouts** - CI needs fast feedback, comprehensive reviews can take longer
4. **Review evidence trails** - Don't just look at pass/fail, understand the reasoning
5. **Adjust thresholds** - Different use cases need different similarity requirements
6. **Iterate on criteria** - Refine based on evaluation results

## Related Documentation

- [Testing Mindset Guide](../../docs/TESTING_MINDSET.md) - Maps testing concepts to youBencha
- [Evaluator Recommendations](../../docs/EVALUATOR_RECOMMENDATIONS.md) - Proposed improvements
- [RFC-001](../../RFC-001-youBencha-Framework.md) - Framework design

## Contributing

Have a testing pattern we missed? We'd love to see:
- Performance testing patterns
- Security evaluation patterns
- Documentation quality patterns
- API contract testing patterns

Submit a PR with your pattern in this directory!
