# GitHub Copilot CLI adapter

The `copilot-cli` adapter runs GitHub Copilot CLI in programmatic JSON mode,
prevents interactive questions and remote sessions, and returns only the final
assistant response to evaluators. The complete event stream is retained.

## Install, update, and authenticate

Install or update the supported npm package:

```text
npm install -g @github/copilot
copilot update
copilot --version
```

For local development, start `copilot` once and follow its sign-in flow.
Headless credentials are considered in this precedence order:

1. `COPILOT_GITHUB_TOKEN`;
2. `GH_TOKEN`;
3. `GITHUB_TOKEN`;
4. a stored Copilot OAuth credential; and
5. GitHub CLI credential fallback.

Copilot CLI supports appropriately scoped fine-grained personal access tokens;
classic GitHub personal access tokens are not supported. Store tokens in the CI
secret store and never place them in YAML or command arguments.

Availability checks run only `copilot --version`. They do not spend an AI
request to probe authentication. Credential, entitlement, organization-policy,
and model errors are classified when execution starts.

## Headless command contract

The adapter invokes the resolved executable with an argument array equivalent
to:

```text
copilot --prompt <prompt> --output-format json --no-ask-user --no-color \
  --no-remote --no-remote-export -C <workspace> [options]
```

The process starts without a shell for native executables. A shared,
non-interactive Windows shim path handles `.cmd`, `.bat`, and `.ps1`
installations without concatenating the prompt into a shell command.

## Configuration

```yaml
agent:
  type: copilot-cli
  agent_name: code-reviewer
  model: account-selected-model
  config:
    prompt: 'Fix the failing tests.'
    reasoning_effort: high
    max_ai_credits: 10
    log_level: warning
    allow_all_tools: true
    allow_all_paths: true
    max_output_bytes: 10485760
```

| Field                | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `reasoning_effort`   | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`    |
| `max_ai_credits`     | Maximum premium-request credits the run may consume              |
| `log_level`          | `none`, `error`, `warning`, `info`, `debug`, `all`, or `default` |
| `allow_all_tools`    | Emit `--allow-all-tools`; defaults to `true` for compatibility   |
| `allow_all_paths`    | Emit `--allow-all-paths`; defaults to `true` for compatibility   |
| `max_output_bytes`   | Per-stream in-memory preview and parser-retention bound           |
| `legacy_text_output` | Request and accept legacy plain-text output; defaults to `false` |

The permission defaults intentionally preserve existing youBencha behavior.
Set both `allow_all_*` fields to `false` for a restrictive run. Because
`--no-ask-user` is always active, an unapproved action fails instead of waiting
for input. `log_level: all` is opt-in because verbose logs can contain more
repository context.

Current Copilot versions must emit JSONL. An exit-zero process that produces
only non-JSON output is treated as failed. `legacy_text_output: true` is an
explicit compatibility path for a pinned older CLI: it changes
`--output-format` to `text`, gives up structured telemetry, and should not be
used for new benchmark configurations.

Named agents use Copilot's native `--agent` option and definitions from
`.github/agents/`.

## Models and reproducibility

Model availability depends on the signed-in account and organization policy.
youBencha therefore accepts a non-empty model string instead of hard-coding a
closed model list. Inspect the choices exposed by the installed CLI/account,
then record the configured model, reported model, and CLI version with results.

Copilot can also be influenced by repository instructions and named-agent
files. Keep those sources under version control and avoid depending on
unrecorded user-level configuration for comparative benchmarks.

## Artifacts and measured usage

Each run writes:

```text
artifacts/
└── copilot-logs/
    ├── events-<timestamp>.jsonl
    └── stderr-<timestamp>.log
```

The parser tolerates unknown future events, records structured errors and tool
activity, and requires a valid terminal response. `max_output_bytes` also
bounds event content retained by the parser while it continues reading
terminal and usage events. The budget charges both UTF-8 text and a minimum
overhead for every retained collection entry, so many tiny events cannot grow
telemetry without bound. Event and stderr artifacts are independently capped at
64 MiB per stream. If the event artifact reaches that safety limit, the
execution fails because the structured result may be incomplete. Telemetry records
when retained content was truncated.

Reported token and credit values use `measurement_source: measured`. Copilot
fields named `cost` represent premium-request or AI-credit consumption, not US
dollars, and are reported as credits. `cost_usd` remains absent unless Copilot
adds an explicitly USD-denominated field. Missing usage remains `unavailable`;
youBencha does not apply a fabricated GPT price.

## Local and CI examples

Local compatibility configuration:

```yaml
agent:
  type: copilot-cli
  config:
    prompt: 'Update the implementation and its tests.'
    max_ai_credits: 10
```

Restrictive CI configuration:

```yaml
agent:
  type: copilot-cli
  model: account-selected-model
  config:
    prompt_file: prompts/ci-task.md
    reasoning_effort: medium
    max_ai_credits: 5
    log_level: warning
    allow_all_tools: false
    allow_all_paths: false
    max_output_bytes: 5242880
timeout: 300000
```

Run `yb doctor` before the smoke test. If execution reports no supported
credentials, verify the token precedence above and confirm that the selected
credential has Copilot access.
