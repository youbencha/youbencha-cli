# Reusable Evaluator Definitions

youBencha supports defining evaluators in separate YAML files that can be referenced across multiple test cases. This enables:

- **Reusability**: Define an evaluator once, use it in many test cases
- **Maintainability**: Update evaluator logic in one place
- **Organization**: Keep test case files clean and focused
- **Sharing**: Share common evaluator definitions across teams

## Quick Start

### 1. Create an Evaluator Definition File

Create a YAML file defining your evaluator (e.g., `evaluators/readme-grammar-check.yaml`):

```yaml
name: agentic-judge:readme-grammar
description: "Checks that README.md has grammatically correct content"

config:
  type: copilot-cli
  agent_name: agentic-judge
  timeout: 300000  # 5 minutes
  
  assertions:
    grammatically_correct: "README.md content is grammatically correct. Score 1 if true, 0 if false."
    no_spelling_errors: "README.md has no spelling errors. Score 1 if true, 0 if false."
    proper_punctuation: "README.md uses proper punctuation. Score 1 if true, 0 if false."
```

### 2. Reference the Evaluator in Your Test Case

In your test case YAML file:

```yaml
name: "Add README comment"
description: "Tests the agent's ability to add a helpful comment to README"

repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add a helpful comment to README.md explaining what this repository is about"

evaluators:
  # Reference the external evaluator definition
  - file: ./evaluators/readme-grammar-check.yaml
  
  # You can mix file references with inline evaluators
  - name: git-diff
    config:
      assertions:
        max_files_changed: 1
        max_lines_added: 10
```

### 3. Run Your Test Case

```bash
yb run -c testcase.yaml
```

The evaluator definition is automatically loaded and used during evaluation.

## Evaluator Definition Schema

An evaluator definition file must include:

- **`name`** (required): Unique name for the evaluator
  - For agentic judges, use format: `agentic-judge:purpose` or `agentic-judge-purpose`
  - For built-in evaluators: `git-diff`, `expected-diff`
  
- **`description`** (optional): Human-readable description of what the evaluator checks

- **`config`** (optional): Evaluator-specific configuration
  - Structure depends on the evaluator type
  - See examples below for different evaluator types

## Examples

### Agentic Judge Evaluator

Check test coverage quality:

```yaml
# evaluators/test-coverage-check.yaml
name: agentic-judge:test-coverage
description: "Ensures code changes include appropriate test coverage"

config:
  type: copilot-cli
  agent_name: agentic-judge
  timeout: 300000
  
  assertions:
    tests_added: "New tests were added. Score 1 if tests exist, 0.5 if partial, 0 if none."
    tests_pass: "All tests pass. Score 1 if all pass, 0.5 if some, 0 if none."
    edge_cases_covered: "Tests cover edge cases. Score 1 if comprehensive, 0.5 if partial, 0 if none."
```

### Git Diff Evaluator

Enforce focused changes:

```yaml
# evaluators/focused-changes.yaml
name: git-diff
description: "Ensures changes are focused and minimal"

config:
  assertions:
    max_files_changed: 3
    max_lines_added: 100
    max_lines_removed: 50
    max_change_entropy: 2.0  # Changes concentrated in few files
```

### Expected Diff Evaluator

Compare against reference implementation:

```yaml
# evaluators/reference-comparison.yaml
name: expected-diff
description: "Compares changes against expected reference branch"

config:
  threshold: 0.85  # 85% similarity required
  ignore_patterns:
    - "*.lock"
    - "package-lock.json"
```

## File Path Resolution

File paths in the `file` field are resolved relative to the directory containing the test case configuration file:

```
my-project/
├── testcases/
│   └── add-feature.yaml          # Test case file
└── evaluators/
    └── code-quality.yaml         # Evaluator definition

# In add-feature.yaml:
evaluators:
  - file: ../evaluators/code-quality.yaml  # Relative path from testcase
```

Absolute paths are also supported:

```yaml
evaluators:
  - file: /path/to/shared/evaluators/security-check.yaml
```

