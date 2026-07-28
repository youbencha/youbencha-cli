# Experiments

Experiments run multiple existing youBencha test cases against multiple agent
variants and repetitions. They add bounded scheduling, resumable state,
aggregate metrics, immutable named baselines, regression policies, and
CI-friendly reports without changing `yb run` or `yb eval`.

This guide covers version 1 power-user experiments. For reusable,
target-neutral tasks, model/harness swapping, mapped target comparisons, and
audited movable channels, use the
[version 2 regression workflow](./regression-suites.md).

## Define and inspect an experiment

Start with [the published example](../examples/experiment-basic.yaml):

```yaml
version: 1
name: basic-agent-comparison

testcases:
  - id: add-readme-comment
    file: ./testcase-basic.yaml

variants:
  - name: copilot-default
    agent:
      type: copilot-cli
  - name: claude-default
    agent:
      type: claude-code

repetitions: 2

execution:
  max_concurrent: 2
  retry:
    max_attempts: 2
    on: [infrastructure_failure, timeout]
    backoff_ms: 1000

budget:
  max_duration_minutes: 30

regression:
  min_pass_rate: 0.8
```

Each test case entry has a unique `id` and a `file` resolved relative to the
experiment file. Each unique variant overrides matching agent fields for that
matrix column; unspecified agent fields remain from the test case.
`repetitions` defaults to 1.

Inspect the definition before running agents:

```bash
yb experiment validate experiment.yaml
yb experiment plan experiment.yaml
yb experiment plan experiment.yaml --json
```

Planning is read-only. It resolves test cases, applies variant agent
configuration, and displays stable cell IDs, the cell count, concurrency,
budgets, and redacted effective configuration. It does not clone repositories
or invoke agents.

## Execution policy

`execution.max_concurrent` bounds simultaneously active cells and defaults to

1. Retry policy uses:

- `max_attempts`: total attempts including the first; defaults to 1.
- `on`: retryable reasons, limited to `infrastructure_failure` and `timeout`.
- `backoff_ms`: delay between attempts; defaults to 0.

Budgets are optional. `max_duration_minutes` stops new cells after the duration
limit. `max_cost_usd` stops new cells when recorded cost reaches the limit.
Already completed results remain durable.

Run the matrix:

```bash
yb experiment run experiment.yaml
```

Every new invocation gets a new experiment ID and directory under
`results/experiments/`. State is written atomically after transitions. Pressing
Ctrl+C stops pending work and preserves resumable state. An agent process that
is already running may take until its configured timeout to return because the
current single-run adapters do not yet terminate an in-flight child process.

Resume an interrupted, cancelled, or budget-limited invocation:

```bash
yb experiment run experiment.yaml --resume <experiment-id>
```

Resume requires the same definition and matrix. Valid completed artifacts are
reused. A cell left in `running` is considered interrupted and can retry;
missing or invalid completed artifacts are never accepted silently.

## Aggregates and reports

An experiment records every cell and attempt and aggregates completion, pass,
duration, token, and cost data where available. Aggregates are emitted at four
scopes: whole experiment, test case, variant, and test-case/variant pair.
Sample sizes accompany metrics. Usage quality is labeled `measured`,
`estimated`, or `unavailable`; mixed quality is not presented as wholly
measured.

The run generates these reports:

- `results.json`: deterministic, machine-readable experiment result.
- `report.md`: cell table, regression findings, aggregates, warnings, and
  drill-down links.
- `junit.xml`: cells and policies represented as CI test cases.

Render a format from a durable result or experiment ID to standard output:

```bash
yb experiment report <experiment-id-or-path> --format markdown
yb experiment report <experiment-id-or-path> --format json
yb experiment report <experiment-id-or-path> --format junit
```

## Baselines and regression policies

Approve a completed result as an immutable local named baseline:

```bash
yb experiment approve <experiment-id-or-path> --name last-approved
```

A name is permanently bound to a content hash. It cannot later be repointed to
different content, and integrity checks detect modified baseline manifests or
objects. These local hashes detect corruption; they are not a signature against
an attacker who can rewrite the baseline store.

Compare a candidate with a named baseline or result path:

```bash
yb experiment compare <candidate-id-or-path> --baseline last-approved
yb experiment compare <candidate-id-or-path> --baseline ./baseline/results.json
```

An experiment definition can enforce:

- `min_pass_rate`: absolute candidate pass-rate floor from 0 through 1.
- `max_pass_rate_drop`: largest allowed drop from baseline, from 0 through 1.
- `max_duration_increase_percent`: largest allowed relative duration increase.
- `zero_baseline_behavior`: `fail`, `partial`, or `absolute_only` when a
  relative comparison has a zero baseline; defaults to `partial`.

To enforce relative rules during `experiment run`, name an already approved
baseline in the definition:

```yaml
baseline:
  name: last-approved
regression:
  min_pass_rate: 0.8
  max_pass_rate_drop: 0.05
  max_duration_increase_percent: 20
  zero_baseline_behavior: partial
```

Missing baseline scopes and incomparable metrics produce partial findings.
Failure diagnostics identify the scope, metric, candidate and baseline values,
and violated threshold.

## Exit codes

| Code | Meaning                                                                         |
| ---: | ------------------------------------------------------------------------------- |
|    0 | Completed and all configured regression policies passed                         |
|    1 | Invalid configuration or experiment infrastructure failure                      |
|    2 | A required cell/evaluator or regression policy failed                           |
|    3 | Incomplete because a required cell was skipped, cancelled, or exhausted retries |

Treat both `2` and `3` as failed CI checks unless incomplete results have an
explicit review policy.

## GitHub Actions

[The packaged workflow example](../examples/github-actions/experiment-regression.yml)
validates, plans, runs, uploads all durable results, and publishes the JUnit
report. Copy it into `.github/workflows/` and replace the agent setup and
authentication placeholders for the adapter you use.

Agent test cases execute repository code and agent CLIs can modify their
workspace. Use trusted definitions and isolated CI runners. Store credentials
in CI secrets; do not place them in experiment or test-case files.
