# Headless adapter modernization plan

**Status:** Proposed  
**Priority:** High  
**Target duration:** 2–4 weeks  
**Primary outcome:** Claude Code and GitHub Copilot CLI run reliably in
non-interactive environments with structured telemetry, deterministic limits,
current authentication guidance, and cross-platform command discovery.

## 1. Scope

This plan covers the selected high-priority updates from the July 2026 adapter
review:

1. fix Copilot CLI discovery and availability checks on Windows;
2. consume Claude Code and Copilot CLI structured output;
3. guarantee that headless runs cannot stop to ask the user a question;
4. invoke named Claude agents through the supported `--agent` interface;
5. improve reproducibility, resource limits, output bounds, and process
   cleanup; and
6. update installation, authentication, configuration, and troubleshooting
   documentation.

In scope:

- a shared, testable subprocess boundary for agent CLIs;
- executable discovery that works for native binaries and Windows npm shims;
- JSON/JSONL parsing for Claude Code and Copilot CLI;
- measured usage and session metadata when the CLI supplies them;
- explicit non-interactive behavior and failure classification;
- Claude named-agent selection with `--agent`;
- bounded output and complete child-process cleanup;
- version and capability diagnostics;
- focused schema, documentation, example, and test updates.

Out of scope:

- adding the Codex CLI adapter, which has a separate plan;
- adding a container or VM execution provider;
- a general plugin or public adapter registry;
- changing evaluator scoring semantics;
- silently broadening an agent's filesystem, command, URL, or network access;
- a complete redesign of the existing permission defaults. Permission changes
  in this plan are limited to making non-interactive behavior explicit and
  preventing contradictory CLI flags.

## 2. Product contract

### Headless execution

Every built-in adapter must:

- start without a TTY;
- close or deliberately use stdin;
- never wait for an interactive answer;
- preserve the final assistant response in `AgentExecutionResult.output`;
- retain the raw machine-readable event stream as an artifact;
- return `failed` with an actionable error when a required action is denied;
- apply the configured timeout and output limits;
- terminate the complete process tree after timeout escalation; and
- never place prompts, tokens, or secret environment values in debug logs.

The final-response requirement preserves compatibility with
`agentic-judge`, which currently parses `AgentExecutionResult.output`.
Structured events are additional execution data, not a replacement for the
existing final-response contract.

### Default command shapes

Claude Code:

```text
claude
  --print
  --output-format stream-json
  --verbose
  --no-session-persistence
  [--agent <name>]
  [--model <model>]
  [--permission-mode <mode>]
  [--allowedTools <rules...>]
  [--max-turns <count>]
  [--max-budget-usd <amount>]
  [--effort <level>]
  <prompt>
```

Copilot CLI:

```text
copilot
  --prompt <prompt>
  --output-format json
  --no-ask-user
  --no-color
  --no-remote
  --no-remote-export
  -C <workspace>
  [--agent <name>]
  [--model <model>]
  [--reasoning-effort <level>]
  [--max-ai-credits <credits>]
  <permission flags>
```

The adapter must construct argument arrays. It must not concatenate
configuration or prompt input into an unquoted shell command.

### Structured execution data

Extend `AgentExecutionResult` with optional, backward-compatible structured
metadata:

```ts
interface AgentExecutionTelemetry {
  cliVersion?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  finalResponse?: string;
  usage?: {
    promptTokens?: number;
    cachedPromptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    source: 'measured' | 'estimated' | 'unavailable';
  };
  eventsArtifactPath?: string;
}
```

Rules:

- fields remain absent when the CLI does not report them;
- measured and estimated values must never be presented as equivalent;
- do not synthesize a model name such as `gpt-4` when it is unknown;
- do not apply hard-coded model pricing to Copilot subscription usage;
- malformed non-terminal events produce diagnostics but do not discard a valid
  final result;
- malformed terminal events or an incomplete stream fail the run.

Update the youBencha log schema with optional measured-state fields while
preserving all required v1 fields. If the change cannot remain backward
compatible, introduce a new log schema version and keep the v1 reader.

## 3. Workstream A: shared CLI process boundary

### A1. Executable discovery

Add a shared command resolver under `src/lib/` that:

- searches `PATH` without invoking user shell profiles;
- honors `PATHEXT` on Windows;
- distinguishes native executables, `.cmd`/`.bat` shims, and PowerShell
  scripts;
- returns the resolved executable kind and absolute path;
- validates that the target is a regular file;
- does not accept a command name from untrusted test-case configuration.

Replace `where`/`which` availability checks with version probes through this
resolver. A successful probe must capture stdout and stderr because different
CLIs write version information to different streams.

For Windows npm shims, use one reviewed invocation path in the shared runner.
Do not duplicate PowerShell or `cmd.exe` quoting logic in each adapter.

### A2. Process execution

Add a shared runner that accepts:

```ts
interface CliProcessRequest {
  executable: ResolvedExecutable;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  maxCapturedOutputBytes: number;
  stdoutArtifactPath: string;
  stderrArtifactPath: string;
}
```

The runner must:

- use `shell: false` for native binaries;
- centralize the reviewed Windows-shim fallback;
- stream complete stdout and stderr to separate artifact files;
- capture only the configured bounded amount in memory;
- count bytes rather than JavaScript characters;
- close stdin immediately when no input is provided;
- terminate descendants, not only the wrapper process;
- attempt graceful termination before forced termination;
- resolve exactly once on `error`, `exit`, or timeout;
- close artifact streams before returning; and
- redact secrets from any user-visible command diagnostics.

Keep adapter-specific event parsing outside the runner.

### A3. Tests

Add unit tests using local fake executables and mocked process boundaries for:

- native executable discovery;
- Windows `.cmd` and `.ps1` discovery;
- paths containing spaces;
- missing and non-executable commands;
- stdout/stderr separation;
- stdin close and stdin content;
- byte-boundary truncation;
- timeout escalation;
- descendant cleanup;
- duplicate process events; and
- artifact-stream errors.

No unit test may require a real agent CLI, authentication, or network access.

## 4. Workstream B: Copilot CLI modernization

### B1. Availability and authentication

Change `CopilotCLIAdapter.checkAvailability()` to:

1. resolve the executable through the shared resolver;
2. run `copilot --version`;
3. parse and retain the CLI version; and
4. return an installation result independently from authentication.

Copilot does not expose a simple, side-effect-free authentication status
command. Do not spend an AI request during availability checks. Execution
errors must classify:

- no supported credentials;
- an unsupported classic PAT;
- expired or insufficient credentials;
- organization policy denial; and
- model or entitlement denial.

Document authentication precedence:

1. `COPILOT_GITHUB_TOKEN`;
2. `GH_TOKEN`;
3. `GITHUB_TOKEN`;
4. stored Copilot OAuth credential; and
5. GitHub CLI credential fallback.

Never log whether a token value is present beyond a boolean diagnostic, and
never log its value or prefix.

### B2. Command construction

Update `buildCopilotCommand()` to:

- add `--output-format json`;
- add `--no-ask-user`;
- add `--no-color`;
- disable remote export for benchmark runs;
- use `-C <workspace>` on every platform;
- preserve supported `--model` and `--agent` behavior;
- expose reasoning effort and AI-credit limits through typed config;
- avoid adding the workspace as an unrestricted extra directory; and
- reject conflicting flags during schema validation.

This work must not silently change the existing allow-all permission policy.
If that policy is retained for compatibility, represent it as an explicit
effective configuration value and report it in provenance. A separate security
change can later replace the default with allowlists.

### B3. JSONL parser

Implement an incremental, line-oriented parser that:

- accepts unknown future event types;
- extracts the final assistant response;
- records model and session identifiers when reported;
- extracts measured token and credit data when reported;
- maps tool executions and tool results to normalized messages;
- reports structured CLI errors;
- ignores ANSI codes only outside JSON strings; and
- stores the original stream unchanged in an artifact.

Remove regex parsing for invented `[TOOL_CALL]` and `[RESPONSE]` markers from
the structured path. Keep a narrowly scoped legacy text parser only if tests
prove an older supported Copilot version requires it.

### B4. Resource handling

Apply the shared output bound to Copilot. The current adapter has no in-memory
output cap. Debug logging must default to `error` or `warning`; `--log-level
all` should be an opt-in diagnostic setting because it increases artifact
volume and can expose unnecessary context.

## 5. Workstream C: Claude Code modernization

