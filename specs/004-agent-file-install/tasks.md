# Tasks: Agent File Installation

**Input**: Design documents from `/specs/004-agent-file-install/`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Based on plan.md, this is a single-project TypeScript CLI at repository root with:
- `src/` for source code
- `tests/` for test files

---

## Phase 1: Setup

**Purpose**: Project initialization and core module structure

- [X] T001 Create agent content module directory at `src/agents/`
- [X] T002 [P] Create agent file content constants in `src/agents/agentic-judge.ts` with `GITHUB_AGENTIC_JUDGE_CONTENT` and `CLAUDE_AGENTIC_JUDGE_CONTENT` string exports
- [X] T003 [P] Create barrel export file `src/agents/index.ts` exporting all agent content constants

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared agent file installation library that both commands depend on

**⚠️ CRITICAL**: User Stories 1 and 2 both depend on this phase

- [X] T004 Create `AgentFileDefinition`, `InstallResult`, `InstallAgentsOptions`, and `InstallAgentsResult` interfaces in `src/lib/agent-files.ts`
- [X] T005 Implement `AGENT_FILES` constant array with both GitHub and Claude agent file definitions in `src/lib/agent-files.ts`
- [X] T006 Implement `getAgentFiles()` function returning readonly agent file definitions in `src/lib/agent-files.ts`
- [X] T007 Implement helper `fileExists()` utility function using `fs.access()` in `src/lib/agent-files.ts`
- [X] T008 Implement helper `installSingleFile()` function with directory creation and conflict handling in `src/lib/agent-files.ts`
- [X] T009 Implement `installAgentFiles()` main function that iterates agent files and aggregates results in `src/lib/agent-files.ts`
- [X] T010 Add error code mapping for EACCES, ENOSPC, EROFS to user-friendly messages in `src/lib/agent-files.ts`

**Checkpoint**: Foundation ready - `installAgentFiles()` can be called by either command

---

## Phase 3: User Story 1 - Install Agents via Init Command (Priority: P1) 🎯 MVP

**Goal**: When user runs `yb init`, automatically install both agent files alongside testcase.yaml

**Independent Test**: Run `yb init` in a clean directory and verify `.github/agents/agentic-judge.md` and `.claude/agents/agentic-judge.md` are created alongside `testcase.yaml`

### Implementation for User Story 1

- [X] T011 [US1] Import `installAgentFiles` from `../../lib/agent-files.js` in `src/cli/commands/init.ts`
- [X] T012 [US1] Add agent file installation call after testcase.yaml creation in `src/cli/commands/init.ts`
- [X] T013 [US1] Display status for each agent file (created/skipped/overwritten) matching CLI contract output format in `src/cli/commands/init.ts`
- [X] T014 [US1] Update "Next Steps" output to mention agent files were installed in `src/cli/commands/init.ts`
- [X] T015 [US1] Handle agent installation errors gracefully - partial success should still report what was created in `src/cli/commands/init.ts`

**Checkpoint**: `yb init` creates testcase.yaml AND both agent files. US1 is fully functional and testable.

---

## Phase 4: User Story 2 - Explicit Install Agents Command (Priority: P2)

**Goal**: Standalone `yb install-agents` command for updating agent files independently

**Independent Test**: Run `yb install-agents` in any directory and verify only agent files are created (no testcase.yaml modification)

### Implementation for User Story 2

- [X] T016 [US2] Create `src/cli/commands/install-agents.ts` with `installAgentsCommand` handler function
- [X] T017 [US2] Implement "Installing agent files..." spinner message at start of command in `src/cli/commands/install-agents.ts`
- [X] T018 [US2] Call `installAgentFiles()` with force option from command options in `src/cli/commands/install-agents.ts`
- [X] T019 [US2] Display warning message when `--force` flag is used before installation in `src/cli/commands/install-agents.ts`
- [X] T020 [US2] Display status for each file per CLI contract output format (✓ Created, - Skipped, ✓ Overwritten, ✗ Failed) in `src/cli/commands/install-agents.ts`
- [X] T021 [US2] Display success message with explanation of what files do in `src/cli/commands/install-agents.ts`
- [X] T022 [US2] Display "use --force to overwrite" hint when files were skipped in `src/cli/commands/install-agents.ts`
- [X] T023 [US2] Exit with code 1 if any errors occurred, 0 otherwise in `src/cli/commands/install-agents.ts`
- [X] T024 [US2] Import and register `install-agents` command in `src/cli/index.ts` with `--force` option and help text

