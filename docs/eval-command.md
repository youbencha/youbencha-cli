# Eval Command - Running Evaluations on Existing Code

The `eval` command allows you to run evaluations on code that has already been modified, without running an AI agent. This is useful when you:

- Have manually run an agent and want to evaluate the results
- Want to re-run evaluations on existing changes
- Need to test evaluators on a specific directory
- Want to evaluate code changes made outside of youBencha

## Quick Start

```bash
# Create an eval configuration
yb eval -c eval.yaml

# Evaluate a specific directory
yb eval -c eval.yaml -d /path/to/code

# With an expected reference directory
yb eval -c eval.yaml -e /path/to/expected
```

## Eval Configuration Format

The eval configuration is simpler than a full test case configuration - it doesn't require agent or repository configuration.

### Minimal Configuration

```yaml
name: "Evaluate code changes"
description: "Run evaluations on existing code"
directory: "."  # Directory to evaluate
evaluators:
  - name: git-diff
```

### Complete Configuration

```yaml
name: "Comprehensive code evaluation"
description: "Run multiple evaluations on existing code"

# Directory configuration
directory: "/path/to/code"  # Required: code to evaluate

# Optional: Expected reference directory for comparison
expected_directory: "/path/to/expected"

# Evaluators to run
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 10
        max_lines_added: 500
  
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        code_quality: "Code follows best practices. Score 1 if excellent, 0 if poor."
        no_errors: "No syntax errors. Score 1 if valid, 0 if broken."

# Optional: Output directory for results
output_dir: ".youbencha-eval"

# Optional: Timeout in milliseconds (default: 5 minutes)
timeout: 300000
```

## Configuration Fields

### Required Fields

- **name**: Short name for this evaluation (1-200 characters)
- **description**: What this evaluation is testing (1-1000 characters)
- **directory**: Path to the directory containing code to evaluate
- **evaluators**: Array of evaluators to run (at least one required)

### Optional Fields

- **expected_directory**: Path to expected reference directory for comparison evaluators like `expected-diff`
- **output_dir**: Where to store evaluation results (defaults to `.youbencha-eval` in current directory)
- **timeout**: Maximum evaluation time in milliseconds (default: 300000 = 5 minutes)

## Command Line Options

```bash
yb eval [options]

Options:
  -c, --config <path>              Path to eval configuration file (YAML or JSON)
  -d, --directory <path>           Directory to evaluate (overrides config file)
  -e, --expected-directory <path>  Expected reference directory (overrides config file)
```

## Output

The eval command creates a timestamped directory under the output directory (default: `.youbencha-eval/`) containing:

```
.youbencha-eval/
└── eval-{timestamp}-{hash}/
    └── artifacts/
        ├── results.json           # Complete results bundle
        ├── youbencha.log.json     # Minimal agent log
        └── [evaluator artifacts]  # Evaluator-specific outputs
```

## Workflow

1. **Load Configuration**: Parse and validate the eval configuration file
2. **Validate Directories**: Check that specified directories exist
3. **Create Artifacts Directory**: Create timestamped output directory
4. **Create Minimal Log**: Generate a youBencha log with agent type "manual"
5. **Run Evaluators**: Execute all configured evaluators in parallel
6. **Build Results Bundle**: Create complete results JSON
7. **Run Post-Evaluations**: Execute any configured post-evaluation hooks (optional)
8. **Report Results**: Display summary and next steps

## Examples

### Example 1: Basic Git Diff Analysis

Evaluate changes in the current directory:

```yaml
name: "Git diff analysis"
description: "Check scope of changes"
directory: "."
evaluators:
  - name: git-diff
```

```bash
yb eval -c eval.yaml
```

### Example 2: Quality Check with AI

Evaluate code quality using an agentic judge:

```yaml
name: "Code quality check"
description: "AI-based quality evaluation"
directory: "/path/to/modified/code"
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        follows_standards: "Code follows project coding standards. Score 1 if compliant, 0 if not."
        has_tests: "Changes include appropriate tests. Score 1 if tested, 0 if not."
```

```bash
yb eval -c eval.yaml
```

### Example 3: Compare with Expected Output

Compare modified code with an expected reference:

```yaml
name: "Compare with expected"
description: "Verify code matches expected implementation"
directory: "/path/to/modified"
expected_directory: "/path/to/expected"
evaluators:
  - name: expected-diff
    config:
      assertions:
        max_diff_ratio: 0.1  # Allow up to 10% difference
```

```bash
yb eval -c eval.yaml
```

### Example 4: Custom Output Directory

Store results in a specific location:

```yaml
name: "Evaluation with custom output"
description: "Store results in project-specific location"
directory: "./src"
output_dir: "./evaluation-results"
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        quality: "Overall code quality score"
```

```bash
yb eval -c eval.yaml
```

## Integration with Reporting

After running an eval, generate a report using the `report` command:

```bash
# Run evaluation
yb eval -c eval.yaml

# Generate report (path shown in eval output)
yb report --from .youbencha-eval/eval-*/artifacts/results.json
```

## Differences from Run Command

| Feature | `yb run` | `yb eval` |
|---------|----------|-----------|
| Runs AI agent | ✅ Yes | ❌ No |
| Requires repository | ✅ Yes | ❌ No |
| Agent configuration | ✅ Required | ❌ Not needed |
| Workspace management | ✅ Full clone | ❌ Uses existing directory |
| Use case | Automated agent testing | Manual agent or code evaluation |

## Best Practices

1. **Use Git Repositories**: The `git-diff` evaluator requires a git repository, so ensure your directory is git-initialized

2. **Clear Directory Paths**: Use absolute paths or clear relative paths to avoid confusion

3. **Descriptive Names**: Use clear, descriptive names and descriptions for your evaluations

4. **Version Control**: Keep eval configurations in version control alongside your code

5. **Consistent Evaluators**: Use the same evaluators across eval and run commands for consistency

6. **Post-Evaluation Hooks**: Use post-evaluation hooks to export results to databases or trigger CI/CD workflows

## Common Use Cases

### 1. CI/CD Integration

```yaml
name: "CI quality gate"
description: "Evaluate PR changes"
directory: "."
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 20
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        breaks_nothing: "Changes don't break existing functionality"
```

### 2. Manual Agent Evaluation

After running GitHub Copilot CLI manually:

```yaml
name: "Evaluate Copilot changes"
description: "Assess manual Copilot session results"
directory: "."
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        task_completed: "The requested task was completed successfully"
        code_quality: "Code quality meets standards"
```

### 3. Regression Testing

```yaml
name: "Regression test"
description: "Verify changes don't regress functionality"
directory: "./current"
expected_directory: "./baseline"
evaluators:
  - name: expected-diff
    config:
      assertions:
        max_diff_ratio: 0.05  # 5% max difference
```

## Troubleshooting

### "Directory not found" error

Ensure the directory path is correct and the directory exists:

```bash
# Check if directory exists
ls -la /path/to/code

# Use absolute paths
yb eval -c eval.yaml -d /absolute/path/to/code
```

### Git-diff evaluator fails

The `git-diff` evaluator requires a git repository:

```bash
# Initialize git if needed
cd /path/to/code
git init
git add .
git commit -m "Initial commit"
```

### Evaluators take too long

Increase the timeout in your configuration:

```yaml
timeout: 600000  # 10 minutes
```

## See Also

- [Run Command](../README.md#run-command) - Run full evaluation with agent
- [Report Command](../README.md#report-command) - Generate reports from results
- [Evaluators](../README.md#evaluators) - Available evaluators
- [Post-Evaluation Hooks](./post-evaluation.md) - Export and process results
