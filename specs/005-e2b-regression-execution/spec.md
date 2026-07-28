# Feature specification: Secure regression suites with E2B

**Feature:** `005-e2b-regression-execution`  
**Created:** 2026-07-26  
**Last reviewed:** 2026-07-27  
**Status:** Implemented core; fixture snapshots and private repositories remain gated  
**Depends on:** Current experiment engine and adapter/evaluator contracts  
**Research:** [research.md](./research.md)

## Summary

Add E2B as an opt-in remote execution provider for youBencha experiments and
add a regression-oriented workflow that lets users run one task or a complete
suite against a selected model/coding harness, compare it with an approved
baseline, and promote a replacement.

The local youBencha process remains the trusted control plane. It validates and
plans the suite, schedules attempts, stores durable state, downloads and
validates bounded artifacts, aggregates results, compares baselines, and emits
reports. Each agent attempt runs in a fresh secured E2B sandbox.

## Goals

- Run repository, harness, hooks, and evaluators away from the local/CI host.
- Preserve current adapter behavior and experiment result semantics.
- Make the same suite usable for one-case smoke tests and scaled regression
  matrices.
- Make model or harness substitution a target-level change rather than a copy
  of every test case.
- Compare a replacement target with a differently named historical target.
- Preserve exact execution provenance after a model or harness is retired.
- Bound concurrency, creation rate, duration, artifacts, and credential scope.
- Fail closed when a requested security control cannot be enforced.
- Keep E2B optional; existing host execution remains compatible and is named
  `host-trusted`.

## Non-goals

- A hosted youBencha control plane or web dashboard.
- An E2B account, template, or model credential provisioning service.
- Automatic installation of arbitrary harness packages from suite files.
- Perfect containment of a credential deliberately exposed to untrusted code
  inside the same sandbox.
- Windows/macOS sandbox guests; E2B execution is Linux-only.
- Dynamic E2B pricing calculations when authoritative cost data is unavailable.
- A replacement for the current agent adapters or evaluators.
- Silent fallback from E2B to host execution.

## Terms

- **Suite:** A reusable collection of test cases and defaults.
- **Task case:** A target-neutral repository, prompt, setup, and evaluator
  definition. Unlike the current version 1 test-case schema, it does not contain
  the system-under-test agent. An evaluator may still declare its own
  independent judge harness/model.
- **Target:** A coding harness, exact harness-version constraint, model, and
  adapter configuration evaluated against the suite.
- **Cell:** One test case × target × repetition.
- **Attempt:** One execution of a cell, including retries.
- **Execution provider:** The environment in which the complete mutable
  one-test lifecycle runs.
- **Baseline snapshot:** An immutable, content-addressed experiment result.
- **Baseline channel:** A named, audited pointer to a baseline snapshot.
- **Runner template:** An E2B template containing the runner protocol and exact
  supported harness toolchain.
- **Fixture snapshot:** An optional secret-free E2B snapshot prepared for one
  exact test-case source/setup state.

## User stories

### P0 — Run one regression case securely

As a developer trying a new model, I can select one case and one target from an
existing suite and execute it in E2B, so I get fast feedback without granting
the repository or agent access to my workstation or CI runner.

Acceptance:

1. `yb regress suite.yaml --target candidate --case fix-auth` plans exactly one
   cell unless the user explicitly requests more repetitions.
2. The attempt runs in one fresh secured E2B sandbox.
3. The E2B API key is never present inside the sandbox.
4. Only secrets declared for the selected target and phase are injected into
   that fixed phase command's process tree. Repository code in that process tree
   is still capable of reading those values.
5. The result bundle is downloaded, validated, and reported locally.
6. The sandbox is killed on success, evaluation failure, infrastructure
   failure, cancellation, or timeout unless debug retention was explicitly
   requested.

### P0 — Run a complete suite at scale

As a benchmark owner, I can run all selected cases, targets, and repetitions
with bounded concurrency and creation rate, so a large regression finishes
quickly without violating provider limits.

Acceptance:

1. The existing stable cell IDs, retry policy, budgets, resume behavior, and
   exit codes continue to apply.
2. `max_concurrent` bounds live attempts.
3. `max_creations_per_second` independently bounds E2B sandbox creation.
4. Every attempt receives a unique sandbox ID and clean mutable state.
5. Retry and resume never accept two live sandboxes for the same attempt.
6. SIGINT or an abort kills active owned sandboxes and leaves durable resumable
   state.
