# youBencha repository usability review and product roadmap

**Review date:** 2026-07-24  
**Repository state:** `main` at `d756aff`  
**Package version:** `0.1.5-beta`

## Implementation update — July 24, 2026

The P0 and P1 work proposed in this review has now been implemented in the
working tree:

- CLI outcomes use stable exit codes, and generated result/report paths are
  printed explicitly.
- `run`, `eval`, and `validate` share effective configuration loading,
  substitution, path resolution, and evaluator validation.
- Runtime limits, evaluator concurrency, model defaults, logging settings, and
  workspace retention behavior are applied consistently.
- `youbencha doctor` and `youbencha init --minimal` provide a faster,
  offline-friendly onboarding path.
- Tests use local fixtures and opt-in external-agent probes, and package/release
  checks are gated and reproducible with a committed lockfile.
- Published documentation and example configurations are verified by automated
  tests.

The repository-wide formatting baseline remains intentionally unresolved:
`npm run format:check` currently reports 94 pre-existing files. New and changed
TypeScript files in this implementation were formatted without performing a
broad, unrelated rewrite.

## Executive summary

youBencha has the foundations of a useful developer tool. It can clone a
repository into a dedicated run workspace, execute one of two coding-agent
CLIs, evaluate the resulting changes, preserve normalized logs and artifacts,
and render machine-readable or Markdown results. The separation between
adapters, evaluators, orchestration, schemas, hooks, and reporters is a good
base for continued development.

The strongest current use case is:

> Run one coding agent on one task, apply a small set of checks, and retain an
> inspectable result bundle.

The product is less complete as a benchmarking or comparison platform than its
README and CLI description imply. There is no first-class suite or experiment
runner, no aggregate comparison across agents or repeated trials, no regression
history, and no reliable CI failure contract. In its current form, youBencha is
best described as an **agent evaluation runner** rather than an end-to-end
benchmarking system.

The next investment should focus on trust before breadth:

1. Make installs, tests, configuration, exit codes, and release checks
   deterministic.
2. Make the first successful evaluation easy and accurately documented.
3. Add first-class experiment, comparison, and regression workflows.
4. Only then broaden the adapter/evaluator ecosystem and isolation options.

## What is already good

### 1. The core workflow is coherent

The CLI presents a recognizable progression:

- `yb init` creates a starter test case and judge agent files.
- `yb validate` catches syntax and schema problems before a paid run.
- `yb run` performs agent execution plus evaluation.
- `yb eval` evaluates existing output without rerunning an agent.
- `yb report` renders stored results.
- `yb list` helps users discover built-in evaluators.

The separate `eval` command is particularly useful. It lets users tune
evaluation criteria, evaluate manual changes, and integrate output produced
outside youBencha without paying for another agent run.

### 2. Results are designed for inspection and automation

Each run records structured metadata, evaluator outcomes, a configuration hash,
environment details, normalized agent logs, and evaluator artifacts. The JSON
result schema is a useful compatibility surface, while the Markdown reporter
makes a run reviewable by a person.

Keeping workspaces by default is a sensible beta choice because users can
inspect the actual code and diagnose surprising scores.

### 3. Evaluation combines objective and qualitative signals

The three built-in evaluator families cover complementary needs:

- `git-diff` measures scope and can enforce size or focus thresholds.
- `expected-diff` compares output with a known reference.
- `agentic-judge` evaluates task-specific criteria that are difficult to reduce
  to simple static metrics.

Reusable evaluator files, external prompt files, and multiple focused judges
are good composability features. They keep larger test cases manageable and
allow teams to standardize quality criteria.

### 4. The internal architecture has useful boundaries

Agent-specific execution is isolated in adapters, evaluator behavior is
separated from orchestration, and configuration/result shapes are represented
with Zod. Pre-execution and post-evaluation hooks provide practical extension
points for setup, notification, and result export.

Although new adapters and evaluators still require core registration changes,
the existing organization makes that evolution tractable.

### 5. Several important safety controls exist

