# Codex CLI adapter integration plan

**Status:** Implemented (2026-07-26)
**Priority:** High after the shared process foundation  
**Target duration:** 1–3 weeks  
**Depends on:** Workstream A and the structured telemetry contract from the
headless adapter modernization plan  
**Primary outcome:** `codex-cli` is a first-class youBencha agent and
agentic-judge adapter using the supported non-interactive `codex exec`
interface.

## 1. Scope

In scope:

- a new `CodexCLIAdapter` implementing `AgentAdapter`;
- non-interactive execution through `codex exec`;
- prompt delivery through stdin;
- JSONL event parsing and raw event artifacts;
- workspace-write sandboxing with no interactive approvals;
- ephemeral benchmark sessions by default;
- model, reasoning, profile, and reproducibility configuration;
- measured usage normalization;
- installation and authentication diagnostics;
- main-agent and agentic-judge registration;
- schemas, docs, examples, doctor output, and tests.

Out of scope:

- using Codex app-server as the initial adapter transport;
- using the Codex SDK instead of the installed CLI;
- Codex cloud task submission;
- remote-control or interactive TUI support;
- session resume in the first release;
- arbitrary `config.toml` mutation;
- exposing `danger-full-access` as a normal benchmark default;
- mapping youBencha `agent_name` to a Codex profile, skill, or subagent;
- installing or authenticating Codex automatically.

## 2. Design decisions

1. Use `codex exec`, the documented non-interactive interface.
2. Send the prompt through stdin and close stdin immediately.
3. Use `--json` and parse JSONL incrementally.
4. Keep `AgentExecutionResult.output` as the final agent message.
5. Store the complete JSONL stream as an artifact.
6. Use `--ephemeral` by default so benchmark sessions do not pollute local
   history.
7. Use `--sandbox workspace-write --ask-for-approval never` by default.
8. Keep Codex's sandbox active; do not use
   `--dangerously-bypass-approvals-and-sandbox`.
9. Use `--ignore-user-config` by default for repeatable benchmark execution,
   with an explicit opt-out.
10. Continue loading repository `AGENTS.md` instructions because they are part
    of the repository-under-test contract.
11. Treat installation, authentication, and execution readiness as distinct
    states.
12. Feature-detect required flags and event types where practical rather than
    pinning one exact CLI version.

## 3. Public configuration

Add `codex-cli` to the agent type discriminated union:

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
```

Initial schema:

```ts
const codexCLIConfigSchema = z
  .object({
    prompt: z.string().min(1).max(50_000).optional(),
    prompt_file: safeRelativePathSchema.optional(),
    sandbox: z
      .enum(['read-only', 'workspace-write'])
      .default('workspace-write'),
    approval_policy: z.literal('never').default('never'),
    ephemeral: z.boolean().default(true),
    ignore_user_config: z.boolean().default(true),
    ignore_rules: z.boolean().default(false),
    profile: z.string().min(1).optional(),
    reasoning_effort: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
      .optional(),
    search: z.boolean().default(false),
    output_limit_bytes: z.number().int().positive().optional(),
  })
  .strict();
```

`model` remains at the common agent level and accepts a non-empty string.

Do not initially expose:

- arbitrary `-c key=value` overrides;
- `danger-full-access`;
- `--dangerously-bypass-approvals-and-sandbox`;
- `--skip-git-repo-check`;
- remote app-server addresses;
- session resume;
- arbitrary additional writable directories; or
- `CODEX_HOME` paths in test-case configuration.

These options materially change trust boundaries or reproducibility and require
separate design review.

### Agent name behavior

Codex profiles, skills, subagents, and `AGENTS.md` serve different purposes.
The adapter must not reinterpret `agent_name` as any of them.

For the first release:

- reject `agent_name` for `codex-cli` with an actionable validation error;
- expose `profile` as its own config field;
- allow repository `AGENTS.md` discovery normally; and
- document that task-specific skill invocation belongs in the prompt.

## 4. Command contract

Default invocation:

```text
codex exec
  --json
  --ephemeral
  --color never
  --sandbox workspace-write
  --ask-for-approval never
  --ignore-user-config
  -C <repoDir>
  [--ignore-rules]
  [--profile <profile>]
  [--model <model>]
  [-c model_reasoning_effort="<level>"]
  -
