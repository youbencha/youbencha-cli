---
name: youbencha-authoring
description: Use when creating, editing, or debugging youBencha test cases, evaluators, eval configs, or reusable evaluator definitions. Triggers on requests to write YAML/JSON configurations for evaluating AI coding agents, define assertions, configure agentic judges, set up git-diff thresholds, or compose evaluation pipelines.
---

# youBencha Test Case & Evaluator Authoring

Author test cases, evaluators, and eval configs for the youBencha CLI framework.

## Quick Reference: File Types

| File | Schema | Command | Purpose |
|------|--------|---------|---------|
| Test case (`.yaml`) | `testCaseConfigSchema` | `yb run -c file.yaml` | Full pipeline: clone → agent → evaluate |
| Eval config (`.yaml`) | `evalConfigSchema` | `yb eval -c file.yaml` | Evaluate existing directory (no agent) |
| Reusable evaluator (`.yaml`) | `evaluatorDefinitionSchema` | Referenced via `file:` | Shared evaluator config across test cases |

## Test Case Structure

```yaml
# REQUIRED fields
name: "Short descriptive name"           # 1-200 chars
description: "What this test evaluates"  # 1-1000 chars
repo: https://github.com/org/repo.git   # HTTPS only, no localhost/private IPs
agent:
  type: copilot-cli                      # 'copilot-cli' | 'claude-code'
  config:
    prompt: "Task for the agent"         # OR prompt_file (mutually exclusive)
evaluators:                              # At least 1 required
  - name: git-diff

# OPTIONAL fields
branch: main
commit: abc123
agent:
  agent_name: my-agent                   # Named agent from .github/agents/
  model: gpt-5.1                         # Model override
  config:
    prompt_file: ./prompts/task.md       # External prompt (mutually exclusive with prompt)
    # Any additional keys passed through to adapter
expected_source: branch                  # Only 'branch' supported
expected: reference-branch               # Required when expected_source is set
pre_execution: []                        # Scripts before agent runs
post_evaluation: []                      # Hooks after evaluation
workspace_dir: .youbencha-workspace
workspace_name: my-run                   # Alphanumeric start, [a-zA-Z0-9._-]
timeout: 300000                          # ms, default 5min
```

## Evaluators

### git-diff

Measures scope of changes. No expected reference needed.

```yaml
- name: git-diff
  config:
    assertions:
      max_files_changed: 3
      max_lines_added: 100
      max_lines_removed: 50
      max_total_changes: 150
      min_change_entropy: 0.5    # Enforce spread across files
      max_change_entropy: 2.0    # Enforce concentration
    base_commit: HEAD             # Optional custom base
```

Output metrics: `files_changed`, `lines_added`, `lines_removed`, `total_changes`, `change_entropy`, `changed_files[]`, `violations[]`.

Status: `passed` if no assertion violations, `failed` if any violated.

### expected-diff

Compares agent output to reference branch. **Requires** `expected_source: branch` + `expected:` in test case.

```yaml
- name: expected-diff
  config:
    threshold: 0.80              # 0.0-1.0, default 0.80
```

Output metrics: `aggregate_similarity`, `files_matched`, `files_changed`, `files_added`, `files_removed`, `file_similarities[]`.

### agentic-judge

Uses an AI agent to evaluate code quality against user-defined assertions. Supports multiple named instances for focused evaluation.

```yaml
- name: agentic-judge                    # Or custom name:
# - name: agentic-judge-error-handling   # Hyphen prefix
# - name: agentic-judge:documentation    # Colon prefix
  config:
    type: copilot-cli                    # REQUIRED: agent type for evaluation
    assertions:                          # REQUIRED: keys → metric names, values → scoring instructions
      readme_modified: "README.md was modified. Score 1 if true, 0 if false."
      message_friendly: "Welcome message is friendly. Score 1 if friendly, 0.5 if neutral, 0 if absent."
    agent_name: agentic-judge            # Optional: named agent
    model: claude-sonnet-4.5             # Optional: model for evaluator
    timeout: 300000                      # Optional: ms
    prompt: "Extra instructions..."      # Optional: prepended to assertions
    prompt_file: ./eval-instructions.txt # Optional: load prompt from file
    instructions-file: ./template.md     # Optional: custom template with {{ASSERTIONS}} placeholder
```

**Naming rules for multiple judges**: Use `agentic-judge-<focus>` or `agentic-judge:<focus>`. Each produces a separate section in the report.

**Prompt priority**: `instructions-file` > `agent_name` (agent has built-in instructions) > default template.

**Assertion writing guidelines**:
- Keys become metric names in output — use `snake_case`
- Values must be explicit scoring instructions
- Pattern: `"<what to check>. Score 1 if <condition>, 0.5 if <partial>, 0 if <absent/wrong>."`
- Keep 1-3 assertions per judge for focused evaluation

## Reusable Evaluator Definitions

Store shared evaluator configs in separate YAML files:

```yaml
# evaluators/readme-grammar-check.yaml
name: agentic-judge:readme-grammar
description: "Checks README grammar quality"
config:
  type: copilot-cli
  agent_name: agentic-judge
  timeout: 300000
  assertions:
    grammatically_correct: "README.md is grammatically correct. Score 1 if true, 0 if false."
    no_spelling_errors: "No spelling errors in README.md. Score 1 if true, 0 if false."
```

