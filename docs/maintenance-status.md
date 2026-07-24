# Maintenance status snapshot

Snapshot date: 2026-07-24  
Branch: `main`  
Commit: `7c81b2f9e46a4cc8f8c3fcaabae572e034ab1641`  
Package version: `0.1.5-beta`

This is a dated handoff, not permanent policy. Re-run the checks relevant to a
new task and update this document when a maintenance pass materially changes the
baseline.

## Executive summary

The project has a substantial beta implementation: 56 TypeScript source files
plus one Markdown prompt template, 44 Jest test files, 37 example files, two
agent adapters, three built-in evaluator families, lifecycle hooks, reporters,
and cross-platform CI intent.
The compiler and linter pass, and the npm package can be assembled.

The main risk is reproducibility rather than missing product structure. A clean
checkout cannot currently follow CI's `npm ci` path because the lockfile is
ignored and untracked. The default test suite also depends on live GitHub access
and contains Windows-incompatible `/tmp` setup. Release metadata and release
scripts need reconciliation before the next publish.

## Observed baseline

| Check                       | Result on 2026-07-24     | Notes                                                                                                                                                         |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`              | Pass                     | ESLint completed without findings.                                                                                                                            |
| `npm run build`             | Pass                     | TypeScript compiled and the agentic-judge prompt was copied.                                                                                                  |
| `npm pack --dry-run --json` | Pass                     | Produced a 269-entry, ~188 KB package preview. Nothing was published.                                                                                         |
| `npm run format:check`      | Fail                     | Prettier reported 100 source/test files. Git reports CRLF working-tree endings across many files, so line-ending normalization is likely a major contributor. |
| `npm test -- --runInBand`   | Environment-limited fail | 40/44 suites passed; 696 tests passed, 103 failed, and 2 were skipped. Failures included denied GitHub clones and literal `C:\tmp` creation.                  |
| Elevated full test retry    | Inconclusive             | Timed out after 185 seconds; the suite still attempted live external work.                                                                                    |
| Dependency version query    | Completed                | Multiple in-range updates and several major-version migrations are available.                                                                                 |
| Vulnerability audit         | Not run                  | The environment rejected sending the full lock graph to npm's audit service without separate user authorization.                                              |

## Priority maintenance backlog

### 1. Restore deterministic installs and CI

`.gitignore` excludes `package-lock.json`, and no lockfile exists in `HEAD`.
Both GitHub Actions workflows use `npm ci`, while `actions/setup-node` also
expects npm dependency metadata for caching.

Choose and enforce one policy:

1. Recommended for this CLI: stop ignoring `package-lock.json`, regenerate it
   intentionally, commit it, and keep `npm ci` in CI.
2. Alternatively, explicitly adopt unlocked installs and change CI/cache setup
   to match. This sacrifices deterministic dependency resolution.

Validate the chosen path from a clean checkout on Node 20 and 22.

### 2. Make the default test suite hermetic

- Replace remote `octocat/Hello-World` clones in the default path with local
  temporary Git fixtures.
- Replace literal `/tmp` with `os.tmpdir()`.
- Move optional Claude/Copilot skip decisions ahead of setup that assumes the
  CLI or platform path is available.
- Keep real agent/network tests behind explicit environment flags and consider a
  separate npm script or CI job for them.

The goal is for `npm test -- --runInBand` to work offline on Windows, Linux, and
macOS. See `tests/AGENTS.md` for the current locations.

### 3. Reconcile formatting and line endings

The repository mixes index line endings and has CRLF working-tree content while
Prettier expects LF. A dedicated formatting change should:

- define line-ending policy in `.gitattributes`;
- run Prettier once in an isolated commit;
- confirm the diff is mechanical; and
- keep subsequent feature changes free of repository-wide churn.

Do not mix the 100-file rewrite into a functional change.

### 4. Repair release safety and metadata

- `scripts/publish.ps1` has its test and lint gates commented out even though
  `scripts/README.md` and `docs/PUBLISHING.md` say they run.
- `prepublishOnly` only builds; the stronger lint/test/build command is stored
  under the unused name `prepublishOnly2`.
- Tags `v0.1.5-beta` and `v0.1.6-beta` already exist on older commits, while
  `main` currently declares `0.1.5-beta`. A future tag creation can collide or
  misrepresent the package source.
- `package.json` lists root `GETTING-STARTED.md` in package files, but the actual
  document is `docs/GETTING-STARTED.md`, so the dry-run package omits it.

Before publishing, decide the next unique version, fix the gates, verify the
package contents, and test installation from the generated tarball.

### 5. Plan dependency upgrades in compatible groups

The 2026-07-24 registry query found routine in-range updates for packages such as
`fs-extra`, `simple-git`, `ts-jest`, `yaml`, `prettier`, and `rimraf`.

Major migrations are available for key surfaces, including Commander, `diff`,
Zod, Jest/types, ESLint, typescript-eslint, Ora, TypeScript, and Node types.
Upgrade the test/lint stack as a coordinated change, and migrate runtime
dependencies one at a time with CLI/schema regression tests. Do not bulk-update
major versions in an unrelated feature.

### 6. Resolve stale governance and docs

- The active license is MIT, but `.specify/memory/constitution.md` and
  `docs/prd.md` still say Apache-2.0.
- The constitution's sync report says `SECURITY.md` must be created even though
  it exists.
- Some constitution requirements describe future container isolation and
  reproducibility guarantees that the current implementation does not provide.
- `src/core/diff-analyzer.ts` still marks rename detection as unimplemented.

Update governance documents as a deliberate decision record. Do not silently
change the active license or claim unimplemented security guarantees.

## Suggested order of work

1. Commit a deterministic lockfile policy and prove clean CI installation.
2. Make the default tests offline and cross-platform.
3. Normalize formatting/line endings in a mechanical-only change.
4. Reconcile release scripts, tags, package contents, and documentation.
5. Apply compatible dependency updates, then scoped major migrations.
6. Reassess aspirational architecture and governance against the product roadmap.