```

The runner writes the prompt to stdin, ends stdin, and independently consumes
stdout and stderr.

Reasons to use stdin:

- the prompt is not exposed in process listings;
- no platform-specific prompt quoting is required;
- multiline and Unicode prompts are passed exactly;
- the command avoids known ambiguity around inherited non-TTY stdin; and
- prompt size is not constrained by the operating system command-line limit.

`cwd` and `-C` must both point to the validated modified repository directory.
The adapter must not use `--skip-git-repo-check`; youBencha workspaces are Git
repositories, and a missing repository is an infrastructure error.

### Reasoning effort

The installed CLI currently exposes reasoning through configuration rather than
a dedicated `codex exec --reasoning-effort` flag. Encode the typed value as one
reviewed `-c model_reasoning_effort="<level>"` argument. Do not accept arbitrary
TOML from test-case configuration.

### Search and network

`search: true` adds `--search`, but it does not itself grant shell-command
network access inside the workspace sandbox. Record this distinction in the
effective config and provenance.

## 5. Adapter implementation

Create:

```text
src/adapters/codex-cli.ts
```

with:

```ts
export class CodexCLIAdapter implements AgentAdapter {
  readonly name = 'codex-cli';
  readonly version = '1.0.0';

  checkAvailability(): Promise<boolean>;
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  normalizeLog(rawOutput: string, result: AgentExecutionResult): YouBenchaLog;
}
```

Use the shared executable resolver and process runner from the modernization
plan. Do not copy process-spawning code from the existing adapters.

### Availability

The availability sequence is:

1. resolve `codex`;
2. run `codex --version`;
3. parse a semantic version when possible;
4. run `codex login status`;
5. account for `CODEX_API_KEY` being valid only for `codex exec`; and
6. return a diagnostic state without exposing credential details.

The current `AgentAdapter.checkAvailability(): Promise<boolean>` cannot express
installed versus authenticated versus environment-authenticated states and
does not receive execution environment overrides. Before adding Codex, either:

- add a backward-compatible optional `diagnoseAvailability()` method returning
  structured diagnostics; or
- extend `checkAvailability` to accept an optional non-secret execution
  environment.

Recommended shape:

```ts
interface AgentAvailability {
  installed: boolean;
  authenticated: boolean | 'unknown';
  version?: string;
  executableKind?: string;
  messages: string[];
}
```

Keep `checkAvailability()` as a compatibility wrapper returning
`installed && authenticated !== false`.

Do not execute an AI request to validate authentication.

### Authentication

Support:

- persisted ChatGPT login from `codex login`;
- persisted API-key login; and
- `CODEX_API_KEY` inherited or supplied only to the individual `codex exec`
  process.

Do not serialize credentials into configuration, results, logs, or artifacts.
Documentation should recommend setting `CODEX_API_KEY` only for the single
invocation environment, not globally across repository-controlled build steps.

## 6. JSONL parser

Implement a line-oriented parser for documented event types:

- `thread.started`;
- `turn.started`;
- `item.started`;
- `item.updated` when present;
- `item.completed`;
- `turn.completed`;
- `turn.failed`; and
- `error`.

Recognize item types including:

- `agent_message`;
- `reasoning`;
- `command_execution`;
- `file_change`;
- `mcp_tool_call`;
- `web_search`; and
- `plan_update`.

Parser behavior:

- capture `thread_id` as the session identifier;
- append final `agent_message` text to `result.output`;
- map command and MCP activity to normalized tool calls;
- extract file-change summaries without duplicating the Git diff;
- extract measured token usage from `turn.completed`;
- preserve cached-input and reasoning-token counts in telemetry;
- classify `turn.failed` and top-level `error` events;
- accept unknown event and item types without failing;
- reject invalid terminal state, missing final completion, or contradictory
  success/failure terminal events;
- bound buffered partial lines; and
- store the raw stream byte-for-byte as an artifact.

Progress emitted on stderr is diagnostic output. Capture it separately and do
not append it to the final assistant response.

## 7. Normalized log mapping

Map Codex data to the youBencha log as follows:

| youBencha field            | Codex source                                        |
| -------------------------- | --------------------------------------------------- |
| `agent.name`               | `codex-cli`                                         |
| `agent.version`            | `codex --version`                                   |
| `agent.adapter_version`    | adapter constant                                    |
| `model.name`               | configured model, or reported model when available  |
| `model.provider`           | `OpenAI`                                            |
| `execution.*`              | shared process runner                               |
| `messages`                 | completed agent, command, file, MCP, and plan items |
| `usage.prompt_tokens`      | `turn.completed.usage.input_tokens`                 |
| cached prompt tokens       | `cached_input_tokens` optional extension            |
| `usage.completion_tokens`  | `output_tokens`                                     |
| reasoning tokens           | `reasoning_output_tokens` optional extension        |
| `usage.total_tokens`       | computed only from measured fields                  |
| `usage.estimated_cost_usd` | absent unless Codex reports cost directly           |
| `errors`                   | terminal errors plus process failures               |

Do not estimate Codex cost from a model pricing table in the adapter.

## 8. Agentic-judge integration

Add `codex-cli` to the agentic-judge schema and factory.

The evaluator needs a stable final JSON object, while the adapter's stdout is a
JSONL envelope. Preserve compatibility by returning only the final
`agent_message` text in `AgentExecutionResult.output`.

For stronger evaluator output, add an adapter capability for structured final
responses:

```ts
interface StructuredOutputRequest {
  schema: Record<string, unknown>;
}
```

The Codex adapter can then:

1. write the evaluator JSON Schema to the evaluator artifacts directory;
2. pass `--output-schema <validated-path>`;
3. optionally pass `--output-last-message <validated-path>`;
4. parse and validate the final message; and
5. return the same final JSON text expected by the existing judge parser.

Implement this capability after the basic adapter works, or in the same change
only if Claude's `--json-schema` path is generalized at the same time. Do not
make the generic `AgentAdapter` depend on a Codex-only flag.

## 9. Registration and repository touch points

Update:

- `src/adapters/codex-cli.ts`;
- `src/adapters/base.ts` for optional telemetry and diagnostics;
- the shared process runner and resolver under `src/lib/`;
- `src/schemas/testcase.schema.ts`;
- `src/schemas/evaluator-config.schema.ts`;
- any effective-config schema and merger;
- `src/core/orchestrator.ts`;
- `src/evaluators/agentic-judge.ts`;
- `src/cli/commands/doctor.ts`;
- `src/cli/commands/list.ts`;
- initialization templates;
- `suggest-testcase` validation and invocation if that command remains
  adapter-specific;
- schema exports;
- result normalization/reporting if usage fields expand;
- README, focused docs, and examples; and
- package-content contract tests.

The deprecated `src/schemas/suite.schema.ts` should either re-export the active
agent schema or be removed in a separately documented compatibility change. Do
not add a third divergent agent enum to it.

## 10. Artifacts

Create:

```text
artifacts/
└── codex-cli-logs/
    ├── events-<timestamp>.jsonl
    ├── stderr-<timestamp>.log
    ├── final-message-<timestamp>.txt
    └── execution-metadata-<timestamp>.json
