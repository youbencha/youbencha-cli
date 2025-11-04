# Research & Technical Decisions: FACE Framework MVP

**Date**: 2025-11-03  
**Feature**: 001-face-framework  
**Purpose**: Resolve technical unknowns and document architecture decisions

## Decision Summary

| Area | Decision | Status |
|------|----------|--------|
| CLI Framework | Commander.js | ✅ Selected |
| Schema Validation | Zod | ✅ Selected |
| Git Operations | simple-git | ✅ Selected |
| Diff Algorithm | diff + Levenshtein | ✅ Selected |
| Testing Framework | Jest | ✅ Selected |
| Progress Feedback | ora (spinner library) | ✅ Selected |
| LLM Integration | Direct API calls (OpenAI SDK) | ✅ Selected |

---

## 1. CLI Framework Selection

### Decision: Commander.js

**Rationale**:
- Industry-standard Node.js CLI framework with 30k+ GitHub stars
- Native TypeScript support with excellent type definitions
- Built-in support for subcommands (`face run`, `face report`, `face suggest-eval`)
- Automatic help generation and argument parsing
- Minimal learning curve for contributors familiar with Node.js ecosystem

**Alternatives Considered**:
- **Yargs**: More complex API, heavier dependency footprint
- **oclif**: Opinionated framework from Heroku/Salesforce, adds unnecessary abstraction for MVP scope
- **cac**: Lighter weight but less mature ecosystem and documentation

**Implementation Notes**:
- Define commands in `src/cli/commands/` with one file per command
- Use Commander's `.option()` for flags like `--max-parallel-evaluators`
- Use Commander's `.argument()` for positional args like suite config path

---

## 2. Schema Validation Approach

### Decision: Zod for Runtime Validation

**Rationale**:
- TypeScript-first schema validation with type inference
- Runtime validation ensures suite configs and FACE Logs are valid before processing
- Excellent error messages for user feedback when configs are malformed
- No separate JSON Schema files to maintain - TypeScript types and validators in one place
- Widely adopted in modern TypeScript projects (Next.js, tRPC, etc.)

**Alternatives Considered**:
- **JSON Schema + ajv**: Requires maintaining separate schema files and TypeScript types
- **io-ts**: More functional programming style, steeper learning curve
- **TypeScript only**: No runtime validation, would allow invalid configs to cause failures deep in execution

**Implementation Notes**:
- Define schemas in `src/schemas/*.schema.ts` using Zod
- Export both Zod schema and inferred TypeScript type: `export const SuiteConfigSchema = z.object({...}); export type SuiteConfig = z.infer<typeof SuiteConfigSchema>;`
- Validate all external inputs (user configs, agent outputs) before use

---

## 3. Git Operations Library

### Decision: simple-git

**Rationale**:
- Promise-based Git wrapper with TypeScript support
- Handles complex Git operations (clone, checkout, branch listing, diff) with simple API
- Active maintenance (1M+ weekly npm downloads)
- No need to shell out to `git` command and parse stdout
- Built-in error handling for common Git failures

**Alternatives Considered**:
- **isomorphic-git**: Pure JavaScript Git implementation, but slower and less feature-complete
- **nodegit**: Native bindings to libgit2, more complex setup and platform-specific build issues
- **Shell commands**: Would require parsing Git output, handling cross-platform differences, and complex error handling

**Implementation Notes**:
- Use in `src/core/workspace.ts` for cloning repositories
- Use in `src/core/branch-analyzer.ts` for diff operations
- Configure with `{ baseDir: workspaceDir }` to isolate operations

---

## 4. Diff Algorithm & Similarity Scoring

### Decision: diff (Myers algorithm) + Levenshtein distance

