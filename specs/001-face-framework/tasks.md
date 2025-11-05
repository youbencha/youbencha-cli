# Tasks: youBencha Framework MVP

**Feature Branch**: `001-face-framework`  
**Input**: Design documents from `/specs/001-face-framework/`  
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/interfaces.md

**Tests**: TDD Required per Constitution - Contract tests and unit tests MUST be written and FAIL before implementation

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `- [ ] [ID] [P?] [Story] Description`

- **Checkbox**: `- [ ]` (markdown task checkbox)
- **[ID]**: Task ID (T001, T002, T003...)
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- **Description**: Include exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure per plan.md

- [x] T001 Create project directory structure: `src/cli/`, `src/core/`, `src/adapters/`, `src/evaluators/`, `src/schemas/`, `src/reporters/`, `src/lib/`, `tests/contract/`, `tests/integration/`, `tests/unit/`
- [x] T002 Initialize Node.js 20+ project with `package.json` including name, version, description, main, bin entries
- [x] T003 [P] Configure TypeScript 5.0+ in `tsconfig.json` (target: ES2020, module: NodeNext, strict: true, esModuleInterop: true, outDir: dist/)
- [x] T004 [P] Setup Jest with TypeScript in `jest.config.js` (preset: ts-jest, testEnvironment: node, coverage threshold: 80%)
- [x] T005 [P] Install production dependencies: commander, zod, simple-git, diff, ora in `package.json`
- [x] T006 [P] Install dev dependencies: typescript, jest, ts-jest, @types/node, @types/jest, eslint, prettier in `package.json`
- [x] T007 [P] Configure ESLint in `.eslintrc.json` (TypeScript rules, Node.js environment)
- [x] T008 [P] Configure Prettier in `.prettierrc` (single quotes, 2 spaces, trailing commas)
- [x] T009 [P] Create npm scripts in `package.json`: build (tsc), test (jest), lint (eslint), format (prettier)
- [x] T010 [P] Create `.gitignore` for Node.js project (node_modules/, dist/, *.log, .youbencha-workspace/, coverage/)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Schemas (TDD: Write tests first)

- [x] T011 [P] Write schema validation tests for youBencha Log in `tests/contract/youbenchalog.test.ts` (MUST FAIL initially)
- [x] T012 [P] Define Zod schema for youBencha Log in `src/schemas/youbenchalog.schema.ts` with version, agent, model, execution, messages, usage, errors, environment fields
- [x] T013 [P] Write schema validation tests for Suite Configuration in `tests/contract/suite.test.ts` (MUST FAIL initially)
- [x] T014 [P] Define Zod schema for Suite Configuration in `src/schemas/suite.schema.ts` with repo, branch, agent, expected_source, expected, evaluators, workspace_dir, timeout fields
- [x] T015 [P] Write schema validation tests for Results Bundle in `tests/contract/results.test.ts` (MUST FAIL initially)
- [x] T016 [P] Define Zod schema for Results Bundle in `src/schemas/result.schema.ts` with version, suite, execution, agent, evaluators, summary, artifacts fields
- [x] T017 [P] Export inferred TypeScript types from all schemas in `src/schemas/index.ts`

### Base Interfaces & Contract Tests (TDD: Tests define contracts)

- [x] T018 [P] Write AgentAdapter contract tests in `tests/contract/adapter.test.ts` (define interface expectations, MUST FAIL initially)
- [x] T019 [P] Define AgentAdapter interface in `src/adapters/base.ts` with name, version, checkAvailability(), execute(), normalizeLog() methods
- [x] T020 [P] Write Evaluator contract tests in `tests/contract/evaluator.test.ts` (define interface expectations, MUST FAIL initially)
- [x] T021 [P] Define Evaluator interface in `src/evaluators/base.ts` with name, description, requiresExpectedReference, checkPreconditions(), evaluate() methods
- [x] T022 [P] Write Reporter contract tests in `tests/contract/reporter.test.ts` (MUST FAIL initially)
- [x] T023 [P] Define Reporter interface in `src/reporters/base.ts` with name, extension, generate(), writeToFile() methods

### Core Utilities

- [x] T024 [P] Implement logger utility in `src/lib/logger.ts` (console-based with levels: debug, info, warn, error)
- [x] T025 [P] Implement progress feedback in `src/lib/progress.ts` using ora (spinners with start, succeed, fail, text methods)
- [x] T026 [P] Implement diff utilities in `src/lib/diff-utils.ts` (Myers diff algorithm, Levenshtein distance, similarity scoring)
- [x] T027 [P] Implement path utilities in `src/lib/path-utils.ts` (workspace path generation, safe path joining, directory validation)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Run Basic Agent Evaluation (Priority: P1) 🎯 MVP

