# Feature Specification: Claude Code Adapter

**Feature Branch**: `002-claude-code-adapter`  
**Created**: 2025-11-24  
**Status**: Draft  
**Input**: User description: "Develop an adapter for Claude Code CLI to enable agent execution within youBencha framework"

## Clarifications

### Session 2025-11-25

- Q: When Claude Code exceeds configured timeout, should the adapter: A) Immediately kill process with no output capture, B) Allow grace period for cleanup, C) Terminate process but capture output up to termination point, or D) Retry with extended timeout? → A: C - Terminate process immediately with SIGTERM (no grace period); capture output up to termination point; mark as timeout with details
- Q: When Claude Code produces extremely large output (>100MB), should the adapter: A) Capture unlimited output, B) Stop at 10MB with truncation warning, C) Stream with no limit, or D) Stop at 50MB and compress if >10MB? → A: B - Stop capturing at 10,485,760 bytes (10MB) of combined stdout+stderr; append truncation warning to log
- Q: When authentication fails (no API key, invalid credentials), should the adapter: A) Retry with backoff, B) Fail immediately with clear error message, C) Prompt for authentication, or D) Continue with warning? → A: B - Fail immediately with clear error message about authentication requirement
- Q: When Claude Code crashes mid-execution without proper exit code, should the adapter: A) Mark as "unknown" and skip evaluation, B) Mark as failed with OS exit code and stderr, C) Parse partial output heuristically, or D) Treat as timeout? → A: B - Mark as "failed"; capture whatever exit code OS provided plus stderr
- Q: How should the adapter handle special characters or quotes in prompts: A) Pass as-is, B) Escape per shell rules with validation, C) Base64-encode prompts, or D) Require prompt_file for complex prompts? → A: B - Escape special characters according to shell rules; validate before execution

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Claude Code Execution (Priority: P1)

A youBencha user wants to evaluate Claude Code's performance on a coding task. They configure a test case YAML file with `agent.type: claude-code` and a prompt, run `yb run -c testcase.yaml`, and the system executes Claude Code in non-interactive mode, captures all output, and generates evaluation results.

**Why this priority**: Core MVP functionality - without basic execution capability, the adapter is not viable. This delivers immediate value by enabling Claude Code evaluation in youBencha.

**Independent Test**: Can be fully tested by creating a simple test case with a basic prompt (e.g., "List files in this directory"), running it through youBencha, and verifying that Claude Code executed successfully with output captured in artifacts.

**Acceptance Scenarios**:

1. **Given** a test case configuration with `agent.type: claude-code` and a prompt, **When** user runs `yb run -c testcase.yaml`, **Then** Claude Code CLI is invoked in non-interactive print mode with the prompt
2. **Given** Claude Code is executing, **When** it produces output, **Then** all stdout and stderr are captured to the artifacts directory
3. **Given** Claude Code execution completes, **When** exit code is 0, **Then** execution status is marked as "success"
4. **Given** Claude Code execution completes with error, **When** exit code is non-zero, **Then** execution status is marked as "failed" with error details

---

### User Story 2 - Agent and Model Selection (Priority: P2)

A youBencha user wants to test a specific Claude Code agent (custom subagent) or model. They specify `agent.agent_name: my-custom-agent` and/or `agent.model: claude-sonnet-4-5-20250929` in the test case config, and the adapter passes these parameters to Claude Code CLI to execute with the specified agent/model configuration.

**Why this priority**: Essential for testing different agent configurations and model variants, which is a key use case for benchmarking. Builds on P1 to add configurability.

**Independent Test**: Can be tested by creating two test cases: one with a custom agent name and one with a specific model, running both, and verifying the correct agent/model was used (visible in Claude Code logs).

**Acceptance Scenarios**:

1. **Given** test case config with `agent.agent_name: code-reviewer`, **When** adapter executes, **Then** Claude Code is invoked with `--agents` flag containing the specified agent configuration
2. **Given** test case config with `agent.model: claude-sonnet-4-5-20250929`, **When** adapter executes, **Then** Claude Code is invoked with `--model claude-sonnet-4-5-20250929`
3. **Given** no agent_name or model specified, **When** adapter executes, **Then** Claude Code runs with default configuration