The implementation uses argument arrays and `shell: false` for primary process
execution paths, applies timeouts and output limits to agent processes, checks
artifact paths, limits workspace traversal, and rejects obvious private or
loopback repository URLs. The README also warns that test configurations and
agents execute code.

These controls do not amount to a security sandbox, but they show that the
project is treating execution risk as a first-class concern.

### 6. The test surface is substantial for a beta

The repository contains unit, contract, and integration coverage for schemas,
adapters, evaluators, configuration, orchestration, reporting, and CLI commands.
A focused verification run completed successfully:

- `npm run build`: passed
- CLI help and evaluator listing: passed
- 43 focused CLI, configuration-loader, and Markdown-reporter tests: passed

The dated maintenance review also records a passing compiler and linter, 696
passing tests in the broader environment-limited run, and a successful package
dry run.

## Usability assessment

### First-time user

The happy path is understandable, but it is more fragile than it appears.
`yb init` creates a relatively advanced, network-dependent example that
requires an installed and authenticated agent CLI and invokes an AI judge. That
is a large first-run dependency chain for someone who only wants to confirm
that installation worked.

Documentation drift adds friction:

- The README links to a root `GETTING-STARTED.md`, while the file is under
  `docs/`.
- `package.json` packages the same nonexistent root path.
- The README and getting-started guide reference
  `examples/testcase-simple.yaml` and `.json`, which do not exist.
- The README's quick-start JSON contains an invalid multiline URL string.
- The getting-started guide documents `file://` repositories, but the active
  test-case schema only accepts public HTTP(S) URLs.
- The starter template says Copilot CLI is the only supported agent even though
  Claude Code is supported.

These are individually small, but together they undermine confidence at the
moment users are deciding whether to adopt the tool.

### Test-case author

YAML/JSON support, Zod errors, prompt files, evaluator files, and verbose
validation are helpful. However, validation does not currently model the real
run closely enough:

- `yb run` loads project/user configuration and substitutes variables;
  `yb validate` does not.
- Evaluator names are free-form. Unknown evaluators can pass schema validation
  and later become `skipped` results.
- Most agent and evaluator configuration is accepted through open-ended
  records, so misspelled or unsupported keys are often not caught early.
- Invalid project/user configuration is warned about and then ignored, which
  can make a run silently use defaults.
- There is no equivalent validation command for an `eval` configuration.

Validation should answer “will this run as intended?”, not only “does this
document satisfy the outer schema?”

### CI adopter

The structured results are a good starting point, but CI behavior is not yet
safe to depend on. Both `yb run` and `yb eval` exit with code 0 after a completed
run even when evaluators report failures. A skipped or unknown evaluator can
produce a partial result and still exit successfully. This makes a green job
ambiguous and prevents the CLI from acting as a dependable quality gate.

Several documented global settings also do not affect execution:

- `timeout_ms`, `agent.timeout_ms`, `agent.model`, and `log_level` are loaded but
  not applied by `run`.
- `evaluators.max_concurrent` is passed into the orchestrator but is not used;
  evaluators are launched together with `Promise.allSettled`.

The configuration surface therefore promises controls that the runtime does
not enforce.

Repository CI is also not reproducible from `HEAD`: workflows use `npm ci`, but
`package-lock.json` is ignored and untracked. The default test suite contains
live GitHub clones and literal `/tmp` paths that fail in offline or Windows
environments. These problems are already captured in
`docs/maintenance-status.md` and should be treated as product trust issues, not
only maintainer inconvenience.

### Benchmark owner

The result bundle is useful for one run, but a benchmark owner needs
experiments:

- multiple test cases;
- multiple agent/model configurations;
- repeated trials to expose nondeterminism;
- concurrency and cost budgets;
- aggregate pass rates, latency, cost, and variance;
- comparison with a named baseline;
- regression thresholds and a CI outcome;
- resumability after partial failures.

None of these is first-class today. Users can script them around `yb run`, but
they must invent result discovery, aggregation, retry, and comparison behavior.
This is the largest gap between current capability and the advertised promise
to “evaluate and compare AI coding agents.”

### Maintainer and extension author

