# Research: E2B-backed coding-agent regression evaluation

**Date:** 2026-07-26  
**Last reviewed:** 2026-07-27  
**Status:** Complete for specification  
**Scope:** Current youBencha value proposition, E2B execution, secure operation,
single-test ergonomics, scaled matrices, and model/harness replacement

## Executive conclusion

youBencha already has most of the control-plane mechanics required for a useful
coding-agent regression product. It can run three headless coding harnesses,
override their models, evaluate the resulting changes, expand a
test-case/variant/repetition matrix, retry infrastructure failures, resume
interrupted work, aggregate quality/latency/token/cost signals, compare with a
baseline, and emit CI-friendly reports.

The highest-value next step is therefore not another benchmark abstraction. It
is a secure remote execution provider and a simpler regression workflow on top
of the current experiment engine.

The recommended positioning is:

> youBencha is a regression-testing control plane for coding agents. Run the
> same repository tasks against a new model or coding harness in isolated
> sandboxes, compare the evidence with an approved baseline, and promote the
> replacement with confidence.

E2B is a good fit for the execution plane because it provides on-demand Linux
microVMs, custom templates, snapshots, lifecycle controls, SDK file and command
APIs, metadata, and resource metrics. E2B does not remove the need for a
youBencha security policy: a model credential visible to a harness is also
visible to hostile code in the same sandbox, and unrestricted outbound network
access still permits exfiltration.

## Current youBencha product analysis

This assessment treats `package.json`, `src/`, schemas, and tests as the source
of truth. The user-facing experiment guide is also current with the
implementation.

### What is implemented now

| Capability        | Current behavior                                                                                                      | Product value                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Coding harnesses  | Headless adapters for Copilot CLI, Claude Code, and Codex CLI                                                         | The same task can be exercised through materially different coding-agent products |
| Model selection   | Every agent type accepts an optional `model`; variants merge agent and adapter config over a test case                | A user can compare models without duplicating the task definition                 |
| Task isolation    | Each run clones into a separate local workspace directory                                                             | Results are inspectable and runs avoid ordinary working-tree collisions           |
| Evaluators        | `git-diff`, `expected-diff`, and one or more `agentic-judge` evaluators                                               | Objective, reference-based, and qualitative signals can be combined               |
| Experiment matrix | Test cases × variants × repetitions with stable cell IDs                                                              | Comparative and nondeterministic behavior can be measured                         |
| Scheduling        | Configurable concurrency, bounded retries, duration/cost budgets, SIGINT handling, and resume                         | Medium-size matrices can survive routine infrastructure failures                  |
| Aggregation       | Pass/completion rates plus min/median/mean/p95/max/stddev/range for duration; token and cost totals                   | Reports contain more than a single pass/fail number                               |
| Regression policy | Absolute pass-rate floor, maximum pass-rate drop, maximum mean-duration increase                                      | CI can reject a quality or performance regression                                 |
| Baselines         | Content-addressed immutable local baseline objects                                                                    | Results cannot be silently repointed under an existing immutable name             |
| Provenance        | Source commit, requested/resolved model, harness CLI version, effective config, and youBencha version where available | A result can identify much of what actually ran                                   |
| Reports           | JSON, Markdown, and JUnit with stable exit codes                                                                      | Results work for people, scripts, and CI systems                                  |
| Process safety    | Argument arrays, `shell: false`, timeouts, bounded output/artifacts, and secret redaction in current adapters         | Common command-injection and runaway-output risks are reduced                     |

Relevant implementation:

- [`src/schemas/experiment.schema.ts`](../../src/schemas/experiment.schema.ts)
- [`src/experiments/planner.ts`](../../src/experiments/planner.ts)
- [`src/experiments/runner.ts`](../../src/experiments/runner.ts)
- [`src/experiments/scheduler.ts`](../../src/experiments/scheduler.ts)
- [`src/experiments/aggregator.ts`](../../src/experiments/aggregator.ts)
- [`src/experiments/comparator.ts`](../../src/experiments/comparator.ts)
- [`src/experiments/provenance.ts`](../../src/experiments/provenance.ts)
- [`docs/experiments.md`](../../docs/experiments.md)

