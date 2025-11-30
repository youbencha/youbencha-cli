# Feature Specification: Agent File Installation

**Feature Branch**: `004-agent-file-install`  
**Created**: November 30, 2025  
**Status**: Draft  
**Input**: User description: "in order for the agentic-judge to work for the copilot cli or claude code agent, the .claude\agents\agentic-judge.md and .github\agents\agentic-judge.md file need to be copied to the repository where youbencha cli is being used. as part of the init command, these folders and files should be created where the command is run. additionally, create a new install agents command that explicitly just copies agents to their correct folder"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install Agents via Init Command (Priority: P1)

As a developer setting up youBencha for the first time, when I run `yb init`, I want the required agentic-judge agent files to be automatically installed so that the agentic-judge evaluator works out of the box without manual file copying.

**Why this priority**: This is the most common entry point for new users. Without the agent files, the agentic-judge evaluator fails silently or with confusing errors. Automating this during init provides a seamless first-run experience.

**Independent Test**: Can be fully tested by running `yb init` in a new directory and verifying that `.github/agents/agentic-judge.md` and `.claude/agents/agentic-judge.md` are created alongside `testcase.yaml`.

**Acceptance Scenarios**:

1. **Given** a clean directory with no youBencha configuration, **When** user runs `yb init`, **Then** the command creates `testcase.yaml` AND creates `.github/agents/agentic-judge.md` AND creates `.claude/agents/agentic-judge.md`

2. **Given** a directory where `.github/agents/` already exists, **When** user runs `yb init`, **Then** the agent file is added without destroying existing files in that directory

3. **Given** a directory where the agent files already exist, **When** user runs `yb init` without `--force`, **Then** the existing agent files are preserved (not overwritten) and user is informed

4. **Given** a directory where the agent files already exist, **When** user runs `yb init --force`, **Then** the agent files are overwritten with the latest versions

---

### User Story 2 - Explicit Install Agents Command (Priority: P2)

As a developer who has already set up youBencha (or wants to update agent files independently), when I run `yb install-agents`, I want only the agent files to be installed/updated without modifying my testcase configuration.

**Why this priority**: Provides flexibility for users who already have a testcase.yaml but need to add or update agent files separately. Also useful for CI/CD pipelines or shared team setups.

**Independent Test**: Can be fully tested by running `yb install-agents` in any directory and verifying only agent files are created, without creating or modifying testcase.yaml.

**Acceptance Scenarios**:

1. **Given** a directory with or without existing youBencha configuration, **When** user runs `yb install-agents`, **Then** the command creates `.github/agents/agentic-judge.md` and `.claude/agents/agentic-judge.md` without modifying any other files

2. **Given** a directory where agent files already exist, **When** user runs `yb install-agents` without `--force`, **Then** existing agent files are preserved and user is informed they already exist

3. **Given** a directory where agent files already exist, **When** user runs `yb install-agents --force`, **Then** agent files are overwritten with the bundled versions

4. **Given** user runs `yb install-agents --help`, **Then** command displays usage information including the `--force` flag option

---

### User Story 3 - Verbose Installation Feedback (Priority: P3)

As a developer running init or install-agents, I want clear feedback about what files were created, skipped, or overwritten so I understand exactly what the command did.

**Why this priority**: Transparency builds trust and helps with debugging. Users should never wonder what happened.

**Independent Test**: Can be tested by running either command and observing the terminal output confirms all file operations.

**Acceptance Scenarios**:

1. **Given** agent files are successfully created, **When** command completes, **Then** output lists each created file with a success indicator (e.g., ✓)

2. **Given** agent files already exist and are skipped, **When** command completes, **Then** output lists each skipped file with an explanation

3. **Given** agent files are overwritten with `--force`, **When** command completes, **Then** output indicates files were overwritten

---

### Edge Cases

- What happens when the directory is read-only? → Command fails gracefully with a clear permission error message
- What happens when disk is full? → Command fails gracefully with a storage error message
- What happens when `.github/` or `.claude/` directories exist but `agents/` subdirectory does not? → Subdirectory is created automatically
- What happens in a non-git repository? → Files are still created (git is not required for agent files)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `yb init` command MUST create `.github/agents/agentic-judge.md` in the current directory
- **FR-002**: The `yb init` command MUST create `.claude/agents/agentic-judge.md` in the current directory
- **FR-003**: The `yb init` command MUST create parent directories (`.github/agents/`, `.claude/agents/`) if they do not exist
- **FR-004**: The `yb init` command MUST preserve existing agent files by default (no overwrite without `--force`)
- **FR-005**: A new `yb install-agents` command MUST be added to the CLI
- **FR-006**: The `yb install-agents` command MUST install the same agent files as init but without creating/modifying testcase.yaml
- **FR-007**: Both commands MUST support a `--force` flag to overwrite existing agent files
- **FR-008**: Both commands MUST output clear status messages for each file operation (created, skipped, overwritten)
- **FR-009**: Agent file content MUST be bundled with the youBencha package (not fetched from external sources)
- **FR-010**: The `yb install-agents` command MUST be registered in the CLI help output

### Key Entities

- **Agent File**: A markdown file containing agent configuration (YAML frontmatter with agent definition and instructions). Located at `.github/agents/agentic-judge.md` (for GitHub Copilot CLI) and `.claude/agents/agentic-judge.md` (for Claude Code).
- **Target Directory**: The directory where the user runs the command (typically a project root or repository)

## Clarifications

### Session 2025-11-30

- Q: Should the commands install both agent files by default, or allow selective installation? → A: Always install both agent files

## Assumptions

- The bundled agent files are the canonical versions from the youBencha repository (`.github/agents/agentic-judge.md` and `.claude/agents/agentic-judge.md`)
- Users running `init` or `install-agents` have write permissions to the current directory
- The agent files are small enough to be bundled as string constants or embedded resources (no external fetch required)
- The `.github/` and `.claude/` naming convention follows the respective agent platforms' requirements
- Both agent files are always installed together (no selective installation) to ensure cross-platform compatibility

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users running `yb init` in a clean directory have a working agentic-judge evaluator without any additional manual steps
- **SC-002**: Users can run `yb install-agents` to update agent files independently of testcase configuration
- **SC-003**: 100% of file operations (create, skip, overwrite) are reported to the user in terminal output
- **SC-004**: Zero data loss - existing agent files are never overwritten without explicit `--force` flag
- **SC-005**: Both commands complete successfully in under 1 second for typical use cases (local file operations only)
