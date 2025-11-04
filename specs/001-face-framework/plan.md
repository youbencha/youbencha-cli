# Implementation Plan: youBencha Framework MVP

**Branch**: `001-face-framework` | **Date**: 2025-11-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-face-framework/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

youBencha is a friendly, developer-first CLI framework for evaluating agentic coding tools. The MVP implements three core capabilities: (1) Running agent evaluations with pluggable evaluators and normalized logging, (2) Comparing agent outputs against expected reference branches, and (3) Suggesting evaluators based on branch analysis. The system uses Commander.js for CLI, TypeScript for type safety, and Zod for schema validation. Evaluation runs execute agents via adapters, normalize logs to youBencha Log format, run evaluators in parallel, and output structured JSON results with Markdown reporting.

## Technical Context

**Language/Version**: TypeScript 5.0+ / Node.js 20+  
**Primary Dependencies**: Commander.js (CLI), Zod (schema validation), simple-git (Git operations), diff (text comparison)  
**Storage**: Filesystem-based (JSON results, logs, artifacts); no database required  
**Testing**: Jest with ≥80% coverage requirement for core modules  
**Target Platform**: Cross-platform CLI (Windows, macOS, Linux)  
**Project Type**: Single CLI application with modular architecture  
**Performance Goals**: <3 min for small repos (<100 files), <10 min for medium repos (100-1000 files), evaluator parallelization (4 concurrent default)  
**Constraints**: Memory footprint <500MB, log normalization overhead <5% of total time, progress feedback every 10 seconds  
**Scale/Scope**: MVP supports 1 agent adapter (GitHub Copilot CLI), 3 evaluators (git-diff, expected-diff, agentic-judge), branch-based expected references only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Initial Check (Pre-Phase 0)**: ✅ PASSED  
**Phase 1 Re-Check (Post-Design)**: ✅ PASSED

- [x] **Agent-Agnostic**: Feature does not hardcode agent-specific logic outside adapters
  - ✅ Agent execution isolated in `adapters/` directory with `AgentAdapter` interface
  - ✅ Core orchestrator works with normalized youBencha Log, agnostic to agent implementation
  - ✅ MVP includes one adapter (GitHub Copilot CLI) but architecture supports multiple agents
  - ✅ **Phase 1 Confirmation**: Interface contract defined in `contracts/interfaces.md` ensures strict separation
  
- [x] **Reproducibility**: Configuration captures all inputs; results are deterministic or variance-documented
  - ✅ Suite configuration (YAML/JSON) captures: repo, commit, agent config, evaluators, expected references
  - ✅ Results bundle includes: OS, Node version, youBencha version, timestamps, model parameters
  - ✅ Workspace isolation ensures clean state for each run (src-modified/, src-expected/)
  - ✅ **Phase 1 Confirmation**: Data model defines complete capture of execution context and environment
  
- [x] **Pluggable**: New evaluators/adapters implement standard interfaces without core changes
  - ✅ Evaluators implement `Evaluator` interface: `evaluate(workspace, context) → EvaluationResult[]`
  - ✅ Evaluators execute in parallel by default, no inter-dependencies
  - ✅ MVP provides 3 built-in evaluators with identical interface patterns
  - ✅ **Phase 1 Confirmation**: Contract tests validate interface compliance before merge
  
- [x] **youBencha Log Compliance**: Any log format changes maintain schema compatibility
  - ✅ youBencha Log schema defined in `schemas/youbenchalog.schema.ts` using Zod
  - ✅ Adapters transform agent-specific output to normalized youBencha Log format
  - ✅ Schema includes: model info, parameters, tokens, messages, tool calls, errors, metadata
  - ✅ **Phase 1 Confirmation**: Schema version field (v1.0.0) enables future evolution with backward compatibility
  
- [x] **Sandbox Isolation**: Agent execution remains isolated; no host system mutations
  - ⚠️ **DEFERRED TO POST-MVP**: Docker/container-based sandbox marked as out-of-scope for MVP
  - ✅ Workspace directory isolation implemented: all operations confined to cloned directories
  - ✅ Note: Full sandbox (network restrictions, resource limits) added in v0.2 per roadmap
  - ✅ **Phase 1 Confirmation**: Workspace manager contract includes lock mechanism and cleanup procedures
  
