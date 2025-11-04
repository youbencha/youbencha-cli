# Feature Specification: FACE Framework MVP

**Feature Branch**: `001-face-framework`  
**Created**: 2025-11-03  
**Status**: Draft  
**Input**: Framework for Agentic Coding Evaluation (FACE) - A Node-based CLI framework that evaluates agentic coding tools by running agents in isolated workspaces, collecting uniform logs, running pluggable evaluators, and outputting structured results for comparison and regression testing

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Basic Agent Evaluation (Priority: P1)

An AI engineer wants to evaluate how well GitHub Copilot CLI performs on a specific coding task. They have a repository with a task description and want to see objective metrics on the agent's output quality.

**Why this priority**: This is the core value proposition - running a single agent evaluation and getting results. Without this, no other functionality matters.

**Independent Test**: Can be fully tested by running `face run -c suite.yaml` with a simple suite configuration and receiving a JSON results file with evaluation metrics. Delivers immediate value by providing objective measurement instead of manual review.

**Acceptance Scenarios**:

1. **Given** a suite configuration file with repo URL, agent config, and evaluators, **When** user runs `face run -c suite.yaml`, **Then** FACE clones the repo, executes the agent, runs evaluators, and outputs results in JSON format
2. **Given** an agent execution that completes successfully, **When** evaluators run, **Then** all evaluator results are captured with pass/fail status and metrics
3. **Given** completed evaluation results, **When** user runs `face report --from results.json`, **Then** a human-readable Markdown report is generated

---

### User Story 2 - Compare Against Expected Reference (Priority: P2)

A team has a successful AI agent output on a feature branch and wants to use it as a reference for evaluating future agent attempts. They want to measure how similar new agent outputs are to this "ideal" solution.

**Why this priority**: This enables teams to leverage existing high-quality outputs as benchmarks, which is critical for iterative improvement and regression testing.

**Independent Test**: Can be tested by configuring a suite with an expected branch reference, running evaluation, and verifying that expected-diff evaluator compares modified output against the reference branch and produces similarity metrics.

**Acceptance Scenarios**:

1. **Given** a suite configured with `expected_source: branch` and `expected: feature/ai-completed`, **When** FACE runs, **Then** it clones both the working branch and the expected branch into separate directories
2. **Given** both source and expected branches cloned, **When** the expected-diff evaluator runs, **Then** it compares files between `src-modified/` and `src-expected/` and produces a similarity score
3. **Given** evaluation results with expected-diff metrics, **When** the report is generated, **Then** it shows which files differ and by how much compared to the expected reference

---

### User Story 3 - Automated Evaluator Suggestions (Priority: P3)

A developer has completed a feature manually or with an agent and wants to set up evaluation criteria for future iterations. They want FACE to analyze the differences and suggest appropriate evaluators with reasonable thresholds.

**Why this priority**: This reduces the setup burden and helps users leverage FACE's evaluation capabilities without deep domain knowledge. It's valuable but not essential for basic evaluation flows.

**Independent Test**: Can be tested by running `face suggest-eval --source main --expected feature/ai-completed`, which analyzes both branches and outputs a generated suite.yaml with recommended evaluators and criteria.

**Acceptance Scenarios**:

1. **Given** two branches (source and expected), **When** user runs `face suggest-eval --source main --expected feature/completed`, **Then** FACE analyzes file changes, detects patterns, and generates a suite template with suggested evaluators
2. **Given** detected code file modifications, **When** evaluator suggester runs, **Then** it recommends expected-diff, typecheck, and lint evaluators with thresholds based on the expected branch metrics
3. **Given** generated suite template, **When** user reviews it, **Then** it includes commented explanations for why each evaluator was suggested and what the thresholds mean

---

### Edge Cases

- What happens when the agent fails to complete (crashes, times out, or exits with error)? System should capture the failure state, log it, and still run evaluators on whatever partial output exists.
- How does the system handle when expected reference branch doesn't exist or can't be cloned? System should fail fast with clear error message before agent execution.
- What happens when an evaluator crashes or throws an error? System should mark that evaluator as "skipped" with error details and continue with remaining evaluators.
- How does system handle extremely large repositories (>1GB)? Clone operation should have configurable timeout, and system should provide progress feedback.
- What happens when evaluators produce conflicting results (one passes, another fails)? System should aggregate all results without attempting to reconcile, allowing users to interpret the overall outcome.
- How does system handle binary files or non-text diffs? Diff evaluators should skip binary files or note them as "binary changed" without attempting text comparison.

