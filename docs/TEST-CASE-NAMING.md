# Test Case File Naming Convention

## Recommended Naming Pattern

Test case configuration files should follow this pattern:

```
testcase-<description>.yaml
```

or

```
testcase-<description>.json
```

## Examples

### Good Names

- `testcase-add-readme-comment.yaml` - Clear, descriptive, follows convention
- `testcase-implement-auth-feature.yaml` - Describes the feature being tested
- `testcase-fix-security-issue.yaml` - Indicates the type of change
- `testcase-refactor-payment-logic.yaml` - Shows the scope of refactoring

### Why This Convention?

1. **Consistency**: All test case files are easily identifiable
2. **Clarity**: The `testcase-` prefix makes the purpose obvious
3. **Organization**: Files sort together in directory listings
4. **Searchability**: Easy to find all test cases with glob patterns like `testcase-*.yaml`

## Test Case Structure

Each test case file must include:

### Required Fields

- `name`: A short, descriptive name for the test case
- `description`: A detailed explanation of what is being tested
- `repo`: The repository URL to test against
- `agent`: Configuration for the coding agent
- `evaluators`: One or more evaluators to run checks and validate the results

### Example

```yaml
# Test case metadata
name: "Add README comment"
description: "Tests the agent's ability to add a helpful comment explaining the repository's purpose to the README file"

# Repository configuration (test data)
repo: https://github.com/youbencha/hello-world.git
branch: main

# Agent configuration
agent:
  type: copilot-cli
  config:
    prompt: "Add a comment to README explaining what this repository is about"

# Evaluators - things that run checks
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      # Assertions - what this evaluator checks (pass/fail conditions)
      assertions:
        readme_modified: "README.md was modified. Score 1 if true, 0 if false."
        helpful_comment_added: "A helpful comment was added. Score 1 if true, 0 if false."
```

## Migration from Suite to Test Case

If you have existing "suite" files, rename them following this pattern:

```bash
# Old naming
simple-suite.yaml
basic-suite.yaml

# New naming
testcase-simple.yaml
testcase-basic.yaml
```

Update the content to include `name` and `description` fields. The top-level field should be `evaluators` (list of evaluators to run), and inside agentic-judge config use `assertions` (what to check).
