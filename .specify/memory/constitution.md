<!--
Sync Impact Report - Constitution v1.0.0
========================================
Version Change: Initial → 1.0.0
Rationale: First official constitution for FACE project based on PRD v0.9

Principles Established:
- I. Agent-Agnostic Architecture
- II. Reproducibility First
- III. Pluggable Evaluation
- IV. Standard Log Format
- V. Sandbox Isolation
- VI. Test-Driven Development

Templates Status:
✅ plan-template.md - Aligned with constitution checks
✅ spec-template.md - User stories align with evaluation principles
✅ tasks-template.md - Task structure supports modular evaluator development

Follow-up TODOs:
- None - all placeholders filled
-->

# FACE Constitution

## Core Principles

### I. Agent-Agnostic Architecture

**Principle**: FACE MUST evaluate any coding agent without bias toward specific implementations.

- All agent interactions occur through standardized adapters that implement a common interface
- Adapters MUST isolate agent-specific details (CLI flags, API calls, configuration) from core orchestration logic
- No hardcoded agent names, behaviors, or assumptions in core evaluation logic
- Each adapter MUST produce normalized FACE Log output regardless of underlying agent format

**Rationale**: The framework's value depends on fair, unbiased comparison across diverse agent ecosystems. Tight coupling to specific agents would compromise credibility and limit adoption.

### II. Reproducibility First

**Principle**: Evaluation runs MUST be deterministic and reproducible within documented variance bounds.

- Every evaluation MUST capture: model name, version, temperature, seed, commit SHA, OS, dependencies
- Workspace state MUST be isolated (sandboxed) and reset between runs
- Stochastic variance (temperature >0) MUST be documented with multi-replication support
- Golden datasets MUST be versioned and immutable once promoted
- Configuration files (suite.yaml) MUST be version-controlled and human-readable

**Rationale**: Without reproducibility, evaluation results are meaningless for regression testing, benchmarking, or comparative analysis. Teams cannot trust results they cannot reproduce.

### III. Pluggable Evaluation

**Principle**: Evaluators MUST be modular, composable, and independently executable.

- All evaluators implement a shared interface: `evaluate(workspace, context) → EvaluationResult[]`
- Evaluators MUST NOT depend on other evaluators' execution or state
- Each evaluator MUST declare required inputs (files, logs, artifacts) and produce structured outputs
- Built-in evaluators (diff, tests, lint) and custom evaluators follow identical patterns
- Evaluators MUST support parallel execution by default unless explicitly marked sequential

**Rationale**: Pluggability enables domain-specific evaluation (security, performance, accessibility) without modifying core framework. Teams can compose evaluation suites tailored to their needs.

### IV. Standard Log Format (FACE Log Spec)

**Principle**: All agent execution data MUST normalize to the canonical FACE Log JSON schema.

- Adapters MUST transform agent-specific output to FACE Log before evaluation
- FACE Log MUST include: messages, tool calls, tokens, cost, errors, timing, model metadata
- Schema MUST be versioned with backward-compatibility requirements
- Logs MUST be human-readable (JSON with pretty-print) and machine-parseable
- Log schema MUST be published as a standalone specification for ecosystem adoption

**Rationale**: Consistent log format enables cross-agent analysis, cost tracking, and development of log-based evaluators. Without standardization, each adapter would require custom evaluator implementations.

### V. Sandbox Isolation

**Principle**: Agent execution MUST occur in isolated environments that prevent unintended side effects.

- Default execution environment: Docker/DevContainer with mounted workspace
- Network access MUST default to disabled with explicit opt-in allowlist
- Filesystem mutations MUST be confined to designated workspace directories (`src-modified/`, `src-expected/`)
- Resource limits (CPU, memory, timeout) MUST be configurable and enforced
- Host system MUST remain unaffected by agent actions or failures

**Rationale**: Agents execute arbitrary code and commands. Isolation protects host systems, prevents cross-contamination between runs, and ensures evaluation integrity.