---

### User Story 3 - Prompt File Support (Priority: P2)

A youBencha user wants to use a reusable prompt stored in a file rather than embedding it in YAML. They specify `agent.config.prompt_file: ./prompts/code-review.md` in the test case, and the adapter loads the prompt from that file and passes it to Claude Code.

**Why this priority**: Supports existing youBencha pattern for prompt management (already implemented in copilot-cli adapter). Enables prompt reusability and version control.

**Independent Test**: Can be tested by creating a test case with `prompt_file` pointing to a Markdown file, running it, and verifying Claude Code receives the file's contents as the prompt.

**Acceptance Scenarios**:

1. **Given** test case config with `prompt_file: ./prompts/task.md`, **When** adapter prepares execution, **Then** adapter reads file contents and uses as prompt
2. **Given** both `prompt` and `prompt_file` specified, **When** adapter validates config, **Then** adapter raises validation error (mutually exclusive)
3. **Given** `prompt_file` points to non-existent file, **When** adapter attempts execution, **Then** adapter fails with clear error message

---

### User Story 4 - Log Export and Normalization (Priority: P3)

A youBencha user wants to analyze Claude Code's execution details after evaluation. After running a test case, they find a `youbencha-log.json` file in the artifacts directory containing standardized execution metadata (model used, token usage, duration, messages exchanged) that can be compared across different agents.

**Why this priority**: Enables cross-agent comparison and detailed analysis, which is valuable for benchmarking but not required for basic execution.

**Independent Test**: Can be tested by running a test case, locating the generated youbencha-log.json file, and validating it conforms to the YouBenchaLog schema with populated fields.

**Acceptance Scenarios**:

1. **Given** Claude Code execution completes, **When** adapter normalizes output, **Then** a youbencha-log.json file is created in artifacts directory conforming to YouBenchaLog schema
2. **Given** Claude Code produced verbose output, **When** adapter parses it, **Then** messages, tool calls, and execution metadata are extracted into structured format
3. **Given** token usage information available in Claude Code output, **When** adapter processes it, **Then** usage metrics are captured in the log

---

### User Story 5 - Advanced CLI Features (Priority: P4)

A youBencha user wants to leverage Claude Code's advanced features like custom system prompts, permission modes, or MCP tool configuration. They specify additional config parameters in the test case (e.g., `agent.config.append_system_prompt`, `agent.config.permission_mode`), and the adapter translates these to appropriate Claude Code CLI flags.

**Why this priority**: Nice-to-have for power users who want fine-grained control, but not essential for basic evaluation workflows.

**Independent Test**: Can be tested by creating test cases with various advanced flags, running them, and verifying the flags were passed correctly to Claude Code (visible in debug output).

**Acceptance Scenarios**:

1. **Given** test case with `config.append_system_prompt`, **When** adapter executes, **Then** Claude Code is invoked with `--append-system-prompt` flag
2. **Given** test case with `config.permission_mode: plan`, **When** adapter executes, **Then** Claude Code is invoked with `--permission-mode plan`
3. **Given** test case with `config.allowed_tools: ["Read", "Write"]`, **When** adapter executes, **Then** Claude Code is invoked with `--allowedTools` flag

---

### Edge Cases

