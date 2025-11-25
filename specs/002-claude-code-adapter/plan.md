# Implementation Plan: Claude Code Adapter

**Branch**: `002-claude-code-adapter` | **Date**: 2025-11-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-claude-code-adapter/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Develop a Claude Code CLI adapter for youBencha that enables evaluation of Anthropic's Claude Code agent. The adapter will implement the AgentAdapter interface, execute Claude Code in non-interactive print mode, capture all output, and normalize execution data to the youBencha Log format. This enables cross-agent comparison between GitHub Copilot CLI and Claude Code, supporting various configuration options including custom agents, model selection, prompt files, and advanced CLI features.

## Technical Context

**Language/Version**: TypeScript 5.0+ with Node.js 20+ runtime (matching existing youBencha codebase)  
**Primary Dependencies**: 
  - child_process (Node.js built-in) for CLI process spawning with spawn() + AbortController
  - Zod for configuration schema validation
  - Existing youBencha schemas (youbenchalog.schema.ts, base.ts)
  - Regex patterns for parsing Claude Code structured output (model, usage, tool calls)

**Authentication**: Claude Code CLI requires ANTHROPIC_API_KEY env var or prior `claude auth` execution. Adapter validates availability but does not manage authentication.

**CLI Syntax**: Non-interactive execution via `claude -p "prompt text"` with optional flags: `--model`, `--agents`, `--permission-mode`, etc. Executed in workspace CWD with shell=false for security.

**Output Format**: Structured text with metadata sections (Model:, Input tokens:, Output tokens:), tool calls (`[TOOL: name] args`), and ANSI color codes. Parsed via regex, cleaned before normalization.

**Storage**: File-based artifacts (logs, youbencha-log.json) stored in context.artifactsDir/claude-code-logs/  
**Testing**: Jest with contract tests, unit tests, and integration tests (80% coverage target per constitution)  
**Target Platform**: Cross-platform (Windows PowerShell, macOS/Linux bash/zsh) CLI execution  
**Project Type**: Single project - new adapter module in existing src/adapters/ directory  

**Performance Goals**: 
  - Adapter execution overhead <500ms (excluding Claude Code runtime)
  - Timeout enforcement within 5 seconds of configured threshold
  - Log normalization <5% of total evaluation time

**Constraints**: 
  - Must maintain interface compatibility with existing AgentAdapter contract
  - Must produce youBencha Log conforming to existing schema (backward-compatible)
  - Must work identically across Windows/macOS/Linux environments
  - Must handle 10MB output limit with truncation warning
  - Rate limiting handled by failing fast with clear error (no retry logic in adapter)

**Scale/Scope**: 
  - Single adapter module (~500-800 LOC based on copilot-cli.ts reference)
  - Support for 10+ configuration parameters (prompt, prompt_file, model, agent_name, etc.)
  - Handle repos up to 1M LOC (same as copilot-cli adapter)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Agent-Agnostic**: ✅ All Claude Code-specific logic confined to src/adapters/claude-code.ts implementing AgentAdapter interface. Orchestrator remains unchanged.
- [x] **Reproducibility**: ✅ Configuration captures: model, agent_name, prompt/prompt_file, timeout, environment. Claude Code version extracted from output. Results deterministic for temperature=0 (documented for temperature>0).
- [x] **Pluggable**: ✅ Implements AgentAdapter interface without modifying base.ts or orchestrator.ts. Added to getAgentAdapter() switch in orchestrator.
- [x] **youBencha Log Compliance**: ✅ Produces YouBenchaLog conforming to existing youbenchalog.schema.ts. No schema changes required.
- [x] **Sandbox Isolation**: ✅ Adapter executes Claude Code CLI within context.workspaceDir. No host system mutations. Workspace cleanup handled by orchestrator.
- [x] **TDD Required**: ✅ Contract tests for AgentAdapter interface, unit tests for command building/output parsing, integration tests for end-to-end execution. Tests written before implementation.
- [x] **Security by Design**: ✅ Prompt escaping via shell-quote library for PowerShell/bash. Path validation (reject .., absolute paths). 10MB output limit enforced. No shell=true usage.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── adapters/
│   ├── base.ts                    # AgentAdapter interface (unchanged)
│   ├── copilot-cli.ts             # Existing adapter (reference implementation)
│   └── claude-code.ts             # NEW: Claude Code adapter implementation
├── core/
│   └── orchestrator.ts            # MODIFIED: Add claude-code to getAgentAdapter()
├── schemas/
│   └── youbenchalog.schema.ts     # Existing schema (unchanged)
└── lib/
    └── shell-utils.ts             # NEW: Shell escaping utilities (if not exists)