### VI. Test-Driven Development

**Principle**: All framework features and evaluators MUST follow TDD discipline.

- Tests MUST be written and approved before implementation begins
- Red-Green-Refactor cycle strictly enforced: failing tests → implementation → passing tests
- Contract tests required for: new adapters, evaluator interfaces, log schema changes
- Integration tests required for: end-to-end evaluation flows, multi-evaluator orchestration
- Unit tests required for: utilities, parsers, reporters, configuration loaders

**Rationale**: FACE evaluates code quality; it must exemplify the standards it measures. TDD ensures reliability and prevents regressions as new agents and evaluators are added.

## Architecture Standards

### Modularity Requirements

- **Core orchestrator** (`core/orchestrator.ts`): Agent-agnostic execution flow
- **Adapters** (`adapters/`): One module per agent, implements `AgentAdapter` interface
- **Evaluators** (`evaluators/`): One module per evaluator, implements `Evaluator` interface
- **Reporters** (`reporters/`): JSON, Markdown, and extensible output formats
- **Schemas** (`schemas/`): TypeScript types and JSON schemas for suite config and FACE Log

No circular dependencies allowed. Each module MUST have a single, clear responsibility.

### Technology Stack

- **Runtime**: Node.js 20+ with TypeScript 5.0+
- **CLI Framework**: Commander.js 
- **Schema Validation**: Zod 
- **Testing**: Jest with coverage ≥80% for core modules
- **Sandbox**: Docker SDK or direct container API calls
- **License**: Apache-2.0 (OSS-friendly, permissive)

### Performance Standards

- Small repo evaluation (<100 files): Complete in <3 minutes
- Medium repo evaluation (100-1000 files): Complete in <10 minutes
- Evaluator parallelization: Default enabled, 4 concurrent max (configurable)
- Log normalization overhead: <5% of total evaluation time
- Memory footprint: <500MB for typical evaluation runs

## Quality Gates

### Pre-Implementation Checklist

Before writing code for any feature:

- [ ] User stories written with acceptance criteria (spec.md)
- [ ] Constitution compliance verified (plan.md)
- [ ] Tests written and reviewed (TDD requirement)
- [ ] Architecture decision documented if introducing new patterns

### Pre-Merge Checklist

Before merging any pull request:

- [ ] All tests pass (unit, integration, contract)
- [ ] Coverage ≥80% for modified modules
- [ ] FACE Log schema compatibility verified (if adapter/log changes)
- [ ] Evaluator interface unchanged or backward-compatible (if evaluator changes)
- [ ] Documentation updated (README, evaluator catalog, API docs)
- [ ] Constitution compliance confirmed in PR description

## Governance

**Authority**: This constitution supersedes all other practices, guidelines, and conventions. In case of conflict, constitution rules prevail.

**Amendment Process**:

1. Propose amendment with rationale in GitHub issue
2. Document impact on existing code, templates, and workflows
3. Require approval from ≥2 maintainers
4. Increment constitution version (semantic versioning rules apply)
5. Update all dependent artifacts (templates, docs, examples)
6. Announce in release notes with migration guide if breaking

**Versioning**:

- **MAJOR**: Principle removal, redefinition, or governance change (backward incompatible)
- **MINOR**: New principle added, section expanded, or new requirement introduced
- **PATCH**: Clarifications, typo fixes, wording improvements (non-semantic)

**Compliance Review**:

- All PRs MUST reference constitution principles in description or checklist
- Quarterly review of compliance across codebase (automated linting where possible)
- Complexity that violates principles MUST be justified in plan.md "Complexity Tracking" section

**Runtime Development Guidance**: Refer to `.specify/templates/agent-file-template.md` for agent-specific implementation guidance during development.

---

**Version**: 1.0.0 | **Ratified**: 2025-11-03 | **Last Amended**: 2025-11-03