7. A reconciliation command can list owned running/paused sandboxes by
   metadata without exposing credentials.
8. A deterministic round-robin schedule interleaves targets by default so a
   temporary provider slowdown or outage does not affect only one target.

### P0 — Swap a model or coding harness

As a team responding to a model retirement, I can define a replacement target
once and run it over the same suite, so I do not duplicate or rewrite task
definitions.

Acceptance:

1. A target selects `agent.type`, requested model, adapter config, and one exact
   expected harness version.
2. Version 2 task cases contain prompt/repository/setup/evaluator behavior and
   do not encode the evaluated target. An evaluator may independently configure
   its judge harness.
3. Planning verifies that the E2B template advertises a compatible runner and
   harness.
4. Results record requested and resolved model, resolved harness version,
   youBencha version, template ID/build ID, and effective target config.
5. If a model is unavailable, the failure is classified separately from a test
   failure and includes an actionable migration diagnostic.
6. Compiling a task and target constructs a new agent config; it never
   shallow-merges adapter-specific config from a different harness type.

### P0 — Compare and promote a replacement

As a release owner, I can compare a candidate target with a differently named
incumbent in the current overlap run and/or an approved baseline, then promote
it, so a retired model does not need to be invoked again afterward.

Acceptance:

1. Regression configuration explicitly maps `candidate_target` to a target
   from a declared current-run or persisted baseline source.
2. Baseline comparison projects the candidate's target and testcase-target
   aggregates against the mapped baseline target; it does not rename
   whole-experiment aggregates that may contain other targets.
3. Promotion writes a new immutable baseline snapshot.
4. A baseline channel advances atomically and records old digest, new digest,
   actor/context when available, timestamp, source experiment, and target
   mapping.
5. CI can require the channel's current digest as a compare-and-swap
   precondition to prevent concurrent promotions.

### P1 — Reproduce and audit execution

As an auditor, I can see the effective sandbox controls and exact toolchain for
each attempt, so I can distinguish a model regression from environment drift.

Acceptance:

1. Result provenance includes provider, SDK version, sandbox/template/build
   IDs, fixture snapshot ID when used, secure-access state, lifecycle policy,
   resources, effective network policy, runner protocol, and retention outcome.
2. E2B access tokens and user secrets are never serialized.
3. Template tags may be accepted as input, but the resolved immutable build ID
   is stored and checked.
4. A strict reproducibility mode rejects moving/unresolved template identity,
   unmatched harness version, unrestricted egress, and runtime package
   installation.

### P1 — Retain a failed sandbox for bounded debugging

As a developer diagnosing an infrastructure failure, I can explicitly retain a
failed sandbox in paused state, so I can inspect it without making indefinite
retention the default.

Acceptance:

1. Retention is off by default.
2. Retention requires a declared reason and maximum intended retention.
3. Output identifies the paused sandbox and warns that E2B does not enforce an
   automatic TTL for paused sandboxes.
4. `yb sandbox reap` kills retained sandboxes past their intended expiry when
   it runs.
5. A retained sandbox never contains `E2B_API_KEY`.

## Proposed user experience

### Commands

Power-user experiment commands remain. Add:

```text
yb regress <suite-file>
  --profile <name>              named smoke, pull-request, nightly, or release selection
  --target <target-id>          repeatable; required unless default_candidate_target is configured
  --case <testcase-id>          repeatable; defaults to all
  --against <channel-or-path>   overrides configured baseline
  --repetitions <n>             explicit run-time override
  --provider <name>             host-trusted|e2b; explicit override
  --resume <experiment-id>
  --plan                        no sandbox creation

yb baseline promote <experiment-id-or-path>
  --channel <name>
  --target <candidate-target>
  --expect <current-digest>     optional compare-and-swap precondition

yb baseline show <channel-or-digest>
yb sandbox list [--experiment <id>]
yb sandbox reap [--experiment <id>]
yb sandbox kill <sandbox-id>
```

`yb regress` is a thin composition over experiment load, filtered planning,
execution, comparison, and reporting. It MUST NOT implement a second scheduler
or result format. Profile selection, CLI filters, provider overrides, and
repetition overrides are normalized into the effective definition hash and
provenance. Resume requires the same effective selection; overrides cannot
silently reuse cells from a different plan.

### Proposed version 2 suite schema