**Goal**: Enable users to run a complete agent evaluation (clone repo, execute agent, run evaluators, output results)

**Independent Test**: Run `yb run -c suite.yaml` with a simple suite configuration and receive a JSON results file with evaluation metrics from git-diff and agentic-judge evaluators

### Core Components (TDD: Write tests before implementation)

- [x] T028 [P] [US1] Write unit tests for Workspace Manager in `tests/unit/workspace.test.ts` (createWorkspace, cloneRepository, cleanup methods)
- [x] T029 [P] [US1] Implement Workspace Manager in `src/core/workspace.ts` (create workspace dirs, use simple-git for cloning, lockfile management, cleanup)
- [x] T030 [P] [US1] Write unit tests for Environment detector in `tests/unit/env.test.ts` (OS detection, Node version, metadata capture)
- [x] T031 [P] [US1] Implement Environment detector in `src/core/env.ts` (detect OS/platform, Node.js version, youBencha version, timestamps)
- [x] T032 [P] [US1] Write unit tests for Storage manager in `tests/unit/storage.test.ts` (save JSON, save artifacts, artifact manifest)
- [x] T033 [P] [US1] Implement Storage manager in `src/core/storage.ts` (save youBencha Log, save results bundle, manage artifacts directory)

### Agent Adapter (TDD: Contract tests already written in Phase 2)

- [x] T034 [US1] Write unit tests for Copilot CLI adapter in `tests/unit/copilot-cli.test.ts` (execute, normalize log, availability check)
- [x] T035 [US1] Implement GitHub Copilot CLI adapter in `src/adapters/copilot-cli.ts` (spawn copilot-cli process, capture stdout/stderr, handle errors)
- [x] T036 [US1] Implement log normalization in `src/adapters/copilot-cli.ts` (parse copilot output, transform to youBencha Log schema)
- [x] T037 [US1] Implement availability check in `src/adapters/copilot-cli.ts` (verify copilot-cli in PATH, check authentication)

### Evaluators for US1 (TDD: Contract tests already written in Phase 2)

- [x] T038 [P] [US1] Write unit tests for GitDiffEvaluator in `tests/unit/git-diff.test.ts` (files changed, lines added/removed, entropy calculation)
- [x] T039 [P] [US1] Implement GitDiffEvaluator in `src/evaluators/git-diff.ts` (use simple-git to get diff stats, calculate change entropy, return metrics)
- [x] T040 [P] [US1] Write unit tests for AgenticJudgeEvaluator in `tests/unit/agentic-judge.test.ts` (agent execution, output parsing, error handling)
- [x] T041 [P] [US1] Implement AgenticJudgeEvaluator in `src/evaluators/agentic-judge.ts` (execute agent via adapter, parse JSON output, handle evaluation criteria)

### Orchestration (TDD: Write tests before implementation)

- [x] T042 [US1] Write unit tests for Orchestrator in `tests/unit/orchestrator.test.ts` (runEvaluation flow, error handling, results aggregation)
- [x] T043 [US1] Implement Orchestrator core in `src/core/orchestrator.ts` (runEvaluation method, workflow coordination)
- [x] T044 [US1] Add workspace setup to Orchestrator (create workspace, clone repo, validate config)
- [x] T045 [US1] Add agent execution to Orchestrator (load adapter, execute agent, save youBencha Log)
- [x] T046 [US1] Add evaluator execution to Orchestrator (load evaluators, run in parallel, handle failures gracefully)
- [x] T047 [US1] Add results bundling to Orchestrator (aggregate evaluator results, calculate summary, create ResultsBundle)
- [x] T048 [US1] Add cleanup to Orchestrator (workspace cleanup on completion or error)

### Reporters (TDD: Contract tests already written in Phase 2)

- [x] T049 [P] [US1] Write unit tests for JSON Reporter in `tests/unit/json-reporter.test.ts` (generate, writeToFile methods)
- [x] T050 [P] [US1] Implement JSON Reporter in `src/reporters/json.ts` (serialize ResultsBundle to pretty JSON, write to file)
- [x] T051 [P] [US1] Write unit tests for Markdown Reporter in `tests/unit/markdown-reporter.test.ts` (generate report sections, format metrics)
- [x] T052 [P] [US1] Implement Markdown Reporter in `src/reporters/markdown.ts` (generate sections: summary, agent execution, evaluator results, use tables for metrics)