The source layout is approachable and contract tests are a strong foundation.
The main limitation is that “pluggable” currently describes code organization,
not a public plugin mechanism. Adding an adapter, evaluator, hook, or reporter
requires editing schemas and factory switches in the core package.

There is also duplicated legacy terminology and schema behavior. The deprecated
`suite.schema.ts` still defines a different Copilot-only shape and remains
widely imported by tests, while the active test-case schema exports its own
suite aliases. This increases the chance that tests validate a compatibility
surface that production no longer uses.

## Highest-priority improvements

| Priority | Improvement | User value | Relative effort |
| --- | --- | --- | --- |
| P0 | Return documented nonzero exit codes for failed/partial quality gates | Makes CI results trustworthy | Small |
| P0 | Apply every supported global setting or remove it | Restores configuration predictability | Small–medium |
| P0 | Commit a lockfile policy and make default tests offline/cross-platform | Makes installs and releases reproducible | Medium |
| P0 | Remove unconditional debug output and route diagnostics through the logger | Reduces noise and accidental prompt/output disclosure | Small |
| P0 | Repair onboarding links, examples, package contents, and contradictory claims | Improves first-run success and credibility | Small |
| P1 | Make validation resolve the effective config, evaluator files, prompts, names, and optional tool availability | Prevents wasted paid runs | Medium |
| P1 | Add `yb doctor` and a minimal offline/local smoke workflow | Shortens diagnosis and time to first value | Medium |
| P1 | Generate a Markdown report automatically and print direct artifact paths | Removes an unnecessary follow-up step | Small |
| P1 | Add typed schemas and discoverable help for each built-in evaluator/adapter | Makes configuration self-teaching | Medium |
| P2 | Add suite/experiment execution, repeats, aggregation, and baseline comparison | Delivers the core benchmarking promise | Large |
| P2 | Add JUnit and/or SARIF output plus explicit regression policies | Deepens CI integration | Medium |
| P3 | Add a public registry/plugin API for adapters, evaluators, hooks, and reporters | Enables ecosystem growth without core forks | Large |
| P3 | Add opt-in container/VM execution providers and clear isolation profiles | Makes untrusted evaluation safer | Large |

## Specific product and engineering recommendations

### Make outcomes unambiguous

Define and test a stable exit-code contract. A reasonable default is:

- `0`: all required evaluators passed;
- `1`: execution/configuration/tool failure;
- `2`: one or more required evaluators failed;
- `3`: incomplete or partial result caused by skipped required evaluators.

If backward compatibility requires completed runs to keep returning 0, add an
explicit `--fail-on failed|partial|never` option immediately and make
`failed` the default in the next major version. Allow evaluators to be marked
optional so a missing best-effort signal does not fail the whole experiment.

The terminal summary should distinguish:

- agent execution status;
- evaluation status;
- post-evaluation/export status;
- final CLI outcome and exit code.

### Make configuration honest

Create one “effective configuration” pipeline shared by `validate`, `run`, and
`eval`. It should:

1. load defaults, user settings, project settings, and command-line overrides;
2. substitute variables and report unresolved placeholders;
3. resolve prompt and evaluator files relative to the declaring config;
4. validate adapter/evaluator-specific schemas;
5. apply agent model, timeout, log level, concurrency, and paths;
6. display the redacted effective configuration in verbose or dry-run mode.

Unknown keys should normally fail with a “did you mean?” suggestion. Invalid
configuration should not silently fall back to defaults.

### Improve the first ten minutes

Add a `yb doctor` command that checks Node, Git, supported agent CLIs,
authentication where possible, writable workspace paths, agent files, and
effective configuration.

Offer two initialization modes:

- `yb init --minimal`: a small, inexpensive configuration with only objective
  evaluation and a local fixture or explicit local repository;
- `yb init --guided`: selects an installed agent, asks for a repository and
  task, and adds AI judging only when requested.

End a successful `run` by generating `report.md` automatically and printing the
exact results, report, agent log, diff, and retained workspace paths. Avoid
requiring shell glob expansion in copy-pasted commands, especially on Windows.

