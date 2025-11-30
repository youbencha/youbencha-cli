# Implementation Plan: Agent File Installation

**Branch**: `004-agent-file-install` | **Date**: 2025-11-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-agent-file-install/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add automatic installation of agentic-judge agent files (`.github/agents/agentic-judge.md` and `.claude/agents/agentic-judge.md`) during `yb init` command, and create a new `yb install-agents` command for standalone agent file management. Agent files are bundled as string constants and written to the target directory with proper directory creation and conflict handling via `--force` flag.

## Technical Context

**Language/Version**: TypeScript 5.9+ with Node.js 20+  
**Primary Dependencies**: Commander.js (CLI), fs-extra (file ops), ora (spinners)  
**Storage**: Local filesystem - writing markdown files to user's project directory  
**Testing**: Jest with ≥80% coverage for core modules  
**Target Platform**: Cross-platform CLI (Windows, macOS, Linux)  
**Project Type**: Single project - CLI tool  
**Performance Goals**: <1 second for agent file installation (local file ops only)  
**Constraints**: Must work without network access; files bundled in package  
**Scale/Scope**: 2 agent files (~114 lines each), 2 CLI commands affected

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Agent-Agnostic Architecture | ✅ PASS | Installs agent files for both Copilot CLI and Claude Code equally |
| II. Reproducibility First | ✅ PASS | Agent files are versioned with the package; deterministic installation |
| III. Pluggable Evaluation | ✅ PASS | No changes to evaluator interface |
| IV. Standard Log Format | ✅ PASS | No changes to log format |
| V. Sandbox Isolation | ✅ PASS | Writes to user's cwd only; no workspace mutation |
| VI. Test-Driven Development | ⏳ PENDING | Tests must be written before implementation (Phase 2) |
| VII. Security by Design | ✅ PASS | Path traversal protection via path.join; no user input in paths; no shell execution |

**Post-Phase 1 Re-evaluation**: ✅ All principles verified. Design uses:
- Hardcoded relative paths only (VII)
- `path.join()` for safe path construction (VII)
- No shell execution - direct fs API (VII)
- Equal treatment of both agent platforms (I)
- String constants bundled in package (II)

## Project Structure

### Documentation (this feature)

```text
specs/004-agent-file-install/
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
├── cli/
│   ├── commands/
│   │   ├── init.ts              # Modified: add agent installation after testcase creation
│   │   └── install-agents.ts    # New: standalone agent installation command
│   └── index.ts                 # Modified: register install-agents command
├── lib/
│   └── agent-files.ts           # New: shared agent file installation logic
└── agents/                      # New: bundled agent file content as constants
    ├── index.ts                 # Exports agent file content constants
    └── agentic-judge.ts         # Agent file content strings

tests/
├── contract/
│   └── agent-files.test.ts      # Contract tests for AgentFile interface
├── integration/
│   └── install-agents.test.ts   # End-to-end CLI command tests
└── unit/
    ├── agent-files.test.ts      # Unit tests for agent file utilities
    └── install-agents.test.ts   # Unit tests for command handler
```

**Structure Decision**: Single project structure matching existing youBencha layout. New code follows established patterns in `src/cli/commands/` for CLI commands and `src/lib/` for shared utilities.

## Complexity Tracking

> No constitution violations - section left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| - | - | - |
