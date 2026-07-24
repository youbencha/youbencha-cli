# youBencha agent guide

youBencha is a Node.js 20+ TypeScript CLI for running coding agents in isolated
workspaces and evaluating their changes. The package is ESM and exposes the
`youbencha` and `yb` binaries from `dist/cli/index.js`.

## Sources of truth

- Treat `package.json`, the implementation under `src/`, Zod schemas, and tests
  as authoritative for current behavior.
- Use `README.md` and `docs/` for user-facing intent, but verify examples against
  the implementation when changing behavior.
- Treat `specs/` as historical feature design unless a task explicitly activates
  a spec.
- `.specify/memory/constitution.md` and `.github/copilot-instructions.md` contain
  useful architectural intent, but parts are stale or aspirational. Do not make
  the code conform to them without confirming the requested scope.
- Read `docs/maintenance-status.md` for the dated baseline and known maintenance
  risks. Re-run relevant checks instead of assuming that snapshot is still current.

## Repository map

- `src/cli/`: Commander entry point and command handlers.
- `src/core/`: orchestration, workspace lifecycle, storage, and diff analysis.
- `src/adapters/`: coding-agent integrations. Each implements `AgentAdapter`.
- `src/evaluators/`: evaluation implementations. Each implements `Evaluator`.
- `src/pre-execution/` and `src/post-evaluation/`: configurable lifecycle hooks.
- `src/schemas/`: Zod schemas and inferred public types.
- `src/reporters/`: JSON and Markdown result renderers.
- `src/lib/`: shared parsing, path, shell, logging, and loading utilities.
- `tests/{unit,contract,integration}/`: Jest suites. Read `tests/AGENTS.md` before
  modifying or running tests.
- `examples/`: public YAML/JSON configurations that should track supported schemas.
- `agents/`: agent files shipped or installed by the CLI.
- `dist/`, `.youbencha-workspace/`, `.youbencha-eval/`, `results/`, `artifacts/`,
  `.test-temp/`: generated or runtime data; do not hand-edit or commit them.

## Setup and common commands

Use npm and a supported Node.js version (20 or 22 are exercised by CI).

```powershell
npm install
npm run build
node dist/cli/index.js --help
```

The repository currently ignores `package-lock.json` even though CI uses
`npm ci`. Until that maintenance issue is deliberately fixed, a fresh checkout
requires `npm install`; do not silently add or remove dependency-lock policy as
part of an unrelated task.

Useful checks:

```powershell
npm run lint
npm run build
npm test -- tests/unit/<name>.test.ts --runInBand
npm run format:check
npm pack --dry-run
```

- Prefer the narrowest relevant Jest file while iterating.
- The full test suite is not currently hermetic and may need network access.
  See `tests/AGENTS.md`.
- `npm run format:check` has a known repository-wide baseline failure. Check
  changed TypeScript files with local Prettier and avoid a 100-file formatting
  rewrite unless the task is specifically to normalize formatting.
- `npm run build` must also copy
  `src/evaluators/prompts/agentic-judge.template.md` into `dist/`.

## Implementation conventions

- Keep ESM imports ending in `.js`, including imports written in `.ts` files.
- Keep TypeScript strict and avoid `any`; all unused locals and parameters fail
  the build.
- Define configuration and result shapes with Zod, infer types from schemas, and
  update contract tests when a schema changes.
- Preserve adapter boundaries: agent-specific commands and output parsing belong
  under `src/adapters/`, not in the orchestrator.
- Preserve evaluator isolation. Evaluators run concurrently and should return
  `status: 'skipped'` for recoverable precondition failures instead of bringing
  down the entire run.
- When adding an adapter, evaluator, pre-execution, or post-evaluation type,
  update its interface implementation, orchestrator factory/registry, schema,
  tests, examples, and user documentation together.
- Use `src/lib/logger.ts` rather than adding production `console.*` calls.
- Keep filesystem work inside the configured workspace and artifacts paths.
  Resolve and validate user-controlled paths before reading or writing.
- Never concatenate configuration or prompt input into shell commands. Prefer
  argument arrays and `shell: false`; preserve timeouts and output limits.
- Keep Windows, Linux, and macOS behavior in mind. Use `path` helpers and
  `os.tmpdir()` rather than POSIX-only paths.

## Documentation and compatibility

- Public CLI flags, schema fields, evaluator names, log/result formats, examples,
  and generated reports are compatibility surfaces.
- Update `README.md`, the relevant focused document under `docs/`, and examples
  whenever a user-visible behavior changes.
- Do not rewrite historical specs to match implementation after the fact.
- The active license is MIT (`LICENSE`, `package.json`, and `README.md`), despite
  stale Apache-2.0 references in planning documents.

## Definition of done

1. Inspect the diff and keep unrelated user changes intact.
2. Add or update the narrowest appropriate unit, contract, or integration tests.
3. Run the relevant targeted tests, `npm run lint`, and `npm run build`.
4. Check formatting on changed TypeScript files. Report the known global
   formatting baseline separately if `npm run format:check` is run.
5. Update public docs/examples for user-visible changes.
6. Report checks that were skipped, failed because of environment constraints,
   or require external agent CLIs/network access.

## Release safety

- Do not bump versions, create tags/releases, publish to npm, or push changes
  unless the user explicitly requests it.
- Treat `scripts/publish.ps1`, `scripts/publish.sh`, and
  `.github/workflows/publish.yml` as high-impact paths and review the complete
  release sequence before changing or invoking them.
- Use `npm pack --dry-run` to inspect package contents without publishing.

## Code review rules

- Flag command injection, path traversal, SSRF, unsafe workspace cleanup, leaked
  secrets, unbounded child processes/output, and missing timeouts as high priority.
- Flag schema changes that are not reflected in loaders, examples, docs, and
  contract tests.
- Flag default-path tests that depend on live services or installed third-party
  agent CLIs.
- Flag release changes that bypass tests, lint, provenance, version uniqueness, or
  explicit confirmation.