### Turn single runs into experiments

Introduce an experiment file rather than overloading a test case:

```yaml
name: authentication-agent-comparison

testcases:
  - ./testcases/add-auth.yaml
  - ./testcases/fix-auth-bug.yaml

variants:
  - name: copilot-default
    agent:
      type: copilot-cli
  - name: claude-sonnet
    agent:
      type: claude-code
      model: sonnet

repetitions: 3
concurrency: 2
budget:
  max_cost_usd: 20
  max_duration_minutes: 60

baseline: ./results/last-approved-experiment.json
regression:
  min_pass_rate: 0.8
  max_pass_rate_drop: 0.05
```

An initial `yb experiment run` can orchestrate existing test-case execution
without changing evaluator internals. Follow it with:

- `yb experiment compare`;
- aggregate Markdown and JSON reports;
- per-task/per-variant pass rate, duration, token, and cost summaries;
- variance and confidence indicators for repeated trials;
- retry/resume with stable run IDs;
- baseline approval and regression exit policies.

This feature provides more user value than adding many more one-off evaluators.

### Strengthen reporting and provenance

Extend result bundles with:

- a stable run/experiment ID;
- resolved adapter CLI version and exact model identifier;
- source and expected commit SHAs;
- redacted effective configuration;
- invocation metadata and exit policy;
- explicit post-evaluation results;
- whether token/cost numbers are measured or estimated;
- schema version migration support.

Reports should link to artifacts, escape table content safely, summarize
violations before raw metrics, and make skipped results visually prominent.
JUnit is the most direct next format for CI; SARIF is useful if evaluator
findings can include file and line locations.

### Clarify the security model

Replace broad “isolated workspace” language with precise guarantees:

- a separate directory is created;
- agent processes currently execute on the host;
- Claude Code may be run with permission bypass enabled;
- trusted pre/post scripts can execute arbitrary commands;
- repository and agent code must be treated as untrusted unless run inside an
  external sandbox.

Then add explicit execution profiles:

- `host-trusted`;
- `container`;
- a future VM/remote runner.

The profile, network policy, mounts, environment allowlist, and resource limits
should be recorded in results. Secrets should be passed through an explicit
allowlist and redacted from logs and effective configuration.

### Prepare for a real extension ecosystem

After experiment workflows stabilize, replace core switches with registries and
publish versioned interfaces for adapters, evaluators, hooks, and reporters.
Plugins should declare:

- name and version;
- compatible youBencha API version;
- Zod/JSON schema for configuration;
- capability and security requirements;
- artifact and result contracts.

Start with local package-based registration. A marketplace or remote plugin
installation is unnecessary until the interface has proven stable.

## Proposed roadmap

### Phase 0: Trustworthy beta foundation (1–2 weeks)

**Goal:** A green command means what users think it means.

- Define evaluator/partial exit codes and add CLI integration tests.
- Apply or remove every documented global setting.
- Enforce evaluator concurrency rather than only storing the option.
- Share effective-config handling between validation and execution.
- Route debug output through the logger and redact prompt/output details.
- Commit and enforce the chosen lockfile policy.
- Replace live default test repositories with local Git fixtures and use
  `os.tmpdir()`.
- Normalize line endings in a dedicated mechanical change.
- Repair release gates, version/tag handling, and packaged documentation.
- Fix active README/getting-started links and validate every published example.

**Exit criteria:**

- Clean `npm ci`, lint, build, format check, package dry run, and offline tests
  pass on Node 20 and 22 across Windows, macOS, and Linux.
- A deliberately failing evaluator produces the documented nonzero exit code.
- Every documented config key has a runtime behavior test.
- Automated link and example-validation checks run in CI.

### Phase 1: Excellent first-run and authoring experience (2–4 weeks)

**Goal:** A new user reaches a meaningful result without repository archaeology.