### Current value proposition

The strongest current value is evidence generation around a real coding
harness, not a synthetic LLM request:

1. A task starts from an exact repository revision.
2. A real coding harness receives a task and can inspect/edit/run the project.
3. Multiple evaluator types inspect the result.
4. Raw logs, diffs, structured outcomes, and provenance remain available.
5. Experiments repeat that process across tasks and agent variants.
6. Regression rules turn the experiment into a CI quality gate.

This is more specific and useful than a generic “LLM evaluation framework”
claim. It is especially valuable to teams selecting a coding agent, validating
an upgrade, or replacing a model that is approaching retirement.

### Gaps that block the stronger proposition

1. **A workspace directory is not a security sandbox.** Agent CLIs, repository
   code, and lifecycle scripts execute on the host. Claude Code can default to
   permission bypass, while Copilot can default to broad tool/path access.
2. **Scale is limited by the local machine and its global harness state.**
   Concurrent cells share host CPU, memory, network, installed CLI versions,
   authentication state, and potentially user-level harness configuration.
3. **The current test-case/variant merge is not a target abstraction.** A
   version 1 test case requires an agent, and variant loading shallow-merges its
   adapter config. Changing the adapter type can carry incompatible
   harness-specific keys from the base test case into the replacement. A true
   cross-harness suite needs target-neutral task files and compilation, not
   cross-type config merging.
4. **The current matrix is powerful but not yet a migration workflow.** Users
   must edit inline variants and manually coordinate candidate runs, baseline
   comparison, and promotion.
5. **Variant names and aggregate scope are comparison keys.** Comparing a
   differently named replacement produces unmatched scopes. Simply renaming
   the aggregate is also incorrect because experiment/testcase aggregates may
   include other variants; mapped regression must project only `variant` and
   `testcase_variant` aggregates.
6. **Baseline names are immutable.** That is useful for evidence, but a channel
   such as `production` or `last-approved` needs a separately audited movable
   pointer to successive immutable snapshots.
7. **There is no test/target selection at run time.** A user cannot use one
   suite definition for both a one-case smoke run and the complete matrix
   without creating another file.
8. **Runtime provenance stops at the host.** It does not record a remote
   template/build, execution provider, network policy, sandbox resources, or
   sandbox lifecycle.
9. **A retired or inaccessible model is only discovered during execution.**
   There is no target preflight or explicit “model unavailable” migration
   diagnostic.
10. **The public-repository-only source schema is restrictive.** Private
    repository support needs scoped credentials and redaction, especially in a
    remote sandbox.
11. **The cost budget is incomplete for remote execution.** Model cost may be
    measured or estimated, but E2B compute usage/cost would be a separate
    signal.

## E2B findings

All E2B findings below were checked against official E2B documentation on
2026-07-26. E2B APIs, plan limits, and pricing are external and must be
re-verified when implementation starts.

### Isolation and access

