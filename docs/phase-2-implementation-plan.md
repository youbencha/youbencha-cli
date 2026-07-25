# Phase 2 implementation plan: experiments and regression detection

**Status:** Proposed  
**Target duration:** 4–8 weeks  
**Depends on:** Phase 0 and Phase 1  
**Primary outcome:** One command can compare multiple agent variants across
multiple tasks and repetitions, resume interrupted work, and fail CI on a
configured regression.

## 1. Scope

Phase 2 adds an experiment layer above the existing single-test-case
orchestrator. Existing test-case files, evaluators, result bundles, and
`yb run`/`yb eval` behavior remain supported.

In scope:

- experiment definitions containing test cases, variants, repetitions, and
  execution policy;
- deterministic experiment planning and stable run identity;
- bounded concurrent execution, budgets, retries, cancellation, and resume;
- aggregate metrics and comparisons against named baselines;
- JSON, Markdown, and JUnit experiment reports;
- provenance sufficient to reproduce or explain each experiment cell;
- documented regression exit behavior.

Out of scope:

- a hosted dashboard or control plane;
- distributed scheduling across machines;
- a public plugin marketplace;
- container or VM isolation;
- statistical claims that cannot be supported by the available sample size;
- changing evaluator scoring semantics.

## 2. Product contract

### Commands

```text
yb experiment validate <experiment.yaml>
yb experiment plan <experiment.yaml> [--json]
yb experiment run <experiment.yaml> [--resume <experiment-id>]
yb experiment compare <candidate> --baseline <baseline>
yb experiment approve <experiment-id> --name <baseline-name>
yb experiment report <experiment-id> --format markdown|json|junit
```

`plan` is read-only and must show the expanded task/variant/repetition matrix,
estimated cell count, concurrency, budgets, and redacted effective
configuration.

`run` creates a durable experiment directory before starting any cell. Reusing
the same experiment definition without `--resume` creates a new experiment ID.

### Exit codes

The established CLI exit-code meanings remain stable:

- `0`: experiment completed and all configured regression policies passed;
- `1`: invalid configuration or experiment infrastructure failure;
- `2`: one or more required cells/evaluators or regression policies failed;
- `3`: experiment is incomplete because required cells were skipped,
  cancelled, or exhausted retries.

The experiment summary must state the final status and exit code. A comparison
failure must identify the metric, threshold, task, and variant that caused it.

### Initial experiment definition

```yaml
version: 1
name: authentication-agent-comparison

testcases:
  - id: add-auth
    file: ./testcases/add-auth.yaml
  - id: fix-auth-bug
    file: ./testcases/fix-auth-bug.yaml

variants:
  - name: copilot-default
    agent:
      type: copilot-cli
  - name: claude-sonnet
    agent:
      type: claude-code
      model: sonnet

repetitions: 3

execution:
  max_concurrent: 2
  retry:
    max_attempts: 2
    on: [infrastructure_failure, timeout]

budget:
  max_duration_minutes: 60
  max_cost_usd: 20

baseline:
  name: last-approved

regression:
  min_pass_rate: 0.8
  max_pass_rate_drop: 0.05
  max_duration_increase_percent: 20
```

Paths resolve relative to the experiment file. Variant agent values override
the referenced test case's agent configuration through the same typed,
effective-config pipeline used by `run` and `validate`.

## 3. Architecture

Keep the existing `Orchestrator` responsible for one run. Add a separate
experiment layer:

```text
experiment file
  -> loader and schema validation
  -> deterministic matrix planner
  -> durable manifest/state store
  -> bounded scheduler
       -> existing Orchestrator.runEvaluation()
  -> result normalizer and aggregator
  -> baseline comparator
  -> JSON / Markdown / JUnit reporters
```

Suggested source layout:

```text
src/
  experiments/
    loader.ts
    planner.ts
    scheduler.ts
    state-store.ts
    aggregator.ts
    comparator.ts
    budget.ts
    provenance.ts
  reporters/
    experiment-json.ts
    experiment-markdown.ts
    junit.ts
  schemas/
    experiment.schema.ts
    experiment-result.schema.ts
  cli/commands/
    experiment.ts
```

Avoid putting matrix scheduling into `core/orchestrator.ts`. The experiment
scheduler should depend on a small single-run interface so unit tests can use a
fake runner.

## 4. Data contracts

### Stable identity

Each planned cell is uniquely identified by:

```text
SHA-256(
  experiment schema version +
  normalized experiment definition +
  test-case ID and resolved config hash +
  variant name and resolved overrides +
  repetition index
)
```

An experiment ID identifies one invocation. A cell ID identifies the logical
matrix cell and is stable across resume. An attempt ID identifies a particular
retry.

Never include secrets or absolute workspace paths in identity inputs.

### Durable state

Write state atomically after every transition:

```text
results/experiments/<experiment-id>/
  experiment.json
  state.json
  results.json
  report.md
  junit.xml
  cells/
    <cell-id>/
      attempt-1/
        results.json
        report.md
```

Cell states:

- `pending`
- `running`
- `passed`
- `failed`
- `partial`
- `infrastructure_failed`
- `cancelled`

On resume, a persisted `running` cell is treated as interrupted and becomes
retryable. Completed cell results are schema-validated before reuse. Invalid or
missing artifacts must not silently count as completed.

### Experiment results

The versioned experiment result schema should contain:

- experiment and schema versions;
- experiment ID, definition hash, start/end time, and final status;
- redacted effective configuration;
- source test-case config hashes and source commit SHAs;
- exact agent CLI version and requested/resolved model when available;
- every cell, attempt, result path, and terminal reason;
- aggregate metrics by experiment, test case, and variant;
- baseline identity and comparison findings;
- whether usage/cost values are `measured`, `estimated`, or `unavailable`;
- reporter artifacts and warnings.

Do not mutate the existing `1.0.0` single-run result schema in place. Add
optional provenance to a backward-compatible minor schema or introduce an
explicit next version with a tested reader for both versions.

## 5. Metrics and comparison policy

The first release should aggregate only well-defined values:

- required-cell completion rate;
- evaluator pass rate;
- overall pass rate;
- duration: count, minimum, median, mean, p95, maximum;
- token and cost totals when supplied by an adapter;
- measured/estimated/unavailable coverage;
- repeated-trial dispersion using standard deviation and range.

Show sample size beside every aggregate. Do not present p95 for fewer than 20
observations; use `unavailable` with an explanation.

Regression policies are evaluated at explicit scopes:

- experiment-wide;
- per variant;
- per test case;
- per test-case/variant pair.

Missing baseline data must produce `partial`, not an implicit pass. Absolute and
relative thresholds must define zero-baseline behavior in the schema.

## 6. Work breakdown

### Milestone 2.1 — Contracts and planning

Deliver:

- experiment and result Zod schemas;
- loader with relative-path resolution and actionable validation;
- deterministic matrix planner;
- `experiment validate` and `experiment plan`;
- published example experiment;
- contract tests and generated help text.

Acceptance:

- duplicate task IDs, variant names, invalid overrides, and empty matrices fail;
- plan order and cell IDs are stable across operating systems;
- plan performs no clones or agent execution;
- all paths and errors identify their declaring file.

### Milestone 2.2 — Scheduler, persistence, and resume

Deliver:

- experiment state store using atomic replace;
- bounded scheduler using the existing concurrency utility;
- retry classification and backoff;
- duration and cost budget enforcement;
- graceful `Ctrl+C` handling;
- `experiment run` and `--resume`;
- test seam for a fake single-run executor.

Acceptance:

- concurrency never exceeds the configured maximum;
- completed cells are not rerun after interruption;
- only configured transient failures retry;
- stopping a budget prevents new cells from starting and preserves results;
- SIGINT leaves resumable state and returns partial status.

### Milestone 2.3 — Aggregation and provenance

Deliver:

- adapter usage/provenance fields with measured-state metadata;
- experiment aggregation by all supported scopes;
- deterministic JSON output;
- warnings for incomparable or missing measurements.

Acceptance:

- aggregate totals can be traced to individual cells;
- mixed measured/estimated data is never represented as wholly measured;
- aggregation is independent of cell completion order;
- schema validation covers old and new single-run bundles.

### Milestone 2.4 — Baselines and regression policy

Deliver:

- immutable named-baseline manifest stored locally;
- `compare` and `approve` commands;
- absolute and relative regression rules;
- clear comparison diagnostics and exit-code mapping.

Acceptance:

- approving a baseline copies or references immutable content by hash;
- a modified baseline is detected;
- regression fixtures reliably exercise pass, fail, and partial outcomes;
- candidates with different task/variant keys report unmatched cells.

### Milestone 2.5 — Reports and CI integration

Deliver:

- experiment Markdown overview with drill-down links;
- machine-readable JSON report;
- JUnit reporter mapping cells or policies to test cases;
- CI documentation and example workflow;
- terminal summary with exact artifact paths.

Acceptance:

- JUnit XML validates and displays useful failures in GitHub Actions;
- Markdown safely escapes user-controlled values;
- reports are byte-stable for fixed timestamps and fixtures;
- the package dry run includes schemas, examples, and documentation.

## 7. Verification strategy

### Unit tests

- schema refinements and override merging;
- identity generation and normalized ordering;
- scheduler concurrency, retry classification, and budget decisions;
- state transitions and atomic recovery;
- statistics and regression math;
- JUnit/XML escaping.

### Contract tests

- versioned experiment definitions and results;
- backward-compatible single-run readers;
- example validation;
- stable exit codes;
- reporter snapshots with normalized paths and timestamps.

### Integration tests

Use local Git fixtures and fake agent adapters:

- two tasks × two variants × two repetitions;
- interruption followed by resume;
- transient failure followed by successful retry;
- time and cost budget exhaustion;
- candidate/baseline pass and regression;
- Windows and POSIX path behavior.

External Copilot/Claude runs remain opt-in and must not be part of the default
release gate.

## 8. Rollout and compatibility

1. Ship schemas, validation, and planning behind no experimental runtime flag.
2. Mark `experiment run` as beta for one minor release.
3. Keep baseline storage local and explicit; do not auto-approve.
4. Publish schema-version and exit-policy documentation before declaring the
   feature stable.
5. Collect user feedback on report shape and policy expressiveness before
   freezing a Phase 3 plugin contract around experiment hooks.

Existing commands and result readers must continue to work. Any single-run
schema addition should be optional or handled through a new version plus
migration-aware readers.

## 9. Definition of done

- One command executes at least two variants across multiple tasks and repeats.
- Interrupted work resumes without duplicating validated completed cells.
- Concurrency, retry, time, and cost policies have deterministic tests.
- Aggregate values trace back to source cells and label measurement quality.
- Named baselines are immutable and regression rules reliably control CI exit.
- JSON, Markdown, and JUnit outputs are generated automatically.
- Lint, build, offline tests, package dry run, and supported Node/OS CI pass.
- Documentation includes local comparison and CI regression workflows.