tests/
├── contract/
│   └── adapter.test.ts            # MODIFIED: Add Claude Code adapter tests
├── unit/
│   ├── claude-code-adapter.test.ts # NEW: Unit tests for command building
│   └── shell-utils.test.ts        # NEW: Shell escaping tests
└── integration/
    └── claude-code-e2e.test.ts    # NEW: End-to-end execution tests

examples/
├── testcase-claude-code.yaml      # NEW: Example test case
└── testcase-claude-code-advanced.yaml # NEW: Advanced config example
```

**Structure Decision**: Single project structure (Option 1). This feature adds one new adapter module following existing patterns. The claude-code.ts adapter mirrors copilot-cli.ts structure (~500-800 LOC). All changes are additive except for orchestrator.ts switch statement update.
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. All principles satisfied:
- Agent-specific logic isolated in adapter (Agent-Agnostic ✅)
- Configuration captures all execution parameters (Reproducibility ✅)
- Implements standard AgentAdapter interface (Pluggable ✅)
- Produces compliant YouBenchaLog (Log Compliance ✅)
- No host mutations, workspace-confined (Sandbox Isolation ✅)
- Contract tests written first (TDD ✅)
- Prompt escaping, path validation, output limiting (Security ✅)

---

## Implementation Phases

### Phase 0: Research & Design ✅ COMPLETE

**Deliverables**:
- [x] research.md - All NEEDS CLARIFICATION items resolved
- [x] Decision documented for CLI syntax, authentication, output parsing
- [x] Best practices identified for shell escaping, timeout handling, output limiting

**Outcomes**:
- CLI command structure: `claude -p "prompt"` with argument arrays (shell=false)
- Authentication verified via `claude --version` in checkAvailability()
- Output parsing strategy: Regex patterns for structured sections
- Rate limiting: Fail-fast approach, no retry logic in adapter

---

### Phase 1: Design & Contracts ✅ COMPLETE

**Deliverables**:
- [x] data-model.md - Entities, validation rules, field mappings defined
- [x] contracts/agent-adapter-contract.md - Interface requirements and test cases
- [x] contracts/configuration-schema.md - YAML/JSON schema with validation
- [x] quickstart.md - Developer implementation guide
- [x] Agent context updated - TypeScript + Node.js added to copilot-instructions.md

**Outcomes**:
- ClaudeCodeAdapter, ClaudeCodeConfig, ClaudeCodeOutput entities defined
- 40+ contract requirements documented (CR-1.x, CR-2.x, CR-3.x, CR-4.x)
- Configuration schema with Zod validation defined
- 8-phase implementation roadmap (Days 1-4)
- Data flow: Config → Context → Command → Execution → Result → Log

---

### Phase 2: Tasks Breakdown (NEXT - Use /speckit.tasks command)

**Goal**: Generate tasks.md with GitHub-ready task definitions

**Process**:
1. Run `/speckit.tasks` command
2. Review generated tasks in `specs/002-claude-code-adapter/tasks.md`
3. Import tasks to GitHub Issues/Project board
4. Assign tasks to developers

**Expected Tasks** (preview):
- T1: Implement ClaudeCodeAdapter skeleton + registration
- T2: Implement checkAvailability() with CLI detection
- T3: Implement buildClaudeCommand() with config handling
- T4: Implement executeWithTimeout() with output capture
- T5: Implement execute() main method
- T6: Implement parsing helpers (model, version, usage, tool calls)
- T7: Implement normalizeLog() with YouBenchaLog generation
- T8: Write contract tests (20+ tests)
- T9: Write unit tests (command building, parsing)
- T10: Write integration tests (end-to-end)
- T11: Create example test cases
- T12: Update documentation (README)

---

## Success Criteria Review

Per spec.md Success Criteria, this plan enables:

- ✅ **SC-001**: Test case with `agent.type: claude-code` executes adapter (Phase 1 contracts define this)
- ✅ **SC-002**: Output capture with 100% fidelity (executeWithTimeout() design in quickstart.md)
- ✅ **SC-003**: Valid youbencha-log.json (normalizeLog() contract CR-3.1)
- ✅ **SC-004**: Timeout enforcement within 5s (AbortController pattern from research.md)
- ✅ **SC-005**: Clear error messages (checkAvailability() contract CR-1.3)
- ✅ **SC-006**: <500ms adapter overhead (performance goal in Technical Context)
- ✅ **SC-007**: Model detection 100% (parseModel() in data-model.md)
- ✅ **SC-008**: Cross-platform consistency (platform-specific commands in research.md)
- ✅ **SC-009**: Agent switching via config (pluggable adapter pattern)
- ✅ **SC-010**: Consistent log organization (artifactsDir/claude-code-logs/ pattern)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Code CLI breaking changes | Medium | High | Version detection in output; document compatible versions |
| Output format variations | Medium | Medium | Robust regex with fallbacks; test against multiple Claude versions |
| Rate limiting in CI/CD | Low | Medium | Document rate limits; suggest API tier upgrades |
| Platform-specific bugs | Low | Low | Test matrix includes Windows/macOS/Linux |
| Authentication setup complexity | Medium | Low | Clear error messages; documentation with examples |

---

## Dependencies

**Upstream** (must exist before implementation):
- ✅ AgentAdapter interface (src/adapters/base.ts)
- ✅ YouBenchaLog schema (src/schemas/youbenchalog.schema.ts)
- ✅ Orchestrator with getAgentAdapter() (src/core/orchestrator.ts)
- ✅ Test framework (Jest configured)

**Downstream** (will use this feature):
- Evaluators (consume youbencha-log.json from Claude Code runs)
- Reporters (include Claude Code results in reports)
- Users (run test cases with claude-code agent)

**External** (required at runtime):
- Claude Code CLI installed (`@anthropic/claude-code` npm package or binary)
- ANTHROPIC_API_KEY environment variable (or prior `claude auth`)

---

## Rollout Plan

1. **Development** (Week 1): Implement adapter per quickstart.md phases
2. **Testing** (Week 1): Contract tests, unit tests, integration tests
3. **Code Review** (Week 2): PR review, address feedback
4. **Documentation** (Week 2): Update README, create examples
5. **Beta Testing** (Week 2): Early adopter feedback on real repos
6. **Release** (Week 3): Merge to main, publish in changelog
7. **Announcement** (Week 3): Blog post, social media, Discord/Slack

---

## Appendix: Key Files Generated

### Documentation (this feature)
- ✅ `specs/002-claude-code-adapter/spec.md` (pre-existing)
- ✅ `specs/002-claude-code-adapter/plan.md` (this file)
- ✅ `specs/002-claude-code-adapter/research.md` (Phase 0)
- ✅ `specs/002-claude-code-adapter/data-model.md` (Phase 1)
- ✅ `specs/002-claude-code-adapter/quickstart.md` (Phase 1)
- ✅ `specs/002-claude-code-adapter/contracts/agent-adapter-contract.md` (Phase 1)
- ✅ `specs/002-claude-code-adapter/contracts/configuration-schema.md` (Phase 1)
- ⏳ `specs/002-claude-code-adapter/tasks.md` (Phase 2 - use /speckit.tasks)

### Source Code (to be implemented)
- `src/adapters/claude-code.ts` (new)
- `src/core/orchestrator.ts` (modified - add switch case)
- `tests/contract/adapter.test.ts` (modified - add Claude Code tests)
- `tests/unit/claude-code-adapter.test.ts` (new)
- `tests/integration/claude-code-e2e.test.ts` (new)
- `examples/testcase-claude-code.yaml` (new)
- `examples/testcase-claude-code-advanced.yaml` (new)

---

## Complexity Tracking

No complexity violations. Feature aligns with existing patterns (copilot-cli adapter precedent). Implementation complexity is justified by:
- Need for CLI process management (timeout, output capture)
- Claude Code output parsing (structured but not JSON)
- Cross-platform compatibility requirements

Simpler alternatives rejected:
- Direct API calls: Would not evaluate CLI tool (user-facing interface)
- Interactive mode: Non-deterministic, hard to automate
- No output parsing: Would produce low-quality logs, defeating evaluation purpose

---

**Plan Status**: ✅ COMPLETE  
**Phase 0 & 1**: Done  
**Phase 2**: Ready for `/speckit.tasks` command  
**Branch**: 002-claude-code-adapter  
**Next Command**: `/speckit.tasks` to generate tasks.md