## Requirements *(mandatory)*

### Functional Requirements

**Core Evaluation Flow**

- **FR-001**: System MUST accept a suite configuration file in YAML or JSON format specifying repository, agent configuration, expected references, and evaluators to run
- **FR-002**: System MUST clone the specified repository into an isolated workspace directory
- **FR-003**: System MUST execute the configured agent adapter (GitHub Copilot CLI for MVP) with the repository as input
- **FR-004**: System MUST capture agent stdout/stderr and normalize it into FACE Log format (JSON schema with model info, parameters, time, cost, tokens, messages, tool calls, errors, and execution metadata)
- **FR-005**: System MUST run all configured evaluators after agent execution completes
- **FR-006**: System MUST run evaluators in parallel by default (configurable via `--max-parallel-evaluators`)
- **FR-007**: System MUST aggregate all evaluator results into a single results bundle
- **FR-008**: System MUST output evaluation results in JSON format with structure: suite metadata, agent execution details, evaluator results array, and artifacts manifest
- **FR-009**: System MUST generate human-readable Markdown report from JSON results when user runs `face report --from results.json`

**Expected Reference Support**

- **FR-010**: System MUST support expected reference configuration with `expected_source: branch` and branch name
- **FR-011**: When expected reference is configured, system MUST clone the specified branch into a separate `src-expected/` directory
- **FR-012**: System MUST provide both `src-modified/` and `src-expected/` paths to evaluators that support comparison
- **FR-013**: System MUST fail gracefully with clear error if expected branch cannot be cloned or doesn't exist

**Evaluators (MVP Set)**

- **FR-014**: System MUST include a `git-diff` evaluator that reports files changed, lines added/removed, and change entropy
- **FR-015**: System MUST include an `expected-diff` evaluator that compares `src-modified/` against `src-expected/` and produces similarity metrics
- **FR-016**: System MUST include a generic `agentic-judge` evaluator that accepts natural language evaluation instructions, uses tool calls to review code, and produces structured evaluation results
- **FR-017**: Each evaluator MUST return a result object with: evaluator name, status (passed/failed/skipped), metrics object, message, and optional artifacts array
- **FR-018**: Evaluators MUST be able to mark themselves as skipped with reason (e.g., missing dependencies, configuration error)

**Evaluator Suggestion Workflow**

- **FR-019**: System MUST provide `face suggest-eval --source <branch> --expected <branch>` command that analyzes differences between two branches
- **FR-020**: Branch analyzer MUST detect: files added/modified/deleted, lines changed, file types, structural patterns (tests added, config changes, dependency updates, docs changes)
- **FR-021**: Evaluator suggester MUST map detected patterns to recommended evaluators (e.g., code changes → expected-diff + typecheck + lint, test changes → tests evaluator, build config → build evaluator)
- **FR-022**: Suggester MUST generate a suite.yaml template with recommended evaluators and placeholder thresholds
- **FR-023**: Generated suite MUST include comments explaining why each evaluator was suggested

**CLI Interface**

- **FR-024**: System MUST provide `face run -c <suite-file>` command to execute full evaluation workflow
- **FR-025**: System MUST provide `face report --from <results-file>` command to generate Markdown report from JSON results
- **FR-026**: System MUST provide `face suggest-eval --source <branch> --expected <branch>` command to generate evaluator suggestions
- **FR-027**: CLI MUST display progress feedback during long operations (cloning, agent execution, evaluator runs)
- **FR-028**: CLI MUST exit with code 0 on success, non-zero on failure

**Error Handling & Resilience**

- **FR-029**: System MUST continue evaluation if individual evaluators fail, marking them as skipped with error details
- **FR-030**: System MUST capture and log agent failures (crashes, timeouts, non-zero exit codes) and still run evaluators on partial output
- **FR-031**: System MUST validate suite configuration before starting evaluation and fail fast with actionable error messages
- **FR-032**: System MUST include timestamps and execution context (OS, Node version, FACE version) in all output artifacts

### Key Entities