Reference from test case:

```yaml
evaluators:
  - file: ./evaluators/readme-grammar-check.yaml
```

File references and inline configs can be mixed. File references are resolved relative to the test case file directory.

## Eval-Only Config (yb eval)

Run evaluators on an existing directory without agent execution:

```yaml
name: "Eval existing code"
description: "Run evaluators against local directory"
directory: "./path/to/code"                # Required, must exist
expected_directory: "./path/to/expected"    # Optional
output_dir: .youbencha-eval                # Optional
evaluators:                                # Inline only, no file references
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5
post_evaluation: []                        # Optional hooks
```

## Pre-Execution Hooks

Run scripts after workspace setup, before agent execution. Sequential — order matters. Failure aborts the pipeline.

```yaml
pre_execution:
  - name: script
    config:
      command: bash
      args: ["-c", "npm install"]
      env:
        NODE_ENV: development
      timeout_ms: 30000                    # Default 30s
      working_dir: /custom/path            # Default: workspace dir
```

## Post-Evaluation Hooks

Run after evaluation completes. Parallel execution. Never fail the pipeline.

```yaml
post_evaluation:
  # JSON file export (append to JSONL for historical tracking)
  - name: database
    config:
      type: json-file
      output_path: ./results-history.jsonl
      include_full_bundle: true
      append: true

  # Webhook notification
  - name: webhook
    config:
      url: https://api.example.com/results
      method: POST                         # POST | PUT | PATCH
      headers:
        Authorization: "Bearer ${TOKEN}"
      include_artifacts: false
      retry_on_failure: true
      timeout_ms: 5000

  # Custom script
  - name: script
    config:
      command: ./scripts/notify.sh
      args: ["--results", "${RESULTS_PATH}"]
      timeout_ms: 30000
```

## Variable Substitution

Define variables in `.youbencharc` (project) or `~/.youbencharc` (user):

```yaml
variables:
  REPO_BASE: https://github.com/myorg
  DEFAULT_BRANCH: main
```

Reference with `${VAR_NAME}` anywhere in test case configs. Unresolved variables are left as-is.

## Common Patterns

### Pattern: Minimal test case

```yaml
name: "Basic README edit"
description: "Tests basic file modification"
repo: https://github.com/org/repo.git
branch: main
agent:
  type: copilot-cli
  config:
    prompt: "Add a comment to README"
evaluators:
  - name: git-diff
```

### Pattern: Multiple focused judges

```yaml
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 5
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        has_try_catch: "Try-catch blocks present. Score 1 if yes, 0 if no."
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "Functions have JSDoc. Score 1 if all, 0.5 if partial, 0 if none."
```

### Pattern: Expected reference comparison

```yaml
expected_source: branch
expected: solution-branch
evaluators:
  - name: expected-diff
    config:
      threshold: 0.85
  - name: git-diff
```

### Pattern: Claude Code agent

```yaml
agent:
  type: claude-code
  model: claude-sonnet-4-5-20250929
  config:
    prompt: "Review and fix security issues"
    append_system_prompt: "Focus on OWASP Top 10"
evaluators:
  - name: agentic-judge
    config:
      type: claude-code              # Match agent type for evaluator
      assertions:
        security_fixed: "Security issues addressed. Score 1 if fixed, 0 if not."
```

### Pattern: Full pipeline with hooks

```yaml
pre_execution:
  - name: script
    config:
      command: npm
      args: ["install"]
      timeout_ms: 60000
# ... agent + evaluators ...
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./history.jsonl
      append: true
```

## Validation Rules

- `repo` must be HTTPS URL — no `localhost`, `127.0.0.1`, `192.168.*`, `10.*`, `172.16.*`, `::1`
- `prompt` and `prompt_file` are mutually exclusive (schema-enforced)
- `expected` is required when `expected_source` is set
- At least 1 evaluator required
- `workspace_name` must start with alphanumeric: `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`
- Evaluator config is a strict union: either `{ name, config? }` or `{ file }`, never both

## Results Structure

After `yb run`, results are saved as `results.json`:

```
ResultsBundle {
  version: '1.0.0'
  test_case: { name, description, repo, branch, commit, ... }
  execution: { started_at, completed_at, duration_ms, ... }
  agent: { type, status: 'success'|'failed'|'timeout', exit_code }
  evaluators: EvaluationResult[]
  summary: { total_evaluators, passed, failed, skipped, overall_status }
  artifacts: { agent_log, reports[], evaluator_artifacts[] }
}
```

Each `EvaluationResult`:
```
{ evaluator, status: 'passed'|'failed'|'skipped', metrics, message, duration_ms, timestamp, assertions?, artifacts?, error? }
```

Generate reports: `yb report --from results.json --format markdown`

## CLI Commands

| Command | Purpose |
|---------|---------|
| `yb run -c testcase.yaml` | Full pipeline |
| `yb eval -c eval.yaml` | Evaluators only |
| `yb report --from results.json` | Generate report |
| `yb validate -c testcase.yaml` | Validate config without running |
| `yb list` | List available evaluators |
| `yb init` | Scaffold new test case |
| `yb suggest-testcase` | AI-assisted test case generation |