**Checkpoint**: `yb install-agents` and `yb install-agents --force` work independently. US2 is fully functional.

---

## Phase 5: User Story 3 - Verbose Installation Feedback (Priority: P3)

**Goal**: Clear, consistent output showing exactly what happened with each file

**Independent Test**: Run either command and observe terminal output confirms all file operations with status indicators

### Implementation for User Story 3

- [X] T025 [US3] Ensure consistent status indicators across both commands: ✓ for success, - for skip, ✗ for error in `src/cli/commands/init.ts` and `src/cli/commands/install-agents.ts`
- [X] T026 [US3] Add summary counts output when some files were skipped or had errors in `src/cli/commands/install-agents.ts`
- [X] T027 [US3] Add file path in output messages uses relative paths for readability in both commands

**Checkpoint**: All output follows consistent format. US3 complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and final validation

- [X] T028 [P] Add JSDoc comments to all exported functions and interfaces in `src/lib/agent-files.ts`
- [X] T029 [P] Add JSDoc comments to `installAgentsCommand` in `src/cli/commands/install-agents.ts`
- [X] T030 Verify quickstart.md scenarios work end-to-end (new user init, existing user install-agents, force update)
- [X] T031 Run `npm run build` and verify `src/agents/` module is correctly compiled to `dist/agents/`
- [X] T032 [P] Update GETTING-STARTED.md to mention agent file installation during init

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 - BLOCKS User Stories 1, 2, and 3
- **User Story 1 (Phase 3)**: Depends on Phase 2 - Can proceed after foundational complete
- **User Story 2 (Phase 4)**: Depends on Phase 2 - Can run in parallel with US1
- **User Story 3 (Phase 5)**: Depends on Phase 3 and Phase 4 - Refines output from both commands
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Foundational - **MVP delivery point**
- **User Story 2 (P2)**: Depends only on Foundational - Can run in parallel with US1
- **User Story 3 (P3)**: Depends on US1 and US2 implementation - Refinement of both

### Within Each Phase

- T002 and T003 can run in parallel (different files)
- T004-T010 are sequential (building up agent-files.ts module)
- T011-T015 are sequential (modifying init.ts)
- T016-T024 are sequential (building install-agents command)
- T028 and T029 can run in parallel (different files)

### Parallel Opportunities

**After Phase 1 complete:**
- T004-T010 must be sequential (same file, building up functionality)

**After Phase 2 complete:**
- US1 (T011-T015) and US2 (T016-T024) can proceed in parallel by different developers

**Within Phase 6:**
- T028, T029, T032 can run in parallel (different files)

---

## Parallel Example: After Foundational Phase

```bash
# Developer A works on User Story 1 (init integration):
T011 → T012 → T013 → T014 → T015

# Developer B works on User Story 2 (install-agents command) in parallel:
T016 → T017 → T018 → T019 → T020 → T021 → T022 → T023 → T024
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T010)
3. Complete Phase 3: User Story 1 (T011-T015)
4. **STOP and VALIDATE**: Test `yb init` creates all files correctly
5. Deploy/release if ready - users get agent files automatically on init

### Incremental Delivery

1. Setup + Foundational → Core library ready
2. Add User Story 1 → Test independently → Release (MVP!)
3. Add User Story 2 → Test independently → Release (standalone command)
4. Add User Story 3 → Test independently → Release (polished output)
5. Each story adds value without breaking previous stories

### File Summary

| New Files | Purpose |
|-----------|---------|
| `src/agents/agentic-judge.ts` | Agent file content as string constants |
| `src/agents/index.ts` | Barrel export for agent content |
| `src/lib/agent-files.ts` | Shared installation logic and types |
| `src/cli/commands/install-agents.ts` | Standalone install-agents command |

| Modified Files | Changes |
|----------------|---------|
| `src/cli/commands/init.ts` | Add agent file installation after testcase creation |
| `src/cli/index.ts` | Register install-agents command |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in same phase
- [Story] label maps task to specific user story for traceability
- Each user story can be independently tested after its phase completes
- Tests are NOT included (not explicitly requested in spec)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All file paths are relative to repository root