### CLI Commands (TDD: Integration tests validate end-to-end)

- [x] T053 [US1] Implement CLI entry point in `src/cli/index.ts` (setup Commander.js, register commands, version, help)
- [x] T054 [US1] Implement `yb run` command in `src/cli/commands/run.ts` (parse -c flag, load suite config, validate schema, invoke orchestrator)
- [x] T055 [US1] Add progress feedback to `yb run` command (spinners for clone, agent execution, evaluators)
- [x] T056 [US1] Add error handling to `yb run` command (user-friendly errors, exit codes, cleanup on SIGINT)
- [x] T057 [US1] Implement `yb report` command in `src/cli/commands/report.ts` (parse --from flag, load results JSON, invoke reporter, output path)
- [x] T058 [US1] Add output options to `yb report` command (--format flag, --output path override)

### Integration Tests (TDD: Write before final integration)

- [x] T059 [US1] Write integration test for complete run workflow in `tests/integration/run-command.test.ts` (full eval with mock repo, verify results JSON)
- [x] T060 [US1] Write integration test for report generation in `tests/integration/report.test.ts` (load real results, generate markdown, validate content)
- [x] T061 [US1] Write integration test for error scenarios in `tests/integration/error-handling.test.ts` (invalid config, repo not found, agent failure)

### Validation & Documentation

- [x] T062 [US1] Create example basic suite in `examples/basic-suite.yaml` (small public repo, copilot-cli agent, git-diff + agentic-judge evaluators)
- [x] T063 [US1] Verify quickstart scenario 1 works end-to-end per `quickstart.md` (run evaluation, generate report, validate output)
- [x] T064 [US1] Create README.md with installation instructions, basic usage, example commands
- [x] T065 [US1] Ensure ≥80% test coverage for all US1 modules (run `npm test -- --coverage`)

**Checkpoint**: User Story 1 complete - basic agent evaluation works end-to-end with git-diff and agentic-judge evaluators

---

## Phase 4: User Story 2 - Compare Against Expected Reference (Priority: P2)

**Goal**: Enable users to compare agent outputs against a reference branch to measure similarity

**Independent Test**: Configure suite with expected branch reference, run evaluation, verify expected-diff evaluator produces similarity metrics and compares src-modified/ against src-expected/

### Expected Reference Support (TDD: Write tests first)

- [X] T066 [US2] Write tests for expected reference cloning in `tests/unit/workspace.test.ts` (clone to src-expected/, handle branch not found)
- [X] T067 [US2] Add expected reference cloning to Workspace Manager in `src/core/workspace.ts` (clone expected branch to src-expected/ directory)
- [X] T068 [US2] Update EvaluationContext type in `src/evaluators/base.ts` to include optional expectedDir: string field
- [X] T069 [US2] Write tests for expected branch validation in `tests/unit/orchestrator.test.ts` (fail fast if expected branch missing)
- [X] T070 [US2] Add expected branch validation to Orchestrator in `src/core/orchestrator.ts` (validate before agent execution, clear error message)

### Expected-Diff Evaluator (TDD: Write tests before implementation)

- [X] T071 [US2] Write unit tests for ExpectedDiffEvaluator in `tests/unit/expected-diff.test.ts` (file comparison, similarity scoring, threshold checking)
- [X] T072 [US2] Implement ExpectedDiffEvaluator skeleton in `src/evaluators/expected-diff.ts` (requiresExpectedReference: true, checkPreconditions, evaluate stub)
- [X] T073 [US2] Implement file-by-file diff comparison (iterate files, use diff-utils for similarity, track file changes)
- [X] T074 [US2] Implement aggregate similarity calculation (overall score, files matched/changed/added/removed counts)
- [X] T075 [US2] Implement threshold checking (compare aggregate similarity to config.threshold, set status passed/failed)
- [X] T076 [US2] Add artifact generation (save detailed diff patch to artifacts/)

### Reporter Updates (TDD: Write tests for new sections)

- [X] T077 [US2] Write tests for expected-diff sections in `tests/unit/markdown-reporter.test.ts` (similarity metrics table, file-level details)
- [X] T078 [US2] Update Markdown Reporter in `src/reporters/markdown.ts` to display expected-diff metrics (similarity score, threshold, pass/fail)
- [X] T079 [US2] Add file-level diff details section to Markdown report (list files with similarity scores, highlight differences)

### Integration Tests