## Mixing Inline and File-Referenced Evaluators

You can use both inline and file-referenced evaluators in the same test case:

```yaml
evaluators:
  # File reference - reusable evaluator
  - file: ./evaluators/readme-grammar-check.yaml
  
  # Inline evaluator - specific to this test case
  - name: git-diff
    config:
      assertions:
        max_files_changed: 1
  
  # Another file reference
  - file: ./evaluators/test-coverage-check.yaml
  
  # Another inline evaluator
  - name: agentic-judge:custom
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        meets_requirements: "Code meets all requirements. Score 1 if yes, 0 if no."
```

## Validation

You can validate a test case configuration (including referenced evaluators) without running it:

```bash
yb validate -c testcase.yaml
```

This command will:
- Parse the test case YAML
- Load and validate all referenced evaluator definitions
- Check for errors in file paths, schema violations, etc.
- Display a summary of all evaluators that will be used

## Best Practices

### 1. Organize Evaluator Definitions

Create a dedicated directory for reusable evaluators:

```
project/
├── evaluators/
│   ├── grammar-checks/
│   │   ├── readme-grammar.yaml
│   │   └── docs-grammar.yaml
│   ├── test-quality/
│   │   ├── test-coverage.yaml
│   │   └── test-clarity.yaml
│   └── code-quality/
│       ├── error-handling.yaml
│       └── best-practices.yaml
└── testcases/
    ├── feature-1.yaml
    └── feature-2.yaml
```

### 2. Use Descriptive Names

Choose clear, descriptive names that indicate what the evaluator checks:

✅ Good:
- `agentic-judge:readme-grammar`
- `agentic-judge:test-coverage-quality`
- `agentic-judge:error-handling-completeness`

❌ Avoid:
- `agentic-judge:check1`
- `agentic-judge:test`
- `evaluator-a`

### 3. Add Descriptions

Always include a description field to document the evaluator's purpose:

```yaml
name: agentic-judge:security-review
description: "Reviews code changes for common security vulnerabilities including SQL injection, XSS, and insecure dependencies"
```

### 4. Version Control

Commit evaluator definitions to version control alongside test cases:
- Track changes to evaluation assertions over time
- Enable code review of evaluation logic changes
- Share evaluators across team members

### 5. Test Your Evaluators

Before using an evaluator definition in production test cases:
1. Create a simple test case that uses it
2. Run the test case to verify the evaluator works as expected
3. Review the evaluation results to ensure assertions are clear and meaningful

## Limitations

1. **No cyclic references**: An evaluator definition file cannot reference another evaluator definition file
2. **No variables/templating**: Evaluator definitions are static YAML - no variable substitution or templating
3. **Same schema as inline**: File-referenced evaluators must follow the same configuration schema as inline evaluators

## Troubleshooting

### "Failed to load evaluator definition from..."

**Cause**: File not found or invalid path

**Solution**: 
- Check that the file path is correct relative to your test case file
- Verify the file exists at that location
- Use absolute path if relative path is problematic

### "Invalid evaluator definition: name: Required"

**Cause**: Evaluator definition file is missing the required `name` field

**Solution**: Add a `name` field to your evaluator definition:

```yaml
name: agentic-judge:my-evaluator  # Add this line
config:
  # ... rest of config
```

### "Evaluator config with both name and file"

**Cause**: Trying to use both inline and file reference in same evaluator entry

**Solution**: Choose one approach:

❌ Wrong:
```yaml
evaluators:
  - name: git-diff
    file: ./evaluators/git-diff.yaml  # Can't have both
```

✅ Correct - file reference:
```yaml
evaluators:
  - file: ./evaluators/git-diff.yaml
```

✅ Correct - inline:
```yaml
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5
```

## See Also

- [Multiple Agentic Judges Guide](./multiple-agentic-judges.md) - Using multiple specialized agentic judge evaluators
- [Agent Name Configuration](./agent-name-configuration.md) - Configuring custom agents
- Example evaluator definitions in `examples/evaluators/`
- Example test case with references in `examples/testcase-reusable-evaluators.yaml`