- What happens when Claude Code CLI is not installed or not in PATH?
- When authentication fails (missing API key or invalid credentials), the adapter fails immediately with a clear, actionable error message explaining the authentication requirement and how to resolve it (e.g., "run 'claude auth' to authenticate")
- When Claude Code execution exceeds configured timeout, the adapter terminates the process immediately, captures all output produced up to the termination point, and marks execution status as "timeout" with details about duration and partial output availability
- When Claude Code produces output exceeding 10MB, the adapter stops capturing at the 10MB limit, appends a truncation warning to the log file indicating the output was truncated, and continues execution normally
- When Claude Code crashes mid-execution without producing a proper exit code, the adapter marks execution status as "failed", captures whatever exit code the OS provided along with all stderr output for diagnostic purposes
- When prompts contain special characters or quotes, the adapter escapes them according to shell-specific rules (PowerShell vs bash/zsh), validates the escaped prompt before execution to prevent injection vulnerabilities or execution failures
- What if the artifacts directory doesn't exist or is not writable?
- How does the adapter handle Claude Code prompting for user input in non-interactive mode?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement AgentAdapter interface from base.ts with name "claude-code"
- **FR-002**: System MUST verify Claude Code CLI availability before execution via checkAvailability() method
- **FR-003**: System MUST execute Claude Code in non-interactive print mode using the `-p` flag
- **FR-004**: System MUST capture all stdout and stderr output from Claude Code execution to artifacts directory
- **FR-005**: System MUST support inline prompt configuration via `agent.config.prompt`
- **FR-006**: System MUST support external prompt files via `agent.config.prompt_file`
- **FR-007**: System MUST enforce mutual exclusivity of `prompt` and `prompt_file` configuration options
- **FR-008**: System MUST pass agent_name parameter to Claude Code via `--agents` flag when specified (flag naming verified in Claude Code CLI documentation)
- **FR-009**: System MUST pass model parameter to Claude Code via `--model` flag when specified
- **FR-010**: System MUST respect timeout configuration and terminate Claude Code process if exceeded
- **FR-011**: System MUST return execution status as "success", "failed", or "timeout" based on exit code and timing
- **FR-012**: System MUST generate YouBenchaLog conforming to youbenchalog.schema.ts
- **FR-013**: System MUST extract and normalize execution metadata (start time, end time, duration) into YouBenchaLog
- **FR-014**: System MUST detect Claude Code version from output and include in normalized log
- **FR-015**: System MUST detect model name from output or configuration and include in normalized log
- **FR-016**: System MUST write raw terminal output to timestamped log file in artifacts/claude-code-logs/ directory
- **FR-017**: System MUST provide clear error messages when Claude Code is not installed or authentication fails
- **FR-018**: System MUST handle workspace directory parameter by setting working directory for Claude Code execution
- **FR-019**: System MUST support Windows (PowerShell), macOS, and Linux execution environments (cross-platform testing covered by T117)
- **FR-020**: ~~System MUST validate that at least one of `prompt` or `prompt_file` is provided in configuration~~ *[REMOVED: Duplicate of FR-007]*
- **FR-021**: System MUST escape special characters and quotes in prompts using the shell-quote library (or equivalent cross-platform escaping library) and validate escaped prompts before execution to prevent injection vulnerabilities

### Key Entities

- **ClaudeCodeAdapter**: Adapter implementation conforming to AgentAdapter interface, responsible for executing Claude Code CLI and normalizing output
- **AgentExecutionContext**: Input context containing workspace paths, configuration, environment variables, and timeout settings
- **AgentExecutionResult**: Output containing exit code, status, raw output, timestamps, duration, and errors
- **YouBenchaLog**: Standardized log format containing agent info, model info, execution metadata, messages, usage metrics, and errors
- **Claude Code Configuration**: Parameters including prompt/prompt_file, agent_name, model, append_system_prompt, permission_mode, allowed_tools, system_prompt, and other CLI flags

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can execute Claude Code agent evaluations by specifying `agent.type: claude-code` in test case configuration without additional setup
- **SC-002**: System captures complete Claude Code execution output with 100% fidelity (no lost stdout/stderr)
- **SC-003**: Adapter generates valid youbencha-log.json files that pass schema validation for all executions (success, failure, timeout)
- **SC-004**: Adapter handles execution timeouts within 5 seconds of configured timeout threshold
- **SC-005**: Users receive clear, actionable error messages when prerequisites are not met (CLI not installed, authentication failed)
- **SC-006**: Adapter execution completes within 500ms overhead (excluding Claude Code runtime) for typical workloads, measured as: (Total execution time) - (Claude Code process runtime) for repos <1000 LOC with simple prompts
- **SC-007**: System correctly identifies and reports the model used in 100% of executions
- **SC-008**: Adapter works identically across Windows, macOS, and Linux environments with same test case configuration
- **SC-009**: Users can switch between copilot-cli and claude-code agents by only changing `agent.type` in configuration
- **SC-010**: Log files are organized in artifacts directory following the same pattern as existing adapters (copilot-cli)