Version 1 experiment files continue to load unchanged. Version 2 introduces
target-neutral task files, reusable targets, provider policy, and explicit
regression mapping.

An illustrative version 2 task file:

```yaml
version: 2
kind: task
name: Fix expired-session handling
description: Correctly reject an expired session and preserve valid sessions.
repo: https://github.com/example/service.git
commit: 0123456789abcdef0123456789abcdef01234567

task:
  prompt_file: ./prompts/fix-auth.md

evaluators:
  - name: git-diff
  - file: ./evaluators/auth-behavior.yaml

setup:
  cacheable:
    - command: npm-ci
  per_attempt: []
```

The task schema owns the shared prompt. A target owns all adapter-specific
settings for the system under test; evaluator definitions own any independent
judge configuration. The compiler creates the current internal
`TestCaseConfig` only after selecting task and target, placing the task prompt
into the selected adapter config.
Cacheable setup entries are named built-ins or structured executable/argument
records; configuration values are never concatenated into a shell command. The
version 2 task ID can continue to populate the existing internal/result
`testcase_id` field for compatibility.

```yaml
version: 2
name: coding-agent-regression

suite:
  tasks:
    - id: fix-auth
      file: ./testcases/fix-auth.yaml
    - id: add-cache
      file: ./testcases/add-cache.yaml
  repetitions: 3

profiles:
  smoke:
    tasks: [fix-auth]
    targets: [candidate]
    repetitions: 1
    comparisons: []
    rules: []
  overlap:
    tasks: '*'
    targets: [production, candidate]
    repetitions: 5
    comparisons: [historical, current-overlap]
    rules: [pass-floor, pass-drop, duration-increase]
  nightly:
    tasks: '*'
    targets: [candidate]
    repetitions: 5
    comparisons: [historical]
    rules: [pass-floor, pass-drop, duration-increase]

targets:
  - id: production
    agent:
      type: codex-cli
      model: gpt-current
      config:
        reasoning_effort: high
    harness:
      exact_version: '1.2.3'
      e2b_template:
        ref: youbencha-codex-runner:v1
        expected_build_id: codex_build_immutable_identifier
        expected_resources:
          cpu: 2
          memory_mb: 4096
    runtime:
      network:
        outbound: allowlist
        allow:
          - github.com
          - api.production-model-provider.example

  - id: candidate
    agent:
      type: claude-code
      model: claude-next
      config:
        effort: high
        permission_mode: dontAsk
    harness:
      exact_version: '2.4.0'
      e2b_template:
        ref: youbencha-claude-runner:v1
        expected_build_id: claude_build_immutable_identifier
        expected_resources:
          cpu: 2
          memory_mb: 4096
    runtime:
      network:
        outbound: allowlist
        allow:
          - github.com
          - api.candidate-model-provider.example

execution:
  max_concurrent: 20
  max_creations_per_second: 4
  schedule:
    order: round_robin
    seed: regression-v1
    ramp_up:
      initial_cells_per_target: 1
      release_after: target_capability_confirmed
  retry:
    max_attempts: 2
    on: [infrastructure_failure, timeout, provider_rate_limit]
    backoff_ms: 1000
    jitter: full

  provider:
    type: e2b
    timeout_ms: 1800000
    collection_grace_ms: 120000
    lifecycle:
      on_timeout: kill
      retain_on: never
    network_defaults:
      inbound: none
      outbound: none
    fixture_cache:
      mode: snapshot
      setup: declared-cacheable-only

  secrets:
    - id: production-model
      source:
        env: PRODUCTION_MODEL_API_KEY
      expose_as:
        env: OPENAI_API_KEY
      targets: [production]
      phases: [agent]
    - id: candidate-model
      source:
        env: CANDIDATE_MODEL_API_KEY
      expose_as:
        env: ANTHROPIC_API_KEY
      targets: [candidate]
      phases: [agent]

budget:
  max_duration_minutes: 90
  max_model_cost_usd: 50
  max_sandbox_runtime_minutes: 600

regression:
  default_candidate_target: candidate
  comparisons:
    - id: historical
      candidate_target: candidate
      baseline:
        source: channel
        channel: production
        target: production
    - id: current-overlap
      candidate_target: candidate
      baseline:
        source: current_run
        target: production
  rules:
    - id: pass-floor
      metric: overall_pass_rate
      scopes: [target, testcase_target]
      minimum: 0.8
      minimum_samples: 3
      insufficient_samples: partial
    - id: pass-drop
      metric: overall_pass_rate
      scopes: [target, testcase_target]
      max_absolute_drop: 0.05
      comparisons: [historical, current-overlap]
      minimum_samples: 3
      insufficient_samples: partial
    - id: duration-increase
      metric: duration_ms_mean
      scopes: [target]
      max_relative_increase: 0.2
      comparisons: [historical, current-overlap]
      minimum_samples: 3
      insufficient_samples: partial
```

