# Model selection

Both built-in adapters accept an optional non-empty `model` string:

```yaml
agent:
  type: copilot-cli
  model: account-selected-model
  config:
    prompt: 'Fix the bug.'
```

```yaml
agent:
  type: claude-code
  model: sonnet
  config:
    prompt: 'Fix the bug.'
```

An agentic judge may select a different model:

```yaml
evaluators:
  - name: agentic-judge
    config:
      type: claude-code
      model: haiku
      max_turns: 4
      assertions:
        tests_pass: 'All tests pass.'
```

youBencha does not maintain a closed Copilot model enum. Availability changes
with CLI versions, accounts, and organization policy. Inspect the model choices
offered by the installed CLI and signed-in account. Claude aliases such as
`sonnet` are convenient but may move; use a versioned model identifier for
strictly reproducible comparisons.

The adapters pass the value with `--model`, preserve the configured model in
provenance, and use the provider-reported model from structured events when
available. They do not fabricate a default model when it is unknown.

Model selection also interacts with:

- Copilot `reasoning_effort` and `max_ai_credits`;
- Claude `effort`, `fallback_model`, and `max_budget_usd`; and
- account entitlements and organization policies.

These settings can change cost, latency, and benchmark behavior. Record the CLI
version, configured model, reported model, limits, and instruction/settings
sources with every comparison.

See [GitHub Copilot CLI adapter](copilot-cli-adapter.md) and
[Claude Code adapter](claude-code-adapter.md) for full configuration.