- [x] **TDD Required**: Tests written and approved before implementation begins
  - ✅ Contract tests required for: adapters, evaluators, youBencha Log schema
  - ✅ Integration tests required for: CLI commands, end-to-end evaluation flows
  - ✅ Unit tests required for: workspace management, reporters, configuration loaders
  - ✅ **Phase 1 Confirmation**: Contract test examples provided in `contracts/interfaces.md` for all interfaces

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
youbencha/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── run.ts           # yb run command
│   │   │   ├── report.ts        # yb report command
│   │   │   └── suggest-eval.ts  # yb suggest-eval command
│   │   └── index.ts             # CLI entry point with Commander.js
│   ├── core/
│   │   ├── orchestrator.ts      # Main evaluation orchestration
│   │   ├── workspace.ts         # Workspace management (clone, cleanup)
│   │   ├── env.ts               # Environment detection & context
│   │   ├── storage.ts           # Artifact storage and retrieval
│   │   ├── branch-analyzer.ts   # Branch diff analysis
│   │   └── evaluator-suggester.ts # Evaluator recommendation logic
│   ├── adapters/
│   │   ├── base.ts              # AgentAdapter interface
│   │   └── copilot-cli.ts       # GitHub Copilot CLI adapter
│   ├── evaluators/
│   │   ├── base.ts              # Evaluator interface
│   │   ├── git-diff.ts          # Git diff metrics evaluator
│   │   ├── expected-diff.ts     # Expected reference comparison
│   │   └── agentic-judge.ts     # Generic LLM-based evaluator
│   ├── schemas/
│   │   ├── suite.schema.ts      # Suite configuration schema (Zod)
│   │   ├── youbenchalog.schema.ts    # youBencha Log schema (Zod)
│   │   └── result.schema.ts     # Evaluation result schema (Zod)
│   ├── reporters/
│   │   ├── json.ts              # JSON results output
│   │   └── markdown.ts          # Markdown report generator
│   └── lib/
│       ├── logger.ts            # Logging utilities
│       ├── progress.ts          # Progress feedback
│       └── diff-utils.ts        # Diff calculation helpers
├── tests/
│   ├── contract/
│   │   ├── adapter.test.ts      # AgentAdapter contract tests
│   │   ├── evaluator.test.ts    # Evaluator contract tests
│   │   └── youbenchalog.test.ts      # youBencha Log schema tests
│   ├── integration/
│   │   ├── run-command.test.ts  # End-to-end run tests
│   │   ├── report.test.ts       # Report generation tests
│   │   └── suggest-eval.test.ts # Evaluator suggestion tests
│   └── unit/
│       ├── workspace.test.ts    # Workspace management tests
│       ├── orchestrator.test.ts # Orchestrator logic tests
│       ├── analyzers.test.ts    # Branch analyzer tests
│       └── reporters.test.ts    # Reporter tests
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

**Structure Decision**: Single project structure selected (Option 1). youBencha is a CLI tool with modular architecture following constitution principles: adapters isolate agent-specific logic, evaluators are pluggable components, core orchestration is agent-agnostic. The `src/` directory organizes code by functional concern (CLI, core logic, adapters, evaluators, schemas, reporters, utilities). Tests mirror source structure with contract/integration/unit separation per TDD requirements.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Sandbox Isolation deferred to post-MVP | MVP timeline constraints; full Docker isolation adds 2-3 weeks of complexity | Directory-based isolation sufficient for MVP proof-of-concept; full sandbox critical for production but not blocking for initial validation |

**Mitigation**: MVP documentation clearly states "development/testing environments only" and v0.2 roadmap includes full sandbox implementation (4 weeks).

---

## Planning Phase Completion Summary

### Phase 0: Research & Technical Decisions ✅

**Artifact**: `research.md` (3,800+ words)

**Decisions Made**:
- CLI Framework: Commander.js
- Schema Validation: Zod
- Git Operations: simple-git
- Diff Algorithm: diff + Levenshtein distance
- Testing Framework: Jest with 80% coverage
- Progress Feedback: ora (spinner library)
- LLM Integration: OpenAI SDK for agentic-judge
- Configuration Format: YAML (primary) + JSON fallback

**Dependencies Finalized**: All 7 production dependencies and 7 dev dependencies identified with versions

**Status**: All NEEDS CLARIFICATION items resolved ✅

### Phase 1: Design & Contracts ✅

**Artifacts Generated**:
1. ✅ `data-model.md` (4,200+ words)
   - 8 core entities defined with attributes, validation rules, relationships
   - State transition diagrams for evaluation lifecycle
   - Schema validation strategy documented
   
2. ✅ `contracts/interfaces.md` (4,800+ words)
   - 7 TypeScript interfaces defined: AgentAdapter, Evaluator, Reporter, Orchestrator, WorkspaceManager, BranchAnalyzer, EvaluatorSuggester
   - Contract tests provided for each interface
   - Version compatibility strategy documented
   
3. ✅ `quickstart.md` (3,600+ words)
   - Installation instructions
   - 3 quickstart scenarios (basic eval, expected reference, auto-suggest)
   - Configuration reference
   - Troubleshooting guide
   - Development workflow

**Agent Context Updated**: ✅ GitHub Copilot instructions file created with technologies from this plan

**Constitution Re-Check**: ✅ PASSED (all principles validated against design)

### Phase 2: Task Breakdown ⏸️

**Status**: Not started (command ends after Phase 1 per workflow)

**Next Command**: `/speckit.tasks` to generate task breakdown and implementation checklist

---

## Implementation Readiness Checklist

- [x] Technical unknowns resolved
- [x] Architecture decisions documented
- [x] Data model defined with validation rules
- [x] Interface contracts specified with test examples
- [x] Quickstart guide written
- [x] Dependencies identified and justified
- [x] Project structure finalized
- [x] Constitution compliance verified (twice)
- [x] Agent context files updated
- [ ] Tasks broken down (next: `/speckit.tasks`)
- [ ] Implementation begun (after task approval)

---

## Files Generated

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `plan.md` | 149 | Implementation plan (this file) | ✅ Complete |
| `research.md` | ~380 | Technical decisions and rationale | ✅ Complete |
| `data-model.md` | ~420 | Entity definitions and schemas | ✅ Complete |
| `contracts/interfaces.md` | ~480 | TypeScript interface contracts | ✅ Complete |
| `quickstart.md` | ~360 | User quickstart guide | ✅ Complete |
| `.github/copilot-instructions.md` | ~30 | Agent context for Copilot | ✅ Generated |

**Total Documentation**: ~1,800 lines across 6 files

---

## Ready for Next Phase

✅ **Planning Complete**  
✅ **All artifacts generated**  
✅ **Constitution validated**  
✅ **Ready for task breakdown**: Run `/speckit.tasks`

**Branch**: `001-face-framework`  
**Spec**: [spec.md](./spec.md)  
**Plan**: [plan.md](./plan.md) (this file)