- **Suite Configuration**: Represents the evaluation specification including repository details, agent configuration, expected reference settings, evaluator list, and execution parameters
- **Agent Adapter**: Represents the interface layer between FACE and specific agent tools (e.g., GitHub Copilot CLI), responsible for executing agent and normalizing logs to FACE Log format
- **FACE Log**: Normalized JSON structure capturing agent execution details including model parameters, messages, tool calls, errors, and metadata - designed to be agent-agnostic
- **Evaluator**: Pluggable component that analyzes agent output and produces evaluation results; includes built-in evaluators (diff, expected-diff, agentic-judge) and supports custom plugins
- **Evaluation Result**: Structured output from an evaluator containing status, metrics, message, and optional artifacts
- **Results Bundle**: Aggregated JSON output containing suite metadata, agent execution details, all evaluator results, and artifacts manifest
- **Expected Reference**: Optional comparison baseline represented by a branch, dataset label, or file path used by comparison evaluators
- **Workspace**: Isolated directory structure containing cloned repository variants (`src-modified/` for agent output, `src-expected/` for reference)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can set up and run a complete agent evaluation (suite config → execution → results) in under 5 minutes for a small repository (<10MB)
- **SC-002**: Evaluation runs produce reproducible results - running the same suite configuration twice on the same repository state produces identical evaluator outputs (excluding timestamp fields)
- **SC-003**: Users can generate a human-readable evaluation report from JSON results in under 10 seconds
- **SC-004**: System successfully evaluates GitHub Copilot CLI agent on at least 3 different real-world repositories with varying sizes and languages
- **SC-005**: Expected-diff evaluator accurately identifies file differences and produces similarity scores between 0.0 and 1.0 when comparing modified vs expected outputs
- **SC-006**: Evaluator suggestion workflow analyzes branch differences and generates a suite template with at least 3 recommended evaluators in under 30 seconds
- **SC-007**: CLI provides clear progress feedback - users can see current operation status without silent periods longer than 10 seconds during evaluation
- **SC-008**: All three MVP evaluators (git-diff, expected-diff, agentic-judge) successfully complete evaluation on test repositories with 100% success rate in automated tests
- **SC-009**: FACE Log format successfully captures agent execution metadata from GitHub Copilot CLI including model parameters, token counts, and execution time
- **SC-010**: System handles evaluator failures gracefully - if 1 out of 3 evaluators crashes, the other 2 still complete and results bundle is generated

## Assumptions

- Git is installed and available in system PATH for repository cloning operations
- Node.js version 20 or higher is installed on the user's system
- GitHub Copilot CLI is already installed and authenticated for users who want to evaluate it
- Users have sufficient disk space for cloning repositories and storing evaluation artifacts (typically 3x repository size)
- Repositories are accessible via HTTPS or SSH with appropriate credentials configured in user's git environment
- Users understand basic Git concepts (branches, commits, clones) for configuring expected references
- Evaluation runs are intended for development/testing environments, not production systems
- Users running FACE have permission to execute arbitrary code from agent tools in their local environment
- Standard text-based diff algorithms are sufficient for initial code comparison (semantic diff is post-MVP)
- YAML/JSON configuration files are manually created or generated by FACE tools (no GUI configuration in MVP)

## Dependencies

- **Git**: Required for repository cloning and branch operations
- **Node.js 20+**: Runtime platform for FACE CLI
- **TypeScript**: Development language for FACE implementation
- **GitHub Copilot CLI**: External dependency for agent evaluation (must be pre-installed by user)
- **File system access**: FACE needs read/write permissions to workspace directory for cloning and artifact storage

## Out of Scope (for MVP)

The following features are explicitly excluded from the MVP but may be considered for future releases:

- **Multi-agent comparison**: Running multiple agents (e.g., Copilot + Claude Code) in same evaluation suite
- **Sandbox isolation**: Docker/container-based execution with network restrictions and resource limits
- **Dataset promotion**: `face expected promote` command for labeling and storing golden datasets
- **Path-based expected references**: Expected references from file paths or artifact bundles (only branch support in MVP)
- **Regression testing**: Comparing evaluation results against historical baselines or golden datasets
- **CI/CD templates**: Pre-built GitHub Actions or other CI workflow examples
- **Build/test/lint/typecheck evaluators**: Command-based evaluators that execute actual build/test toolchains
- **Token cost tracking**: Detailed cost calculation and token usage reporting in FACE Log
- **Web dashboard or UI**: All interactions via CLI only in MVP
- **Plugin marketplace**: Distribution and discovery system for custom evaluators
- **Evaluator parallelization controls**: `--max-parallel-evaluators` flag (serial execution only in MVP)
- **LLM-based evaluator criteria generation**: Automatic generation of semantic evaluation criteria from code patterns
- **Multiple expected reference comparison**: Comparing against multiple ideal references simultaneously
