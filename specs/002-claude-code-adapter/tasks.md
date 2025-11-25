# Tasks: Claude Code Adapter

**Input**: Design documents from `/specs/002-claude-code-adapter/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Tests are REQUIRED per youBencha constitution (TDD approach)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Review existing AgentAdapter interface in src/adapters/base.ts
- [ ] T002 Review copilot-cli.ts reference implementation in src/adapters/copilot-cli.ts
- [ ] T003 [P] Review YouBenchaLog schema in src/schemas/youbenchalog.schema.ts
- [ ] T004 [P] Verify Claude Code CLI is installed and authenticated (run `claude --version`)
- [ ] T005 [P] Create test fixtures directory for adapter tests at tests/fixtures/claude-code/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create shell utility module in src/lib/shell-utils.ts with escapeShellArg() for cross-platform prompt escaping
- [ ] T007 [P] Write unit tests for shell-utils.ts in tests/unit/shell-utils.test.ts (test PowerShell and bash escaping)
- [ ] T008 Create Claude Code adapter skeleton class in src/adapters/claude-code.ts implementing AgentAdapter interface
- [ ] T009 Register ClaudeCodeAdapter in orchestrator switch statement in src/core/orchestrator.ts (getAgentAdapter function)
- [ ] T010 [P] Create example test case configuration in examples/testcase-claude-code.yaml
- [ ] T011 [P] Create advanced example test case in examples/testcase-claude-code-advanced.yaml

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic Claude Code Execution (Priority: P1) 🎯 MVP

**Goal**: Enable basic Claude Code execution through youBencha with prompt configuration, capturing all output, and generating evaluation results

**Independent Test**: Create a simple test case with `agent.type: claude-code` and prompt "List files in this directory", run through youBencha, verify Claude Code executed successfully with output captured in artifacts

### Contract Tests for User Story 1 (TDD FIRST - MUST FAIL)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T012 [P] [US1] Write contract tests for checkAvailability() in tests/contract/adapter.test.ts (CR-1.1 through CR-1.5)
- [ ] T013 [P] [US1] Write contract tests for execute() basic execution in tests/contract/adapter.test.ts (CR-2.1, CR-2.2, CR-2.8)
- [ ] T014 [P] [US1] Write contract tests for execute() prompt configuration in tests/contract/adapter.test.ts (CR-2.4)
- [ ] T015 [P] [US1] Write contract tests for execute() working directory in tests/contract/adapter.test.ts (CR-2.10)
- [ ] T016 [P] [US1] Write contract tests for normalizeLog() basic structure in tests/contract/adapter.test.ts (CR-3.1, CR-3.2, CR-3.3)
- [ ] T017 [P] [US1] Write integration test for end-to-end execution in tests/integration/claude-code-e2e.test.ts
- [ ] T018 [US1] Run test suite and verify all US1 tests fail with "not implemented" errors (npm test -- claude-code)

### Implementation for User Story 1

- [ ] T019 [P] [US1] Implement checkAvailability() method in src/adapters/claude-code.ts with CLI detection and auth verification
- [ ] T020 [P] [US1] Implement buildClaudeCommand() private helper in src/adapters/claude-code.ts for command construction
- [ ] T021 [US1] Implement executeWithTimeout() private helper in src/adapters/claude-code.ts using child_process.spawn and AbortController
- [ ] T022 [US1] Implement execute() main method in src/adapters/claude-code.ts orchestrating command building and execution
- [ ] T023 [US1] Implement output capture logic in execute() method to save raw output to artifacts/claude-code-logs/
- [ ] T023a [US1] Verify artifacts/claude-code-logs/ directory is created with proper structure and timestamped log files (FR-016)
- [ ] T024 [P] [US1] Implement stripAnsiCodes() helper function in src/adapters/claude-code.ts
- [ ] T025 [P] [US1] Implement parseModel() helper function in src/adapters/claude-code.ts
- [ ] T026 [P] [US1] Implement parseVersion() helper function in src/adapters/claude-code.ts
- [ ] T026a [US1] Verify parseVersion() correctly extracts Claude Code CLI version from output and includes in normalized log (FR-014)
- [ ] T027 [US1] Implement normalizeLog() method skeleton in src/adapters/claude-code.ts with basic structure
- [ ] T028 [US1] Verify all US1 contract tests pass (npm test -- contract/adapter)
- [ ] T029 [US1] Verify US1 integration test passes (npm test -- integration/claude-code-e2e)
- [ ] T030 [US1] Manual validation: Run examples/testcase-claude-code.yaml and verify output

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently - basic Claude Code execution works

---

## Phase 4: User Story 2 - Agent and Model Selection (Priority: P2)

**Goal**: Enable users to specify custom agent configurations and specific models for testing different variants

**Independent Test**: Create two test cases (one with agent_name, one with model parameter), run both, verify correct agent/model used via Claude Code logs

### Contract Tests for User Story 2 (TDD FIRST - MUST FAIL)

- [ ] T031 [P] [US2] Write contract tests for execute() with model parameter in tests/contract/adapter.test.ts (CR-2.6)
- [ ] T032 [P] [US2] Write contract tests for execute() with agent_name parameter in tests/contract/adapter.test.ts (CR-2.7)
- [ ] T033 [P] [US2] Write unit tests for buildClaudeCommand() with model flag in tests/unit/claude-code-adapter.test.ts
- [ ] T034 [P] [US2] Write unit tests for buildClaudeCommand() with agent flag in tests/unit/claude-code-adapter.test.ts
- [ ] T035 [US2] Run test suite and verify all US2 tests fail (npm test -- claude-code)

### Implementation for User Story 2

- [ ] T036 [P] [US2] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle model parameter with --model flag
- [ ] T037 [P] [US2] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle agent_name parameter with --agents flag
- [ ] T038 [US2] Update parseModel() helper in src/adapters/claude-code.ts to detect model from config if not in output
- [ ] T039 [US2] Update normalizeLog() in src/adapters/claude-code.ts to populate model_info with provider: 'anthropic'
- [ ] T040 [US2] Verify all US2 contract tests pass (npm test -- contract/adapter)
- [ ] T041 [US2] Verify US2 unit tests pass (npm test -- unit/claude-code-adapter)
- [ ] T042 [US2] Update examples/testcase-claude-code-advanced.yaml to demonstrate agent_name and model usage
- [ ] T043 [US2] Manual validation: Run advanced example and verify agent/model parameters honored

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - agent/model selection functional

---

## Phase 5: User Story 3 - Prompt File Support (Priority: P2)

**Goal**: Enable users to use reusable prompts stored in files rather than embedding in YAML

**Independent Test**: Create test case with prompt_file pointing to Markdown file, run it, verify Claude Code receives file contents as prompt

### Contract Tests for User Story 3 (TDD FIRST - MUST FAIL)

- [ ] T044 [P] [US3] Write contract tests for execute() with prompt_file in tests/contract/adapter.test.ts (CR-2.5)
- [ ] T045 [P] [US3] Write contract tests for prompt/prompt_file mutual exclusivity in tests/contract/adapter.test.ts (CR-4.1)
- [ ] T046 [P] [US3] Write contract tests for prompt_file validation in tests/contract/adapter.test.ts (CR-4.2, CR-4.3)
- [ ] T047 [P] [US3] Write unit tests for buildClaudeCommand() with prompt_file in tests/unit/claude-code-adapter.test.ts
- [ ] T048 [US3] Run test suite and verify all US3 tests fail (npm test -- claude-code)

### Implementation for User Story 3

- [ ] T049 [US3] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle prompt_file: read file and use contents
- [ ] T050 [US3] Add validation in buildClaudeCommand() to enforce mutual exclusivity of prompt and prompt_file
- [ ] T051 [US3] Add validation in buildClaudeCommand() to validate prompt_file path (reject .., absolute paths)
- [ ] T052 [US3] Add error handling for missing/unreadable prompt_file with clear error message
- [ ] T053 [US3] Verify all US3 contract tests pass (npm test -- contract/adapter)
- [ ] T054 [US3] Verify US3 unit tests pass (npm test -- unit/claude-code-adapter)
- [ ] T055 [P] [US3] Create example prompt file in examples/prompts/claude-code-task.md
- [ ] T056 [US3] Update examples/testcase-claude-code-advanced.yaml to demonstrate prompt_file usage
- [ ] T057 [US3] Manual validation: Run example with prompt_file and verify file contents used

**Checkpoint**: All three priority user stories (P1, P2, P2) are now independently functional

---

## Phase 6: User Story 4 - Log Export and Normalization (Priority: P3)

**Goal**: Enable cross-agent comparison by exporting standardized youbencha-log.json with execution metadata

**Independent Test**: Run test case, locate generated youbencha-log.json in artifacts, validate against YouBenchaLog schema with populated fields

### Contract Tests for User Story 4 (TDD FIRST - MUST FAIL)

- [ ] T058 [P] [US4] Write contract tests for normalizeLog() messages parsing in tests/contract/adapter.test.ts (CR-3.4)
- [ ] T059 [P] [US4] Write contract tests for normalizeLog() tool calls parsing in tests/contract/adapter.test.ts (CR-3.5)
- [ ] T060 [P] [US4] Write contract tests for normalizeLog() usage metrics in tests/contract/adapter.test.ts (CR-3.6)
- [ ] T061 [P] [US4] Write contract tests for normalizeLog() execution metadata in tests/contract/adapter.test.ts (CR-3.7, CR-3.8)
- [ ] T062 [P] [US4] Write unit tests for parseMessages() helper in tests/unit/claude-code-adapter.test.ts
- [ ] T063 [P] [US4] Write unit tests for parseToolCalls() helper in tests/unit/claude-code-adapter.test.ts
- [ ] T064 [P] [US4] Write unit tests for parseUsage() helper in tests/unit/claude-code-adapter.test.ts
- [ ] T065 [US4] Run test suite and verify all US4 tests fail (npm test -- claude-code)

### Implementation for User Story 4

- [ ] T066 [P] [US4] Implement parseMessages() private helper in src/adapters/claude-code.ts using regex patterns
- [ ] T067 [P] [US4] Implement parseToolCalls() private helper in src/adapters/claude-code.ts using regex for [TOOL: name] pattern
- [ ] T068 [P] [US4] Implement parseUsage() private helper in src/adapters/claude-code.ts to extract token counts
- [ ] T069 [US4] Complete normalizeLog() implementation in src/adapters/claude-code.ts to populate all YouBenchaLog fields
- [ ] T070 [US4] Add agent_info section population (name, version, adapter_version) in normalizeLog()
- [ ] T071 [US4] Add model_info section population (name, provider) in normalizeLog()
- [ ] T072 [US4] Add execution metadata population (timestamps, duration, status) in normalizeLog()
- [ ] T073 [US4] Integrate parsed messages, tool calls, and usage into log structure
- [ ] T074 [US4] Verify all US4 contract tests pass (npm test -- contract/adapter)
- [ ] T075 [US4] Verify US4 unit tests pass (npm test -- unit/claude-code-adapter)
- [ ] T076 [US4] Manual validation: Run test case and inspect generated youbencha-log.json for completeness
- [ ] T077 [US4] Validate youbencha-log.json against schema using Zod validation

**Checkpoint**: Log export and normalization complete - cross-agent comparison enabled

---

## Phase 7: User Story 5 - Advanced CLI Features (Priority: P4)

**Goal**: Support power users with advanced Claude Code features (system prompts, permission modes, MCP tools)

**Independent Test**: Create test cases with various advanced flags, run them, verify flags passed correctly to Claude Code (visible in debug output)

### Contract Tests for User Story 5 (TDD FIRST - MUST FAIL)

- [ ] T078 [P] [US5] Write contract tests for execute() with append_system_prompt in tests/contract/adapter.test.ts (CR-2.12)
- [ ] T079 [P] [US5] Write contract tests for execute() with permission_mode in tests/contract/adapter.test.ts (CR-2.13)
- [ ] T080 [P] [US5] Write contract tests for execute() with allowed_tools in tests/contract/adapter.test.ts (CR-2.14)
- [ ] T081 [P] [US5] Write unit tests for buildClaudeCommand() with all advanced flags in tests/unit/claude-code-adapter.test.ts
- [ ] T082 [US5] Run test suite and verify all US5 tests fail (npm test -- claude-code)

### Implementation for User Story 5

- [ ] T083 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle append_system_prompt with --append-system-prompt flag
- [ ] T084 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle permission_mode with --permission-mode flag
- [ ] T085 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle allowed_tools with --allowedTools flag
- [ ] T086 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle system_prompt with --system-prompt flag
- [ ] T087 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle max_tokens with --max-tokens flag
- [ ] T088 [US5] Update buildClaudeCommand() in src/adapters/claude-code.ts to handle temperature with --temperature flag
- [ ] T089 [US5] Verify all US5 contract tests pass (npm test -- contract/adapter)
- [ ] T090 [US5] Verify US5 unit tests pass (npm test -- unit/claude-code-adapter)
- [ ] T091 [US5] Update examples/testcase-claude-code-advanced.yaml to demonstrate all advanced features
- [ ] T092 [US5] Manual validation: Run advanced example with permission_mode=plan and verify behavior

**Checkpoint**: All user stories complete - full feature functionality delivered

---

## Phase 8: Edge Cases & Robustness

**Purpose**: Handle error conditions and edge cases robustly

### Contract Tests for Edge Cases (TDD FIRST - MUST FAIL)

- [ ] T093 [P] Write contract tests for timeout enforcement in tests/contract/adapter.test.ts (CR-2.3)
- [ ] T094 [P] Write contract tests for output size limiting in tests/contract/adapter.test.ts (CR-2.9)
- [ ] T095 [P] Write contract tests for special characters in prompts in tests/contract/adapter.test.ts (CR-2.15)
- [ ] T096 [P] Write contract tests for environment variable handling in tests/contract/adapter.test.ts (CR-2.11)
- [ ] T097 [P] Write integration tests for authentication failures in tests/integration/claude-code-e2e.test.ts
- [ ] T098 [P] Write integration tests for rate limit errors in tests/integration/claude-code-e2e.test.ts
- [ ] T099 Write integration tests for crash/abnormal exit in tests/integration/claude-code-e2e.test.ts

### Implementation for Edge Cases

- [ ] T100 Implement timeout enforcement in executeWithTimeout() using AbortController in src/adapters/claude-code.ts
- [ ] T101 Add timeout error handling with status: 'timeout' and partial output capture in execute()
- [ ] T102 Implement 10MB output limit with truncation warning in execute() method in src/adapters/claude-code.ts
- [ ] T103 Add truncation error to errors array when output exceeds limit
- [ ] T104 Implement prompt escaping using shell-utils.ts escapeShellArg() in buildClaudeCommand()
- [ ] T105 Add prompt validation before execution to prevent injection vulnerabilities
- [ ] T106 Add environment variable passing (ANTHROPIC_API_KEY) in executeWithTimeout()
- [ ] T107 Add rate limit error detection in execute() error handling (check for "rate limit" or "429" in stderr)
- [ ] T108 Add crash detection and error reporting for abnormal exits in execute()
- [ ] T109 Verify all edge case contract tests pass (npm test -- contract/adapter)
- [ ] T110 Verify all edge case integration tests pass (npm test -- integration/claude-code-e2e)

**Checkpoint**: Adapter handles all error conditions gracefully

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T111 [P] Add JSDoc comments to all public methods in src/adapters/claude-code.ts
- [ ] T112 [P] Add JSDoc comments to all helper functions in src/lib/shell-utils.ts
- [ ] T113 [P] Update README.md to document Claude Code adapter usage and requirements
- [ ] T114 [P] Create documentation page in docs/adapters/claude-code.md with configuration examples
- [ ] T115 Code review and refactoring for consistency with copilot-cli.ts patterns
- [ ] T116 Performance profiling: Verify adapter overhead <500ms (SC-006)
- [ ] T117 Cross-platform testing: Run full test suite on Windows, macOS, and Linux
- [ ] T118 Verify test coverage meets 80% threshold (npm test -- --coverage)
- [ ] T119 Run quickstart.md validation workflow from specs/002-claude-code-adapter/quickstart.md
- [ ] T120 Final integration test: Run examples/testcase-claude-code.yaml and examples/testcase-claude-code-advanced.yaml
- [ ] T121 Validate all success criteria (SC-001 through SC-010) are met

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion
- **User Story 2 (Phase 4)**: Depends on Foundational phase completion (can run in parallel with US1)
- **User Story 3 (Phase 5)**: Depends on Foundational phase completion (can run in parallel with US1/US2)
- **User Story 4 (Phase 6)**: Depends on US1 completion (needs basic execution working)
- **User Story 5 (Phase 7)**: Depends on US1, US2 completion (builds on basic + agent/model selection)
- **Edge Cases (Phase 8)**: Depends on US1 completion (can run in parallel with US2-US5)
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: MVP - Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Can run in parallel with US1
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Can run in parallel with US1/US2
- **User Story 4 (P3)**: Needs US1 complete (requires basic execution infrastructure)
- **User Story 5 (P4)**: Needs US1, US2 complete (extends command building)

### Within Each User Story

- Contract tests MUST be written first and FAIL before implementation (TDD)
- Unit tests for helpers can run in parallel (marked [P])
- Helper functions can be implemented in parallel (marked [P])
- Main execute() and normalizeLog() methods have internal dependencies
- Story validation must pass before moving to next priority

### Parallel Opportunities

**Setup Phase (Phase 1)**:
- T002, T003, T004, T005 can run in parallel

**Foundational Phase (Phase 2)**:
- T007, T010, T011 can run in parallel after T006

**User Story 1 Tests**:
- T012, T013, T014, T015, T016, T017 can all run in parallel

**User Story 1 Implementation**:
- T019, T020 can run in parallel
- T024, T025, T026 can run in parallel

**User Story 2 Tests**:
- T031, T032, T033, T034 can all run in parallel

**User Story 2 Implementation**:
- T036, T037 can run in parallel

**User Story 3 Tests**:
- T044, T045, T046, T047 can all run in parallel

**User Story 3 Implementation**:
- T055 can run while other US3 tasks complete

**User Story 4 Tests**:
- T058, T059, T060, T061, T062, T063, T064 can all run in parallel

**User Story 4 Implementation**:
- T066, T067, T068 can run in parallel

**User Story 5 Tests**:
- T078, T079, T080, T081 can all run in parallel

**Edge Cases Tests**:
- T093, T094, T095, T096, T097, T098 can all run in parallel

**Polish Phase**:
- T111, T112, T113, T114 can all run in parallel

### Critical Path (Minimum Time to MVP)

1. **Day 1 Morning**: Setup (Phase 1) → Foundational (Phase 2) - 4 hours
2. **Day 1 Afternoon**: US1 Tests (write all in parallel) - 2 hours
3. **Day 2 Morning**: US1 Implementation (execute path) - 4 hours
4. **Day 2 Afternoon**: US1 Implementation (normalize path) + validation - 4 hours
5. **MVP Complete**: Basic Claude Code execution functional

### Full Feature Timeline

- **Days 1-2**: MVP (US1 only) - Basic execution
- **Day 3**: US2 + US3 (can do in parallel) - Agent/Model + Prompt Files
- **Day 4**: US4 + Edge Cases - Log normalization + Robustness
- **Optional Day 5**: US5 + Polish - Advanced features + Documentation

---

## Parallel Example: User Story 1 Contract Tests

```bash
# Launch all contract tests for User Story 1 together:
Task T012: "Write contract tests for checkAvailability() in tests/contract/adapter.test.ts"
Task T013: "Write contract tests for execute() basic execution in tests/contract/adapter.test.ts"
Task T014: "Write contract tests for execute() prompt configuration in tests/contract/adapter.test.ts"
Task T015: "Write contract tests for execute() working directory in tests/contract/adapter.test.ts"
Task T016: "Write contract tests for normalizeLog() basic structure in tests/contract/adapter.test.ts"
Task T017: "Write integration test for end-to-end execution in tests/integration/claude-code-e2e.test.ts"
```

## Parallel Example: User Story 1 Helper Implementation

```bash
# Launch all helper implementations together:
Task T024: "Implement stripAnsiCodes() helper function in src/adapters/claude-code.ts"
Task T025: "Implement parseModel() helper function in src/adapters/claude-code.ts"
Task T026: "Implement parseVersion() helper function in src/adapters/claude-code.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (1-2 hours)
2. Complete Phase 2: Foundational (2-3 hours) - CRITICAL
3. Complete Phase 3: User Story 1 (8-10 hours)
   - Write all tests first (TDD)
   - Implement in order: checkAvailability → execute → normalizeLog
