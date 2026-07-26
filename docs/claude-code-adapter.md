# Claude Code adapter

The `claude-code` adapter runs Claude Code without a TTY, consumes its
`stream-json` event protocol, and returns only the final assistant response to
youBencha evaluators. The complete event stream and stderr remain available as
artifacts.

## Install and update

Anthropic's native installer is recommended:

```bash
# macOS and Linux
curl -fsSL https://claude.ai/install.sh | bash
```

```powershell
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
```

The npm package remains an option:

```text
npm install -g @anthropic-ai/claude-code
```

Use `claude update` to update the active installation. The `latest` channel
receives new features first; use the `stable` channel when benchmark
repeatability is more important than immediate feature access. Record
`claude --version` with benchmark results.

## Authentication

Check local authentication without starting an agent turn:

```text
claude auth status --json
```

For interactive development, authenticate through Claude Code. For unattended
CI, provide one documented headless credential through the job's secret store:

- `ANTHROPIC_API_KEY` for API-key authentication; or
- `CLAUDE_CODE_OAUTH_TOKEN` for a provisioned Claude Code OAuth token.

Never put a credential in test-case YAML, command arguments, or logs.

## Headless command contract

The adapter invokes the resolved `claude` executable with an argument array
equivalent to:

```text
claude --print --output-format stream-json --verbose \
  --no-session-persistence [options] <prompt>
```

It closes stdin, never asks a question, applies the youBencha timeout, bounds
stdout/stderr previews by bytes, and terminates the process tree on timeout.
Raw output is not parsed from terminal decorations or human-oriented text.

For compatibility, the default permission policy remains bypass mode. Set
`permission_mode: dontAsk` with explicit tool rules when denied actions should
fail instead of being broadly allowed.

## Configuration

```yaml
agent:
  type: claude-code
  agent_name: code-reviewer
  model: sonnet
  config:
    prompt: 'Review the implementation and fix correctness issues.'
    permission_mode: dontAsk
    max_turns: 8
    max_budget_usd: 2
    effort: high
    fallback_model: haiku
    setting_sources: [project]
    tools: [Read, Grep, Edit]
    allowed_tools: [Read, Grep, Edit]
    disallowed_tools: [WebFetch]
    max_output_bytes: 10485760
```

`prompt` and `prompt_file` are mutually exclusive. Supported adapter options
are:

| Field                                | Meaning                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `system_prompt`                      | Replace Claude Code's system prompt                                        |
| `append_system_prompt`               | Append additional system instructions                                      |
| `permission_mode`                    | `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, or `plan` |
| `max_turns`                          | Maximum agent turns                                                        |
| `max_budget_usd`                     | Provider spend ceiling; can incur usage charges up to this value           |
| `effort`                             | `low`, `medium`, `high`, `xhigh`, `max`, or `ultracode`                    |
| `fallback_model`                     | Model used if the configured model is unavailable                          |
| `setting_sources`                    | Any of `user`, `project`, and `local`                                      |
| `tools`                              | Tools made available to the session                                        |
| `allowed_tools` / `disallowed_tools` | Non-interactive tool policy rules                                          |
| `max_output_bytes`                   | Bounds previews and parsed payloads; artifacts remain complete             |

Claude CLI options evolve between releases. During availability checks,
youBencha reads `claude --help` and records the permission modes and effort
levels advertised by the installed CLI. If that capability data says a
configured option is unavailable, execution fails with the installed version
and supported choices. If capability discovery is unavailable, the option is
passed through and telemetry records a diagnostic. For example, `ultracode`
can be configured for versions that advertise it, while older versions fail
before starting an agent turn.

`max_budget_usd` is accepted by older supported Claude releases, but full
budget enforcement across spawned subagents requires Claude Code 2.1.217 or
newer. When the detected version is older, provenance includes this caveat
without rejecting the run.

`max_tokens` and `temperature` are API parameters, not supported Claude Code
CLI flags. Current configuration validation rejects them with guidance to use
`max_turns` or `max_budget_usd`.

### Named agents

`agent_name` selects `.claude/agents/<name>.md` with Claude Code's native
`--agent` flag. youBencha validates the name and confirms the copied definition
exists before invocation. It does not rewrite the prompt.

The same adapter options can be applied to an agentic judge:

```yaml
evaluators:
  - name: agentic-judge
    config:
      type: claude-code
      agent_name: agentic-judge
      max_turns: 4
      max_budget_usd: 1
      setting_sources: [project]
      assertions:
        correct: 'The implementation is correct.'
```

## Reproducibility

Claude Code can read user, project, and local instruction/settings sources.
Use `setting_sources` to make the intended sources explicit, keep project
instructions in version control, disable session persistence, pin a CLI
version/channel, and record the configured and provider-reported model. A model
alias can move over time; use a versioned model identifier for strict
comparisons.

## Artifacts and usage

Each run writes:

```text
artifacts/
└── claude-code-logs/
    ├── events-<timestamp>.jsonl
    └── stderr-<timestamp>.log
```

The normalized log records provider-reported prompt, cached prompt, completion,
reasoning, total-token, and cost fields when present. `measurement_source` is
`measured`, `estimated`, or `unavailable`; unavailable values are not replaced
with character-count estimates.

`max_output_bytes` bounds the assistant text, tool payloads, errors, and final
response retained by the JSONL parser as well as process previews. Terminal
status, measured usage, and cost are still parsed after that bound is reached.
The raw event artifact remains complete, and telemetry records when retained
content was truncated.

## Local and CI examples

Local development can retain the compatibility permission default:

```yaml
agent:
  type: claude-code
  config:
    prompt: 'Fix the failing unit tests.'
    max_turns: 8
```

For CI, use explicit non-interactive restrictions and spend limits:

```yaml
agent:
  type: claude-code
  model: claude-sonnet-versioned-id
  config:
    prompt_file: prompts/ci-task.md
    permission_mode: dontAsk
    setting_sources: [project]
    allowed_tools: [Read, Grep, Edit, Bash]
    disallowed_tools: [WebFetch]
    max_turns: 6
    max_budget_usd: 1
    max_output_bytes: 5242880
timeout: 300000
```

Run `yb doctor`, then `claude auth status --json`, before a CI smoke test.