```

`execution-metadata` contains only redacted, non-secret provenance:

- CLI and adapter versions;
- configured and reported model;
- sandbox and approval policy;
- ephemeral and ignore-config states;
- reasoning effort;
- thread ID;
- duration and exit code;
- output truncation state; and
- usage measurement source.

Validate every artifact path against `context.artifactsDir`.

## 11. Doctor and user-facing diagnostics

`youbencha doctor` should report:

```text
Codex CLI
  Installed: yes
  Version: <version>
  Authentication: signed in | CODEX_API_KEY available | unavailable | unknown
  Non-interactive exec: supported
  JSONL output: supported
  Workspace sandbox: supported
```

Recommended remediation:

- install the standalone CLI using the current official installation method;
- run `codex login` for local use;
- use a single-process `CODEX_API_KEY` environment for trusted automation;
- run `codex login status` to inspect persisted login; and
- avoid using a binary discovered only inside an editor-extension directory as
  the documented production installation.

Doctor must not launch `codex exec` or consume model usage.

## 12. Tests

### Unit

Add `tests/unit/codex-cli.test.ts` covering:

- command construction and argument order;
- prompt passed through stdin and not argv;
- stdin closed after the prompt;
- default sandbox, approval, ephemeral, and ignore-config flags;
- optional model, profile, reasoning, rules, and search flags;
- rejection of unsafe or conflicting config;
- no `--skip-git-repo-check`;
- JSONL parsing for every supported event/item type;
- unknown events;
- malformed lines;
- missing terminal events;
- success, model failure, auth failure, timeout, and truncation;
- measured usage;
- final-response extraction;
- artifact paths; and
- redacted diagnostics.

### Contract

Add `tests/contract/codex-cli-adapter.test.ts` covering:

- `AgentAdapter` conformance;
- `codex-cli` main-agent schema;
- `codex-cli` agentic-judge schema;
- normalized log validation;
- optional telemetry validation;
- `agent_name` rejection;
- published example validation; and
- stable final-response behavior.

### Integration

Add an offline integration test with a fake `codex` executable that:

- responds to `--version`;
- responds to `login status`;
- validates received argv and stdin;
- emits deterministic JSONL;
- writes a file into the modified repository; and
- exits with configurable codes.

This proves the full orchestrator path without authentication or network.

Add an opt-in live smoke test:

```text
CODEX_CLI_INTEGRATION_TESTS=1
```

The live test must:

- run only when Codex is installed and authenticated;
- use a tiny local Git fixture;
- use an explicit model only when supplied by the environment;
- set a short timeout;
- avoid network-dependent task instructions;
- assert a small deterministic file change;
- retain artifacts; and
- never run in the default test suite.

## 13. Documentation

Add `docs/codex-cli-adapter.md` covering:

- installation and authentication;
- local versus CI credentials;
- the `codex exec` command contract;
- sandbox and approval defaults;
- model, profile, reasoning, and search configuration;
- `AGENTS.md` behavior;
- why `agent_name` is not supported;
- ephemeral sessions;
- raw JSONL artifacts;
- measured usage fields;
- troubleshooting for Git, auth, policy, model, sandbox, and timeout errors;
- Windows behavior; and
- opt-in live tests.

Update:

- README supported-agent tables;
- `docs/GETTING-STARTED.md`;
- `docs/configuration.md`;
- `docs/agent-name-configuration.md`;
- experiment examples with a Codex variant;
- init-template comments;
- CLI list/help text; and
- maintenance status after checks are rerun.

## 14. Delivery sequence

### Change 1: contract and offline adapter

- optional telemetry and availability diagnostics;
- Codex config schema;
- adapter command construction;
- JSONL parser;
- factories;
- fake executable integration fixture; and
- unit/contract tests.

### Change 2: evaluator and reporting

- agentic-judge registration;
- final structured-response capability if adopted;
- normalized usage extensions;
- artifact manifest integration;
- reporter updates; and
- end-to-end offline tests.

### Change 3: discoverability and live verification

- doctor, list, and init updates;
- docs and examples;
- opt-in live smoke test;
- lint, build, targeted tests, and package dry run; and
- maintenance-status update.

Do not mix the adapter work with a repository-wide formatting rewrite or
dependency-major upgrade.

## 15. Definition of done

1. `type: codex-cli` validates for main-agent and agentic-judge use.
2. The adapter invokes `codex exec` with JSONL, ephemeral sessions,
   workspace-write sandboxing, and no interactive approvals.
3. Prompts travel through stdin and never appear in logged argv.
4. `AgentExecutionResult.output` contains only the final agent response.
5. The complete JSONL stream and stderr are retained as separate artifacts.
6. Measured input, cached-input, output, and reasoning tokens are normalized.
7. Unknown future events do not break successful runs.
8. Authentication and policy failures are actionable and do not consume a
   request during doctor or availability checks.
9. `agent_name` is rejected rather than silently remapped.
10. Offline unit, contract, and integration tests pass on Windows and an
    Unix-like CI runner.
11. The live test is opt-in and bounded.
12. Lint, build, changed-file formatting, targeted tests, and package dry run
    pass.
13. README, focused docs, examples, CLI help, and doctor output agree with the
    implementation.

## 16. Primary references

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex CLI command reference](https://developers.openai.com/codex/cli/reference)
- [OpenAI Codex repository](https://github.com/openai/codex)