**Rationale**:
- `diff` package provides line-by-line comparison using Myers algorithm (Git's default)
- Levenshtein distance for character-level similarity scoring
- Combined approach: structural diff (files added/removed/modified) + content similarity (0.0-1.0 score)
- Fast enough for typical source files (<10k lines)

**Alternatives Considered**:
- **AST-based diff**: More semantic but requires language-specific parsers (TypeScript, Python, etc.) - too complex for MVP
- **git diff --stat**: Provides file counts but not similarity metrics for expected-diff evaluator
- **Jaccard similarity**: Simpler but less accurate for code with minor changes

**Implementation Notes**:
- Use `diff.diffLines()` for line-by-line comparison in `expected-diff.ts`
- Calculate similarity as: `1 - (levenshtein(actual, expected) / max(len(actual), len(expected)))`
- Report similarity per file and aggregate similarity across all files

---

## 5. Testing Strategy & Framework

### Decision: Jest with 80% Coverage Requirement

**Rationale**:
- Most popular JavaScript testing framework with excellent TypeScript support
- Built-in mocking, assertions, and coverage reporting
- Parallel test execution out of the box
- Snapshot testing useful for validating report outputs
- Constitution mandates ≥80% coverage for core modules

**Test Categories**:

**Contract Tests** (`tests/contract/`):
- `adapter.test.ts`: Verify AgentAdapter interface implementation
- `evaluator.test.ts`: Verify Evaluator interface implementation
- `facelog.test.ts`: Verify FACE Log schema compliance

**Integration Tests** (`tests/integration/`):
- `run-command.test.ts`: End-to-end evaluation flow with real Git repos
- `report.test.ts`: Results JSON → Markdown report generation
- `suggest-eval.test.ts`: Branch analysis → evaluator suggestion

**Unit Tests** (`tests/unit/`):
- All core modules (workspace, orchestrator, analyzers, reporters)
- Test with mocked dependencies (Git operations, file system)

**Implementation Notes**:
- Configure Jest with `collectCoverageFrom: ['src/**/*.ts']` and `coverageThreshold: { global: { lines: 80 } }`
- Use `jest.mock()` to mock external dependencies (Git, file system, agent execution)
- Write tests first per TDD requirement in constitution

---

## 6. Progress Feedback Mechanism

### Decision: ora (Elegant Terminal Spinners)

**Rationale**:
- Popular library (2.5M+ weekly downloads) for CLI progress indicators
- Supports spinners, success/fail icons, and elapsed time
- Meets requirement: "progress feedback every 10 seconds"
- Simple API: `spinner.start()`, `spinner.succeed()`, `spinner.fail()`

**Alternatives Considered**:
- **cli-progress**: More complex multi-progress-bar scenarios, overkill for MVP
- **log-update**: Lower-level, would require manual spinner animation
- **Custom console.log**: No visual feedback during long operations

**Implementation Notes**:
- Wrap long operations in `src/lib/progress.ts` utility
- Use for: Git clone, agent execution, evaluator runs
- Display operation name and elapsed time

---

## 7. LLM Integration for Agentic Judge

### Decision: Direct OpenAI SDK (openai npm package)

**Rationale**:
- `agentic-judge` evaluator needs to call LLM with tool support
- OpenAI SDK provides function calling / tool use out of the box
- Simple integration: pass evaluation instructions as system prompt, code files as user context
- MVP targets OpenAI models (GPT-4, o1) - extensible to other providers post-MVP

**Alternatives Considered**:
- **LangChain**: Too heavyweight for simple LLM calls with tools
- **Direct REST API**: More code to maintain, SDK handles retries and streaming
- **Anthropic SDK**: Would require separate adapter, OpenAI sufficient for MVP

**Implementation Notes**:
- Accept OpenAI API key from environment variable: `OPENAI_API_KEY`
- Define tool schema for code review operations (read file, analyze complexity, etc.)
- Parse structured output into `EvaluationResult` format

---

## 8. Configuration File Format

### Decision: YAML (primary) with JSON fallback

**Rationale**:
- YAML more human-friendly for suite configs (comments, multi-line strings)
- JSON support via same parser (js-yaml) for programmatic generation
- Industry standard for configuration files (Docker Compose, Kubernetes, GitHub Actions)

**Alternatives Considered**:
- **JSON only**: Less readable, no comments
- **TOML**: Less familiar to JavaScript ecosystem
- **TypeScript/JavaScript config files**: Security risk (arbitrary code execution), violates sandbox principles

**Implementation Notes**:
- Use `js-yaml` to parse both YAML and JSON
- Validate with Zod schema after parsing
- Auto-detect format by file extension (.yaml, .yml, .json)

---

## 9. Expected Reference Resolution

### Decision: Git-based branch cloning for MVP

**Rationale**:
- MVP only supports `expected_source: branch`
- Use `simple-git` to clone expected branch into `src-expected/` directory
- Fail fast if branch doesn't exist or can't be cloned
- Dataset and path-based references deferred to post-MVP

**Implementation Notes**:
- Clone expected branch during workspace setup in `workspace.ts`
- Use shallow clone (`--depth 1`) for performance
- Store both `src-modified/` and `src-expected/` paths in workspace context

---

## 10. Evaluator Suggestion Algorithm

### Decision: Pattern-Based Mapping with Heuristics

**Rationale**:
- `face suggest-eval` analyzes branch diff to suggest evaluators
- Use heuristic rules: file extensions → evaluators, change patterns → criteria
- Extract metrics from expected branch (run evaluators on it) for thresholds

**Pattern → Evaluator Mapping**:
| Detected Pattern | Suggested Evaluators | Reasoning |
|------------------|---------------------|-----------|
| Code files changed (*.ts, *.py, *.js) | expected-diff, git-diff | Compare content and structure |
| Test files added/modified (*test*, *spec*) | (future) tests evaluator | Validate test execution |
| Config files changed (*.json, *.yaml, *.toml) | (future) build evaluator | Ensure build still works |
| Docs changed (*.md, /docs/) | agentic-judge (docs quality) | LLM assesses completeness |

**Alternatives Considered**:
- **LLM-based suggestion**: More flexible but adds latency and cost for simple suggestions
- **Static rule engine**: No ability to extract thresholds from expected branch
- **Manual configuration only**: Reduces usability, defeats purpose of suggestion feature

**Implementation Notes**:
- Implement in `src/core/evaluator-suggester.ts`
- Use `branch-analyzer.ts` output (file changes, LOC, patterns) as input
- Generate suite.yaml template with comments explaining suggestions

---

## Best Practices Research

### Node.js CLI Best Practices
- Exit codes: 0 for success, non-zero for failure
- Stream large outputs instead of buffering in memory
- Respect `NO_COLOR` environment variable for CI environments
- Provide `--help` and `--version` flags
- Use stderr for errors, stdout for results

### TypeScript Project Best Practices
- Strict mode enabled in tsconfig.json
- Path aliases for imports (`@/core`, `@/evaluators`)
- ESLint with TypeScript rules
- Prettier for consistent formatting
- Pre-commit hooks with husky + lint-staged

### Testing Best Practices
- Arrange-Act-Assert pattern for test structure
- Use descriptive test names: `it('should clone repository into workspace directory')`
- Mock external dependencies (file system, network, Git)
- Use test fixtures for sample repos and configs
- Clean up test artifacts in afterEach/afterAll

### Performance Optimization
- Parallel evaluator execution (Promise.all)
- Shallow Git clones (`--depth 1`) for speed
- Stream file reading for large diffs
- Debounce progress updates (max 1 update per second)

---

## Open Questions Resolved

**Q: How to handle GitHub Copilot CLI authentication?**  
A: Assume pre-installed and authenticated by user. Document in README as prerequisite.

**Q: Should we support monorepos with multiple packages?**  
A: Not in MVP. Evaluate entire repository as single unit. Monorepo support in future roadmap.

**Q: How to version FACE Log schema for backward compatibility?**  
A: Include `version` field in FACE Log (MVP uses `v1.0.0`). Future schema changes increment version and adapters specify which version they produce.

**Q: Should evaluators be allowed to modify workspace?**  
A: No. Evaluators receive read-only paths. Constitution requires immutability.

**Q: How to handle agent timeouts?**  
A: MVP leaves timeout configuration to agent adapter. Future versions add suite-level timeout configuration.

---

## Dependencies Final List

```json
{
  "dependencies": {
    "commander": "^11.x",
    "zod": "^3.x",
    "simple-git": "^3.x",
    "diff": "^5.x",
    "js-yaml": "^4.x",
    "ora": "^8.x",
    "openai": "^4.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/jest": "^29.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "typescript": "^5.x",
    "eslint": "^8.x",
    "prettier": "^3.x",
    "husky": "^9.x",
    "lint-staged": "^15.x"
  }
}
```

---

## Implementation Readiness

✅ All technical unknowns resolved  
✅ All dependencies identified and justified  
✅ Architecture decisions documented with rationale  
✅ Best practices researched and summarized  
✅ Ready to proceed to Phase 1: Design & Contracts