- [X] T080 [US2] Write integration test for expected reference workflow in `tests/integration/expected-ref.test.ts` (clone both branches, run eval, verify expected-diff results)
- [X] T081 [US2] Write integration test for expected branch not found in `tests/integration/error-handling.test.ts` (verify error message, no agent execution)

### Validation & Documentation

- [X] T082 [US2] Create example suite with expected reference in `examples/expected-ref-suite.yaml` (expected_source: branch, expected: feature/completed, threshold: 0.80)
- [X] T083 [US2] Verify quickstart scenario 2 works end-to-end per `quickstart.md` (expected reference comparison with similarity metrics)
- [X] T084 [US2] Update README.md with expected reference section (configuration examples, use cases, threshold guidance)

**Checkpoint**: User Stories 1 AND 2 complete - users can run basic evaluations AND compare against expected reference branches

---

## Phase 5: User Story 3 - Automated Evaluator Suggestions (Priority: P3)

**Goal**: Enable users to analyze branch differences and get automated evaluator recommendations with thresholds

**Independent Test**: Run `yb suggest-eval --source main --expected feature/completed`, verify it outputs valid suite.yaml with recommended evaluators and thresholds based on branch analysis

### Branch Analysis Components (TDD: Write tests first)

- [ ] T085 [P] [US3] Write unit tests for BranchAnalyzer in `tests/unit/branch-analyzer.test.ts` (diff detection, file patterns, structural analysis)
- [ ] T086 [P] [US3] Implement BranchAnalyzer skeleton in `src/core/branch-analyzer.ts` (analyzeBranches method returning BranchAnalysis)
- [ ] T087 [P] [US3] Implement file change detection (use simple-git to diff branches, categorize files as added/modified/deleted)
- [ ] T088 [P] [US3] Implement pattern detection (detect test files, config files, docs, dependencies based on file paths and extensions)
- [ ] T089 [P] [US3] Implement structural analysis (calculate lines changed, file type distribution, change complexity score)

### Evaluator Suggestion Logic (TDD: Write tests first)

- [ ] T090 [P] [US3] Write unit tests for EvaluatorSuggester in `tests/unit/evaluator-suggester.test.ts` (pattern mapping, threshold calculation, template generation)
- [ ] T091 [P] [US3] Implement EvaluatorSuggester in `src/core/evaluator-suggester.ts` (suggestEvaluators method taking BranchAnalysis)
- [ ] T092 [US3] Implement rule-based evaluator mapping (code changes → expected-diff, test patterns → test evaluator, always include git-diff)
- [ ] T093 [US3] Implement threshold calculation (analyze expected branch metrics, suggest reasonable thresholds with margin)
- [ ] T094 [US3] Implement suite template generation (format as YAML with comments explaining each evaluator and threshold)

### CLI Command for US3 (TDD: Integration tests validate workflow)

- [ ] T095 [US3] Implement `yb suggest-eval` command in `src/cli/commands/suggest-eval.ts` (parse --source, --expected, --output flags)
- [ ] T096 [US3] Add branch cloning for analysis (clone both branches to temporary directories for comparison)
- [ ] T097 [US3] Add analyzer and suggester invocation (call BranchAnalyzer, pass results to EvaluatorSuggester)
- [ ] T098 [US3] Add YAML output generation (write suggested suite to file, display path to user)
- [ ] T099 [US3] Add progress feedback (spinners for cloning, analyzing, generating)
- [ ] T100 [US3] Wire up suggest-eval command in `src/cli/index.ts` (register with Commander.js)

### Integration Tests

- [ ] T101 [US3] Write integration test for suggest-eval workflow in `tests/integration/suggest-eval.test.ts` (analyze real branches, verify suite structure)
- [ ] T102 [US3] Write tests for various branch patterns in `tests/integration/branch-patterns.test.ts` (code-only, tests-only, mixed changes, docs-only)
- [ ] T103 [US3] Write test for generated suite validity in `tests/integration/suggest-eval.test.ts` (parse generated YAML, validate against suite schema)

### Validation & Documentation

- [ ] T104 [US3] Create example test repository with branches in `examples/test-repos/sample-project/` (setup main and feature branches with typical changes)
- [ ] T105 [US3] Verify quickstart scenario 3 works end-to-end per `quickstart.md` (run suggest-eval, verify output, validate generated suite)
- [ ] T106 [US3] Update README.md with suggest-eval section (command usage, examples, interpretation guide)

**Checkpoint**: All three user stories complete - complete MVP delivered with all P1-P3 functionality

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final quality checks

### Error Handling & Resilience

