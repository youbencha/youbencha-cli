# Implementation plan: E2B regression execution

**Status:** Implemented through Milestone 5; Milestones 6-7 remain gated  
**Last reviewed:** 2026-07-27  
**Specification:** [spec.md](./spec.md)  
**Research:** [research.md](./research.md)

## Architectural approach

Use the current experiment engine as the control plane and introduce E2B first
as a `SingleRunExecutor`. This proves the remote protocol with minimal churn:

```text
suite/experiment loader
  -> target/case filtered planner
  -> existing scheduler, retry, budget, state store
  -> SingleRunExecutor
       -> host: OrchestratorSingleRunExecutor
       -> remote: E2BSingleRunExecutor
            -> secured E2B sandbox
            -> fixed multi-phase remote runner protocol
            -> phase-capable orchestration + current adapters/evaluators
            -> bounded artifact bundle
  -> existing aggregation, comparison, reports, exit codes
```

After this is stable, promote the seam into the broader execution-provider
interface already anticipated by `docs/phase-3-implementation-plan.md`.

## Proposed source layout

```text
src/
  execution/
    provider.ts
    host-trusted.ts
    policies.ts
    secrets.ts
    remote-artifacts.ts
    e2b/
      client.ts
      executor.ts
      lifecycle.ts
      rate-limiter.ts
      reconciliation.ts
      provenance.ts
      runner-protocol.ts
  baselines/
    snapshot-store.ts
    channel-store.ts
    promotion-audit.ts
  regression/
    selection.ts
    task-compiler.ts
    aggregate-projection.ts
    target-mapping.ts
    command.ts
  schemas/
    execution-provider.schema.ts
    e2b.schema.ts
    suite-v2.schema.ts
    baseline-channel.schema.ts
runner/
  e2b/
    template.ts
    protocol/
    scripts/
```

Built-in adapter code stays under `src/adapters/`.

## Milestone 1 — Regression ergonomics without E2B

Deliver:

Stage 1A — suite and plan identity:

- target-neutral version 2 task schema and task+target compiler;
- reusable targets with harness-version constraints;
- named smoke/overlap/nightly/release selection profiles;
- `--case` and `--target` planning filters;
- deterministic round-robin target scheduling.

Stage 1B — regression and promotion:

- candidate-to-baseline projection over `variant` and `testcase_variant`
  aggregates, using persisted or current-run target sources;
- minimum-sample and incomplete-data regression policy;
- immutable baseline snapshots and movable channels;
- `yb regress`, `yb baseline show`, and `yb baseline promote`;
- provenance/result schema evolution and migrations.

Why first:

- the model-retirement workflow can be tested with the existing host executor;
- filtered plans reduce E2B development cost;
- baseline semantics should not be coupled to one provider.

Acceptance:

- one suite supports a one-case smoke run and a full matrix;
- named profiles produce deterministic, identity-bound plans and resume rejects
  selection drift;
- compiling one task with two harness types produces independently validated
  adapter configs without cross-type key leakage;
- a Claude candidate can compare with a Codex target in a historical baseline;
- an overlap profile compares interleaved incumbent/candidate targets from its
  current result without affecting candidate-only profiles;
- mapped comparison excludes aggregates containing unrelated targets and
  becomes partial below its configured sample floor;
- promotion advances a channel while preserving both immutable snapshots;
- version 1 experiment behavior is unchanged.

## Milestone 2 — E2B runner protocol and no-agent smoke path

Deliver:

- pinned E2B SDK dependency;
- versioned remote runner protocol;
- version-controlled common E2B template base with Node 20+, Git, and the
  youBencha runner protocol;
- fake client and deterministic artifact fixtures;
- one live opt-in no-agent smoke test;
- template/build and protocol provenance;
- resolved template CPU/memory expectation verification.

Acceptance:

- the control plane creates a secured sandbox, invokes a constant runner
  phase command, downloads a valid fixture bundle, and kills the sandbox;
- the E2B API key is absent from remote environment/artifacts;
- template build mismatch fails before execution;
- resolved template resource mismatch fails before paid execution;
- default tests need no E2B account or network.

## Milestone 3 — Full one-case execution

Deliver:

- `E2BSingleRunExecutor`;
- source checkout at exact commit;
- target/component/phase-scoped command environment;
- process-group cleanup between separately credentialed phases;
- phase-capable orchestration reusing current adapters and evaluators;
- remote result/archive packaging;
- bounded secure extraction and remote-path sanitization;
- failure classification and immediate cancellation by sandbox kill.

Acceptance:

- an offline fake harness completes a real repository task inside E2B;
- current evaluators and reports consume the remote result unchanged;
- malicious artifacts are rejected;
- all terminal paths attempt teardown;
- retained local artifacts are sufficient to diagnose a normal failure without
  downloading the whole workspace.

## Milestone 4 — Harness templates and secure secrets

Deliver:

- exact supported Codex, Claude Code, and Copilot CLI installations in minimal
  capability-specific template builds derived from a reviewed common base;
- per-target template and effective network-policy resolution;
- per-cell verification that the template covers both target and evaluator
  harness capabilities;
