# Codex CLI adapter

The `codex-cli` adapter runs the installed Codex CLI through its supported
non-interactive `codex exec` interface. It sends the complete task prompt on
stdin, consumes JSON Lines events, and returns the final agent message to
youBencha.

## Install and authenticate

Install a current Codex CLI release using the
[official Codex CLI instructions](https://learn.chatgpt.com/docs/codex-cli), then
verify it:

```bash
codex --version
codex login status
```

For local use, run `codex login` and follow the sign-in flow. For trusted
automation, `CODEX_API_KEY` can authenticate an individual `codex exec`
process. Do not set `OPENAI_API_KEY` or `CODEX_API_KEY` for an entire job that
checks out or runs repository-controlled code; build scripts, dependency hooks,
tests, and other actions in that job could read it. Scope `CODEX_API_KEY` to the
single `yb run` process that launches Codex, and never store it in testcase
YAML, artifacts, or committed environment files.

Run `yb doctor` to distinguish installation, persisted authentication, and an
available single-process `CODEX_API_KEY`.

## Basic configuration

```yaml
agent:
  type: codex-cli
  model: gpt-5.4
  config:
    prompt: |
      Implement the requested change and run focused tests.
    sandbox: workspace-write
    approval_policy: never
    ephemeral: true
    ignore_user_config: true
    ignore_rules: false
    reasoning_effort: high
    search: false
```

`prompt_file` may replace `prompt` with a safe path relative to the testcase.
The two fields are mutually exclusive.

The same adapter can be used by an agentic judge:

```yaml
evaluators:
  - name: agentic-judge
    config:
      type: codex-cli
      assertions:
        focused: 'The implementation is limited to the requested behavior.'
        verified: 'Focused automated tests cover the change.'
```

## Command contract

The adapter constructs the equivalent of:

```text
codex
  --ask-for-approval never
  [--search]
  exec
  --json
  --ephemeral
  --color never
  --sandbox workspace-write
  --ignore-user-config
  -C <validated-repository>
  [--ignore-rules]
  [--profile <profile>]
  [--model <model>]
  [-c model_reasoning_effort="<level>"]
  -
```

Global flags precede `exec`. Both the child process working directory and `-C`
point to the validated modified repository. The adapter writes the prompt to
stdin and closes it immediately, so multiline text and Unicode do not require
shell quoting and the prompt does not appear in process arguments.

The adapter does not add `--skip-git-repo-check`, additional writable
directories, `danger-full-access`, or the sandbox-bypass flag. A benchmark
workspace must be a Git repository.

## Reproducibility and permissions

The defaults are deliberately non-interactive:

- `sandbox: workspace-write` permits changes inside the benchmark repository.
- `approval_policy: never` prevents a headless run from waiting for input.
- `ephemeral: true` avoids saving session rollout history.
- `ignore_user_config: true` ignores personal `config.toml` settings while
  retaining normal Codex authentication discovery.
- `ignore_rules: false` keeps user and project exec-policy rules active.

Repository `AGENTS.md` instructions remain active because they are part of the
repository under test. Set `ignore_rules: true` only when the benchmark
explicitly intends to bypass exec-policy `.rules` files; this does not disable
`AGENTS.md`.

`profile` is separate from `agent_name`. A Codex profile layers configuration,
while `AGENTS.md`, skills, and subagents provide different instruction or
delegation mechanisms. The initial adapter rejects `agent_name` instead of
silently reinterpreting it. Put task-specific skill instructions in the prompt.

## Supported fields

| Field                | Values                                           | Default           |
| -------------------- | ------------------------------------------------ | ----------------- |
| `prompt`             | non-empty string                                 | none              |
| `prompt_file`        | safe relative path                               | none              |
| `sandbox`            | `read-only`, `workspace-write`                   | `workspace-write` |
| `approval_policy`    | `never`                                          | `never`           |
| `ephemeral`          | boolean                                          | `true`            |
| `ignore_user_config` | boolean                                          | `true`            |
| `ignore_rules`       | boolean                                          | `false`           |
| `profile`            | non-empty profile name                           | none              |
| `reasoning_effort`   | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | CLI/model default |
| `search`             | boolean                                          | `false`           |
| `output_limit_bytes` | positive integer                                 | adapter default   |

`model` remains on the common `agent` object. `search: true` enables Codex web
search; it does not grant arbitrary network access to shell commands in the
workspace sandbox. Managed policy, the selected model, and the installed CLI
may further restrict any option.

## Output, artifacts, and usage

Codex progress remains separate from the final answer. The adapter parses
stdout as JSONL and writes artifacts under `artifacts/codex-cli-logs/`,
including the event stream, stderr, final message, and redacted execution
metadata. Event and stderr artifacts have a hard per-file quota derived from
`output_limit_bytes` (four times that value, with a 1 MiB floor and 64 MiB
ceiling); the final-message artifact is limited to `output_limit_bytes`.
Artifacts are complete when under those quotas. If a quota is reached, the
metadata and normalized diagnostics identify the truncated artifact.

Before stdout or stderr reaches durable storage, the adapter replaces values
from credential-like environment variables (including `CODEX_API_KEY`) with
`[REDACTED]`; JSON-escaped forms are covered as well. Parsed messages, errors,
and tool telemetry are also structurally redacted. The final-message artifact
is derived from that sanitized event stream rather than a second raw CLI output
file. These protections can intentionally make a retained artifact differ from
the CLI's byte-for-byte output.

The normalized result uses the final completed `agent_message` as
`AgentExecutionResult.output`. When Codex reports usage, youBencha records
measured input, cached-input, output, and reasoning-output token counts. It does
not infer a dollar cost from a local pricing table.

Unknown future event and item types are retained in the event stream without
causing an otherwise valid run to fail, subject to the artifact quota and
credential redaction above.

## Troubleshooting

### Codex is not installed

Install the standalone Codex CLI, ensure `codex --version` works in the same
environment as youBencha, then run `yb doctor`. Do not rely on a binary found
only inside an editor extension for production automation.

### Authentication is unavailable

Run `codex login` and verify `codex login status`, or provide
`CODEX_API_KEY` only to the individual trusted invocation. `CODEX_API_KEY`
applies to `codex exec`, not general Codex commands.

### Git repository check fails

Confirm the testcase source cloned successfully and that `src-modified` still
contains its `.git` metadata. The adapter intentionally does not bypass this
check.

### Policy, sandbox, or model errors

Managed configuration can forbid requested permissions, profiles, models, web
search, or tools. Keep `workspace-write` and `never` unless a more restrictive
test is intended. Use a model available to the authenticated account and avoid
depending on personal configuration when `ignore_user_config` is enabled.

### The run waits or times out

The adapter never requests interactive approval. Check stderr artifacts for
provider, MCP initialization, policy, command, or authentication errors. Raise
the testcase timeout only after ruling out a blocked subprocess or a task that
expects interactive input.

### Windows

youBencha resolves native executables and standard npm shims without placing
the prompt in a shell command. Keep both Codex and PowerShell discoverable on
`PATH` when the installed package exposes a `.cmd` or PowerShell shim. Codex
sandbox capabilities still depend on the installed Codex release and local
Windows policy.

## Integration tests

The default Codex integration test uses a deterministic fake executable and
requires no account or network. The live smoke test is opt-in:

```bash
CODEX_CLI_INTEGRATION_TESTS=1 npm test -- tests/integration/codex-cli-live.test.ts --runInBand
```

Set `CODEX_CLI_INTEGRATION_MODEL` only when the live environment requires an
explicit model. The test uses a temporary local Git repository, a short
timeout, and a small deterministic file change. It may consume model usage.

## Official references

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