- [ ] T107 [P] Add comprehensive error handling to all CLI commands in `src/cli/commands/*.ts` (try-catch blocks, user-friendly error messages, exit codes)
- [ ] T108 [P] Add timeout handling for Git operations in `src/core/workspace.ts` (configurable timeout, graceful termination)
- [ ] T109 [P] Add graceful degradation when evaluators fail in `src/core/orchestrator.ts` (mark as skipped, continue with others, log error)
- [ ] T110 [P] Add detailed validation for suite configuration in `src/cli/commands/run.ts` (Zod parse with custom error messages, field-level guidance)

### Performance & Resource Management

- [ ] T111 [P] Add workspace cleanup on errors and SIGINT in `src/core/orchestrator.ts` (register cleanup handlers, ensure directories removed)
- [ ] T112 [P] Implement parallel evaluator execution in `src/core/orchestrator.ts` (use Promise.allSettled, configurable concurrency limit)
- [ ] T113 [P] Ensure progress feedback for all long operations in `src/cli/commands/*.ts` (use progress utility, update every 10 seconds)
- [ ] T114 [P] Add memory usage monitoring in `src/lib/monitor.ts` (track workspace size, warn if >500MB, suggest cleanup)

### Documentation & Developer Experience

- [ ] T115 [P] Finalize comprehensive README.md (installation, all commands, examples, troubleshooting, contributing)
- [ ] T116 [P] Create CONTRIBUTING.md (dev setup, running tests, code style, PR process, TDD requirements)
- [ ] T117 [P] Create architecture guide in `docs/architecture.md` (component diagram, data flow, extension points)
- [ ] T118 [P] Create troubleshooting guide in `docs/troubleshooting.md` (common errors, solutions, debugging tips)
- [ ] T119 [P] Add JSDoc comments to all public interfaces in `src/adapters/base.ts`, `src/evaluators/base.ts`, `src/reporters/base.ts`
- [ ] T120 [P] Create example custom evaluator in `examples/custom-evaluator/` (demonstrates pluggable architecture)

### Testing & Quality Assurance

- [ ] T121 [P] Run coverage report and ensure ≥80% for all core modules (orchestrator, workspace, adapters, evaluators, reporters)
- [ ] T122 [P] Add end-to-end smoke tests in `tests/e2e/smoke.test.ts` (full evaluation with real repo, verify all artifacts created)
- [ ] T123 [P] Test on Windows in `tests/platform/windows.test.ts` (path handling, line endings, shell commands)
- [ ] T124 [P] Test on macOS and Linux in `tests/platform/unix.test.ts` (permissions, symlinks, shell compatibility)
- [ ] T125 [P] Create CI/CD workflow in `.github/workflows/test.yml` (run tests on push, matrix: Windows/macOS/Linux, Node 20+)
- [ ] T126 [P] Create release workflow in `.github/workflows/release.yml` (build, version bump, npm publish)

### Final Validation & Constitution Compliance

- [ ] T127 Run all quickstart.md scenarios manually (scenario 1: basic eval, scenario 2: expected ref, scenario 3: suggest-eval)
- [ ] T128 Test with real repositories of different sizes (small: <10MB, medium: 10-100MB, large: 100MB-1GB)
- [ ] T129 Verify Constitution principles maintained (agent-agnostic adapters, reproducible results, pluggable evaluators, youBencha Log compliance, workspace isolation, TDD coverage)
- [ ] T130 Create release candidate build with `npm run build`, test npm link installation, verify binary works
- [ ] T131 Review all TODO/FIXME comments in codebase and resolve or create follow-up issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) completion AND US1 Workspace Manager
  - Extends workspace cloning capabilities for expected references
  - Can start once US1 workspace manager is complete (T029)
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2) completion only
  - Independent of US1 and US2 - uses git operations directly
  - Can start in parallel with US1/US2 if team capacity allows
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Foundation only - No dependencies on other user stories
  - Fully independent and testable
  - Delivers core evaluation value
  
- **User Story 2 (P2)**: Foundation + US1 Workspace Manager
  - Extends workspace cloning for expected references
  - Uses US1 evaluator infrastructure
  - Still independently testable (can run expected-diff without git-diff)
  
- **User Story 3 (P3)**: Foundation only - No dependencies on other user stories
  - Uses git operations directly (simple-git)
  - Generates suite configs that US1/US2 consume, but no runtime coupling
  - Fully independent and testable

### Within Each User Story (TDD Flow)

