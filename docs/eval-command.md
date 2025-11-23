# The `yb eval` Command

The `yb eval` command allows you to run evaluators on existing directories without executing an agent. This is useful for several scenarios where you want to evaluate code that has already been modified.

## Use Cases

### 1. Re-evaluate Existing Agent Outputs

You've already run an agent and want to test different evaluator configurations without re-running the expensive agent execution:

```bash
# First run created output in .youbencha-workspace/run-abc123/src-modified
yb run -c testcase.yaml

# Now try different evaluators on the same output
yb eval -c eval-strict.yaml  # With stricter thresholds
yb eval -c eval-custom.yaml  # With custom evaluators
```

### 2. Evaluate Manual Code Changes

You made manual code changes and want to evaluate them using youBencha's evaluators:

```bash
# Make your changes manually
git checkout -b feature/my-changes
# ... make code changes ...

# Evaluate the changes
yb eval -c eval.yaml
```

### 3. Test Custom Evaluators

You're developing custom evaluators and want to test them quickly without agent execution:

```bash
# Test your new evaluator on known code
yb eval -c eval-test-my-evaluator.yaml
```

### 4. CI/CD Integration

Evaluate code changes made by other tools (e.g., automated refactoring, code generation scripts):

```yaml
# .github/workflows/evaluate.yml
- name: Run automated refactoring
  run: ./scripts/refactor.sh

- name: Evaluate changes
  run: yb eval -c eval-ci.yaml
```

### 5. Comparative Analysis

Evaluate multiple agent outputs consistently:

```bash
# Run different agents
yb run -c testcase-agent-a.yaml
yb run -c testcase-agent-b.yaml

# Evaluate both with same criteria
yb eval -c eval-comparison.yaml --directory agent-a-output
yb eval -c eval-comparison.yaml --directory agent-b-output
```

## Configuration

The eval configuration is simpler than a full test case configuration since it doesn't include agent or repository settings.

### Required Fields

- `name` - Name of the evaluation
- `description` - Description of what you're evaluating
- `directory` - Path to the directory to evaluate (must exist)
- `evaluators` - Array of evaluators to run (at least one required)

### Optional Fields

- `expected_directory` - Path to expected reference directory (for expected-diff evaluator)
- `output_dir` - Where to save results (default: `.youbencha-eval`)
- `post_evaluation` - Post-evaluation hooks to run after evaluation

### Example Configuration

**YAML format (eval.yaml):**

```yaml
name: "Evaluate Feature Implementation"
description: "Evaluate the authentication feature implementation"

# Directory to evaluate (relative or absolute path)
directory: "./src"

# Optional: Expected reference for comparison
expected_directory: "./expected"

# Optional: Custom output directory
output_dir: "./eval-results"

# Evaluators to run
evaluators:
  - name: git-diff
    config:
      thresholds:
        files_changed: 10
        lines_added: 500
        total_changes: 600
        change_entropy: 0.9

  - name: expected-diff
    config:
      threshold: 0.85

  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        authentication_implemented: "Authentication logic was properly implemented. Score 1 if true, 0 if false."
        tests_added: "Unit tests were added for authentication. Score 1 if true, 0 if false."
        error_handling: "Proper error handling is implemented. Score 1 if true, 0 if false."

# Optional: Post-evaluation hooks
post_evaluation:
  - name: webhook
    config:
      url: "https://api.example.com/results"
      method: POST
```

**JSON format (eval.json):**

```json
{
  "name": "Evaluate Feature Implementation",
  "description": "Evaluate the authentication feature implementation",
  "directory": "./src",
  "expected_directory": "./expected",
  "evaluators": [
    {
      "name": "git-diff",
      "config": {
        "thresholds": {
          "files_changed": 10,
          "lines_added": 500
        }
      }
    },
    {
      "name": "agentic-judge",
      "config": {
        "type": "copilot-cli",
        "assertions": {
          "authentication_implemented": "Authentication logic was properly implemented"
        }
      }
    }
  ]
}
```

## Command Usage

```bash
yb eval -c <config-file>
```

### Options

- `-c, --config <path>` - Path to eval configuration file (YAML or JSON) **[required]**

### Examples

```bash
# Basic usage
yb eval -c eval.yaml

# Using JSON format
yb eval -c eval.json

# Using absolute path
yb eval -c /path/to/eval-config.yaml
```

## Output

The eval command outputs results to `.youbencha-eval/` (or your custom `output_dir`) with a timestamped subdirectory:

```
.youbencha-eval/
└── eval-2024-01-15T10-30-45-123Z/
    └── artifacts/
        ├── youbencha.log.json
        ├── results.json
        ├── report.md
        └── [evaluator-specific artifacts]
```

### Result Structure

The `results.json` file follows the same structure as full test case runs, making it compatible with the `yb report` command:

```bash
# Generate a readable report
yb report --from .youbencha-eval/eval-*/artifacts/results.json
```

## Important Notes

### Directory Requirements

- The directory must exist before running eval
- For `git-diff` evaluator, the directory must be a git repository
- For `expected-diff` evaluator, both `directory` and `expected_directory` must exist

### Evaluator Configuration

- All evaluators must be configured inline (no file references)
- Each evaluator runs with the same configuration as in full test cases
- Evaluators that require agent execution (like `agentic-judge`) need the agent type specified in their config

### Differences from `yb run`

| Feature | `yb run` | `yb eval` |
|---------|----------|-----------|
| Agent execution | ✅ Yes | ❌ No |
| Repository cloning | ✅ Yes | ❌ No (uses existing directory) |
| Workspace management | ✅ Full workspace | ⚠️ Minimal (artifacts only) |
| Output location | `.youbencha-workspace/` | `.youbencha-eval/` |
| Configuration | Full test case | Simplified eval config |

## Tips and Best Practices

1. **Testing Evaluators**: Use `yb eval` to quickly test evaluator configurations on known code before running full test cases

2. **Iterative Development**: When developing custom evaluators, use `yb eval` for faster iteration

3. **Post-Processing**: Combine with scripts to evaluate multiple directories:
   ```bash
   for dir in output-*; do
     yb eval -c eval.yaml --directory "$dir"
   done
   ```

4. **Version Control**: Keep eval configurations in version control alongside your code

5. **CI/CD**: Use in CI/CD pipelines to evaluate changes before merging:
   ```yaml
   - name: Evaluate changes
     run: yb eval -c .youbencha/pr-eval.yaml
   ```

## Related Commands

- [`yb run`](../README.md#yb-run) - Run full evaluation with agent execution
- [`yb report`](../README.md#yb-report) - Generate reports from results
- [`yb validate`](../README.md#yb-validate) - Validate configuration files