- E2B describes each sandbox as a Firecracker microVM intended for untrusted
  workflows, providing a stronger tenant boundary than a host directory or an
  ordinary same-kernel container. See [E2B's product
  overview](https://e2b.dev/) and its
  [Firecracker isolation explanation](https://e2b.dev/blog/not-affected-by-copy-fail-heres-why).
- SDK 2.x enables secured sandbox-controller access by default. With secured
  access, control and filesystem calls require an access token; disabling it is
  discouraged for production. See [Secured
  access](https://e2b.dev/docs/sandbox/secured-access).
- The default sandbox identity is an unprivileged `user` in `/home/user`.
  Templates can change it, but the youBencha runner should remain non-root. See
  [User and workdir](https://e2b.dev/docs/template/user-and-workdir).
- Sandbox creation exposes internet and network-policy controls, including
  public traffic and outbound allow/deny fields. `allow_internet_access: false`
  is documented as denying `0.0.0.0/0`. See [Create
  sandbox](https://e2b.dev/docs/api-reference/sandboxes/create-sandbox).

### Secrets are not made private by environment scoping

E2B supports global and command-scoped environment variables, but explicitly
states that command-scoped values are not private within the operating system.
That means an untrusted repository or agent can potentially read a model token
that is available to the harness process. See [Environment
variables](https://e2b.dev/docs/sandbox/environment-variables).

Implications:

- never pass `E2B_API_KEY` into a sandbox;
- expose only the credential required by the selected target;
- prefer short-lived, narrowly scoped provider credentials;
- inject credentials only for the agent command, after source preparation;
- do not create a snapshot after credentials have been injected;
- treat outbound network policy as part of secret protection, not only as a
  reproducibility setting; and
- redact secret values from stdout, stderr, structured events, results, error
  stacks, and downloadable artifacts.

### Templates, snapshots, and reproducibility

- Templates declaratively define a reusable base image, installed tools, files,
  user, workdir, and optional prestarted processes. E2B supports Debian-derived
  images and can convert supported Dockerfile instructions. See [Template
  quickstart](https://e2b.dev/docs/template/quickstart) and [Base
  image](https://e2b.dev/docs/template/base-image).
- Template builds return both template and build IDs. Tags can move, so a
  reproducible run must persist the resolved build ID and should reject an
  unexpected build even if a friendly template tag was configured. See
  [Template builds](https://e2b.dev/docs/template/build) and [Template
  tags](https://e2b.dev/docs/template/tags).
- Snapshots capture filesystem and memory and can fan out one prepared state to
  many new sandboxes. E2B recommends templates for repeatable static
  environments and snapshots for runtime checkpoints/forks. See [Sandbox
  snapshots](https://e2b.dev/docs/sandbox/snapshots).

Recommended split:

- use minimal capability-specific versioned templates derived from a reviewed
  common base for Linux, Node, Git, the youBencha runner protocol, the exact
  system-under-test harness, and any independent judge harness required by the
  task;
- use an optional per-test snapshot only after cloning the exact commit and
  completing explicitly cacheable, secret-free setup; and
- spawn one fresh sandbox from that template/snapshot for every attempt.

Do not reuse a mutated execution sandbox for another target or repetition.
Cross-cell reuse would contaminate comparisons and let one target influence the
next. E2B currently documents CPU and memory sizing as template-build
configuration, so a run should verify the resolved template's resources rather
than claim it can override them per sandbox.

### Lifecycle, retention, and cleanup

- Sandboxes can be killed, paused, resumed, or configured to pause/kill on
  timeout. Continuous runtime is documented as one hour on the Base tier and
  up to 24 hours on Pro; pausing resets the continuous-runtime window. See
  [Sandbox lifecycle](https://e2b.dev/docs/sandbox) and
  [Persistence](https://e2b.dev/docs/sandbox/persistence).
- Paused sandboxes are documented as retained indefinitely. They stop compute
  billing, but they do not have an automatic data-retention TTL. This makes
  pause-on-failure unsuitable as a silent default.
- E2B exposes sandbox metadata, listing/filtering, lifecycle events, and
  signed lifecycle webhooks. These can support reconciliation and leak
  detection. See [Metadata](https://e2b.dev/docs/sandbox/metadata), [List
  sandboxes](https://e2b.dev/docs/sandbox/list), and [Lifecycle
  events](https://e2b.dev/docs/sandbox/lifecycle-events-api).

The safe default is kill-on-completion and kill-on-timeout. Debug retention
must be opt-in, pause the sandbox, print the sandbox ID and expiry intent, and
warn that expiry needs an external janitor or a future CLI invocation because
E2B itself does not automatically delete paused sandboxes.

### Scaling and rate control

E2B's current published plan table lists:

- Hobby: 20 concurrent sandboxes and 1 creation/second;
- Pro: 100–1,100 concurrent sandboxes and 5 creations/second; and
- Enterprise: custom limits.

See [Billing and limits](https://e2b.dev/docs/billing). These are account-plan
limits, not appropriate hard-coded defaults.

The scheduler needs two independent controls:

1. maximum active cells; and
2. maximum sandbox creations per second.

Creation should use a token bucket, respect rate-limit retry hints when
available, add jittered backoff, and never let retries create two sandboxes for
one attempt. Every sandbox should carry metadata containing the experiment ID,
cell ID, attempt ID, target ID, and a non-secret owner/project identifier.

Large runs should also ramp up one cell per target before releasing full
parallelism. A deterministic harness authentication or model-unavailable result
should open a target circuit breaker and cancel pending fan-out; transient
throttling should remain a bounded infrastructure retry. This avoids discovering
a retired model in dozens of sandboxes simultaneously.

### Files, artifacts, and observability

- E2B exposes filesystem read/write/upload/download APIs and each sandbox has
  its own filesystem. See [Filesystem](https://e2b.dev/docs/filesystem).
- Directory download is not the ergonomic primitive in the basic SDK
  documentation. The runner should create one bounded archive plus a signed
  manifest and download those files, rather than recursively mirroring a
  workspace.
- E2B collects CPU, memory, and disk metrics on a five-second interval. Batch
  metrics requests accept up to 100 sandbox IDs. See [Sandbox
  metrics](https://e2b.dev/docs/sandbox/metrics) and [List sandbox
  metrics](https://e2b.dev/docs/api-reference/sandboxes/list-sandbox-metrics).
- E2B's own CI example uses a separate sandbox per workflow run so untrusted
  code does not execute on the GitHub Actions runner. See [GitHub Actions
  CI/CD](https://e2b.dev/docs/use-cases/ci-cd).

Artifacts must be allowlisted, size-bounded, hash-verified, checked for archive
path traversal/symlink escape, schema-validated, and written only below the
local experiment attempt directory. The remote mutable workspace should not be
downloaded by default.

## Recommended execution topology

### One test

1. The local CLI loads and validates the suite and target.
2. Planning resolves a stable cell/attempt ID and prints security/cost intent.
3. The E2B executor creates one secured sandbox with identifying metadata.
4. The runner verifies its template build, youBencha protocol, harness version,
   and target capability.
5. Source is prepared at an exact commit without model credentials.
6. The control plane invokes fixed `prepare`, `agent`, `evaluate`,
   `post-evaluate`, and `package` runner phases. Only
   target/component/phase-declared secrets are injected into each applicable
   command. Code in that command's process tree can still read them.
7. The runner terminates residual processes between secret-bearing phases.
8. Phase-capable orchestration reuses the existing adapters and evaluators
   inside the sandbox.
9. The runner packages a manifest, result, diff, bounded logs, and evaluator
   artifacts.
10. The local executor downloads and validates the bundle.
11. The sandbox is killed in a `finally` path.

### A scaled suite

1. The local scheduler expands cases × targets × repetitions as it does today.
2. At most `max_concurrent` attempts are active, while a second limiter meters
   sandbox creation.
3. Optionally, one secret-free setup sandbox per unique test case prepares the
   exact source/dependencies and creates a snapshot.
4. Each attempt starts a fresh sandbox from the resolved template build or
   test snapshot.
5. Attempt state is persisted locally before and after every remote lifecycle
   transition.
6. Cancellation kills the corresponding remote sandbox immediately.
7. A reconciliation pass lists sandboxes with the experiment metadata and
   kills or reconnects only those that match persisted attempt ownership.
8. Aggregation, baseline comparison, reports, and exit codes remain local and
   provider-independent.

For fair incumbent/candidate comparisons, the scheduler should interleave
targets in a deterministic round-robin order. A historical baseline remains
useful after retirement, but it is not a contemporaneous experiment; the
preferred migration is an overlap run before retirement followed by promotion
of the candidate target recorded in the immutable overlap result.

## Product decisions

### Decision 1: E2B is an execution provider, not an agent adapter

Harness-specific commands and parsing remain in `src/adapters/`. E2B owns where
the complete mutable lifecycle runs: source preparation, hooks, agent,
evaluators, artifact packaging, and teardown.

The current `SingleRunExecutor` is the shortest implementation seam. A later
general `ExecutionProvider` interface can absorb both host and E2B without
putting cloud behavior in adapters or the experiment scheduler.

### Decision 2: one sandbox per attempt

This produces the clearest isolation and comparison semantics. Templates and
secret-free snapshots amortize setup without sharing mutated state.

### Decision 3: keep scheduling and durable results outside the sandbox

One sandbox running the whole matrix would create a single failure domain,
limit parallelism, complicate cancellation, and place baseline/results state
inside an untrusted environment. The local CLI should remain the control plane.

### Decision 4: distinguish immutable snapshots from movable baseline channels

Every approval creates an immutable content-addressed baseline snapshot. A
channel such as `production` can atomically advance to a new snapshot with an
audit record and optional compare-and-swap precondition. A candidate can map
to a differently named target in the baseline. This supports model retirement
without rerunning the retired model.

Mapped comparison must use target-specific aggregates only. Candidate
`variant`/`testcase_variant` aggregates map to the baseline target and are
reported as logical `target`/`testcase_target` scopes. Whole-experiment and
testcase-only aggregates are excluded because they may include unrelated
targets. Regression rules must also declare minimum samples and explicit
insufficient-data behavior. The mapped target source may be a persisted
baseline or another target in the same interleaved overlap run; named profiles
select only the comparisons relevant to that plan.

### Decision 5: add a thin regression command over experiments

`yb regress` should select one or more cases/targets, resolve a baseline
channel, execute through the existing experiment engine, compare, report, and
return the existing stable exit code. `yb experiment` remains the power-user
surface. Named smoke, overlap, nightly, and release profiles let CI trigger
bounded plans from the same suite; all selection overrides participate in plan
identity and resume validation.

### Decision 6: add target-neutral version 2 task cases

The current test-case schema requires an agent, so it cannot be the clean
long-term suite unit. Version 2 introduces task files containing repository,
prompt, setup, and evaluators but no agent. Selecting a target compiles a new
current internal test-case config. Adapter config is never inherited across
different harness types. Version 1 files remain supported rather than being
silently split by heuristic migration.

## Alternatives considered

### Run the full experiment inside one E2B sandbox

Rejected because it weakens cell isolation, makes one sandbox a bottleneck and
failure domain, and makes partial resume harder.

### Reuse one sandbox across targets or repetitions

Rejected because filesystem, process, cache, and credential state can leak
between cells and bias comparisons.

### Install harnesses at the start of every attempt

Rejected as the default because it adds time, network dependence, version
drift, package-registry risk, and cost. Exact harnesses belong in a versioned
template. Runtime installation can remain an explicit development mode.

### Put secrets in template environment variables

Rejected because template state is reusable and credentials could be captured
or exposed broadly. Target credentials must be supplied only at attempt
execution time.

### Treat artifact hashes as sandbox attestation

Rejected because hashes generated by the same sandbox only prove transfer
completeness and manifest consistency. They do not establish that a compromised
sandbox produced truthful results.

### Use pause-on-failure by default

Rejected because paused sandboxes persist indefinitely according to E2B's
documentation. Default teardown must kill.

### Replace experiments with a new suite engine

Rejected because the current planner, scheduler, state store, retry logic,
aggregator, comparator, reporters, and provenance already solve the hard
control-plane problems. The proposal extends those contracts instead of
forking them.