**User Story 1 (Phase 3)**:
1. Write unit tests for core components (T028, T030, T032) - tests MUST FAIL
2. Implement core components in parallel (T029, T031, T033)
3. Write unit tests for adapter (T034) - tests MUST FAIL
4. Implement Copilot CLI adapter (T035-T037)
5. Write unit tests for evaluators (T038, T040) - tests MUST FAIL
6. Implement evaluators in parallel (T039, T041)
7. Write unit tests for orchestrator (T042) - tests MUST FAIL
8. Implement orchestrator flow (T043-T048)
9. Write unit tests for reporters (T049, T051) - tests MUST FAIL
10. Implement reporters in parallel (T050, T052)
11. Implement CLI commands (T053-T058)
12. Write integration tests (T059-T061) - validate end-to-end
13. Validation and documentation (T062-T065)

**User Story 2 (Phase 4)**:
1. Write tests for expected reference support (T066, T069) - tests MUST FAIL
2. Implement expected reference cloning (T067-T070)
3. Write tests for expected-diff evaluator (T071) - tests MUST FAIL
4. Implement expected-diff evaluator (T072-T076)
5. Write tests for reporter updates (T077) - tests MUST FAIL
6. Update reporters (T078-T079)
7. Write integration tests (T080-T081)
8. Validation and documentation (T082-T084)

**User Story 3 (Phase 5)**:
1. Write tests for analyzer (T085) - tests MUST FAIL
2. Implement branch analyzer (T086-T089)
3. Write tests for suggester (T090) - tests MUST FAIL
4. Implement evaluator suggester (T091-T094)
5. Implement CLI command (T095-T100)
6. Write integration tests (T101-T103)
7. Validation and documentation (T104-T106)

### Parallel Opportunities

**Phase 1 (Setup)**: 8 parallel tasks after T001-T002
- T003-T010 can all run in parallel (config files, dependencies, tooling)

**Phase 2 (Foundational)**: High parallelism within categories
- Schema tests: T011, T013, T015 can run in parallel
- Schema implementations: T012, T014, T016 can run in parallel after tests
- Contract tests: T018, T020, T022 can run in parallel
- Interface definitions: T019, T021, T023 can run in parallel after tests
- All utilities: T024-T027 can run in parallel

**Phase 3 (US1)**: Multiple parallel tracks
- Core component tests (T028, T030, T032) can run in parallel
- Core component implementations (T029, T031, T033) can run in parallel
- Evaluator tests (T038, T040) can run in parallel
- Evaluator implementations (T039, T041) can run in parallel
- Reporter tests (T049, T051) can run in parallel
- Reporter implementations (T050, T052) can run in parallel

**Phase 4 (US2)**: Moderate parallelism
- T066 and T069 tests can be written in parallel
- T067-T068 and T070 can be implemented in parallel
- T077 and reporter updates can run in parallel
- T080-T081 integration tests can run in parallel

**Phase 5 (US3)**: Good parallelism
- Analyzer and suggester tests (T085, T090) can be written in parallel
- Analyzer implementation (T086-T089) can run in parallel
- T101-T103 integration tests can run in parallel

**Phase 6 (Polish)**: Highest parallelism - almost all tasks are independent
- Error handling (T107-T110) can all run in parallel
- Performance (T111-T114) can all run in parallel
- Documentation (T115-T120) can all run in parallel
- Testing tasks (T121-T126) can run in parallel

---

## Parallel Example: Foundational Phase (Phase 2)

```bash
# Phase 2 has excellent parallelism - example workflow:

## Track 1: Schema Tests (write first)
T011: Write youBencha Log schema tests
T013: Write Suite Config schema tests
T015: Write Results Bundle schema tests

## Track 2: Schema Implementations (after tests fail)
T012: Implement youBencha Log schema
T014: Implement Suite Config schema
T016: Implement Results Bundle schema

## Track 3: Contract Tests (independent track)
T018: Write AgentAdapter contract tests
T020: Write Evaluator contract tests
T022: Write Reporter contract tests

## Track 4: Interface Definitions (after contract tests)
T019: Define AgentAdapter interface
T021: Define Evaluator interface
T023: Define Reporter interface

## Track 5: Utilities (fully independent)
T024: Implement logger
T025: Implement progress feedback
T026: Implement diff utilities
T027: Implement path utilities
```

---

## Implementation Strategy

### Strategy 1: MVP First (User Story 1 Only) - RECOMMENDED ⭐

**Timeline**: 2-3 weeks for single developer