Names are illustrative. The final Zod schema must preserve these semantics even
if individual keys change during implementation review.

Profiles are named plan selections, not separate execution engines. CLI
`--case`/`--target` filters may narrow a profile. Broadening a profile requires
an explicit option or a different profile so a pull-request job cannot
accidentally expand into an expensive full matrix. A profile also selects its
comparison and rule IDs; omitting a current-run comparison from a candidate-only
profile prevents an expected missing incumbent from turning the run partial.
The smoke profile relies on ordinary cell/evaluator exit status instead of
pretending one repetition satisfies a multi-sample statistical gate.

### Recommended retirement workflow

1. Add the replacement as a new target without changing any task file.
2. Before retirement, run the `overlap` profile so incumbent and candidate are
   interleaved under the same time window.
3. Inspect both the `current-overlap` candidate-to-incumbent projection and the
   `historical` approved-channel projection; resolve all failed/partial
   findings.
4. Promote the candidate target to the `production` baseline channel with a
   compare-and-swap digest.
5. Change the default candidate or remove the old live target. The immutable
   old baseline remains comparable without invoking the retired model.

### Compatibility mapping

A version 1 experiment continues through its existing schema and merge behavior:

- missing provider → `host-trusted`
- current regression fields → normalized rule objects
- immutable `baseline.name` → immutable snapshot reference

Version 2 suites MUST use target-neutral version 2 task files. A migration
command may extract the shared prompt and create an initial target from a
version 1 test case, but the loader MUST NOT guess how to split mixed
adapter-specific config. Version 1 output remains readable. Version 2 output
increments `experiment_version` and adds fields without mutating historical
results.

## Architecture requirements

### Control plane

The local CLI MUST own:

- config loading, redaction, and schema validation;
- target/case selection and cell identity;
- concurrency, rate limiting, retry, budget, cancellation, and resume;
- baseline resolution and promotion;
- durable state and attempt ownership;
- artifact download and validation;
- aggregation, comparison, reporting, and exit codes; and
- E2B reconciliation/cleanup.

The E2B API key MUST remain only in the local control plane.

### E2B attempt executor

Implement `E2BSingleRunExecutor` behind the existing `SingleRunExecutor`
contract first. Its lifecycle is:

1. persist `creating` intent with attempt ownership;
2. create a secured sandbox with metadata and fail-closed policies;
3. persist the sandbox ID before executing mutable work;
4. verify runner/toolchain manifest;
5. prepare or restore exact source state;
6. write a validated cell manifest using the filesystem API;
7. invoke the fixed `prepare` phase and wait for it to finish;
8. invoke the fixed `agent` phase with only its declared command-scoped
   secrets, wait, terminate residual phase processes, and verify cleanup;
9. invoke fixed evaluator/post-evaluator phases with only their separately
   declared secrets, applying the same wait and cleanup boundary;
10. invoke the fixed secret-free `package` phase;
11. enforce both command and sandbox deadlines throughout;
12. collect remote result manifest and bounded artifact archive;
13. validate hashes, paths, sizes, schemas, and ownership locally;
14. record metrics/provenance; and
15. kill or explicitly pause in a `finally` path.

The fixed remote command family should resemble:

```text
/opt/youbencha/bin/run-cell prepare /work/input/cell.json
/opt/youbencha/bin/run-cell agent /work/input/cell.json
/opt/youbencha/bin/run-cell evaluate /work/input/cell.json
/opt/youbencha/bin/run-cell post-evaluate /work/input/cell.json
/opt/youbencha/bin/run-cell package /work/input/cell.json
```

Phase names come from a closed internal enum. All user-controlled values are
written to the manifest, not concatenated into these commands. Implementing
this protocol requires extracting phase-capable orchestration from the current
single-call `Orchestrator`; it does not move adapter command construction out of
the adapters.

### Runner protocol

The runner template MUST expose a versioned protocol manifest containing:

- protocol version;
- exact youBencha runner/package version;
- Node and Git versions;
- installed harness types and versions;
- supported adapter schema versions;
- template/build identity when available; and
- artifact protocol version and limits.

The control plane MUST reject incompatible major protocol versions before agent
execution. It MUST reject harness-version mismatch in strict mode. Release
templates MUST pin harness installations and disable harness auto-update where
the harness supports it.

Every selected target declares a preferred template. For each task/target cell,
the planner computes the full required capability set: the system-under-test
harness plus any evaluator judge harnesses. The resolved template MUST
advertise that complete set. A suite may therefore use multiple resolved builds
in one experiment; the planner validates and prints every cell-to-build mapping
before creating any sandbox.

### Source and fixture setup

MVP supports the current public HTTPS repository model and exact commit
resolution. Private repositories are a later milestone.

Fixture snapshot mode MUST:

- prepare one exact test-case source/setup state without model credentials;
- run only setup steps explicitly declared cacheable;
- prohibit snapshot creation after any target secret is exposed;
- prohibit snapshot creation after any source/setup credential is exposed
  unless a provider-specific scrub-and-attest design is approved later;
- ensure no setup child process remains running when the snapshot is taken,
  because E2B snapshots include memory and processes;
- bind the snapshot cache key to template build, source commit, test config,
  cacheable setup config, and runner protocol;
- create a fresh execution sandbox from the snapshot per attempt; and
- delete/reconcile snapshots according to explicit retention policy.

If any condition cannot be proven, the provider MUST run the attempt from the
base template instead of accepting a stale/unsafe snapshot. A fixture snapshot
is reusable only within the same resolved template build. Different
harness-specific templates can share a logical source/setup input hash, but
MUST NOT claim byte-identical full environments.

### Artifact protocol

The remote runner writes:

```text
/work/output/
  manifest.json
  artifacts.tar.zst
```

The manifest includes:

- experiment/cell/attempt IDs;
- result schema/protocol version;
- every artifact path, uncompressed size, compressed size, and SHA-256;
- total archive sizes;
- remote result path;
- runner completion status; and
- redaction/truncation markers.

The control plane MUST:

- cap compressed and declared uncompressed size;
- reject absolute paths, `..`, device paths, duplicate normalized paths,
  symlinks/hardlinks that escape, and undeclared files;
- extract only below the attempt artifact directory;
- hash-verify before accepting completion;
- validate `results.json` and logs with current schemas;
- sanitize remote absolute paths in retained results; and
- avoid downloading the mutable repository by default.

Archive hashes prove transfer completeness and manifest consistency. They do
not make output from a compromised sandbox trustworthy.

### Security profiles

Provider network semantics:

- `inbound: none` is the default.
- `outbound: none` is the default for no-model/offline evaluation.
- `outbound: allowlist` is recommended for model-backed targets.
- `outbound: unrestricted` requires an explicit opt-in, is shown as a warning,
  and is rejected by strict reproducibility mode.
- If the selected E2B API cannot enforce a configured allowlist exactly, the
  run fails before sandbox creation; it MUST NOT widen to unrestricted.

Network policy is resolved per target. The sandbox's effective allowlist is the
explicit union needed by its source/setup, selected harness/model, and
evaluators because the design does not depend on changing network policy
between phases. Planning prints that union and warns when a requested hostname
cannot be represented exactly by the provider.

Secret semantics:

- secret values cannot appear in suite/effective config;
- only environment-backed secret references are required for MVP;
- secret source presence is checked locally without printing its value;
- every phase starts from a documented minimal environment allowlist
  (`PATH`, isolated `HOME`, locale, and runner-required values) rather than
  forwarding the local or template login environment wholesale;
- a secret MUST be scoped to targets/components and phases such as `source`,
  `agent`, or `evaluator`;
- E2B control credentials cannot be selected as sandbox secrets;
- redaction uses both secret names/patterns and exact runtime values;
- secret files, if added later, use a temporary private directory and are
  removed before artifact collection; and
- no snapshot can be created after a secret-bearing phase.

Command scoping is exposure minimization, not an in-guest confidentiality
boundary. The runner MUST terminate the prior phase's process group before
injecting a different phase's credentials. A future higher-assurance profile
may place agent execution and evaluation in separate sandboxes.

Template semantics:

- template source/build scripts are version controlled;
- releases resolve and record immutable build IDs;
- no credentials are baked into templates;
- runner and harness operate as non-root;
- production templates are minimal capability-specific builds derived from a
  reviewed common base; a multi-harness build is allowed when the task/target
  capability set requires it, while an unnecessary all-harness build requires
  explicit approval;
- runtime harness/package installation is disabled in strict mode; and
- the template does not run a public service.

E2B CPU and memory allocation are properties of the resolved template build in
the currently documented API. Suite policy therefore declares expected
resources and validates the resolved sandbox; it does not imply per-sandbox
resource overrides.

### Scheduling and idempotency

Persisted attempt state adds:

```text
provider_state:
  provider: e2b
  lifecycle: creating|running|collecting|killing|paused|killed|lost
  sandbox_id: optional
  ownership_nonce_hash: optional
  created_at: optional
  last_observed_at: optional
  intended_expiry_at: optional
```

Requirements:

- one attempt ID maps to at most one accepted sandbox;
- sandbox metadata includes the attempt identity and ownership nonce hash;
- reconciliation never controls a sandbox without matching experiment,
  attempt, and ownership metadata;
- provider rate limits are classified independently from test failures;
- infrastructure retries get a new attempt ID and sandbox;
- a test/evaluator failure is not retried as infrastructure;
- cancellation calls sandbox kill rather than waiting for the inner harness
  timeout; and
- cleanup errors are warnings plus reconcilable state, not silent success.

Scaled execution uses a per-target ramp-up/circuit breaker. Until one cell
confirms harness authentication and requested model resolution, at most the
configured initial cell count is released for that target. A deterministic
target/model-unavailable error opens the circuit and marks remaining target
cells unavailable without retrying or creating more sandboxes. Transient
provider throttling follows the bounded infrastructure retry policy instead.
An optional explicit live model probe may release the circuit earlier, but its
token/cost usage must be reported.

Creation does not assume provider-side idempotency. After a crash in the
create/persist gap, reconciliation lists sandboxes by attempt metadata: zero
matches allows a new create, one valid match can be adopted, and multiple
matches are killed and treated as an infrastructure failure requiring review.
youBencha sandbox list/reap/kill commands refuse to mutate sandboxes that do
not carry valid youBencha ownership metadata for the configured project/team
scope.

### Deadlines

Four deadlines are distinct:

1. the experiment duration budget stops scheduling new cells;
2. setup/agent/evaluator phase deadlines bound their commands;
3. the sandbox TTL exceeds the phase deadline by an explicit artifact
   collection/cleanup grace period; and
4. an outer control-plane watchdog kills the sandbox if SDK command waiting or
   TTL behavior fails.

Planning MUST reject internally inconsistent deadlines. A sandbox timeout is
not a substitute for the adapter's agent timeout.

### Baseline model

Persisted baseline storage has two layers:

1. immutable content-addressed snapshots; and
2. mutable channels with append-only local audit records.

Mapped comparison creates a target-specific projection:

- candidate `variant:<candidate_target>` is compared with baseline
  `variant:<baseline_target>` and reported as scope `target`;
- candidate `testcase_variant:<case>:<candidate_target>` is compared with the
  corresponding baseline aggregate and reported as `testcase_target`; and
- whole-experiment and testcase-only aggregates are excluded because they may
  combine unrelated targets.

A comparison baseline source is one of:

- an immutable snapshot, channel, or result path; or
- another target in the current run.

Current-run comparison requires both targets in the effective plan and uses the
same target-specific projection. Profiles explicitly select comparison IDs, so
a candidate-only job does not attempt a current-run comparison.

Test-case IDs must still match unless a future explicit case mapping is added.
Rules declare a minimum sample size and what to do with insufficient,
incomplete, or measurement-quality-incompatible data. The default is
`partial`, never silent pass. `minimum_samples` is checked against recorded
metric `sample_size`, not merely the planned repetition count: the candidate
for absolute rules and both candidate and baseline for relative rules.

Historical baselines can outlive a retired model, but they are not
contemporaneous A/B measurements. Before retirement, the recommended promotion
workflow interleaves incumbent and candidate targets in one overlap run,
reviews per-case variance, then promotes the candidate target recorded in that
immutable overlap result.

A channel records the default promoted target alongside the snapshot digest so
future comparisons can resolve `baseline_target` explicitly or from the channel
metadata. A channel promotion MUST NOT modify an immutable snapshot. Local
channel audit hashes detect accidental corruption but do not protect against an
attacker who can rewrite the store. Existing version 1 immutable names remain
supported.

