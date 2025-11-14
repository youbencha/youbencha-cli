# youBencha Development Guidelines

A CLI framework for evaluating AI coding agents through pluggable adapters and evaluators.

## Project Architecture

### Core Mental Model
youBencha follows a **pipeline architecture** where evaluation flows through distinct stages:
1. **Workspace Setup** - Clone repo(s) to isolated directories (`src-modified/`, `src-expected/`)
2. **Agent Execution** - Run coding agent via adapter (e.g., CopilotCLIAdapter)
3. **Log Normalization** - Transform agent output to standardized `YouBenchaLog` format
4. **Evaluators** - Run pluggable evaluators **in parallel** (git-diff, expected-diff, agentic-judge)
5. **Results Aggregation** - Bundle all outputs into `ResultsBundle` JSON
6. **Reporting** - Generate human-readable Markdown/JSON reports

### Key Components

**Orchestrator** (`src/core/orchestrator.ts`)  
- Central coordinator owning the entire evaluation workflow
- Manages workspace lifecycle, agent execution, evaluator parallelization
- Never mutates original repository - works in isolated workspace
- Implements error recovery with workspace cleanup

**Agent Adapters** (`src/adapters/`)  
- Interface: `AgentAdapter` with `checkAvailability()`, `execute()`, `normalizeLog()`
- Isolate agent-specific logic (CLI invocation, authentication, output parsing)
- Must produce `YouBenchaLog` for cross-agent comparison
- MVP: `CopilotCLIAdapter` (GitHub Copilot CLI)

**Evaluators** (`src/evaluators/`)  
- Interface: `Evaluator` with `checkPreconditions()`, `evaluate()`
- Run **in parallel** via `Promise.allSettled()` - isolated from each other
- Access immutable snapshots: `modifiedDir`, `expectedDir`, `artifactsDir`
- Return structured `EvaluationResult` (status, metrics, message, duration)
- Built-in: `git-diff`, `expected-diff`, `agentic-judge`

**Workspace Manager** (`src/core/workspace.ts`)  
- Creates isolated workspace under `.youbencha-workspace/run-{timestamp}-{hash}/`
- Clones branch(es): `src-modified/` (agent works here), `src-expected/` (optional reference)
- Implements locking mechanism to prevent concurrent workspace conflicts
- Cleanup is **mandatory** unless `--keep-workspace` flag set

### Data Flow Contracts

**Suite Configuration** (YAML/JSON → `SuiteConfig`)  
Required: `repo`, `agent.type`, `evaluators[]`  
Optional: `branch`, `commit`, `expected_source`, `expected`, `timeout`, `workspace_dir`  
Validation: Zod schema rejects localhost/internal network repos

**youBencha Log** (`YouBenchaLog`)  
Standardized format normalizing agent outputs: model info, token usage, execution metadata, messages, tool calls  
Enables cross-agent comparison and cost tracking

**Results Bundle** (`ResultsBundle`)  
Complete evaluation artifact with suite metadata, agent execution details, evaluator results, summary statistics  
Saved as `results.json` in workspace artifacts directory

## Development Workflows

### Running Tests
```powershell
npm test                    # Full test suite with coverage
npm test -- orchestrator    # Run specific test file
npm test -- --coverage      # Generate coverage report (target: 80%)
```

Test structure:
- `tests/contract/` - Schema validation, interface contracts (TDD: write first)
- `tests/unit/` - Component isolation tests
- `tests/integration/` - End-to-end workflows (real git operations)

### Building & Running
```powershell
npm run build              # Compile TypeScript to dist/
yb run -c suite.yaml       # Run evaluation
yb report --from results.json --format markdown
```

**Critical**: `npm run build` copies `agentic-judge.template.md` to `dist/evaluators/prompts/` - required for agentic-judge evaluator

### Adding New Evaluators
1. Create class implementing `Evaluator` interface in `src/evaluators/`
2. Add to `getEvaluator()` switch in `orchestrator.ts`
3. Return `EvaluationResult` with: `evaluator`, `status`, `metrics`, `message`, `duration_ms`, `timestamp`
4. Use `status: 'skipped'` for recoverable errors (don't throw unless fatal)
5. Write contract tests in `tests/contract/evaluator.test.ts`

### Adding New Agent Adapters
1. Create class implementing `AgentAdapter` interface in `src/adapters/`
2. Implement `checkAvailability()` (verify CLI installed, authentication)
3. Implement `execute()` (run agent, capture output, handle timeout)
4. Implement `normalizeLog()` (parse agent output → `YouBenchaLog` schema)
5. Add to `getAgentAdapter()` switch in `orchestrator.ts`
6. Write contract tests in `tests/contract/adapter.test.ts`

## Code Conventions

### TypeScript Patterns
- **ES Modules**: Use `.js` extensions in imports (`import { foo } from './bar.js'`)
- **Strict Mode**: All compiler strictness flags enabled
- **Zod Schemas**: Define schemas first, infer types with `z.infer<typeof schema>`
- **Error Handling**: Custom error classes (`WorkspaceError`, `DiffAnalyzerError`) with error codes

### Logging
- Use `src/lib/logger.ts` utilities: `logger.info()`, `logger.warn()`, `logger.error()`
- Default: `INFO` level with `[youBencha]` prefix
- Avoid timestamps in logs (configurable via `LoggerConfig`)

### File Naming
- Kebab-case for files: `git-diff.ts`, `expected-diff.ts`, `copilot-cli.ts`
- Match evaluator/adapter names to file names

### Documentation
- JSDoc on all public interfaces, classes, exported functions
- Include `@param`, `@returns`, `@throws` where applicable
- Purpose header comment on every file

## Security & Resource Management

**Repository Validation**: Suite schema rejects `localhost`, `127.0.0.1`, `192.168.*`, `10.*`, `172.16.*` (prevent SSRF)

**Workspace Isolation**: All operations in `.youbencha-workspace/` - never mutate user's working directory

**Timeouts**: Default 5min for git operations, configurable via `timeout` in suite config

**Cleanup**: Workspace cleanup is critical - uses try/finally to ensure removal even on errors

## Key Files Reference

- `src/schemas/` - Zod schemas for configuration/results validation
- `src/cli/commands/` - CLI command implementations (`run.ts`, `report.ts`, `suggest-suite.ts`)
- `src/lib/` - Shared utilities (logger, diff-utils, path-utils, progress spinners)
- `src/evaluators/prompts/` - Prompt templates for agentic evaluators
- `examples/` - Example suite configurations

## Common Pitfalls

❌ **Don't** use `.ts` in imports - must use `.js` for ES modules  
❌ **Don't** run evaluators serially - use `Promise.allSettled()` for parallelization  
❌ **Don't** forget workspace cleanup - memory/disk leaks  
❌ **Don't** throw errors from evaluators for recoverable issues - return `status: 'skipped'`  
✅ **Do** validate with Zod before using external input  
✅ **Do** handle Git errors gracefully (network issues, auth failures)  
✅ **Do** write contract tests first (TDD approach)