1. ✅ Complete Phase 1: Setup (1 day) - Tasks T001-T010
2. ✅ Complete Phase 2: Foundational (2-3 days) - Tasks T011-T027
3. ✅ Complete Phase 3: User Story 1 (1-2 weeks) - Tasks T028-T065
4. **STOP and VALIDATE**: Test US1 independently, demo to stakeholders
5. Get feedback, iterate on US1 if needed
6. Decide whether to proceed to US2/US3 based on validation

**Benefits**:
- Fastest path to working product (basic evaluation flow)
- Early validation of architecture and TDD approach
- Can course-correct before building US2/US3
- Delivers core value: run agent, get evaluation results
- Proof of concept for pluggable evaluators and adapters

**What Works After Phase 3**:
- ✅ `yb run -c suite.yaml` - full evaluation workflow
- ✅ `yb report --from results.json` - markdown reports
- ✅ git-diff and agentic-judge evaluators
- ✅ GitHub Copilot CLI adapter
- ⏸️ Expected reference comparison (US2 needed)
- ⏸️ Evaluator suggestions (US3 needed)

### Strategy 2: Incremental Delivery (All User Stories)

**Timeline**: 4-6 weeks for single developer

1. Complete Phase 1: Setup (1 day) - T001-T010
2. Complete Phase 2: Foundational (2-3 days) - T011-T027
3. Complete Phase 3: User Story 1 (1-2 weeks) - T028-T065 → **Demo MVP**
4. Complete Phase 4: User Story 2 (3-5 days) - T066-T084 → **Demo with references**
5. Complete Phase 5: User Story 3 (3-5 days) - T085-T106 → **Demo full feature set**
6. Complete Phase 6: Polish (3-5 days) - T107-T131 → **Production ready**

**Benefits**:
- Each story adds value independently
- Can demo progress weekly
- Can prioritize or defer stories based on feedback
- Continuous delivery of features
- Each checkpoint provides validation opportunity

### Strategy 3: Parallel Team Development (3 Developers)

**Timeline**: 2-3 weeks with team

1. **Week 1 (Together)**: Setup + Foundational
   - All: Phase 1 Setup (T001-T010)
   - All: Phase 2 Foundational (T011-T027)
   - Checkpoint: Foundation complete, contracts defined

2. **Week 2-3 (Parallel)**: User Stories
   - Developer A: User Story 1 (T028-T065) - Core evaluation
   - Developer B: User Story 2 (T066-T084) - Expected references (waits for T029 from Dev A)
   - Developer C: User Story 3 (T085-T106) - Evaluator suggestions (fully independent)

3. **Week 3 (Integration)**: Polish & Merge
   - All: Code review and integration
   - All: Phase 6 Polish (T107-T131)
   - All: Cross-platform testing

**Benefits**:
- Fastest overall timeline
- Maximizes team throughput
- Stories integrate cleanly due to strong interface contracts
- Parallel testing across user stories
- Note: Dev B has minor dependency on Dev A's workspace manager

---

## Testing Strategy

### Test-First Development (TDD)

Per Constitution requirement, ALL tests must be written BEFORE implementation:

1. **Phase 2: Write contract tests first** (T011, T013, T015, T018, T020, T022)
   - Define interface and schema expectations
   - Run tests → MUST FAIL (no implementation yet)
   - These tests guard against breaking contracts

2. **Write unit tests before each component**
   - Example: Write T028 (workspace tests) before T029 (workspace implementation)
   - Tests define expected behavior
   - Run tests → MUST FAIL
   - Implement component → tests PASS

3. **Write integration tests before final workflows**
   - Example: Write T059 (run command test) during CLI implementation
   - Tests validate end-to-end flows
   - Guide implementation decisions

### Coverage Requirements

- ≥80% line coverage for all modules in `src/` (enforced in jest.config.js)
- 100% coverage target for:
  - Schema validation (`src/schemas/*.schema.ts`)
  - Core interfaces (`src/adapters/base.ts`, `src/evaluators/base.ts`, `src/reporters/base.ts`)
  - Orchestrator logic (`src/core/orchestrator.ts`)

### Test Execution

```bash
# Run all tests
npm test

# Run with coverage report
npm test -- --coverage

# Run specific test file
npm test -- workspace.test.ts

# Run by test type
npm test -- tests/contract/     # Contract tests only
npm test -- tests/unit/         # Unit tests only
npm test -- tests/integration/  # Integration tests only

# Watch mode during development
npm test -- --watch
```

---

## Success Metrics

### Phase Completion Criteria