The MVP channel store is local. Ephemeral CI jobs must check out, restore, or
download the referenced baseline store/result before comparison; the CLI does
not imply cross-runner persistence. Authenticated shared baseline storage is a
later production-hardening milestone.

### Provenance additions

Every E2B cell records non-secret fields:

- provider `e2b`;
- E2B SDK version;
- sandbox ID;
- template reference, template ID, and resolved build ID;
- fixture snapshot ID/cache key when used;
- runner protocol and youBencha version;
- requested/resolved harness version;
- requested/resolved model;
- secure-controller access enabled;
- effective inbound/outbound policy and whether it degraded;
- CPU, memory, disk allocation where reported;
- lifecycle/retention outcome;
- sandbox start/end/runtime and available CPU/memory/disk metrics;
- artifact archive/manifest hashes; and
- source commit and effective redacted config already captured today.

E2B access tokens, API keys, and exact secret values are prohibited fields.

## Functional requirements

- **FR-001:** Add `e2b` as an opt-in execution provider without changing adapter
  command ownership.
- **FR-002:** Execute every attempt in a fresh sandbox or fresh sandbox forked
  from a secret-free snapshot.
- **FR-003:** Never silently fall back to `host-trusted`.
- **FR-004:** Add case and target selection usable by both plan and run.
- **FR-005:** Add a one-command regression workflow over the experiment engine.
- **FR-006:** Add explicit candidate-to-baseline target mapping.
- **FR-007:** Add immutable baseline snapshots plus atomically movable channels.
- **FR-008:** Verify runner protocol, template build, and harness version before
  paid model execution.
- **FR-009:** Use secured E2B controller access and record the effective state.
- **FR-010:** Keep `E2B_API_KEY` out of sandbox environment, files, commands,
  logs, results, and artifacts.
- **FR-011:** Inject only target/component/phase-declared secrets and redact
  their values.
- **FR-012:** Fail closed on unsupported network/resource/security policy.
- **FR-013:** Meter both active attempts and sandbox creation rate.
- **FR-014:** Persist remote lifecycle ownership so interruption can reconcile.
- **FR-015:** Kill sandboxes on all terminal paths by default.
- **FR-016:** Validate a bounded manifest/archive before accepting remote output.
- **FR-017:** Preserve current aggregation, regression exit codes, and reports.
- **FR-018:** Record complete provider/toolchain/model provenance.
- **FR-019:** Classify test failure, harness/model unavailability, provider rate
  limit, timeout, artifact failure, and cleanup failure distinctly.
- **FR-020:** Preserve version 1 experiment compatibility.
- **FR-021:** Add a target-neutral version 2 task schema and compile it with one
  selected target without cross-adapter config merging.
- **FR-022:** Project only target-specific aggregate scopes for mapped baseline
  comparison.
- **FR-023:** Enforce minimum samples and explicit incomplete-data behavior for
  regression rules.
- **FR-024:** Interleave targets deterministically during comparative runs.
- **FR-025:** Validate template-owned CPU/memory expectations rather than
  promising unsupported per-sandbox overrides.
- **FR-026:** Add named selection profiles so CI can trigger bounded smoke,
  overlap, nightly, and release plans from one suite.
- **FR-027:** Support both persisted and current-run target sources for mapped
  comparison without introducing a second aggregation format.
- **FR-028:** Add per-target ramp-up and circuit breaking so a retired,
  unauthorized, or invalid model does not fail concurrently across the entire
  matrix.
- **FR-029:** Resolve and verify the complete per-cell harness capability set,
  including independent agentic-judge harnesses, before execution.

## Non-functional requirements

- **NFR-001 Security:** Default policies minimize inbound traffic, outbound
  traffic, secrets, privilege, retained data, and downloaded artifacts.
- **NFR-002 Reproducibility:** Strict mode requires immutable environment
  identity and exact toolchain compatibility.
- **NFR-003 Portability:** Host execution continues on supported operating
  systems; E2B execution clearly reports Linux guest constraints.
- **NFR-004 Reliability:** State transitions are atomic and resume does not
  duplicate accepted completed work.
- **NFR-005 Scale:** The scheduler supports provider-plan concurrency without
  assuming a specific E2B tier.
- **NFR-006 Observability:** Each provider failure identifies experiment, cell,
  attempt, sandbox when safe, phase, and remediation.
