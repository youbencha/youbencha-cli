# Multiple Agentic Judge Evaluators

## Overview

youBencha now supports defining multiple agentic-judge evaluators in a single test case. This allows you to break down code quality evaluation into focused areas, keeping each evaluator's context window manageable and evaluations clear.

## Why Multiple Judges?

Instead of having a single agentic-judge with 10+ assertions covering different aspects (error handling, documentation, security, tests, etc.), you can now create specialized judges:

**Before (single judge with many assertions):**
```yaml
evaluators:
  - name: agentic-judge
    config:
      assertions:
        has_error_handling: "..."
        errors_logged: "..."
        functions_documented: "..."
        comments_clear: "..."
        no_console_log: "..."
        uses_proper_types: "..."
        follows_conventions: "..."
        has_tests: "..."
        tests_cover_edge_cases: "..."
        security_best_practices: "..."
```

**After (multiple focused judges):**
```yaml
evaluators:
  - name: agentic-judge-error-handling
    config:
      assertions:
        has_error_handling: "..."
        errors_logged: "..."
        
  - name: agentic-judge-documentation
    config:
      assertions:
        functions_documented: "..."
        comments_clear: "..."
        
  - name: agentic-judge-best-practices
    config:
      assertions:
        no_console_log: "..."
        uses_proper_types: "..."
```

## Benefits

1. **Focused Evaluations**: Each judge evaluates 1-3 related assertions
2. **Cleaner Results**: Reports clearly show which area passed/failed
3. **Independent Status**: Each judge has its own pass/fail status
4. **Better Context**: Smaller context windows = more focused AI evaluations
5. **Parallel Execution**: All judges run in parallel for faster evaluation

## Usage

### Naming Convention

Custom agentic-judge evaluators use one of two naming patterns:

1. **Hyphen separator** (recommended): `agentic-judge-<focus-area>`
   - `agentic-judge-error-handling`
   - `agentic-judge-documentation`
   - `agentic-judge-best-practices`

2. **Colon separator**: `agentic-judge:<focus-area>`
   - `agentic-judge:security`
   - `agentic-judge:tests`

### Example Configuration

See `examples/testcase-multiple-judges.yaml` for a complete example:

```yaml
name: "Add error handling to API client"
description: "Comprehensive evaluation with multiple focused judges"

repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add error handling to the API client"

evaluators:
  # Track scope of changes
  - name: git-diff
    config:
      max_files_changed: 5
  
  # Judge 1: Error Handling
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        has_try_catch: "Code includes try-catch blocks. Score 1 if present, 0 if absent."
        error_messages_clear: "Error messages are descriptive. Score 1 if clear, 0 if vague."
        errors_logged: "Errors are properly logged. Score 1 if logged, 0 if not."
  
  # Judge 2: Documentation
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions have JSDoc. Score 1 if all documented, 0 if none."
        error_types_documented: "Error scenarios documented. Score 1 if documented, 0 if missing."
  
  # Judge 3: Best Practices
  - name: agentic-judge-best-practices
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        no_console_log: "No console.log statements. Score 1 if clean, 0 if found."
        proper_error_types: "Uses specific error types. Score 1 if specific, 0 if generic."
```

## Results Format

Each judge appears as a separate evaluator in results with its own metrics:

```json
{
  "evaluators": [
    {
      "evaluator": "agentic-judge-error-handling",
      "status": "passed",
      "metrics": {
        "has_try_catch": 1,
        "error_messages_clear": 1,
        "errors_logged": 1
      }
    },
    {
      "evaluator": "agentic-judge-documentation",
      "status": "failed",
      "metrics": {
        "functions_documented": 0.5,
        "error_types_documented": 0
      }
    },
    {
      "evaluator": "agentic-judge-best-practices",
      "status": "passed",
      "metrics": {
        "no_console_log": 1,
        "proper_error_types": 1
      }
    }
  ]
}
```

## Report Output

The markdown report will show each judge separately:

```markdown
## Evaluator Results

### agentic-judge-error-handling
**Status:** ✅ passed

| Metric | Value |
|--------|-------|
| has_try_catch | 1 |
| error_messages_clear | 1 |
| errors_logged | 1 |

### agentic-judge-documentation
**Status:** ❌ failed

| Metric | Value |
|--------|-------|
| functions_documented | 0.5 |
| error_types_documented | 0 |

### agentic-judge-best-practices
**Status:** ✅ passed

| Metric | Value |
|--------|-------|
| no_console_log | 1 |
| proper_error_types | 1 |
```

## Best Practices

1. **Keep judges focused**: 1-3 assertions per judge
2. **Use descriptive names**: Clearly indicate what each judge evaluates
3. **Group related assertions**: Error handling, documentation, security, etc.
4. **Consistent naming**: Use hyphens for multi-word areas (`error-handling`, not `errorHandling`)
5. **Balance thoroughness and speed**: More judges = more thorough but longer execution

## Migration Guide

If you have an existing test case with a single agentic-judge with many assertions:

1. Group your assertions by topic (error handling, docs, tests, etc.)
2. Create a new evaluator for each group
3. Name each using the pattern `agentic-judge-<topic>`
4. Split assertions across the new evaluators
5. Run evaluation and review results

Example:

```yaml
# Before
evaluators:
  - name: agentic-judge
    config:
      assertions:
        criterion_1: "..."
        criterion_2: "..."
        criterion_3: "..."
        criterion_4: "..."
        criterion_5: "..."
        criterion_6: "..."

# After
evaluators:
  - name: agentic-judge-quality
    config:
      assertions:
        criterion_1: "..."
        criterion_2: "..."
        
  - name: agentic-judge-correctness
    config:
      assertions:
        criterion_3: "..."
        criterion_4: "..."
        
  - name: agentic-judge-maintainability
    config:
      assertions:
        criterion_5: "..."
        criterion_6: "..."
```

## Implementation Details

- Evaluators with names starting with `agentic-judge-` or `agentic-judge:` are automatically recognized
- Each judge is an independent instance of `AgenticJudgeEvaluator`
- All judges run in parallel via `Promise.allSettled()`
- Each judge maintains its own execution context and metrics
- Standard `agentic-judge` name still works for backward compatibility

## See Also

- [Custom Evaluators Guide](./custom-evaluators.md) - Creating custom code and LLM-based evaluators
- [Reusable Evaluators Guide](./reusable-evaluators.md) - Sharing evaluator configurations across test cases
- [Prompt Files Guide](./prompt-files.md) - Loading prompts from external files