- Add `yb doctor`, `yb validate --check-tools`, and eval-config validation.
- Add minimal and guided initialization.
- Support an explicit, safe local-repository workflow or remove that claim.
- Generate the default Markdown report as part of a run.
- Add per-adapter and per-evaluator configuration schemas and help.
- Improve errors with config paths, suggestions, and actionable remediation.
- Document a short local workflow, a CI workflow, and an AI-judge workflow as
  three separate paths.

**Exit criteria:**

- A fresh user can install, diagnose, initialize, validate, run, and read a
  report in under ten minutes.
- The minimal smoke path does not require network access or a paid model.
- Invalid names and configuration keys fail before agent execution.

### Phase 2: Experiments, comparison, and regression detection (4–8 weeks)

**Goal:** Deliver the product’s central benchmarking value.

See the detailed [Phase 2 implementation plan](./phase-2-implementation-plan.md)
for proposed commands, schemas, architecture, milestones, acceptance criteria,
and rollout sequencing.

- Add experiment definitions with test-case and agent/model matrices.
- Add repeated trials, controlled concurrency, cost/time budgets, retry, and
  resume.
- Aggregate pass rate, latency, cost, token usage, and variance.
- Add named baselines and regression rules.
- Add experiment comparison reports and JUnit output.
- Record stronger provenance and measured-versus-estimated usage.

**Exit criteria:**

- One command compares at least two variants across multiple tasks and repeats.
- Interrupted experiments resume without rerunning completed cells.
- A configured regression reliably fails CI and identifies the responsible
  task/variant/metric.

### Phase 3: Safe scale and ecosystem (8–12+ weeks)

**Goal:** Let teams extend and operate youBencha without maintaining a fork.

See the detailed [Phase 3 implementation plan](./phase-3-implementation-plan.md)
for the registry and plugin contracts, execution-provider architecture,
container security model, milestones, and compatibility gates.

- Publish versioned adapter, evaluator, hook, and reporter registries.
- Support locally installed package plugins.
- Add container execution with explicit network, mount, secret, and resource
  controls.
- Add private-repository authentication without embedding credentials in
  config or artifacts.
- Add optional integrations for result storage and notifications.
- Define schema migration and deprecation policy before a stable 1.0 release.

**Exit criteria:**

- A third party can add an evaluator and its config help without editing core.
- The same experiment can run under host and container profiles with the
  profile captured in results.
- Result schemas and extension APIs have documented compatibility guarantees.

## Measures of progress

Track product outcomes, not only feature completion:

| Measure | Suggested target |
| --- | --- |
| Time from install to first readable local report | Under 10 minutes |
| Default test reliability on supported OS/Node matrix | 100% without live services |
| Published example validity | 100% parsed and schema-validated in CI |
| Broken active documentation links | 0 |
| Documented config keys covered by runtime tests | 100% |
| CI outcome correctness for failed/partial runs | 100% |
| Runs ending in unexplained `skipped` evaluators | Under 1% |
| Experiment resume without duplicate completed work | 100% |
| Result bundles with exact agent/model/source provenance | 100% |
| Repeat users who run more than one experiment | Primary adoption indicator |

If telemetry is ever added, it should be opt-in, documented, and collect only
the minimum anonymous product events needed to measure these outcomes.

## Recommended product positioning

For the next beta, use a narrower and more credible promise:

> youBencha runs repeatable coding-agent tasks, evaluates the resulting changes,
> and produces inspectable, CI-ready evidence.

Once Phase 2 ships, the stronger benchmarking promise becomes accurate:

> youBencha compares coding agents across tasks and repeated trials, tracks
> quality, cost, and latency, and catches regressions before they ship.

## Review scope and limitations

This review used the current implementation under `src/`, active Zod schemas,
CLI output, tests, examples, README, focused documentation, package metadata,
CI/release workflows, and `docs/maintenance-status.md`. Historical feature specs
were not treated as current behavior.

The build, CLI help/list commands, and 43 focused tests were executed during the
review. Live Copilot/Claude runs, network-dependent tests, the full test suite,
and npm publishing were intentionally not run. Recommendations about agent
quality and runtime cost therefore concern the product workflow and recorded
data model, not a comparative measurement of the external agents themselves.
