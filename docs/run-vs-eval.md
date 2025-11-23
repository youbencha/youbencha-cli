# Command Comparison: `yb run` vs `yb eval`

This guide helps you choose between `yb run` and `yb eval` commands based on your use case.

## Quick Decision Tree

```
Do you need to execute an AI agent?
├─ YES → Use `yb run`
│         - Agent modifies code
│         - Full workspace setup
│         - Clones repository
│
└─ NO → Use `yb eval`
          - Evaluates existing code
          - No agent execution
          - Works with local directories
```

## Feature Comparison

| Feature | `yb run` | `yb eval` |
|---------|----------|-----------|
| **Agent Execution** | ✅ Yes | ❌ No |
| **Repository Cloning** | ✅ Yes | ❌ No |
| **Workspace Management** | ✅ Full workspace | ⚠️ Minimal (artifacts only) |
| **Git Operations** | ✅ Clone, checkout, branch management | ⚠️ Evaluates existing repo state |
| **Configuration** | Full test case config | Simplified eval config |
| **Output Location** | `.youbencha-workspace/` | `.youbencha-eval/` |
| **Speed** | Slower (includes agent) | Faster (evaluators only) |
| **Use When** | Testing agent behavior | Testing evaluator configurations |

## When to Use `yb run`

Use `yb run` when you want to:

1. **Test an AI agent's coding ability**
   ```bash
   yb run -c suite.yaml
   ```
   The agent will clone a repo, make changes, and be evaluated.

2. **Generate training data for agent benchmarks**
   Multiple runs to compare agent performance.

3. **Test agent behavior on specific tasks**
   Verify an agent can complete a specific coding task.

4. **Full end-to-end evaluation**
   From repository cloning to final evaluation.

### Example: Testing an agent
```yaml
# suite.yaml - Full test case
name: "Test Agent on Feature"
repo: https://github.com/example/repo.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add authentication middleware"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        auth_added: "Authentication was added"
```

## When to Use `yb eval`

Use `yb eval` when you want to:

1. **Re-evaluate existing agent outputs**
   ```bash
   # Already ran agent, now test different evaluators
   yb eval -c eval-strict.yaml
   ```

2. **Evaluate manual code changes**
   ```bash
   # Made changes manually, want to evaluate them
   git checkout -b my-feature
   # ... make changes ...
   yb eval -c eval.yaml
   ```

3. **Test custom evaluators quickly**
   ```bash
   # Developing new evaluator, test it fast
   yb eval -c eval-test-evaluator.yaml
   ```

4. **CI/CD integration**
   ```bash
   # Evaluate changes from automated tools
   ./scripts/refactor.sh
   yb eval -c eval-ci.yaml
   ```

5. **Compare multiple outputs**
   ```bash
   # Evaluate different agent outputs consistently
   yb eval -c eval.yaml --directory agent-a-output
   yb eval -c eval.yaml --directory agent-b-output
   ```

### Example: Evaluating existing code
```yaml
# eval.yaml - Simplified eval config
name: "Evaluate Existing Code"
description: "Check code quality"
directory: "./src"

evaluators:
  - name: git-diff
    config:
      thresholds:
        files_changed: 10
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        quality: "Code follows best practices"
```

## Configuration Differences

### `yb run` Configuration (suite.yaml)

**Required:**
- `repo` - Repository URL (will be cloned)
- `agent` - Agent configuration with type and config
- `evaluators` - List of evaluators

**Optional:**
- `branch` - Which branch to use
- `commit` - Specific commit SHA
- `expected` - Reference branch for comparison
- `pre_execution` - Hooks to run before agent
- `post_evaluation` - Hooks to run after evaluation
- `workspace_dir` - Custom workspace location
- `timeout` - Agent timeout

### `yb eval` Configuration (eval.yaml)

**Required:**
- `name` - Evaluation name
- `description` - What you're evaluating
- `directory` - Local directory path (must exist)
- `evaluators` - List of evaluators

