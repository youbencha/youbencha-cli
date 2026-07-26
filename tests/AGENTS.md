# Test-suite guidance

This file supplements the root `AGENTS.md` for work under `tests/`.

## Test categories

- `unit/`: component behavior with dependencies isolated. New unit tests should
  not clone remote repositories or require installed agent CLIs.
- `contract/`: public schemas and adapter/evaluator/reporter interface behavior.
- `integration/`: command and multi-component flows. Prefer local temporary Git
  repositories and deterministic fixtures.

Keep a behavior in the narrowest category that proves it. When changing a public
schema or extension interface, add a contract test even if unit coverage exists.

## Running tests

```powershell
npm test -- tests/unit/<name>.test.ts --runInBand
npm test -- tests/contract/<name>.test.ts --runInBand
npm test -- tests/integration/<name>.test.ts --runInBand
npm test -- --runInBand
npm test -- --coverage --runInBand
```

Run targeted files during development. Run the full suite for cross-cutting
changes when the environment permits it. Coverage thresholds are enforced only
when coverage collection is requested.

Real agent execution is opt-in:

- `COPILOT_CLI_INTEGRATION_TESTS=1` enables tests that invoke Copilot CLI.
- `CLAUDE_CODE_INTEGRATION_TESTS=1` enables tests that invoke Claude Code.
- `CODEX_CLI_INTEGRATION_TESTS=1` enables the bounded Codex CLI live smoke
  test. `CODEX_CLI_INTEGRATION_MODEL` optionally selects its model.

Do not set these variables unless the corresponding CLI is installed,
authenticated, and the task calls for live integration testing.

## Known baseline hazards

- `tests/unit/orchestrator.test.ts` clones
  `https://github.com/octocat/Hello-World.git`; despite its location, it needs
  network access.
- `tests/integration/run-command.test.ts` also uses that remote repository.
- Several Claude Code suites construct paths under literal `/tmp`. On Windows
  that resolves to `C:\tmp` and can fail before their runtime skip logic.
- The full suite is consequently not a reliable offline or sandboxed gate today.
  Distinguish product failures from network, permissions, missing-CLI, and
  platform-path failures in the final report.

When touching these tests, improve hermeticity rather than adding more exceptions:
create a local temporary Git fixture, use `os.tmpdir()`, and place skip logic
before setup that requires the optional dependency.

## Test conventions

- Use `fs.mkdtemp(path.join(os.tmpdir(), '<specific-prefix>-'))`.
- Clean up only the exact temporary directory created by the test, normally in
  `afterEach` or `afterAll`.
- Avoid fixed timestamps, ports, global paths, and shared workspace names.
- Mock process execution at the adapter or shell utility boundary for unit tests.
- Assert normalized structured results, not incidental console formatting.
- Keep tests cross-platform: avoid shell-specific syntax and path separators
  unless the test explicitly covers that platform behavior.
- Never weaken an assertion merely to accommodate a sandbox or unavailable
  external service; make the dependency explicit or replace it with a local fixture.