- **Phase 1 Complete**: `npm run build` succeeds, all config files valid, dependencies installed
- **Phase 2 Complete**: All contract tests pass (T011-T027), schemas validate sample data, interfaces defined
- **Phase 3 Complete**: `yb run -c suite.yaml` works end-to-end, ≥80% coverage, quickstart scenario 1 validated
- **Phase 4 Complete**: Expected reference comparison works, expected-diff evaluator functional, quickstart scenario 2 validated
- **Phase 5 Complete**: `yb suggest-eval` generates valid suite configs, quickstart scenario 3 validated
- **Phase 6 Complete**: All quickstart scenarios pass, ≥80% coverage maintained, cross-platform tested, documentation complete

### User Story Validation Commands

**US1 Validation** (Phase 3 Complete):
```bash
# Basic evaluation should work
yb run -c examples/basic-suite.yaml

# Should generate results and report
yb report --from .youbencha-workspace/run-*/artifacts/results.json

# Verify results.json has git-diff and agentic-judge results
cat .youbencha-workspace/run-*/artifacts/results.json | grep evaluators
```

**US2 Validation** (Phase 4 Complete):
```bash
# Expected reference comparison should work
yb run -c examples/expected-ref-suite.yaml

# Check results.json contains expected-diff evaluator
cat .youbencha-workspace/run-*/artifacts/results.json | grep expected-diff

# Report should show similarity metrics
cat .youbencha-workspace/run-*/artifacts/report.md | grep similarity
```

**US3 Validation** (Phase 5 Complete):
```bash
# Should generate suite config with recommendations
yb suggest-eval --source main --expected feature/completed --output suggested.yaml

# Generated suite should be valid YAML
cat suggested.yaml

# Should be usable with yb run
yb run -c suggested.yaml
```

### Constitution Compliance Checklist

- [ ] **Agent-Agnostic**: Agent execution isolated in adapters/ (T035-T037), core agnostic (T043-T048)
- [ ] **Reproducibility**: Suite config captures all inputs (T014), results bundle includes environment (T047)
- [ ] **Pluggable**: Evaluators implement Evaluator interface (T021, T039, T041, T072-T076), parallel execution (T046)
- [ ] **youBencha Log Compliance**: Schema defined (T012), validated (T011), adapters normalize to schema (T036)
- [ ] **Sandbox Isolation**: Workspace isolation implemented (T029, T067), cleanup on errors (T111)
- [ ] **TDD Required**: Tests written before implementation throughout (T011, T013, T015, T018, T020, T022, T028, T030, T032, etc.)

---

## Quick Reference

**Total Tasks**: 131 tasks across 6 phases

**Task Breakdown by Phase**:
- Phase 1 (Setup): 10 tasks (T001-T010)
- Phase 2 (Foundational): 17 tasks (T011-T027) - BLOCKS all user stories
- Phase 3 (User Story 1 - MVP): 38 tasks (T028-T065)
- Phase 4 (User Story 2): 19 tasks (T066-T084)
- Phase 5 (User Story 3): 22 tasks (T085-T106)
- Phase 6 (Polish): 25 tasks (T107-T131)

**Task Breakdown by Type**:
- Contract/Schema Tests: 9 tasks (all in Phase 2)
- Unit Tests: 18 tasks (distributed across user stories)
- Integration Tests: 9 tasks (distributed across user stories)
- Implementation: 70 tasks
- Documentation/Validation: 25 tasks

**Estimated Timeline**:
- **MVP (Phase 1-3)**: 2-3 weeks single developer
  - Delivers: Basic evaluation workflow, 2 evaluators, reports
- **Full Feature Set (Phase 1-5)**: 4-6 weeks single developer
  - Adds: Expected references, evaluator suggestions
- **Production Ready (All Phases)**: 5-7 weeks single developer
  - Adds: Polish, documentation, cross-platform testing
- **Team of 3**: 2-3 weeks all phases
  - Parallel user story development after foundation

**Recommended Approach**:
1. **Weeks 1**: Phase 1 + 2 (Setup + Foundation) → T001-T027
2. **Weeks 2-3**: Phase 3 (User Story 1) → T028-T065
3. **STOP**: Validate MVP, demo, get feedback
4. **Decision Point**: Continue to US2/US3 or iterate on US1

**Key Success Indicators**:
- ✅ All contract tests pass (Phase 2)
- ✅ `yb run` executes successfully (Phase 3)
- ✅ ≥80% test coverage maintained (Phase 3-6)
- ✅ All quickstart scenarios work (Phase 6)
- ✅ Constitution principles maintained (Phase 6)
