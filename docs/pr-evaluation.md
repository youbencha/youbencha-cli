# Pull Request Evaluation

## Overview

youBencha supports evaluating existing pull requests without running an AI agent. This is useful when an AI agent has already made code changes in a PR, and you want to evaluate those changes using youBencha's evaluators.

## Features

### 1. No Agent Execution Required

In PR evaluation mode, youBencha:
- Clones the pull request branch directly from GitHub
- Skips agent execution entirely
- Runs configured evaluators on the PR changes
- Generates a complete evaluation report

This is ideal for:
- CI/CD pipelines evaluating AI-generated PRs
- Batch evaluation of multiple PRs
- Comparing different AI agents' PRs
- Quality gates before merging AI-generated code

### 2. Works with All Evaluators

All youBencha evaluators work in PR mode:
- **git-diff**: Analyze what changes were made
- **expected-diff**: Compare PR against reference implementation
- **agentic-judge**: Evaluate PR quality with custom criteria

## Configuration

### Basic PR Evaluation

```yaml
repo: https://github.com/owner/repo.git

pull_request:
  url: https://github.com/owner/repo/pull/123

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      criteria:
        code_quality: "Code is well-structured. Score 0-1."
        tests_included: "Changes include tests. Score 1 if yes, 0 if no."
```

### PR Evaluation with Expected Reference

Compare the PR changes against a reference implementation:

```yaml
repo: https://github.com/owner/repo.git

pull_request:
  url: https://github.com/owner/repo/pull/123

# Compare against a reference branch
expected_source: branch
expected: expected-solution

evaluators:
  - name: expected-diff
    config:
      threshold: 0.80  # Require 80% similarity
```

## How It Works

### 1. GitHub Pull Request Refs

GitHub exposes pull requests as special Git refs at `refs/pull/{number}/head`. youBencha uses this feature to clone the exact state of the PR:

```
refs/pull/123/head  # The PR branch (head commit)
refs/pull/123/merge # The merge commit (not used)
```

### 2. Workspace Setup

When evaluating a PR, youBencha:

1. **Parses PR URL**: Extracts owner, repo, and PR number
2. **Clones Repository**: Performs shallow clone of base repository
3. **Fetches PR Ref**: Fetches `refs/pull/{number}/head` from origin
4. **Checks Out PR**: Checks out the PR branch
5. **Runs Evaluators**: Executes configured evaluators on PR changes

### 3. Agent Execution is Skipped

In PR mode:
- No AI agent is invoked
- Agent configuration is not required in suite.yaml
- A minimal youBencha log is created with `status: skipped`
- All evaluators run normally on the existing PR changes

## Complete Example

```yaml
# PR Evaluation Suite
# Evaluates an existing pull request from an AI agent

repo: https://github.com/octocat/Hello-World.git

# Specify the pull request to evaluate
pull_request:
  url: https://github.com/octocat/Hello-World/pull/1

# Optional: Compare against expected implementation
expected_source: branch
expected: main

# Evaluators to run
evaluators:
  # Analyze the changes made
  - name: git-diff
  
  # Compare against expected branch
  - name: expected-diff
    config:
      threshold: 0.85  # 85% similarity required
  
  # Evaluate with custom criteria
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      criteria:
        readme_modified: "README.md was modified appropriately"
        no_breaking_changes: "Changes don't break existing functionality"
        code_quality: "Code follows project conventions"
        tests_updated: "Tests are updated to cover changes"

# Optional: Workspace configuration
workspace_dir: .youbencha-workspace
timeout: 300000  # 5 minutes
```

## Usage

### Run PR Evaluation

```bash
yb run -c pr-evaluation-suite.yaml
```

### Generate Report

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

### Keep Workspace for Inspection

```bash
yb run -c pr-evaluation-suite.yaml --keep-workspace
```

## Use Cases

### 1. CI/CD Pipeline Integration

Evaluate PRs automatically in your CI pipeline:

```yaml
# .github/workflows/evaluate-pr.yml
name: Evaluate AI PR

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install -g youbencha
      - run: |
          cat > pr-suite.yaml <<EOF
          repo: https://github.com/${{ github.repository }}.git
          pull_request:
            url: https://github.com/${{ github.repository }}/pull/${{ github.event.pull_request.number }}
          evaluators:
            - name: git-diff
            - name: agentic-judge
              config:
                criteria:
                  code_quality: "Code meets quality standards"
          EOF
      - run: yb run -c pr-suite.yaml
      - run: yb report --from .youbencha-workspace/*/artifacts/results.json
```

### 2. Batch Evaluation

Evaluate multiple PRs from different AI agents:

```bash
# Create suite for each PR
for pr_number in 101 102 103; do
  cat > "pr-${pr_number}-suite.yaml" <<EOF
repo: https://github.com/owner/repo.git
pull_request:
  url: https://github.com/owner/repo/pull/${pr_number}
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      criteria:
        code_quality: "Evaluate code quality"
EOF
  yb run -c "pr-${pr_number}-suite.yaml"
done
```

### 3. Compare AI Agent Performance

Evaluate PRs from different AI agents on the same task:

```bash
# Agent A's PR
yb run -c agent-a-pr-suite.yaml

# Agent B's PR  
yb run -c agent-b-pr-suite.yaml

# Compare reports
yb report --from .youbencha-workspace/run-agent-a/artifacts/results.json
yb report --from .youbencha-workspace/run-agent-b/artifacts/results.json
```

## Validation

Validate your PR evaluation configuration before running:

```bash
yb validate -c pr-evaluation-suite.yaml -v
```

Output:
```
✓ Configuration is valid

🔗 Pull Request:
   URL: https://github.com/owner/repo/pull/123
   Mode: PR evaluation (agent execution will be skipped)

📊 Evaluators:
   1. git-diff
   2. agentic-judge (configured)

✅ Configuration is valid!

📋 Summary:
   Repository: https://github.com/owner/repo.git
   Mode: Pull Request Evaluation
   Evaluators: 2 configured

🚀 Ready to run:
   yb run -c pr-evaluation-suite.yaml
```

## Constraints and Limitations

### Pull Request URL Format

The PR URL must follow this format:
```
https://github.com/{owner}/{repo}/pull/{number}
```

Invalid formats (will be rejected):
- Issues URL: `https://github.com/owner/repo/issues/123`
- PR files tab: `https://github.com/owner/repo/pull/123/files`
- SSH URL: `git@github.com:owner/repo.git`

### Agent Configuration

When using PR evaluation mode:
- ✅ `agent` field is **not required**
- ✅ `pull_request` field **is required**
- ❌ Cannot specify both `agent` and `pull_request` (mutually exclusive)

### GitHub API Rate Limits

PR cloning uses Git protocol (not GitHub API), so it:
- ✅ Does not consume API rate limits
- ✅ Works with public repositories without authentication
- ℹ️ Private repositories require Git credentials

## Troubleshooting

### "Pull request not found"

**Cause**: PR number doesn't exist or repository is private without credentials

**Solution**: 
- Verify PR number is correct
- For private repos, ensure Git credentials are configured
- Check repository URL is correct

### "Invalid PR URL format"

**Cause**: PR URL doesn't match expected GitHub PR format

**Solution**: Use exact format: `https://github.com/owner/repo/pull/NUMBER`

### "Cannot specify both agent and pull_request"

**Cause**: Suite configuration has both `agent` and `pull_request` fields

**Solution**: Remove either `agent` or `pull_request` field - they're mutually exclusive

## Benefits

1. **Fast Evaluation**: No agent execution time - just evaluation
2. **CI/CD Friendly**: Perfect for automated quality gates
3. **Reproducible**: Evaluate the same PR state multiple times
4. **Cost Effective**: No API token usage for agent execution
5. **Flexible**: Works with all youBencha evaluators

## See Also

- [PR Evaluation Example](../examples/pr-evaluation-suite.yaml)
- [Expected Reference Configuration](./expected-ref-suite.yaml)
- [CI/CD Integration Guide](https://github.com/youbencha/youbencha-cli#cicd)
- [Agentic Judge Configuration](../examples/basic-suite.yaml)