**Optional:**
- `expected_directory` - Reference directory for comparison
- `output_dir` - Custom output location (default: `.youbencha-eval`)
- `post_evaluation` - Hooks to run after evaluation

**Not Needed:**
- No `repo` (uses existing directory)
- No `agent` (no execution)
- No `branch`, `commit` (uses current state)
- No `pre_execution` (no agent to prepare for)

## Common Workflows

### Workflow 1: Iterative Evaluator Development

```bash
# 1. Run agent once
yb run -c suite.yaml
# Output in: .youbencha-workspace/run-abc123/

# 2. Test different evaluator configs (fast!)
yb eval -c eval-v1.yaml  # First try
yb eval -c eval-v2.yaml  # Adjusted thresholds
yb eval -c eval-v3.yaml  # Added more evaluators

# 3. Once satisfied, update suite.yaml with final evaluators
yb run -c suite-final.yaml
```

### Workflow 2: Manual Development + Evaluation

```bash
# 1. Create feature branch
git checkout -b feature/auth

# 2. Make manual changes
# ... edit code ...
git add .
git commit -m "Add auth"

# 3. Evaluate your changes
yb eval -c eval.yaml

# 4. Generate report
yb report --from .youbencha-eval/eval-*/artifacts/results.json
```

### Workflow 3: CI/CD Pipeline

```yaml
# .github/workflows/evaluate.yml
steps:
  # Changes were made by previous steps
  - name: Evaluate changes
    run: yb eval -c .youbencha/ci-eval.yaml
  
  - name: Generate report
    run: yb report --from .youbencha-eval/eval-*/artifacts/results.json
    
  - name: Check if passed
    run: |
      if jq -e '.summary.overall_status == "passed"' .youbencha-eval/eval-*/artifacts/results.json; then
        echo "Evaluation passed!"
      else
        echo "Evaluation failed!"
        exit 1
      fi
```

### Workflow 4: Agent Comparison

```bash
# 1. Run multiple agents
yb run -c suite-agent-a.yaml  # Uses agent A
yb run -c suite-agent-b.yaml  # Uses agent B

# 2. Evaluate all outputs with same criteria
yb eval -c eval-comparison.yaml --directory .youbencha-workspace/run-agentA/src-modified
yb eval -c eval-comparison.yaml --directory .youbencha-workspace/run-agentB/src-modified

# 3. Compare reports
yb report --from .youbencha-eval/eval-1/artifacts/results.json
yb report --from .youbencha-eval/eval-2/artifacts/results.json
```

## Output Directories

### `yb run` Output
```
.youbencha-workspace/
└── run-2024-01-15T10-30-45-abc/
    ├── src-modified/           # Agent's changes
    ├── src-expected/          # Reference (if configured)
    └── artifacts/
        ├── youbencha.log.json # Agent execution log
        ├── results.json       # Evaluation results
        └── [evaluator outputs]
```

### `yb eval` Output
```
.youbencha-eval/
└── eval-2024-01-15T11-00-00-xyz/
    └── artifacts/
        ├── youbencha.log.json # Minimal log (no real agent)
        ├── results.json       # Evaluation results
        └── [evaluator outputs]
```

## Tips

1. **Faster Iteration**: Use `yb eval` for faster iteration when testing evaluators or configurations

2. **Full Testing**: Use `yb run` for complete end-to-end testing including agent behavior

3. **Cost Efficiency**: `yb eval` doesn't use agent API calls, saving money when testing evaluators

4. **Consistent Evaluation**: Use `yb eval` to evaluate multiple directories with identical criteria

5. **CI/CD**: `yb eval` is lighter weight and better suited for CI/CD pipelines

6. **Development**: Use `yb eval` during development to validate your code changes

## Related Commands

- [`yb init`](../README.md#yb-init) - Create starter configuration
- [`yb report`](../README.md#yb-report) - Generate reports from results
- [`yb validate`](../README.md#yb-validate) - Validate configurations
- [`yb list`](../README.md#yb-list) - List available evaluators