### C1. Availability

Change `ClaudeCodeAdapter.checkAvailability()` to:

1. resolve and run `claude --version`;
2. run `claude auth status --json`;
3. parse only non-secret authentication metadata;
4. accept documented headless environment authentication; and
5. distinguish installed, authenticated, and unsupported-version states.

Do not interpret `claude --version` stderr as an authentication test.

### C2. Named agents

Replace prompt rewriting:

```text
Use the "<agent>" agent for this task.
```

with:

```text
--agent <agent>
```

Preserve `.claude/agents/` copying for repository-defined agents. Validate the
agent name before invocation and surface a clear error when the named agent is
not discovered.

Add tests proving that:

- `--agent` is present exactly once;
- the prompt is unchanged;
- agent names containing unsupported characters are rejected;
- model and tool restrictions from the agent are not duplicated as prompt
  text; and
- an agentic judge can use a named Claude agent.

### C3. Structured stream

Use `--output-format stream-json --verbose`. Parse:

- system initialization and capability metadata;
- assistant messages and content blocks;
- tool use and tool results;
- retry events;
- terminal result status;
- session ID;
- model;
- token usage; and
- total cost when supplied.

Use capability data when present rather than branching only on version
strings. Preserve unknown events in the raw artifact and ignore them safely.

### C4. Reproducibility and limits

Default evaluation runs to `--no-session-persistence`. Add typed configuration
for:

- `max_turns`;
- `max_budget_usd`;
- `effort`;
- `fallback_model`;
- `setting_sources`;
- `tools`;
- `allowed_tools`; and
- `disallowed_tools`.

Validate documented enum values and mutual exclusions. Do not add both
`--dangerously-skip-permissions` and a conflicting `--permission-mode`.

The currently exposed `max_tokens` and `temperature` fields are not part of the
documented Claude Code CLI contract. Deprecate them with validation warnings,
remove them from new examples, and either:

- stop forwarding them in the next breaking configuration version; or
- retain them only behind a tested legacy-compatibility switch.

Do not silently ignore either field.

## 6. Workstream D: normalization and provenance

### D1. Final output compatibility

For both adapters:

- `result.output` is the final assistant response;
- the complete event stream is stored under the adapter artifact directory;
- bounded stdout/stderr previews may be included in errors;
- `normalizeLog()` consumes structured telemetry rather than reparsing the
  final response; and
- agentic judges continue to receive only their requested final JSON content.

### D2. Usage data

Update normalized logs and reports to distinguish:

- measured prompt tokens;
- measured cached prompt tokens;
- measured completion tokens;
- measured reasoning tokens;
- measured provider-reported cost or credits;
- estimates, when an estimate is unavoidable; and
- unavailable metrics.

Remove the current Copilot GPT-4 price estimate and the Claude/Copilot
character-count estimates from the default path. Reports should omit
unavailable cost instead of showing a fabricated zero or estimate.

### D3. Provenance

Record:

- resolved executable path with the user-home portion redacted;
- CLI version;
- adapter version;
- configured and reported model;
- effective headless mode;
- session persistence state;
- configured limits;
- structured-output format;
- usage measurement source; and
- whether a legacy parser was used.

Do not store authentication tokens, credential file paths, or complete inherited
environment variables.

## 7. Workstream E: schemas and configuration

Create adapter-specific Zod schemas rather than continuing to grow a generic
passthrough object:

```text
src/schemas/agent-config/
├── common.ts
├── claude-code.ts
└── copilot-cli.ts
```

The common schema owns:

- prompt versus prompt file;
- timeout;
- output limit;
- model;
- agent name; and
- shared provenance options.

Each adapter schema owns only flags supported by that CLI. Unknown fields
should produce a useful validation error in strict mode. If forward-compatible
passthrough remains necessary during beta, emit a warning listing unvalidated
fields.

Update both main-agent and agentic-judge validation so the same adapter config
has the same meaning in either location.

## 8. Workstream F: documentation and examples

Update:

- `README.md`;
- `docs/GETTING-STARTED.md`;
- `docs/configuration.md`;
- `docs/claude-code-adapter.md`;
- a new focused `docs/copilot-cli-adapter.md`;
- `docs/agent-name-configuration.md`;
- model-selection documentation;
- relevant examples; and
- `youbencha doctor` remediation text.