4. **STOP and VALIDATE**: Run all tests, manual validation with example
5. Deploy/demo basic Claude Code execution capability

**Timeline**: 2 days for MVP

### Incremental Delivery

1. **Foundation** (Setup + Foundational) → Can now build user stories
2. **US1** (P1) → Test independently → **MVP Release** 🎯
3. **US2** (P2) + **US3** (P2) → Test independently → **Enhanced Release**
4. **US4** (P3) → Test independently → **Analysis Release**
5. **US5** (P4) + Edge Cases + Polish → **Complete Release**

Each story adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers (after Foundational phase completes):

- **Developer A**: User Story 1 (MVP - highest priority)
- **Developer B**: User Story 2 + User Story 3 (can work in parallel)
- **Developer C**: Edge Cases + Shell Utils (foundational support)

After US1 completes:
- **Developer A**: User Story 4 (builds on US1)
- **Developer B**: User Story 5 (builds on US1+US2)
- **Developer C**: Polish + Documentation

---

## Success Criteria Validation Checklist

After Phase 9 completion, verify all success criteria:

- [ ] **SC-001**: Test case with `agent.type: claude-code` executes (validate with examples/testcase-claude-code.yaml)
- [ ] **SC-002**: Complete output capture with 100% fidelity (verify in terminal logs)
- [ ] **SC-003**: Valid youbencha-log.json generated (validate with Zod schema)
- [ ] **SC-004**: Timeout enforcement within 5s (verify with timeout integration test)
- [ ] **SC-005**: Clear error messages for prerequisites (verify checkAvailability error handling)
- [ ] **SC-006**: Adapter overhead <500ms (measure with performance profiling)
- [ ] **SC-007**: Model detection 100% accurate (verify with various model configs)
- [ ] **SC-008**: Cross-platform consistency (test on Windows/macOS/Linux)
- [ ] **SC-009**: Easy agent switching (verify by switching between copilot-cli and claude-code)
- [ ] **SC-010**: Consistent log organization (verify artifacts directory structure)

---

## Notes

- **[P] tasks** = different files, no dependencies - can execute in parallel
- **[Story] label** = maps task to specific user story for traceability
- **TDD approach** = Write tests first, ensure they fail, then implement
- **Each user story** = independently completable and testable
- **Verify tests fail** before implementing (red-green-refactor cycle)
- **Commit after each task** or logical group for incremental progress
- **Stop at checkpoints** to validate story independence
- **Total tasks**: 121 tasks across 9 phases
- **MVP tasks**: T001-T030 (30 tasks, ~2 days)
- **Full feature**: T001-T121 (121 tasks, ~4-5 days)
