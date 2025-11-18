# Multiple Agentic-Judge Evaluators - Quick Reference

## Quick Comparison

| Aspect | Single Judge | Multiple Judges |
|--------|-------------|-----------------|
| **Assertions per Judge** | 10+ combined | 1-3 focused |
| **Context Window** | Overloaded | Manageable |
| **Result Clarity** | Single pass/fail | Per-area pass/fail |
| **Debugging** | Hard to pinpoint | Easy to identify |
| **Execution** | Sequential | Parallel |
| **Typical Time** | ~12 min | ~4 min (parallel) |

## Naming Patterns

```yaml
# Pattern 1: Hyphen separator (recommended)
- name: agentic-judge-error-handling
- name: agentic-judge-documentation
- name: agentic-judge-best-practices

# Pattern 2: Colon separator
- name: agentic-judge:security
- name: agentic-judge:tests

# Pattern 3: Traditional (backward compatible)
- name: agentic-judge
```

## Minimal Example

```yaml
# testcase.yaml
repo: https://github.com/example/repo.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add error handling"

evaluators:
  # Track changes
  - name: git-diff
  
  # Judge 1: Error handling
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        has_try_catch: "Try-catch blocks present. Score 1 if yes, 0 if no."
        errors_logged: "Errors logged. Score 1 if yes, 0 if no."
  
  # Judge 2: Documentation
  - name: agentic-judge-docs
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions documented. Score 1 if yes, 0 if no."
```

## Run and View Results

```bash
# Run evaluation
yb run -c testcase.yaml

# Generate report
yb report --from .youbencha-workspace/run-*/artifacts/results.json

# View results
cat .youbencha-workspace/run-*/artifacts/report.md
```

## Expected Results Structure

```json
{
  "evaluators": [
    {
      "evaluator": "git-diff",
      "status": "passed",
      "metrics": { "files_changed": 3 }
    },
    {
      "evaluator": "agentic-judge-error-handling",
      "status": "passed",
      "metrics": { "has_try_catch": 1, "errors_logged": 1 }
    },
    {
      "evaluator": "agentic-judge-docs",
      "status": "failed",
      "metrics": { "functions_documented": 0 }
    }
  ],
  "summary": {
    "total_evaluators": 3,
    "passed": 2,
    "failed": 1,
    "overall_status": "failed"
  }
}
```

## Common Use Cases

### 1. Feature Development
```yaml
evaluators:
  - name: agentic-judge-functionality    # Does it work?
  - name: agentic-judge-tests            # Is it tested?
  - name: agentic-judge-documentation    # Is it documented?
```

### 2. Bug Fix Validation
```yaml
evaluators:
  - name: agentic-judge-bug-fixed        # Is bug resolved?
  - name: agentic-judge-no-regression    # No new bugs?
  - name: agentic-judge-root-cause       # Root cause addressed?
```

### 3. Refactoring Review
```yaml
evaluators:
  - name: agentic-judge-code-quality     # Better quality?
  - name: agentic-judge-maintainability  # Easier to maintain?
  - name: agentic-judge-performance      # Same/better performance?
```

### 4. Security Audit
```yaml
evaluators:
  - name: agentic-judge-authentication   # Auth secure?
  - name: agentic-judge-data-validation  # Input validated?
  - name: agentic-judge-secrets          # No exposed secrets?
```

### 5. API Development
```yaml
evaluators:
  - name: agentic-judge-endpoints        # Correct endpoints?
  - name: agentic-judge-error-handling   # Errors handled?
  - name: agentic-judge-documentation    # API documented?
  - name: agentic-judge-validation       # Input validated?
```

## Migration Checklist

- [ ] Review current assertions
- [ ] Group related assertions by topic
- [ ] Create judge for each group (2-3 assertions max)
- [ ] Use descriptive names: `agentic-judge-<topic>`
- [ ] Update configuration file
- [ ] Run test evaluation
- [ ] Review separate results per judge
- [ ] Adjust assertion groupings as needed

## Best Practices

1. ✅ **DO**: Keep 1-3 assertions per judge
2. ✅ **DO**: Use descriptive names indicating focus area
3. ✅ **DO**: Group related assertions together
4. ✅ **DO**: Use consistent naming convention
5. ❌ **DON'T**: Create too many judges (3-5 is ideal)
6. ❌ **DON'T**: Use vague names like `judge1`, `judge2`
7. ❌ **DON'T**: Mix unrelated assertions in one judge
8. ❌ **DON'T**: Duplicate assertions across judges

## Troubleshooting

### Judge not recognized
```yaml
# ❌ Wrong
- name: judge-error-handling

# ✅ Correct
- name: agentic-judge-error-handling
```

### Too many judges (execution slow)
```yaml
# ❌ Too many (8 judges)
- name: agentic-judge-try-catch
- name: agentic-judge-error-messages
- name: agentic-judge-logging
- name: agentic-judge-functions
- name: agentic-judge-comments
- name: agentic-judge-types
- name: agentic-judge-conventions
- name: agentic-judge-security

# ✅ Consolidated (3 judges)
- name: agentic-judge-error-handling
  config:
    assertions:
      has_try_catch: "..."
      error_messages_clear: "..."
      errors_logged: "..."
      
- name: agentic-judge-documentation
  config:
    assertions:
      functions_documented: "..."
      comments_clear: "..."
      
- name: agentic-judge-quality
  config:
    assertions:
      proper_types: "..."
      follows_conventions: "..."
      security_practices: "..."
```

## Resources

- **Full Guide**: [docs/multiple-agentic-judges.md](multiple-agentic-judges.md)
- **Visual Guide**: [docs/multiple-agentic-judges-visual.md](multiple-agentic-judges-visual.md)
- **Example Config**: [examples/testcase-multiple-judges.yaml](../examples/testcase-multiple-judges.yaml)
- **Main README**: [README.md](../README.md)

## Quick Links

- Issue: Define multiple agentic-judge evaluators
- Implementation PR: #[number]
- Feature Release: v[version]