Documentation requirements:

- recommend Claude's native installer first while retaining npm as an option;
- explain Claude `latest` versus `stable` update channels;
- document `claude update` and `copilot update`;
- show `claude auth status --json`;
- document Claude's `ANTHROPIC_API_KEY` and
  `CLAUDE_CODE_OAUTH_TOKEN` headless paths;
- document Copilot token precedence and supported fine-grained PATs;
- state that classic GitHub PATs are unsupported by Copilot CLI;
- explain which local user/project instruction sources affect reproducibility;
- document raw event artifacts and measured usage fields;
- identify settings that can incur additional cost; and
- provide separate local-development and CI examples.

Do not hard-code a closed Copilot model enum in documentation. Model
availability changes by account and organization policy; accept a non-empty
model string and show how to inspect the installed CLI's current choices.

## 9. Test plan

### Unit

- command resolution and process runner tests from Workstream A;
- exact command argument arrays for both adapters;
- no prompt or secret appears in logs;
- Copilot JSONL fixtures for success, failure, unknown events, and truncation;
- Claude stream fixtures for success, tool use, retry, budget exhaustion,
  permission denial, and malformed terminal events;
- final-response extraction;
- measured usage normalization;
- named Claude agent behavior;
- schema validation and deprecation warnings; and
- process-tree timeout behavior.

### Contract

- `AgentExecutionResult` remains source-compatible for existing adapters;
- optional telemetry validates;
- normalized logs distinguish measured, estimated, and unavailable usage;
- both adapter config schemas accept documented examples;
- unknown adapter fields follow the chosen strictness policy; and
- published examples validate.

### Integration

Use local fake executables placed first on `PATH` to prove complete
orchestrator flows on Windows and Unix-like command shapes.

Keep real execution opt-in:

```text
COPILOT_CLI_INTEGRATION_TESTS=1
CLAUDE_CODE_INTEGRATION_TESTS=1
```

Live tests must:

- verify installation and authentication before workspace setup;
- use a tiny local Git fixture;
- set explicit spend/credit and time limits;
- assert only stable behavior;
- avoid relying on a particular default model; and
- retain raw event artifacts on failure.

## 10. Delivery sequence

### Change 1: process foundation

- shared executable resolver;
- shared bounded process runner;
- local fake-executable fixtures;
- Windows Copilot discovery fix; and
- process and timeout tests.

### Change 2: structured adapter output

- optional execution telemetry contract;
- Copilot JSONL parser;
- Claude stream parser;
- final-response compatibility;
- normalized measured usage; and
- structured parser fixtures.

### Change 3: headless configuration

- Copilot `--no-ask-user` and non-remote flags;
- Claude `--agent`;
- Claude persistence and resource limits;
- typed adapter-specific schemas; and
- deprecation handling for unsupported Claude fields.

### Change 4: documentation and live verification

- installation and authentication docs;
- focused examples;
- doctor diagnostics;
- opt-in live smoke tests; and
- package-content verification.

Each change should be independently buildable and should not combine
repository-wide formatting normalization.

## 11. Definition of done

1. `CopilotCLIAdapter.checkAvailability()` succeeds on Windows for the
   supported npm installation.
2. Neither adapter depends on regexes over human-oriented terminal text in its
   current-version path.
3. Both adapters return the final assistant response through
   `AgentExecutionResult.output`.
4. Both adapters retain a raw JSON/JSONL event artifact.
5. A headless run cannot wait for `ask_user`, permission, trust, login, or
   workspace-choice input.
6. Named Claude agents use `--agent`.
7. Output, duration, spend/credit, and agent-turn limits are enforced where
   supported.
8. Timeout terminates descendant processes on Windows, Linux, and macOS.
9. Normalized usage clearly identifies measured, estimated, or unavailable
   values.
10. Unit and contract tests are offline and require no installed third-party
    CLI.
11. Relevant targeted tests, lint, build, and changed-file formatting pass.
12. README, focused docs, examples, and doctor output agree with the
    implementation.

## 12. Primary references

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code installation](https://code.claude.com/docs/en/setup)
- [GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [GitHub Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [GitHub Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)
- [GitHub Copilot CLI tool permissions](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