- **NFR-007 Cost honesty:** Model and sandbox usage are reported separately;
  unavailable cost is labeled unavailable rather than guessed as measured.
- **NFR-008 Testability:** Default tests use a fake E2B client and local artifact
  fixtures; live E2B tests are opt-in and bounded.

## Edge cases

- Sandbox creation succeeds but local state persistence fails.
- Local state says `creating` and no sandbox ID was recorded.
- Sandbox exists but command connection is lost.
- The harness exits successfully but the artifact manifest is missing.
- Results are valid but cleanup/kill fails.
- A configured template tag resolves to a different build than expected.
- Harness `--version` output is missing or unparsable.
- Requested model is retired, renamed, forbidden, or silently resolved to a
  different model.
- The provider rejects network allowlist syntax.
- The source repository exceeds disk or setup timeout.
- A setup step needs a target secret and therefore cannot be snapshotted.
- An archive is compressed small but declares/extracts extremely large.
- Artifact paths differ only by case on a case-insensitive local filesystem.
- A paused debug sandbox outlives the machine that started it.
- Baseline channel advances between candidate comparison and promotion.
- Candidate and baseline contain different test-case sets.
- E2B account concurrency or spend limit is exhausted mid-experiment.
- An agent leaves credential-bearing child processes running before evaluator
  execution.
- Two sandboxes exist with metadata for the same attempt after a crash.
- Candidate and incumbent were measured at different times and provider
  behavior changed between runs.

## Success criteria

- **SC-001:** A selected one-case/one-target run creates exactly one attempt
  sandbox and returns the normal youBencha result/report/exit code.
- **SC-002:** A 100-cell fake-provider test never exceeds configured active or
  creation-rate bounds and never reuses mutable sandboxes.
- **SC-003:** Cancellation transitions every owned active sandbox to killed or
  explicitly reconcilable cleanup-failed state.
- **SC-004:** Secret-canary tests find zero canary values in configs, commands,
  logs, results, state, reports, and artifact names/content after redaction.
- **SC-005:** Malicious archive traversal/symlink/size fixtures are all rejected
  before extraction outside the attempt directory.
- **SC-006:** Replacing only target harness/model runs the unchanged suite.
- **SC-007:** A differently named candidate compares with a mapped historical
  target and can advance a baseline channel without rerunning the baseline.
- **SC-008:** Strict mode rejects template-build drift, harness-version drift,
  model-resolution drift when detectable, and unrestricted egress.
- **SC-009:** Version 1 experiment contract and integration tests remain green.
- **SC-010:** Live opt-in smoke coverage can run one inexpensive sandbox, collect
  a no-agent fixture result, and confirm teardown without requiring a paid
  model.
- **SC-011:** A version 2 task contains no agent, and compiling it with Codex
  then Claude produces two independently validated configs with no
  adapter-specific key leakage.
- **SC-012:** Mapped comparisons never use whole-experiment/testcase aggregates
  containing unrelated targets and return partial below the configured sample
  floor.
- **SC-013:** A crash immediately after sandbox creation is reconciled by
  metadata without accepting duplicate owned sandboxes.
- **SC-014:** A named profile expands to a deterministic effective plan, is
  included in identity/provenance, and cannot be resumed with different
  selection overrides.
- **SC-015:** An overlap profile compares interleaved candidate/incumbent
  targets from the same run, while a candidate-only profile executes only its
  configured persisted-baseline comparisons.
- **SC-016:** A deterministic model-unavailable response from the first target
  cell prevents creation of the remaining target sandboxes and is never
  retried as a test failure.
- **SC-017:** Planning rejects a template that contains the target harness but
  omits a judge harness required by the selected task.

## Open implementation validations

These require checking the selected E2B SDK version rather than guessing from
documentation:

1. Exact network allowlist entry syntax and hostname/CIDR semantics.
2. Whether network policy can change after creation; the specification does not
   depend on that capability.
3. Exact immutable template/build identifier accepted by `Sandbox.create`.
4. Command cancellation behavior and whether kill alone is the reliable
   cross-process-tree stop primitive.
5. Maximum practical artifact file size through the selected file API.
6. Availability and precision of account/sandbox cost data.
7. Snapshot deletion/listing APIs and limits for the chosen plan.

Any unavailable control must be surfaced as an unsupported capability. It must
not be approximated silently.