- runner toolchain manifest and version checks;
- secret-reference schema with target, component, and phase scoping;
- network-policy capability validation;
- strict reproducibility profile;
- model/harness unavailability diagnostics.

Acceptance:

- at least two harnesses run the same task by changing only the target;
- secret canaries do not survive redaction into retained outputs;
- a secret from one phase is absent from the next phase and no prior
  credential-bearing process remains alive;
- unrestricted egress is explicit and rejected by strict mode;
- harness or model drift is visible and policy-enforceable.

## Milestone 5 — Scale, resume, and reconciliation

Deliver:

- sandbox creation token bucket with jittered retry;
- per-target ramp-up and deterministic target/model-unavailable circuit breaker;
- create/persist-gap adoption by attempt metadata, including duplicate cleanup;
- persisted remote lifecycle state and ownership metadata;
- resume reconciliation;
- `yb sandbox list`, `reap`, and `kill`;
- E2B metrics collection and separate sandbox-runtime budgeting;
- opt-in pause-on-failure debugging.

Acceptance:

- high-concurrency fake tests prove active/creation bounds;
- a model-unavailable first cell prevents the remaining target fan-out without
  misclassifying the result as task failure;
- interruption neither leaks accepted duplicate attempts nor loses ownership
  data;
- cleanup failures remain discoverable and reapable;
- reports distinguish model cost, sandbox runtime, and unavailable provider
  cost.

## Milestone 6 — Secret-free fixture snapshots

Deliver:

- explicit cacheable fixture setup phase;
- snapshot cache identity and lifecycle;
- fan-out from one exact prepared test fixture;
- automatic fallback to base template when snapshot safety is not provable;
- snapshot reconciliation and deletion.

Acceptance:

- repetitions using the same template build start from byte-identical prepared
  state, while cross-template runs share a logical source/setup hash without a
  false byte-identity claim;
- no source, target, model, or evaluator credential exists before snapshot
  creation, and no setup child process remains alive;
- snapshot cache invalidates on source, setup, template build, runner protocol,
  or relevant config changes;
- setup time is amortized without execution-sandbox reuse.

## Milestone 7 — Private repositories and production hardening

Deliver:

- short-lived HTTPS repository credential references;
- redirect/host policy and credential redaction;
- signed/shared baseline storage option for CI;
- lifecycle event/webhook integration where operationally useful;
- threat model, incident cleanup guide, and operator documentation;
- opt-in bounded live suites for supported harnesses.

Acceptance:

- private source credentials never appear in stored URL/config/args/logs;
- baseline channels can be shared safely between CI jobs;
- an orphaned-sandbox drill demonstrates detection and cleanup;
- package, lint, build, targeted tests, and supported CI matrix pass.

## Test strategy

### Default hermetic tests

- fake E2B client for creation, commands, files, metrics, pause, kill, and list;
- deterministic sandbox state-machine/property tests;
- scheduler creation-rate/concurrency tests with a fake clock;
- interruption at every persisted lifecycle transition;
- artifact traversal, symlink, duplicate path, case collision, hash mismatch,
  decompression bomb, and schema mismatch fixtures;
- exact-value secret canaries across every retained surface;
- version 1/2 normalization and result migrations;
- task+target compilation across adapter types with no config leakage;
- baseline channel compare-and-swap races and audit integrity;
- persisted/current-run target projection and minimum-sample behavior;
- create/persist-gap crash recovery with zero, one, and multiple metadata
  matches;
- per-target ramp-up and circuit-breaker classification;
- phase-secret process cleanup and deadline hierarchy.

### Opt-in live tests

- create/kill secured base sandbox;
- fixed no-agent runner fixture;
- network deny verification;
- one template protocol/toolchain verification;
- one bounded fake-harness repository run;
- separately gated paid-model smoke tests for each supported harness.

Live tests must have explicit environment flags, short deadlines, a maximum
sandbox count, and cleanup in both test and suite teardown.

## Security review gates

Before E2B beta:

- threat-model trust boundaries: local control plane, E2B API, sandbox
  controller, runner, repository, harness/model provider, and artifacts;
- verify actual network semantics with the selected SDK;
- inspect sandbox process environment and artifacts for canary secrets;
- inspect template for credentials, root usage, public listeners, moving
  package versions, and unnecessary tools;
- test kill behavior against child process trees;
- review archive extraction independently;
- prove no host fallback path on E2B errors.

Before scaled/general availability:

- orphan/reconciliation chaos test;
- provider rate-limit and spend-exhaustion test;
- baseline promotion race test;
- private repository redirect/credential test;
- template build provenance and rollback drill.

## Rollout and compatibility

1. Ship suite v2/regression UX with `host-trusted`.
2. Release E2B no-agent preview behind explicit provider configuration.
3. Add one supported harness/template combination.
4. Add the remaining built-in harnesses after individual conformance tests.
5. Enable scaled runs after lifecycle reconciliation is proven.
6. Add snapshots only after secret-free setup phases are explicit.
7. Add private repositories after credential and redirect review.

Never change the default provider to E2B automatically. Never describe
`host-trusted` as sandboxed. Never describe E2B execution as preventing a
sandboxed repository from reading a credential intentionally exposed inside
that sandbox.
